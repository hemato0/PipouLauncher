// Configuration persistante du launcher (userData/config.json).
// Sert notamment à stocker l'ID d'application Azure (client_id), les comptes, les
// profils de mods, la version/RAM par profil, etc.
//
// Écritures ATOMIQUES (fichier temporaire + rename) : une lecture concurrente ne
// tombe JAMAIS sur un fichier à moitié écrit.
//
// PIÈGE WINDOWS #1 (verrou) : quand `rename` remplace config.json, une lecture
// concurrente peut échouer BRIÈVEMENT (EPERM/EBUSY/UNKNOWN — verrou OS/antivirus).
// PARADE : un CACHE MÉMOIRE fait office de source de vérité (mono-instance). Une lecture
// qui échoue renvoie la DERNIÈRE valeur connue au lieu de jeter — jamais `{}`.
//
// PIÈGE WINDOWS #2 (corruption) : après un CRASH / coupure de courant, NTFS peut laisser
// un fichier récemment écrit rempli de ZÉROS/espaces (la taille est là, les données non).
// config.json devient alors illisible et les comptes semblent perdus. PARADE : une
// SAUVEGARDE `config.json.bak` (dernier état bon) est écrite à chaque mise à jour, et si le
// principal est illisible/vide sans cache, on RESTAURE automatiquement depuis la sauvegarde.

const { app } = require('electron')
const fsp = require('fs/promises')
const path = require('path')

function configPath() { return path.join(app.getPath('userData'), 'config.json') }
function bakPath() { return configPath() + '.bak' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Dernière config lue/écrite avec succès. Mono-instance => source de vérité fiable.
let cache = null

// Lit + parse un fichier JSON, robuste aux verrous et à la corruption. Renvoie :
//  - l'objet parsé si OK ;
//  - `undefined` si le fichier est ABSENT (ENOENT) ;
//  - `null` s'il est illisible (verrou persistant) OU vide/tout-blanc (corruption NTFS) OU
//    JSON invalide après tous les essais. Ne jette JAMAIS.
async function readJson(p) {
  for (let attempt = 0; attempt < 12; attempt++) {
    let raw
    try {
      raw = await fsp.readFile(p, 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') return undefined
      await sleep(30 + attempt * 20); continue // EBUSY/EPERM/EACCES/UNKNOWN : verrou -> retry
    }
    // Fichier NON vide mais entièrement blanc = corruption (NTFS l'a rempli de zéros/espaces
    // après un crash). Inutile de réessayer : ça ne se réparera pas seul -> illisible.
    if (raw.length > 0 && raw.trim().length === 0) return null
    try { return JSON.parse(raw) }
    catch (_) { await sleep(30 + attempt * 20) } // JSON incomplet (write en cours) -> retry
  }
  return null // toujours illisible après tous les essais
}

// Config principale : ABSENT -> {} (nouvelle install) ; sinon voir readJson.
async function readRaw() {
  const v = await readJson(configPath())
  return v === undefined ? {} : v
}

// Rename ATOMIQUE avec retry : symétrique de readJson. Sous Windows, le rename qui remplace
// config.json peut échouer BRIÈVEMENT si l'antivirus/l'OS verrouille la cible — sans retry,
// un compte fraîchement authentifié ne serait pas persisté. On réessaie ~1,7 s.
async function renameWithRetry(tmp, p) {
  let lastErr
  for (let attempt = 0; attempt < 12; attempt++) {
    try { await fsp.rename(tmp, p); return }
    catch (e) {
      lastErr = e
      if (e.code === 'ENOENT') throw e // le tmp a disparu : anomalie, pas un verrou
      await sleep(30 + attempt * 20)
    }
  }
  throw lastErr
}

const isEmpty = (o) => !o || Object.keys(o).length === 0

// Écrit la SAUVEGARDE de secours (config.json.bak) — best-effort. Écrite APRÈS le config
// principal, donc au pire elle a une version de retard ; une corruption simultanée des deux
// fichiers (écrits à des instants différents) est extrêmement improbable.
async function writeBak(obj) {
  try {
    const tmp = `${bakPath()}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(obj, null, 2))
    await renameWithRetry(tmp, bakPath())
  } catch (_) { /* la sauvegarde n'est pas critique */ }
}

// Lit la config. Repli sur le cache mémoire dès que le disque renvoie quelque chose de
// DOUTEUX (illisible = null, OU vide = {} d'un ENOENT transitoire) pour ne JAMAIS écraser une
// bonne config. Si aucun cache et principal illisible : AUTO-RÉPARATION depuis config.json.bak.
async function getConfig() {
  const fresh = await readRaw()
  // Vraie config lue (non vide) -> source de vérité.
  if (fresh !== null && !isEmpty(fresh)) { cache = fresh; return fresh }
  // fresh est null (illisible/corrompu) ou {} (ENOENT/vide) : NE PAS empoisonner un bon cache.
  if (!isEmpty(cache)) return cache
  // Pas de cache utile : on tente la SAUVEGARDE de secours (répare une corruption au boot).
  const bak = await readJson(bakPath())
  if (bak && !isEmpty(bak)) {
    cache = bak
    // Restaure config.json depuis la sauvegarde pour que les lectures suivantes réussissent.
    try {
      const tmp = `${configPath()}.${process.pid}.heal.tmp`
      await fsp.writeFile(tmp, JSON.stringify(bak, null, 2))
      await renameWithRetry(tmp, configPath())
    } catch (_) {}
    return bak
  }
  // Ni config, ni cache, ni sauvegarde : un {} d'ENOENT = vrai premier lancement légitime.
  if (fresh !== null) { cache = fresh; return fresh }
  throw new Error('config.json illisible (verrou fichier persistant).')
}

// File d'attente : sérialise les écritures d'un même processus.
let writeChain = Promise.resolve()

// Mutation ATOMIQUE : relit l'état frais, applique le mutator, écrit dans un fichier
// temporaire puis renomme (remplacement atomique). Met à jour le cache ET la sauvegarde.
async function updateConfig(mutator) {
  const run = writeChain.then(async () => {
    const cur = await getConfig() // peut throw seulement si aucun cache ni sauvegarde -> pas d'écriture
    const next = await mutator(cur)
    const p = configPath()
    const tmp = `${p}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2))
    try {
      await renameWithRetry(tmp, p) // atomique (remplace l'ancien d'un coup), avec retry
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {}) // pas de .tmp orphelin qui traîne
      throw e
    }
    cache = next             // le cache reflète le disque
    await writeBak(next)     // met à jour la sauvegarde de secours (dernier état bon connu)
    return next
  })
  writeChain = run.catch(() => {}) // la file survit à une erreur
  return run
}

async function setConfig(patch) { return updateConfig(cur => ({ ...cur, ...patch })) }

module.exports = { getConfig, setConfig, updateConfig }
