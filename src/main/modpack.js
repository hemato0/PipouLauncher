// Import de modpacks Modrinth (.mrpack).
// Un .mrpack est un ZIP contenant :
//   - modrinth.index.json : le manifeste (nom, version MC, loader, liste de mods
//     avec URL de téléchargement) ;
//   - overrides/ (et parfois client-overrides/) : fichiers embarqués (mods, config…).
// On lit tout ça avec adm-zip (déjà en dépendance). On ne télécharge rien nous-mêmes
// ici : on renvoie la liste des mods à récupérer (main.js s'en charge).

const AdmZip = require('adm-zip')
const path = require('path')

// Allowlist d'hôtes pour les téléchargements listés dans un .mrpack.
// La spec Modrinth impose à l'importeur de restreindre les hôtes (anti-SSRF et
// anti-jar malveillant : le fichier est fourni par un tiers non fiable).
const ALLOWED_HOST = new Set([
  'cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com',
  'objects.githubusercontent.com', 'gitlab.com', 'media.forgecdn.net', 'edge.forgecdn.net'
])
const ALLOWED_SUFFIX = ['.modrinth.com', '.githubusercontent.com']
function isTrustedDownload(u) {
  let p
  try { p = new URL(u) } catch { return false }
  if (p.protocol !== 'https:') return false
  const h = p.hostname.toLowerCase()
  return ALLOWED_HOST.has(h) || ALLOWED_SUFFIX.some(s => h.endsWith(s))
}

// Parse un .mrpack et renvoie tout ce qu'il faut pour créer un profil.
//   files        : mods à télécharger  { fileName, url, sha1, size }
//   overrideMods : jars de mods embarqués { fileName, entry }  (entry AdmZip, décompressé à l'écriture)
//   overrideFiles: autres fichiers (config, resourcepacks…) { relPath, entry }
//   skipped      : mods ignorés faute d'URL de confiance (surface à l'utilisateur)
function parseModpack(zipPath) {
  let zip
  try { zip = new AdmZip(zipPath) } catch (e) { throw new Error('Archive .mrpack illisible : ' + e.message) }

  const idxEntry = zip.getEntry('modrinth.index.json')
  if (!idxEntry) throw new Error('.mrpack invalide : modrinth.index.json manquant.')

  let index
  try { index = JSON.parse(zip.readAsText(idxEntry)) } catch (_) { throw new Error('.mrpack : index JSON illisible.') }
  if (index.game && index.game !== 'minecraft') throw new Error('Modpack non-Minecraft non supporté.')

  const deps = index.dependencies || {}
  const gameVersion = deps.minecraft || null
  // Loader + version EXACTE tirés des dépendances du pack (fail-closed sur 'other').
  let loader = 'other', loaderVersion = null
  if (deps['fabric-loader']) { loader = 'fabric'; loaderVersion = deps['fabric-loader'] }
  else if (deps['quilt-loader']) { loader = 'quilt'; loaderVersion = deps['quilt-loader'] }
  else if (deps['neoforge']) { loader = 'neoforge'; loaderVersion = deps['neoforge'] }
  else if (deps['forge']) { loader = 'forge'; loaderVersion = deps['forge'] }

  // Mods listés dans le manifeste (téléchargés depuis une URL de confiance).
  const files = []
  const skipped = []
  for (const f of index.files || []) {
    const p = String(f.path || '').replace(/\\/g, '/')
    if (!p.startsWith('mods/') || !p.endsWith('.jar')) continue
    if ((f.env || {}).client === 'unsupported') continue // mod serveur-only
    const url = (f.downloads || []).find(isTrustedDownload)
    if (!url) { skipped.push(path.basename(p)); continue } // pas d'URL fiable
    files.push({
      fileName: path.basename(p),
      url,
      sha1: (f.hashes || {}).sha1 || null,
      size: f.fileSize || 0
    })
  }

  // Overrides : mods embarqués + autres fichiers (config, resourcepacks…).
  // On garde l'entrée AdmZip (décompression paresseuse à l'écriture) plutôt que
  // tous les buffers en RAM d'un coup.
  const overrideMods = []
  const overrideFiles = []
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue
    const name = e.entryName.replace(/\\/g, '/')
    const m = name.match(/^(?:overrides|client-overrides)\/(.+)$/i)
    if (!m) continue
    const rel = m[1]
    if (/^mods\/.+\.jar$/i.test(rel)) {
      overrideMods.push({ fileName: path.basename(rel), entry: e })
    } else if (rel.toLowerCase() !== 'options.txt') {
      // options.txt est géré par le launcher (réglages de perf) : on ne l'écrase pas.
      overrideFiles.push({ relPath: rel, entry: e })
    }
  }

  return { name: index.name || 'Modpack', gameVersion, loader, loaderVersion, files, overrideMods, overrideFiles, skipped }
}

module.exports = { parseModpack }
