// Installation du loader Fabric via l'API officielle Fabric Meta.
// https://meta.fabricmc.net — fournit les versions de loader compatibles et
// un "profil de version" (format launcher) décrivant comment lancer le jeu modé.
//
// Ce que ce module produit dans le dossier géré :
//   versions/<id>/<id>.json   -> le profil de version Fabric (héritant du vanilla)
//   libraries/...             -> les librairies Fabric (loader, intermediary, asm…)

const fsp = require('fs/promises')
const path = require('path')
const { downloadFile } = require('./downloader')

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const HEADERS = {
  'User-Agent': 'perf-launcher/0.1.0 (launcher éducatif d\'optimisation)'
}

// Liste les versions de loader Fabric compatibles avec une version de MC.
async function getLoaderVersions(gameVersion) {
  const res = await fetch(`${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`Fabric Meta: HTTP ${res.status}`)
  return await res.json()
}

// Renvoie la dernière version STABLE du loader (ou la plus récente sinon).
async function getStableLoader(gameVersion) {
  const list = await getLoaderVersions(gameVersion)
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Aucun loader Fabric disponible pour Minecraft ${gameVersion}`)
  }
  const stable = list.find(x => x.loader && x.loader.stable)
  return (stable || list[0]).loader.version
}

// Récupère le profil de version (JSON launcher) pour game+loader donnés.
async function getProfileJson(gameVersion, loaderVersion) {
  const url = `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Fabric profil: HTTP ${res.status}`)
  return await res.json()
}

// Convertit une coordonnée Maven (group:artifact:version[:classifier][@ext])
// en chemin de fichier relatif façon dépôt Maven.
function mavenToPath(name) {
  const [coord, ext = 'jar'] = name.split('@')
  const parts = coord.split(':')
  const group = parts[0]
  const artifact = parts[1]
  const version = parts[2]
  const classifier = parts[3]
  const file = classifier
    ? `${artifact}-${version}-${classifier}.${ext}`
    : `${artifact}-${version}.${ext}`
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`
}

// Normalise la liste des librairies du profil en { name, url, path, sha1 }.
// Gère les deux formats : moderne (downloads.artifact) et Fabric (name + url).
function libraryDownloads(profile) {
  const out = []
  for (const lib of profile.libraries || []) {
    if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.url) {
      const a = lib.downloads.artifact
      out.push({ name: lib.name, url: a.url, path: a.path || mavenToPath(lib.name), sha1: a.sha1 })
    } else if (lib.url) {
      const rel = mavenToPath(lib.name)
      out.push({ name: lib.name, url: lib.url.replace(/\/$/, '') + '/' + rel, path: rel, sha1: lib.sha1 })
    }
  }
  return out
}

// Installe Fabric dans gameDir : écrit le profil de version + télécharge les
// librairies. onProgress({ done, total, name, phase }) est appelé par lib.
// Retourne un résumé { versionId, loaderVersion, inheritsFrom, libCount, results }.
async function installFabric(gameVersion, gameDir, onProgress, loaderVersion) {
  // loaderVersion optionnel : version de loader ÉPINGLÉE (ex. tirée d'un .mrpack) ;
  // sinon on prend le dernier stable.
  loaderVersion = loaderVersion || await getStableLoader(gameVersion)
  const profile = await getProfileJson(gameVersion, loaderVersion)
  const versionId = profile.id // ex. "fabric-loader-0.16.9-1.21.1"

  // 1) Écriture du profil de version.
  const verDir = path.join(gameDir, 'versions', versionId)
  await fsp.mkdir(verDir, { recursive: true })
  await fsp.writeFile(path.join(verDir, `${versionId}.json`), JSON.stringify(profile, null, 2))

  // 2) Téléchargement des librairies Fabric.
  const libs = libraryDownloads(profile)
  const libRoot = path.join(gameDir, 'libraries')
  const results = []
  let done = 0

  for (const lib of libs) {
    if (onProgress) onProgress({ done, total: libs.length, name: lib.name, phase: 'start' })
    try {
      const r = await downloadFile(lib.url, path.join(libRoot, lib.path), lib.sha1)
      results.push({ name: lib.name, status: r.status })
    } catch (e) {
      results.push({ name: lib.name, status: 'error', error: e.message })
    }
    done++
    if (onProgress) onProgress({ done, total: libs.length, name: lib.name, phase: 'done' })
  }

  // Échec persistant d'une lib -> on RETIRE le profil déjà écrit et on throw. Sinon
  // le JSON présent fait croire à un loader « installé » (findModdedProfile le trouve,
  // la ré-installation est sautée) => classpath incomplet, NoClassDefFoundError durable.
  const failed = results.filter(r => r.status === 'error')
  if (failed.length) {
    await fsp.rm(path.join(verDir, `${versionId}.json`), { force: true }).catch(() => {})
    const names = failed.slice(0, 4).map(f => f.name).join(', ') + (failed.length > 4 ? '…' : '')
    throw new Error(`Installation Fabric incomplète : ${failed.length}/${libs.length} librairie(s) en échec (${names}).`)
  }

  return {
    versionId,
    loaderVersion,
    inheritsFrom: profile.inheritsFrom || gameVersion,
    libCount: libs.length,
    results
  }
}

module.exports = { installFabric, getStableLoader, getProfileJson, mavenToPath, libraryDownloads }
