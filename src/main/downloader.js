// Téléchargement des mods dans le dossier de jeu géré par le launcher.
// Chaque fichier est vérifié par SHA1 (intégrité + sécurité), et l'opération
// est idempotente : un mod déjà présent avec le bon hash n'est pas re-téléchargé.

const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

const HEADERS = {
  'User-Agent': 'perf-launcher/0.1.0 (launcher éducatif d\'optimisation)'
}

// Compteur pour des noms de fichiers temporaires uniques (évite les collisions
// entre téléchargements parallèles écrivant la même destination).
let partCounter = 0

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// SHA1 hexadécimal d'un buffer.
function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

// fetch avec timeout (AbortController) + retry à backoff exponentiel.
// Ne réessaie PAS les 4xx non transitoires (elles ne se répareront pas).
// `consume(res)` (optionnel) lit le CORPS SOUS un timeout réarmé et sa valeur est
// renvoyée : un corps bloqué par le CDN déclenche alors abort + retry, au lieu de
// pendre ~5 min (bodyTimeout undici) sans retry. Sans consume, on renvoie la réponse
// (l'appelant lit le corps lui-même, hors timeout — à réserver aux réponses sûres).
async function fetchWithRetry(url, { retries = 3, timeoutMs = 30000, consume = null } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    let timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal })
      if (res.ok) {
        if (!consume) { clearTimeout(timer); return res }
        clearTimeout(timer)
        timer = setTimeout(() => ctrl.abort(), timeoutMs) // budget RÉARMÉ pour le corps
        try { return await consume(res) }
        finally { clearTimeout(timer) }
      }
      clearTimeout(timer)
      // Réponse d'erreur : libérer le socket avant de réessayer/abandonner.
      if (res.body) { try { await res.body.cancel() } catch (_) {} }
      // 4xx (hors 408/429) = définitif : on abandonne sans réessayer.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        throw new Error(`HTTP ${res.status}`)
      }
      lastErr = new Error(`HTTP ${res.status}`) // 5xx/408/429 : transitoire
    } catch (e) {
      clearTimeout(timer)
      if (e && typeof e.message === 'string' && /^HTTP 4/.test(e.message)) throw e
      lastErr = e // réseau/timeout/abort : transitoire
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt)
  }
  throw lastErr
}

// Vérifie qu'un fichier existant correspond au hash attendu.
// Retourne false si le fichier n'existe pas, ou si aucun hash n'est fourni.
async function fileMatches(filePath, expectedSha1) {
  if (!expectedSha1) return false
  try {
    const buf = await fsp.readFile(filePath)
    return sha1(buf) === expectedSha1
  } catch (_) {
    return false
  }
}

// Récupère et parse un JSON distant (avec retry/timeout, corps lu sous timeout).
async function fetchJson(url) {
  return await fetchWithRetry(url, { consume: (res) => res.json() })
}

// Brique bas niveau : télécharge une URL vers un chemin précis (crée les
// dossiers parents), vérifie le SHA1 si fourni, idempotent, écriture atomique.
// Renvoie { status: 'cached' | 'downloaded', bytes? }.
async function downloadFile(url, destPath, expectedSha1) {
  if (await fileMatches(destPath, expectedSha1)) {
    return { status: 'cached' }
  }

  const buf = await fetchWithRetry(url, { consume: async (res) => Buffer.from(await res.arrayBuffer()) })
  if (expectedSha1 && sha1(buf) !== expectedSha1) {
    throw new Error('SHA1 non conforme (fichier corrompu ou altéré)')
  }

  await fsp.mkdir(path.dirname(destPath), { recursive: true })
  // Nom temporaire unique -> pas de collision entre workers parallèles.
  const tmp = `${destPath}.${process.pid}.${++partCounter}.part`
  try {
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, destPath)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {}) // pas d'orphelin
    throw e
  }

  return { status: 'downloaded', bytes: buf.length }
}

// Télécharge une liste d'items en parallèle avec un pool borné.
// items : [{ url, dest, sha1?, ...meta }]. onProgress({done,total,item,result}).
// Ne rejette jamais : un item en échec a result.status === 'error'.
async function downloadAll(items, { concurrency = 4, onProgress } = {}) {
  const results = new Array(items.length)
  let next = 0, done = 0

  async function worker() {
    while (next < items.length) {
      const i = next++
      const it = items[i]
      try {
        const r = await downloadFile(it.url, it.dest, it.sha1)
        results[i] = { ...it, status: r.status, bytes: r.bytes }
      } catch (e) {
        results[i] = { ...it, status: 'error', error: e.message }
      }
      done++
      if (onProgress) onProgress({ done, total: items.length, item: it, result: results[i] })
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results
}

// Télécharge un mod. Renvoie un statut : 'cached' | 'downloaded'.
async function downloadOne(mod, modsDir) {
  const dest = path.join(modsDir, mod.fileName)
  const r = await downloadFile(mod.downloadUrl, dest, mod.sha1)
  return { slug: mod.slug, status: r.status, fileName: mod.fileName, bytes: r.bytes }
}

// Télécharge une liste de mods dans modsDir, séquentiellement (progression
// claire + doux pour le CDN Modrinth). onProgress est appelé à chaque étape.
async function downloadMods(mods, modsDir, onProgress) {
  await fsp.mkdir(modsDir, { recursive: true })

  const results = []
  let done = 0

  for (const mod of mods) {
    if (onProgress) onProgress({ phase: 'start', mod, done, total: mods.length })
    try {
      const r = await downloadOne(mod, modsDir)
      results.push(r)
    } catch (e) {
      results.push({ slug: mod.slug, status: 'error', error: e.message })
    }
    done++
    const last = results[results.length - 1]
    if (onProgress) onProgress({ phase: 'done', mod, result: last, done, total: mods.length })
  }

  return results
}

// Réconcilie le dossier de mods GÉRÉ : supprime les .jar qui ne font PAS partie
// de l'ensemble voulu (ex. anciens mods devenus incompatibles). Le dossier est
// géré par le launcher, donc on peut le remettre à l'état exact voulu.
async function reconcileMods(modsDir, wantedFilenames) {
  const wanted = new Set(wantedFilenames)
  const removed = []
  let entries = []
  try { entries = await fsp.readdir(modsDir) } catch (_) { return { removed } }
  for (const name of entries) {
    if (!name.endsWith('.jar')) continue
    if (!wanted.has(name)) {
      await fsp.rm(path.join(modsDir, name), { force: true }).catch(() => {})
      removed.push(name)
    }
  }
  return { removed }
}

module.exports = { downloadMods, downloadOne, downloadFile, downloadAll, fetchJson, reconcileMods, sha1 }
