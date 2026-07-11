// Détection d'un runtime Java utilisable.
// Minecraft 1.21.x EXIGE Java 21 : sur les petits PC ciblés, l'absence de Java 21
// est le cas d'échec n°1 (et il serait silencieux). On cherche Java à plusieurs
// endroits, on lit sa version, et on renvoie le meilleur candidat (major le plus
// élevé, en privilégiant >= 21).
//
// (Le téléchargement/bundling d'un JRE 21 — comme Lunar avec Zulu ou Prism avec
//  Temurin — est prévu ensuite ; ici on fait la DÉTECTION, déjà indispensable.)

const { execFile } = require('child_process')
const fsp = require('fs/promises')
const path = require('path')
const os = require('os')

// Lance `<java> -version` et parse la version (écrite sur stderr par la JVM).
function probe(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 5000 }, (err, _stdout, stderr) => {
      if (err && !stderr) return resolve(null)
      const text = stderr || ''
      // Ex : version "21.0.2"  ->  21   |   version "1.8.0_401"  ->  8
      const m = text.match(/version "([^"]+)"/)
      if (!m) return resolve(null)
      const v = m[1]
      let major
      if (v.startsWith('1.')) major = parseInt(v.split('.')[1], 10)
      else major = parseInt(v.split('.')[0], 10)
      if (!Number.isFinite(major)) return resolve(null)
      resolve({ path: javaPath, version: v, major })
    })
  })
}

// Liste les binaires java.exe potentiels sur la machine.
async function candidatePaths() {
  const out = new Set()
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'

  // 1) java sur le PATH
  out.add(exe)

  // 2) JAVA_HOME
  if (process.env.JAVA_HOME) out.add(path.join(process.env.JAVA_HOME, 'bin', exe))

  // 3) Dossiers d'install classiques sous Windows
  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\Zulu'
  ]
  for (const root of roots) {
    try {
      const entries = await fsp.readdir(root)
      for (const e of entries) out.add(path.join(root, e, 'bin', exe))
    } catch (_) { /* dossier absent : on ignore */ }
  }

  // 4) Runtimes Java installés par le launcher Mojang officiel (.minecraft/runtime)
  const dotMc = path.join(process.env.APPDATA || os.homedir(), '.minecraft', 'runtime')
  try {
    for (const f of await findJavaUnder(dotMc, 5)) out.add(f)
  } catch (_) { /* ignore */ }

  // 5) Runtime du launcher Minecraft MS-Store : ENFOUI très profond sous le package
  //    (…\Packages\Microsoft.4297127D64EC6…\LocalCache\Local\runtime\…\bin\java.exe).
  //    On NE scanne PAS tout l'arbre UWP (lent) : uniquement le(s) package(s) Minecraft.
  const pkgRoot = path.join(os.homedir(), 'AppData', 'Local', 'Packages')
  try {
    for (const pkg of await fsp.readdir(pkgRoot)) {
      if (!/minecraft|4297127D64EC6/i.test(pkg)) continue
      const rt = path.join(pkgRoot, pkg, 'LocalCache', 'Local', 'runtime')
      try { for (const f of await findJavaUnder(rt, 6)) out.add(f) } catch (_) { /* ignore */ }
    }
  } catch (_) { /* Packages absent : on ignore */ }

  return [...out]
}

// Recherche récursive (profondeur limitée) de bin/java.exe sous un dossier.
async function findJavaUnder(dir, depth) {
  if (depth < 0) return []
  const exe = process.platform === 'win32' ? 'java.exe' : 'java'
  const results = []
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch (_) { return [] }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name === exe && path.basename(dir) === 'bin') results.push(full)
    else if (e.isDirectory()) results.push(...await findJavaUnder(full, depth - 1))
  }
  return results
}

// Liste TOUS les runtimes Java trouvés (mise en cache : le scan disque + les
// `-version` sont coûteux, et Java ne s'installe pas en cours de session — on ne
// cache QUE les résultats non vides, pour qu'un Java fraîchement installé soit vu).
let foundCache = null
async function findAllJava() {
  if (foundCache) return foundCache
  const paths = await candidatePaths()
  const found = (await Promise.all(paths.map(probe))).filter(Boolean)
  if (found.length) foundCache = found
  return found
}

// Détecte le meilleur Java pour la version demandée. `requiredMajor` = major exigé
// par la version MC (8 pour 1.16, 17 pour 1.17-1.20.4, 21 pour 1.20.5+). On choisit
// un runtime qui CORRESPOND (le plus haut major crashe les vieilles versions LWJGL).
// Sans argument : ancien comportement (le plus haut, en privilégiant >= 21).
async function detectJava(requiredMajor) {
  const found = await findAllJava()
  if (found.length === 0) return null
  if (!requiredMajor) {
    const eligible = found.filter(j => j.major >= 21)
    const pool = eligible.length ? eligible : found
    pool.sort((a, b) => b.major - a.major)
    return pool[0]
  }
  // 1) major EXACT ; 2) le plus PETIT major >= requis ; 3) le plus haut dispo (échouera au garde launch).
  const exact = found.filter(j => j.major === requiredMajor)
  if (exact.length) return exact[0]
  const ge = found.filter(j => j.major >= requiredMajor).sort((a, b) => a.major - b.major)
  if (ge.length) return ge[0]
  return [...found].sort((a, b) => b.major - a.major)[0]
}

module.exports = { detectJava, probe }
