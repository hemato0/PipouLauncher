// Téléchargement de Minecraft VANILLA (Mojang) : client.json, client.jar,
// librairies (avec évaluation des rules OS), assets (adressés par hash), et
// extraction des natives. Prérequis du lancement. La FUSION avec le profil
// Fabric (inheritsFrom) se fera à l'étape de lancement (module dédié), PAS ici :
// cet installeur ne fait qu'installer le vanilla. Spec vérifiée sur 1.21.1.
//
// Hôtes distincts (gotcha #6) :
//   piston-meta.mojang.com        -> manifest, client.json, asset index
//   piston-data.mojang.com        -> client.jar (URL lue dans client.json)
//   libraries.minecraft.net       -> jars de librairies (URL lue)
//   resources.download.minecraft.net -> octets des objets d'assets

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')
const AdmZip = require('adm-zip')

const { downloadFile, downloadAll, fetchJson } = require('./downloader')

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const ASSET_HOST = 'https://resources.download.minecraft.net'

// --- Environnement hôte (pour l'évaluation des rules) ---

// Mappe l'arch Node vers la nomenclature Mojang (gotcha #2).
function hostArch() {
  switch (process.arch) {
    case 'x64': return 'x86_64'
    case 'ia32': return 'x86'
    case 'arm64': return 'arm64'
    default: return process.arch
  }
}
function hostOsName() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}
function hostEnv() {
  return { os: { name: hostOsName(), arch: hostArch(), version: os.release() }, features: {} }
}

// Le classifier natif attendu pour l'hôte (2e passe de sélection, gotcha #1).
function expectedNativeClassifier(env) {
  const { name, arch } = env.os
  if (name === 'windows') {
    if (arch === 'x86_64') return 'natives-windows'
    if (arch === 'x86') return 'natives-windows-x86'
    if (arch === 'arm64') return 'natives-windows-arm64'
  }
  if (name === 'linux') return arch === 'arm64' ? 'natives-linux-arm64' : 'natives-linux'
  if (name === 'osx') return arch === 'arm64' ? 'natives-macos-arm64' : 'natives-macos'
  return null
}

// --- Évaluation des rules (last-match-wins, deny par défaut si rules présentes) ---

function ruleMatches(rule, env) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== env.os.name) return false
    if (rule.os.arch && rule.os.arch !== env.os.arch) return false
    if (rule.os.version && !(new RegExp(rule.os.version)).test(env.os.version)) return false
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (Boolean(env.features[k]) !== Boolean(v)) return false
    }
  }
  return true
}

// Absence de rules => applicable. Présence => deny par défaut, dernière règle
// qui matche l'emporte (gotcha #3).
function evaluateRules(rules, env) {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleMatches(rule, env)) allowed = (rule.action === 'allow')
  }
  return allowed
}

// --- Résolution des librairies (code vs natives) ---

// Sépare les libs applicables en jars de CODE (classpath) et jars NATIFS (extraction).
// Applique les rules PUIS filtre les natifs par classifier selon l'arch (gotcha #1).
function resolveLibraries(clientJson, env) {
  const wantedNative = expectedNativeClassifier(env)
  const code = []
  const natives = []

  for (const lib of clientJson.libraries || []) {
    if (!evaluateRules(lib.rules, env)) continue

    // Ancien schéma (<1.19) : natives via la map lib.natives -> downloads.classifiers.
    // (Traité AVANT le `continue` ci-dessous : certaines libs natives n'ont PAS
    //  d'artifact principal.) Substitution ${arch} = bits de la JVM (32/64).
    if (lib.natives && lib.downloads && lib.downloads.classifiers) {
      const key = lib.natives[env.os.name]
      if (key) {
        const classifier = key.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
        const nat = lib.downloads.classifiers[classifier]
        if (nat && nat.url) natives.push({ name: `${lib.name}:${classifier}`, path: nat.path, url: nat.url, sha1: nat.sha1 })
      }
    }

    const artifact = lib.downloads && lib.downloads.artifact
    if (!artifact || !artifact.url) continue

    const classifier = lib.name.split(':')[3] // group:artifact:version[:classifier]
    const item = { name: lib.name, path: artifact.path, url: artifact.url, sha1: artifact.sha1 }

    if (classifier && classifier.startsWith('natives-')) {
      // 2e passe : ne garder que le natif de l'arch hôte, rejeter les autres (schéma ≥1.19).
      if (classifier === wantedNative) natives.push(item)
    } else {
      code.push(item)
    }
  }

  return { code, natives }
}

// --- Étapes de téléchargement ---

// Résout la version : manifest -> entrée -> client.json (vérifié SHA1) sur disque.
async function fetchClientJson(versionId, gameDir) {
  const manifest = await fetchJson(MANIFEST_URL)
  const entry = (manifest.versions || []).find(v => v.id === versionId)
  if (!entry) throw new Error(`Version ${versionId} introuvable dans le manifest Mojang`)

  const jsonPath = path.join(gameDir, 'versions', versionId, `${versionId}.json`)
  await downloadFile(entry.url, jsonPath, entry.sha1) // idempotent + vérif SHA1
  const clientJson = JSON.parse(await fsp.readFile(jsonPath, 'utf8'))
  return { entry, clientJson, jsonPath }
}

// Extrait les binaires natifs (.dll/.so/.dylib) des jars retenus vers nativesDir,
// en aplatissant le nom et en excluant META-INF/ et les annexes (gotcha #5).
// Résilient : un jar manquant/corrompu est collecté dans `errors` et n'interrompt
// PAS l'extraction des autres. Idempotent : skip si déjà extrait à la même taille.
function extractNatives(nativeJarPaths, nativesDir) {
  const NATIVE_EXT = { windows: '.dll', linux: '.so', osx: '.dylib' }[hostOsName()] || '.dll'
  const extracted = []
  const errors = []
  fs.mkdirSync(nativesDir, { recursive: true })

  for (const jarPath of nativeJarPaths) {
    let zip
    try { zip = new AdmZip(jarPath) }
    catch (e) { errors.push({ jarPath, error: e.message }); continue }

    try {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const name = entry.entryName
        if (name.startsWith('META-INF/')) continue
        if (!name.endsWith(NATIVE_EXT)) continue // ignore module-info.class, *.sha1…

        const outPath = path.join(nativesDir, path.basename(name)) // aplatir le chemin interne
        // Idempotent : ne pas réécrire si déjà présent à la même taille.
        try {
          if (fs.statSync(outPath).size === entry.header.size) { extracted.push(outPath); continue }
        } catch (_) { /* pas encore extrait */ }

        fs.writeFileSync(outPath, entry.getData())
        extracted.push(outPath)
      }
    } catch (e) {
      errors.push({ jarPath, error: e.message })
    }
  }
  return { extracted, errors }
}

// Orchestrateur : télécharge tout le vanilla et renvoie un manifeste prêt pour
// le lancement (classpath, natives, assets, mainClass, javaMajor).
// opts.assetLimit : limite le nombre d'objets d'assets (TESTS uniquement).
async function installVanilla(versionId, gameDir, opts = {}, onProgress = () => {}) {
  const env = hostEnv()
  const verDir = path.join(gameDir, 'versions', versionId)
  const emit = (phase, done, total, label) => onProgress({ phase, done, total, label })

  // 1) client.json
  emit('client-json', 0, 1, versionId)
  const { clientJson } = await fetchClientJson(versionId, gameDir)
  emit('client-json', 1, 1, versionId)

  // 2) client.jar
  const clientJarPath = path.join(verDir, `${versionId}.jar`)
  emit('client-jar', 0, 1, `${versionId}.jar`)
  await downloadFile(clientJson.downloads.client.url, clientJarPath, clientJson.downloads.client.sha1)
  emit('client-jar', 1, 1, `${versionId}.jar`)

  // 3) librairies (code + natives)
  const { code, natives } = resolveLibraries(clientJson, env)
  const libRoot = path.join(gameDir, 'libraries')
  const libItems = [
    ...code.map(l => ({ ...l, isNative: false, dest: path.join(libRoot, l.path) })),
    ...natives.map(l => ({ ...l, isNative: true, dest: path.join(libRoot, l.path) }))
  ]
  const libResults = await downloadAll(libItems, {
    concurrency: 6,
    onProgress: (p) => emit('libraries', p.done, p.total, p.item.name)
  })
  // Une lib de CODE manquante = classpath cassé => lancement impossible : on refuse.
  // (Les assets, eux, restent dégradables.)
  const codeErrors = libResults.filter(r => r.status === 'error' && !r.isNative)
  if (codeErrors.length) {
    throw new Error(
      `${codeErrors.length} librairie(s) de code non téléchargée(s) (ex : ${codeErrors[0].name}). ` +
      `Lancement impossible — réessaie.`
    )
  }
  const nativeDlErrors = libResults.filter(r => r.status === 'error' && r.isNative)

  // 4) asset index
  const assetIndex = clientJson.assetIndex
  const indexPath = path.join(gameDir, 'assets', 'indexes', `${assetIndex.id}.json`)
  emit('asset-index', 0, 1, assetIndex.id)
  await downloadFile(assetIndex.url, indexPath, assetIndex.sha1)
  const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'))
  emit('asset-index', 1, 1, assetIndex.id)

  // 5) objets d'assets (adressés par hash, parallèle).
  // Plusieurs chemins virtuels peuvent partager le même hash -> dédup obligatoire
  // (sinon téléchargements redondants + counts.assets gonflé).
  let objects = Object.entries(index.objects).map(([name, o]) => ({ name, hash: o.hash, size: o.size }))
  if (opts.assetLimit) objects = objects.slice(0, opts.assetLimit)

  const objRoot = path.join(gameDir, 'assets', 'objects')
  const seenHash = new Set()
  const assetItems = []
  for (const o of objects) {
    if (seenHash.has(o.hash)) continue
    seenHash.add(o.hash)
    assetItems.push({
      hash: o.hash,
      sha1: o.hash,
      url: `${ASSET_HOST}/${o.hash.slice(0, 2)}/${o.hash}`,
      dest: path.join(objRoot, o.hash.slice(0, 2), o.hash)
    })
  }
  const assetResults = await downloadAll(assetItems, {
    concurrency: 12,
    onProgress: (p) => emit('assets', p.done, p.total, p.item.hash.slice(0, 8))
  })
  const assetErrors = assetResults.filter(r => r.status === 'error')

  // 6) extraction des natives (seulement les jars natifs réellement téléchargés)
  const nativesDir = path.join(verDir, 'natives')
  const nativeJarPaths = libResults
    .filter(r => r.isNative && r.status !== 'error')
    .map(r => r.dest)
  emit('natives', 0, 1, 'extraction')
  const { extracted: extractedNatives, errors: nativeExtractErrors } = extractNatives(nativeJarPaths, nativesDir)
  emit('natives', 1, 1, 'extraction')

  // Récapitulatif d'installation (prérequis du lancement — pas encore les
  // gabarits d'arguments, construits plus tard par le module de lancement).
  const classpath = [...code.map(l => path.join(libRoot, l.path)), clientJarPath]
  return {
    versionId,
    mainClass: clientJson.mainClass,
    javaMajor: clientJson.javaVersion ? clientJson.javaVersion.majorVersion : null,
    assetIndexId: assetIndex.id,
    assetsDir: path.join(gameDir, 'assets'),
    nativesDir,
    clientJarPath,
    classpath,
    counts: {
      libraries: libItems.length,
      assets: assetItems.length,
      assetErrors: assetErrors.length,
      nativesExtracted: extractedNatives.length,
      nativesErrors: nativeDlErrors.length + nativeExtractErrors.length
    }
  }
}

module.exports = {
  installVanilla, resolveLibraries, evaluateRules, extractNatives,
  fetchClientJson, hostEnv, expectedNativeClassifier
}
