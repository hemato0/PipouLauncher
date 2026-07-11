// Analyse des dépendances ET des CONFLITS de versions entre mods, en lisant les
// contraintes déclarées DANS chaque jar (fabric.mod.json / quilt.mod.json) :
//   - depends : { id: plage_de_versions }  -> versions requises d'un autre mod
//   - breaks  : { id: plage_de_versions }  -> versions INCOMPATIBLES d'un autre mod
// Sert au launcher à (1) installer ce qui manque et (2) détecter/réparer les
// incompatibilités de versions (ex. Iris exige un vieux Sodium) POUR TOUS LES MODS.

const AdmZip = require('adm-zip')
const fs = require('fs')
const path = require('path')

const BUILTIN = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric', 'fabric-api', 'fabric-language-kotlin',
  'quilt_loader', 'quiltloader', 'quilt_base', 'quilted_fabric_api', 'mixinextras'
])
function isBuiltin(id) {
  return BUILTIN.has(id) || id.startsWith('fabric-') || id.startsWith('quilted_')
}

// ---------- Versions (évaluateur de plages façon Fabric, volontairement PRUDENT) ----------
// Parse une version en {nums:[...], pre:bool}. Ignore les métadonnées de build (+...).
function parseVer(s) {
  if (s == null) return null
  const str = String(s).trim().split('+')[0]
  const dash = str.indexOf('-')
  const core = dash >= 0 ? str.slice(0, dash) : str
  const pre = dash >= 0
  const nums = core.split('.').map(x => parseInt(x, 10))
  if (!nums.length || nums.some(n => Number.isNaN(n))) return null
  return { nums, pre }
}
function cmp(a, b) {
  const n = Math.max(a.nums.length, b.nums.length)
  for (let i = 0; i < n; i++) {
    const x = a.nums[i] || 0, y = b.nums[i] || 0
    if (x !== y) return x < y ? -1 : 1
  }
  if (a.pre && !b.pre) return -1
  if (!a.pre && b.pre) return 1
  return 0
}
// Convertit un joker "0.6.x" / "1.x" en [borne_basse, borne_haute[. null si pas un joker.
function wildcardRange(w) {
  const parts = w.split('.')
  const idx = parts.findIndex(p => /^[xX*]$/.test(p))
  if (idx <= 0) return null
  const base = parts.slice(0, idx).map(n => parseInt(n, 10))
  if (base.some(Number.isNaN)) return null
  const lower = { nums: base.concat([0, 0, 0]).slice(0, 3), pre: false }
  const upperBase = [...base]; upperBase[idx - 1] = (upperBase[idx - 1] || 0) + 1
  const upper = { nums: upperBase.concat([0, 0, 0]).slice(0, 3), pre: false }
  return { lower, upper }
}
// Un prédicat simple est-il satisfait ? En cas de DOUTE -> true (on ne casse rien).
function satisfiesOne(vStr, pred) {
  pred = String(pred).trim()
  if (!pred || pred === '*') return true
  const v = parseVer(vStr); if (!v) return true

  const m = pred.match(/^(>=|<=|>|<|=|\^|~)?\s*(.+)$/)
  if (!m) return true
  const op = m[1] || ''
  const rhs = m[2].trim()

  if (/[xX*]/.test(rhs)) {
    if (op) return true // "op + joker" : trop ambigu -> on n'en fait rien
    const wr = wildcardRange(rhs); if (!wr) return true
    return cmp(v, wr.lower) >= 0 && cmp(v, wr.upper) < 0
  }
  const t = parseVer(rhs); if (!t) return true
  const c = cmp(v, t)
  switch (op) {
    case '>=': return c >= 0
    case '<=': return c <= 0
    case '>': return c > 0
    case '<': return c < 0
    case '=': return c === 0
    case '^': return c >= 0 && cmp(v, { nums: [(t.nums[0] || 0) + 1, 0, 0], pre: false }) < 0
    case '~': return c >= 0 && cmp(v, { nums: [t.nums[0] || 0, (t.nums[1] || 0) + 1, 0], pre: false }) < 0
    default: return true // version nue -> on considère satisfait (prudence, évite les faux conflits)
  }
}
// Une plage (string "AND par espaces", ou tableau "OR") est-elle satisfaite ?
function satisfies(vStr, range) {
  if (range == null || range === '*') return true
  if (Array.isArray(range)) return range.some(r => satisfies(vStr, r)) // OR
  return String(range).trim().split(/\s+/).every(p => satisfiesOne(vStr, p)) // AND
}

// ---------- Lecture d'un jar ----------
// { ids:[id+provides], version, depends:{id:range}, breaks:{id:range} } ; null si illisible.
function readJarMeta(jarPath) {
  let zip
  try { zip = new AdmZip(jarPath) } catch { return null }

  let e = zip.getEntry('fabric.mod.json')
  if (e) {
    try {
      const j = JSON.parse(zip.readAsText(e))
      const ids = [j.id, ...(Array.isArray(j.provides) ? j.provides : [])].filter(Boolean)
      return { ids, version: j.version || null, depends: j.depends || {}, breaks: j.breaks || {} }
    } catch { return null }
  }
  e = zip.getEntry('quilt.mod.json')
  if (e) {
    try {
      const j = JSON.parse(zip.readAsText(e))
      const ql = j.quilt_loader || {}
      const provides = (Array.isArray(ql.provides) ? ql.provides : []).map(p => (typeof p === 'string' ? p : p && p.id)).filter(Boolean)
      const ids = [ql.id, ...provides].filter(Boolean)
      const depends = {}, breaks = {}
      for (const d of (Array.isArray(ql.depends) ? ql.depends : [])) {
        if (typeof d === 'string') depends[d] = '*'
        else if (d && d.id && !d.optional) depends[d.id] = d.versions || '*'
      }
      for (const b of (Array.isArray(ql.breaks) ? ql.breaks : [])) {
        if (b && b.id) breaks[b.id] = b.versions || '*'
      }
      return { ids, version: ql.version || null, depends, breaks }
    } catch { return null }
  }
  return null
}

// Lit tous les jars d'un dossier -> [{ file, meta }].
function readAll(modsDir) {
  let files = []
  try { files = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar')) } catch { return [] }
  return files.map(file => ({ file, meta: readJarMeta(path.join(modsDir, file)) })).filter(x => x.meta)
}

// Dépendances DÉCLARÉES mais absentes (par id), hors builtins.
function scanMissingDeps(modsDir) {
  const jars = readAll(modsDir)
  const provided = new Set()
  const required = new Set()
  for (const { meta } of jars) {
    for (const id of meta.ids) provided.add(id)
    for (const d of Object.keys(meta.depends || {})) required.add(d)
  }
  return [...required].filter(id => !isBuiltin(id) && !provided.has(id))
}

// Détecte les CONFLITS de versions entre mods présents.
// Renvoie { conflicts:[texte lisible], involved:[fichiers jar à mettre à jour] }.
function findConflicts(modsDir) {
  const jars = readAll(modsDir)
  // Map id -> { version, file } (un id peut être fourni par un jar).
  const byId = {}
  for (const { file, meta } of jars) {
    for (const id of meta.ids) byId[id] = { version: meta.version, file }
  }
  const conflicts = []
  const involved = new Set()
  const nameOf = (id) => id

  for (const { file, meta } of jars) {
    const selfId = meta.ids[0] || file
    // depends : la version présente doit satisfaire la plage requise.
    for (const [id, range] of Object.entries(meta.depends || {})) {
      if (isBuiltin(id)) continue
      const have = byId[id]
      if (!have || have.version == null) continue // absent -> géré par scanMissingDeps
      if (!satisfies(have.version, range)) {
        conflicts.push(`${nameOf(selfId)} exige ${id} ${JSON.stringify(range)} mais ${id} ${have.version} est présent`)
        involved.add(file); involved.add(have.file)
      }
    }
    // breaks : la version présente NE doit PAS tomber dans la plage incompatible.
    for (const [id, range] of Object.entries(meta.breaks || {})) {
      const have = byId[id]
      if (!have || have.version == null) continue
      if (satisfies(have.version, range)) {
        conflicts.push(`${nameOf(selfId)} est incompatible avec ${id} ${JSON.stringify(range)} (présent : ${have.version})`)
        involved.add(file); involved.add(have.file)
      }
    }
  }
  return { conflicts, involved: [...involved] }
}

module.exports = { readJarMeta, scanMissingDeps, findConflicts, satisfies, parseVer, cmp }
