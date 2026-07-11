// Abstraction des LOADERS de mods : Fabric, Quilt, Forge, NeoForge.
//
// Deux familles :
//   - META (Fabric, Quilt) : une API "meta" fournit un version-profile JSON prêt
//     à l'emploi + la liste des librairies à télécharger. Simple.
//   - INSTALLER (Forge, NeoForge) : on télécharge le JAR installer officiel et on
//     le lance en HEADLESS (--install-client). Il télécharge les libs et lance des
//     "processors" qui PATCHENT le client, puis écrit un version-profile JSON
//     standard (inheritsFrom = vanilla) que notre launch.js sait déjà lancer.
//
// Dans tous les cas, le résultat est un versions/<id>/<id>.json standard : la
// machinerie de lancement (fusion inheritsFrom + arguments.jvm/game) est commune.

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const { downloadFile } = require('./downloader')
const { installFabric, libraryDownloads } = require('./fabric')

const HEADERS = { 'User-Agent': 'perf-launcher/0.1.0 (launcher éducatif d\'optimisation)' }

const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge']
// Fichier témoin d'un install Forge/NeoForge MENÉ À TERME (anti « install partiel »).
const COMPLETE_MARKER = '.install-complete'
const LOADER_LABEL = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
// Fabric et Quilt chargent les mods Fabric ; Forge/NeoForge ont leur propre écosystème.
const FABRIC_LIKE = new Set(['fabric', 'quilt'])

function isValidLoader(l) { return LOADERS.includes(l) }

// ---------------------------------------------------------------------------
// META (Quilt) — calqué sur Fabric.
// ---------------------------------------------------------------------------
const QUILT_META = 'https://meta.quiltmc.org/v3'

async function getQuiltStableLoader(gameVersion) {
  const res = await fetch(`${QUILT_META}/versions/loader/${encodeURIComponent(gameVersion)}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Quilt Meta: HTTP ${res.status}`)
  const list = await res.json()
  if (!Array.isArray(list) || !list.length) throw new Error(`Aucun loader Quilt pour Minecraft ${gameVersion}.`)
  // Pas de booléen "stable" : le beta est marqué par le suffixe "-beta".
  const stable = list.find(x => x.loader && !/-beta/i.test(x.loader.version))
  return (stable || list[0]).loader.version
}

async function getQuiltProfile(gameVersion, loaderVersion) {
  const url = `${QUILT_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Quilt profil: HTTP ${res.status}`)
  return await res.json()
}

async function installQuilt(gameVersion, gameDir, loaderVersion, onProgress) {
  const lv = loaderVersion || await getQuiltStableLoader(gameVersion)
  const profile = await getQuiltProfile(gameVersion, lv)
  // mainClass peut être un objet {client, server} : on garde le client.
  if (profile.mainClass && typeof profile.mainClass === 'object') profile.mainClass = profile.mainClass.client

  const versionId = profile.id
  const verDir = path.join(gameDir, 'versions', versionId)
  await fsp.mkdir(verDir, { recursive: true })
  await fsp.writeFile(path.join(verDir, `${versionId}.json`), JSON.stringify(profile, null, 2))

  const libs = libraryDownloads(profile)
  const libRoot = path.join(gameDir, 'libraries')
  const results = []
  let done = 0
  for (const lib of libs) {
    if (onProgress) onProgress({ done, total: libs.length, name: lib.name, phase: 'start' })
    try { const r = await downloadFile(lib.url, path.join(libRoot, lib.path), lib.sha1); results.push({ name: lib.name, status: r.status }) }
    catch (e) { results.push({ name: lib.name, status: 'error', error: e.message }) }
    done++
    if (onProgress) onProgress({ done, total: libs.length, name: lib.name, phase: 'done' })
  }
  // Échec persistant d'une lib -> retire le profil écrit et throw (cf. installFabric),
  // sinon Quilt est vu « installé » alors que le classpath est incomplet.
  const failed = results.filter(r => r.status === 'error')
  if (failed.length) {
    await fsp.rm(path.join(verDir, `${versionId}.json`), { force: true }).catch(() => {})
    const names = failed.slice(0, 4).map(f => f.name).join(', ') + (failed.length > 4 ? '…' : '')
    throw new Error(`Installation Quilt incomplète : ${failed.length}/${libs.length} librairie(s) en échec (${names}).`)
  }
  return { loader: 'quilt', versionId, loaderVersion: lv, inheritsFrom: profile.inheritsFrom || gameVersion, libCount: libs.length, results }
}

// ---------------------------------------------------------------------------
// INSTALLER (Forge, NeoForge) — on lance le JAR installer officiel en headless.
// ---------------------------------------------------------------------------

// id du version-profile produit par l'installer (sert à trouver/idempoter).
function installerVersionId(loader, gameVersion, loaderVersion) {
  return loader === 'neoforge'
    ? `neoforge-${loaderVersion}`
    : `${gameVersion}-forge-${loaderVersion}`
}

// URL du JAR installer officiel.
function installerUrl(loader, gameVersion, loaderVersion) {
  if (loader === 'neoforge') {
    return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`
  }
  const combo = `${gameVersion}-${loaderVersion}`
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${combo}/forge-${combo}-installer.jar`
}

// Lance l'installer en headless. Résout à la sortie 0, rejette sinon.
// Garde-fous : -Djava.awt.headless empêche toute fenêtre Swing de BLOQUER,
// stdin fermé (un éventuel prompt reçoit EOF), et un délai max tue le process —
// la promesse se règle TOUJOURS (sinon le lancement resterait figé indéfiniment).
function runInstaller(javaPath, installerPath, gameDir, onProgress) {
  return new Promise((resolve, reject) => {
    // Le parser (partagé Forge/NeoForge) accepte --install-client <dir> sans GUI.
    const args = ['-Djava.awt.headless=true', '-jar', installerPath, '--install-client', gameDir]
    let out = '', settled = false, child, timer
    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child && child.kill() } catch (_) {}
      fn(arg)
    }
    try { child = spawn(javaPath, args, { cwd: gameDir, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { return reject(e) }
    timer = setTimeout(() => finish(reject, new Error(
      `installer ${path.basename(installerPath)} : délai dépassé (5 min), process arrêté.\n${out.slice(-600)}`)), 5 * 60 * 1000)
    const tail = (d) => {
      out += d
      const line = d.toString().split(/\r?\n/).filter(Boolean).pop()
      if (line && onProgress) onProgress({ phase: 'run', name: line.slice(0, 90) })
    }
    child.stdout.on('data', tail)
    child.stderr.on('data', tail)
    child.on('error', (e) => finish(reject, e))
    child.on('exit', (code) => code === 0
      ? finish(resolve, out)
      : finish(reject, new Error(`installer ${path.basename(installerPath)} : code ${code}\n${out.slice(-600)}`)))
  })
}

async function installViaInstaller(loader, gameVersion, gameDir, loaderVersion, javaPath, onProgress) {
  if (!loaderVersion) throw new Error(`Version ${LOADER_LABEL[loader]} manquante (requise pour l'installation).`)
  if (!javaPath) throw new Error('Java introuvable — requis pour lancer l\'installer.')

  const versionId = installerVersionId(loader, gameVersion, loaderVersion)
  const verDir = path.join(gameDir, 'versions', versionId)
  const verJson = path.join(verDir, `${versionId}.json`)
  const doneMarker = path.join(verDir, COMPLETE_MARKER)
  // On ne fait confiance qu'à un marqueur écrit APRÈS un install complet et vérifié.
  if (fs.existsSync(verJson) && fs.existsSync(doneMarker)) return { loader, versionId, cached: true }
  // Reste d'un install interrompu : on repart propre (l'installer patche le client
  // via des processors ; un JSON présent seul peut cacher des libs manquantes).
  try { fs.rmSync(verDir, { recursive: true, force: true }) } catch (_) {}

  try {
    // 1) launcher_profiles.json OBLIGATOIRE (sinon l'installer échoue en headless).
    const lp = path.join(gameDir, 'launcher_profiles.json')
    if (!fs.existsSync(lp)) {
      await fsp.mkdir(gameDir, { recursive: true })
      await fsp.writeFile(lp, JSON.stringify({ profiles: {}, settings: {}, selectedProfileName: '', version: 3 }, null, 2))
    }

    // 2) Télécharge l'installer.
    if (onProgress) onProgress({ phase: 'download', name: `installer ${LOADER_LABEL[loader]} ${loaderVersion}` })
    const url = installerUrl(loader, gameVersion, loaderVersion)
    const installerPath = path.join(gameDir, 'installers', `${loader}-${loaderVersion}-installer.jar`)
    await fsp.mkdir(path.dirname(installerPath), { recursive: true })
    try {
      await downloadFile(url, installerPath, null)
    } catch (e) {
      throw new Error(`Téléchargement de l'installer ${LOADER_LABEL[loader]} ${loaderVersion} échoué (${e.message}). Vérifie que cette version existe.`)
    }

    // 3) Lance l'installer (patch du client via processors : peut durer 1-3 min).
    if (onProgress) onProgress({ phase: 'run', name: `installation ${LOADER_LABEL[loader]} (patch du client)…` })
    await runInstaller(javaPath, installerPath, gameDir, onProgress)

    // 4) Vérifie que le version-profile a bien été produit.
    if (!fs.existsSync(verJson)) {
      throw new Error(`L'installer ${LOADER_LABEL[loader]} n'a pas produit le profil « ${versionId} ». `
        + `Assure-toi que Minecraft ${gameVersion} est installé et que tu es connecté à Internet.`)
    }
    // 5) Marqueur de complétude : seul un install fini est considéré valide.
    await fsp.writeFile(doneMarker, new Date().toISOString())
    return { loader, versionId, loaderVersion }
  } catch (e) {
    // Install partiel : on purge pour ne jamais laisser un état « à moitié » fiable.
    try { fs.rmSync(verDir, { recursive: true, force: true }) } catch (_) {}
    throw e
  }
}

// Dernière version d'un loader pour une version MC (sélecteur manuel).
// Fabric/Quilt renvoient null : la version stable est résolue à l'installation.
async function latestLoaderVersion(loader, gameVersion) {
  if (loader === 'fabric' || loader === 'quilt') return null
  if (loader === 'neoforge') {
    const parts = String(gameVersion).split('.')
    const prefix = `${parts[1]}.${parts[2] || '0'}.` // 1.21.1 -> "21.1."
    const res = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge', { headers: HEADERS })
    if (!res.ok) throw new Error(`liste NeoForge: HTTP ${res.status}`)
    const data = await res.json()
    const all = (data.versions || data.version || []).filter(v => v.startsWith(prefix))
    const stable = all.filter(v => !/beta/i.test(v))
    const pick = stable.length ? stable : all
    if (!pick.length) throw new Error(`aucune version NeoForge pour Minecraft ${gameVersion}`)
    return pick[pick.length - 1] // trié croissant : la dernière est la plus récente
  }
  if (loader === 'forge') {
    const res = await fetch('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', { headers: HEADERS })
    if (!res.ok) throw new Error(`promotions Forge: HTTP ${res.status}`)
    const promos = (await res.json()).promos || {}
    const v = promos[`${gameVersion}-recommended`] || promos[`${gameVersion}-latest`]
    if (!v) throw new Error(`aucune version Forge pour Minecraft ${gameVersion}`)
    return v
  }
  return null
}

// ---------------------------------------------------------------------------
// Dispatch + détection.
// ---------------------------------------------------------------------------

// Installe le loader demandé dans gameDir. opts = { loaderVersion, javaPath, onProgress }.
async function installLoader(loader, gameVersion, gameDir, opts = {}) {
  const { loaderVersion = null, javaPath = null, onProgress = null } = opts
  switch (loader) {
    case 'fabric': return installFabric(gameVersion, gameDir, onProgress, loaderVersion)
    case 'quilt': return installQuilt(gameVersion, gameDir, loaderVersion, onProgress)
    case 'forge':
    case 'neoforge': return installViaInstaller(loader, gameVersion, gameDir, loaderVersion, javaPath, onProgress)
    default: throw new Error(`Loader inconnu : ${loader}`)
  }
}

// L'id d'un version-profile appartient-il à ce loader ?
function idMatchesLoader(id, loader) {
  const s = String(id || '').toLowerCase()
  switch (loader) {
    case 'fabric': return s.includes('fabric')
    case 'quilt': return s.includes('quilt')
    case 'neoforge': return s.includes('neoforge')
    case 'forge': return s.includes('forge') && !s.includes('neoforge')
    default: return false
  }
}

// Cherche dans versions/ le profil du loader qui hérite de mcVersion.
// Forge/NeoForge : on EXIGE la version exacte (loaderVersion) + le marqueur de
// complétude — sinon un ancien profil ou un install partiel serait pris par erreur.
// Fabric/Quilt : l'install résout la version stable, donc on matche par FAMILLE.
function findLoaderProfile(gameDir, mcVersion, loader, loaderVersion = null) {
  const root = path.join(gameDir, 'versions')
  let dirs = []
  try { dirs = fs.readdirSync(root) } catch (_) { return null }
  const installerBased = loader === 'forge' || loader === 'neoforge'
  const wantId = (installerBased && loaderVersion)
    ? installerVersionId(loader, mcVersion, loaderVersion).toLowerCase()
    : null
  let fallback = null
  for (const d of dirs) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(root, d, `${d}.json`), 'utf8'))
      if (p.inheritsFrom !== mcVersion || !idMatchesLoader(p.id || d, loader)) continue
      if (installerBased && !fs.existsSync(path.join(root, d, COMPLETE_MARKER))) continue // install incomplet
      const id = String(p.id || d).toLowerCase()
      if (wantId) { if (id === wantId) return p } // version exacte uniquement
      else if (!fallback) fallback = p            // fabric/quilt (ou forge sans version pinnée)
    } catch (_) { /* json absent/illisible */ }
  }
  return wantId ? null : fallback
}

module.exports = {
  LOADERS, LOADER_LABEL, FABRIC_LIKE, isValidLoader,
  installLoader, findLoaderProfile, idMatchesLoader, installerVersionId, latestLoaderVersion
}
