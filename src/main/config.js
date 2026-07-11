// Configuration persistante du launcher (userData/config.json).
// Sert notamment à stocker l'ID d'application Azure (client_id), les comptes, les
// profils de mods, la version/RAM par profil, etc.
//
// Écritures ATOMIQUES (fichier temporaire + rename) : une lecture concurrente ne
// tombe JAMAIS sur un fichier à moitié écrit.
//
// PIÈGE WINDOWS corrigé : quand `rename` remplace config.json, une lecture
// concurrente peut échouer BRIÈVEMENT (EPERM/EBUSY/UNKNOWN — verrou OS/antivirus).
// Symptôme observé = compte "perdu" au démarrage (JOUER grisé) alors que le fichier
// est intact. PARADE : un CACHE MÉMOIRE fait office de source de vérité (le launcher
// est mono-instance). Une lecture qui échoue renvoie la DERNIÈRE valeur connue au
// lieu de jeter — jamais `{}` qui écraserait tout au prochain write.

const { app } = require('electron')
const fsp = require('fs/promises')
const path = require('path')

function configPath() { return path.join(app.getPath('userData'), 'config.json') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Dernière config lue/écrite avec succès. Mono-instance => source de vérité fiable.
let cache = null

// Lit le fichier brut. ABSENT -> {} (nouvelle install). Illisible (write en cours ou
// verrou Windows) -> RÉESSAIE longuement (jusqu'à ~1,7 s), puis renvoie null (l'appelant
// décidera de replier sur le cache). Ne jette JAMAIS ici.
async function readRaw() {
  for (let attempt = 0; attempt < 12; attempt++) {
    let raw
    try {
      raw = await fsp.readFile(configPath(), 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') return {}
      await sleep(30 + attempt * 20); continue // EBUSY/EPERM/EACCES/UNKNOWN : verrou -> retry
    }
    try { return JSON.parse(raw) }
    catch (_) { await sleep(30 + attempt * 20) } // JSON incomplet (write en cours) -> retry
  }
  return null // toujours illisible après tous les essais
}

const isEmpty = (o) => !o || Object.keys(o).length === 0

// Lit la config. Repli sur le cache mémoire dès que le disque renvoie quelque chose
// de DOUTEUX (illisible = null, OU vide = {} d'un ENOENT transitoire), pour ne JAMAIS
// écraser une bonne config déjà connue. On ne renvoie {} QUE lors d'un vrai premier
// lancement (aucun cache). C'est ce qui empêche un compte de "disparaître" au boot.
async function getConfig() {
  const fresh = await readRaw()
  // Vraie config lue (non vide) -> source de vérité.
  if (fresh !== null && !isEmpty(fresh)) { cache = fresh; return fresh }
  // fresh est null (illisible) ou {} (ENOENT/vide) : NE PAS empoisonner un bon cache.
  if (!isEmpty(cache)) return cache // on a déjà une config à comptes -> on la garde
  // Pas de cache utile : un {} d'ENOENT = vrai premier lancement légitime.
  if (fresh !== null) { cache = fresh; return fresh }
  throw new Error('config.json illisible (verrou fichier persistant).')
}

// File d'attente : sérialise les écritures d'un même processus.
let writeChain = Promise.resolve()

// Mutation ATOMIQUE : relit l'état frais, applique le mutator, écrit dans un fichier
// temporaire puis renomme (remplacement atomique). Met à jour le cache. Si la relecture
// échoue même avec repli cache (1re install jamais lue), on N'ÉCRIT PAS -> aucune perte.
async function updateConfig(mutator) {
  const run = writeChain.then(async () => {
    const cur = await getConfig() // peut throw seulement si aucun cache -> on n'écrit rien
    const next = await mutator(cur)
    const p = configPath()
    const tmp = `${p}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2))
    await fsp.rename(tmp, p) // atomique (remplace l'ancien d'un coup)
    cache = next             // le cache reflète le disque
    return next
  })
  writeChain = run.catch(() => {}) // la file survit à une erreur
  return run
}

async function setConfig(patch) { return updateConfig(cur => ({ ...cur, ...patch })) }

module.exports = { getConfig, setConfig, updateConfig }
