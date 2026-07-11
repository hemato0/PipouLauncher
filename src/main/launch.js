// Lancement du jeu : fusionne le profil Fabric avec le vanilla (inheritsFrom),
// construit le classpath + la ligne d'arguments (substitution des placeholders),
// écrit un options.txt optimisé, puis spawn le processus Java.

const { spawn } = require('child_process')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const { evaluateRules, hostEnv } = require('./mojang')
const { mavenToPath } = require('./fabric')
const { findLoaderProfile } = require('./loaders')
const { buildJvmArgs } = require('./jvm')
const { detectJava } = require('./java')
const { optionsForProfile, mergeOptions } = require('./settings')
const { setProcessPriority } = require('./system')

const SEP = process.platform === 'win32' ? ';' : ':'

// Service de présence (badge Pipou dans le tab, façon Feather) : le mod PipouMod
// lit cette URL via -Dpipou.presence.url. Override possible via la variable
// d'environnement PIPOU_PRESENCE_URL (dev / autre hébergement). Vide => seul le
// joueur local a son cœur (le mod dégrade sans backend).
const PRESENCE_URL = (process.env.PIPOU_PRESENCE_URL || 'https://pipou-presence.onrender.com').trim()

// --- Chargement + fusion des profils de version ---

function versionsDir(gameDir) { return path.join(gameDir, 'versions') }

// Cherche le profil du loader (Fabric/Quilt/Forge/NeoForge) héritant de mcVersion.
// (findLoaderProfile vient de loaders.js et matche l'id selon le loader + la version.)
function findModdedProfile(gameDir, mcVersion, loader, loaderVersion) {
  return findLoaderProfile(gameDir, mcVersion, loader || 'fabric', loaderVersion || null)
}

// Fusionne le profil enfant (loader) sur le parent (vanilla).
function mergeProfiles(child, parent) {
  return {
    id: child.id,
    mainClass: child.mainClass || parent.mainClass,       // Fabric KnotClient l'emporte
    assets: parent.assets,
    assetIndex: parent.assetIndex,
    javaVersion: parent.javaVersion,
    type: child.type || parent.type,
    // libs enfant AVANT parent (dédup par group:artifact -> version enfant gagne)
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: {
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((child.arguments && child.arguments.jvm) || [])],
      game: [...((parent.arguments && parent.arguments.game) || []), ...((child.arguments && child.arguments.game) || [])]
    }
  }
}

// Renvoie le profil effectif à lancer (fusionné si le loader est présent, sinon vanilla).
function loadProfile(gameDir, mcVersion, loader, loaderVersion) {
  const vanillaPath = path.join(versionsDir(gameDir), mcVersion, `${mcVersion}.json`)
  const vanilla = JSON.parse(fs.readFileSync(vanillaPath, 'utf8'))
  const modded = findModdedProfile(gameDir, mcVersion, loader, loaderVersion)
  return { profile: modded ? mergeProfiles(modded, vanilla) : vanilla, modded: !!modded }
}

// --- Construction du classpath ---

// Chemin relatif d'une lib : downloads.artifact.path (vanilla) ou maven (Fabric).
function libRelPath(lib) {
  if (lib.downloads && lib.downloads.artifact && lib.downloads.artifact.path) return lib.downloads.artifact.path
  return mavenToPath(lib.name)
}

// Classpath = libs de CODE applicables (dédup group:artifact, natifs exclus) + client.jar.
function buildClasspath(profile, gameDir, mcVersion, env) {
  const libRoot = path.join(gameDir, 'libraries')
  const seen = new Set()
  const cp = []
  for (const lib of profile.libraries) {
    if (lib.rules && !evaluateRules(lib.rules, env)) continue
    const classifier = lib.name.split(':')[3]
    if (classifier && classifier.startsWith('natives-')) continue // natifs pas sur le classpath
    const key = lib.name.split(':').slice(0, 2).join(':')          // group:artifact
    if (seen.has(key)) continue
    seen.add(key)
    cp.push(path.join(libRoot, libRelPath(lib)))
  }
  cp.push(path.join(versionsDir(gameDir), mcVersion, `${mcVersion}.jar`))
  return cp
}

// --- Substitution des placeholders + expansion des arguments ---

function substitute(str, map) {
  return String(str).replace(/\$\{([^}]+)\}/g, (m, k) => (k in map ? map[k] : m))
}

// Développe un tableau d'arguments (format moderne : chaînes + entrées {rules,value}).
function expandArgs(argArray, env, map) {
  const out = []
  for (const a of argArray || []) {
    if (typeof a === 'string') { out.push(substitute(a, map)); continue }
    if (a && a.rules) {
      if (!evaluateRules(a.rules, env)) continue
      const vals = Array.isArray(a.value) ? a.value : [a.value]
      for (const v of vals) out.push(substitute(v, map))
    }
  }
  return out
}

// Construit la ligne d'arguments complète du lancement.
function buildLaunchArgs({ profile, gameDir, mcVersion, account, perfJvmArgs }) {
  const env = hostEnv()
  const nativesDir = path.join(versionsDir(gameDir), mcVersion, 'natives')
  const classpath = buildClasspath(profile, gameDir, mcVersion, env).join(SEP)

  const map = {
    natives_directory: nativesDir,
    launcher_name: 'perf-launcher',
    launcher_version: '0.1.15',
    classpath,
    classpath_separator: SEP,
    library_directory: path.join(gameDir, 'libraries'),
    auth_player_name: account.name,
    version_name: profile.id,
    game_directory: gameDir,
    assets_root: path.join(gameDir, 'assets'),
    assets_index_name: profile.assets,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    clientid: '',
    auth_xuid: '',
    user_type: account.type || 'msa',
    version_type: profile.type || 'release'
  }

  const jvmArgs = expandArgs(profile.arguments.jvm, env, map)
  const gameArgs = expandArgs(profile.arguments.game, env, map)
  // Propriété système lue par PipouMod pour la présence tab (cœur Pipou). Placée
  // avant la mainClass (c'est un arg JVM). Omise si aucune URL n'est configurée.
  const presenceArg = PRESENCE_URL ? [`-Dpipou.presence.url=${PRESENCE_URL}`] : []
  // perf (mémoire + GC) d'abord, puis le template JVM (java.library.path, -cp, flags Fabric),
  // puis la mainClass, puis les arguments de jeu.
  return [...perfJvmArgs, ...presenceArg, ...jvmArgs, profile.mainClass, ...gameArgs]
}

// --- options.txt (enfin branché : le levier de perf gratuit) ---

async function writeOptions(gameDir, profile) {
  const p = path.join(gameDir, 'options.txt')
  let existing = ''
  try { existing = await fsp.readFile(p, 'utf8') } catch (_) { /* pas encore de fichier */ }
  await fsp.writeFile(p, mergeOptions(existing, optionsForProfile(profile)))
}

// --- Lancement ---

// Lance le jeu. account = { name, uuid, accessToken, type }. hw pour la JVM.
// onLog(ligne) reçoit stdout/stderr ; onExit(code) à la fin. Renvoie le pid.
async function launch({ mcVersion, gameDir, account, perfProfile, hw, totalRamMB, ramMB, loader, loaderVersion }, onLog, onExit) {
  if (!account || !account.accessToken) throw new Error('Connecte-toi avec Microsoft avant de jouer.')

  // options.txt optimisé (ne touche que nos clés, préserve le reste).
  await writeOptions(gameDir, perfProfile)

  const { profile, modded } = loadProfile(gameDir, mcVersion, loader, loaderVersion)
  // Major Java requis lu DANS la version (javaVersion.majorVersion) : ne pas imposer
  // 21 à tout le monde (1.20.1 tourne en 17, 1.16.5 en 8). On choisit un runtime adapté.
  const requiredMajor = (profile.javaVersion && profile.javaVersion.majorVersion) || 21
  const java = await detectJava(requiredMajor)
  if (!java) throw new Error(`Java introuvable — installe un JRE/JDK ${requiredMajor}.`)
  if (java.major < requiredMajor) throw new Error(`Java ${java.major} détecté, mais Minecraft ${mcVersion} exige Java ${requiredMajor}.`)

  const perfJvmArgs = buildJvmArgs({ ramMB, cores: hw.cpuThreads, javaMajor: java.major, totalRamMB })
  const args = buildLaunchArgs({ profile, gameDir, mcVersion, account, perfJvmArgs })

  // Masque le token de session s'il apparaissait dans les logs (défense en profondeur).
  // On ne masque que les vrais tokens longs (pas le "0" du mode hors-ligne).
  const tok = account.accessToken
  const redact = (tok && tok.length > 10) ? (s) => s.split(tok).join('***') : (s) => s

  // Log de jeu PERSISTANT (userData/game-latest.log) : indispensable pour diagnostiquer
  // un crash (surtout un code -1/4294967295 = crash natif AVANT la fenêtre). On y écrit
  // aussi la commande Java et, à la fin, le code de sortie.
  const logPath = path.join(path.dirname(gameDir), 'game-latest.log')
  let logStream = null
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'w' })
    logStream.write(`[launcher] Minecraft ${mcVersion} · Java ${java.major} (${java.path})\n`)
    logStream.write(`[launcher] ${redact([java.path, ...args].join(' '))}\n\n`)
  } catch (_) { /* pas de log fichier : on continue quand même */ }
  const writeLog = (s) => { try { logStream && logStream.write(s) } catch (_) {} }

  const child = spawn(java.path, args, { cwd: gameDir })
  child.stdout.on('data', (d) => { const s = redact(d.toString()); writeLog(s); onLog(s) })
  child.stderr.on('data', (d) => { const s = redact(d.toString()); writeLog(s); onLog(s) })
  child.on('error', (e) => { const s = `[spawn error] ${e.message}\n`; writeLog(s); onLog(s) })
  child.on('exit', (code) => {
    writeLog(`\n[launcher] processus terminé — code ${code}\n`)
    try { logStream && logStream.end() } catch (_) {}
    onExit(code)
  })

  // Optim système sûre + éphémère : priorité ABOVE_NORMAL sur le process de jeu.
  const prioritized = child.pid ? setProcessPriority(child.pid, 'above') : false

  return { pid: child.pid, modded, mainClass: profile.mainClass, javaPath: java.path, prioritized }
}

module.exports = {
  launch, buildLaunchArgs, buildClasspath, mergeProfiles, loadProfile,
  findModdedProfile, expandArgs, substitute
}
