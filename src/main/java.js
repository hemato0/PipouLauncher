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

  // 4) Runtimes Java installés par le launcher Mojang officiel
  const mojangRuntime = path.join(os.homedir(), 'AppData', 'Local', 'Packages')
  const dotMc = path.join(process.env.APPDATA || os.homedir(), '.minecraft', 'runtime')
  for (const base of [dotMc, mojangRuntime]) {
    try {
      const found = await findJavaUnder(base, 4)
      for (const f of found) out.add(f)
    } catch (_) { /* ignore */ }
  }

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

// Détecte le meilleur Java disponible. Renvoie { path, version, major } ou null.
// On privilégie un major >= 21 ; à défaut, le major le plus élevé trouvé.
async function detectJava() {
  const paths = await candidatePaths()
  const probes = await Promise.all(paths.map(probe))
  const found = probes.filter(Boolean)
  if (found.length === 0) return null

  const eligible = found.filter(j => j.major >= 21)
  const pool = eligible.length ? eligible : found
  pool.sort((a, b) => b.major - a.major)
  return pool[0]
}

module.exports = { detectJava, probe }
