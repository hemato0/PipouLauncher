// Intégration de l'API Modrinth (https://docs.modrinth.com).
// On ne stocke aucun mod nous-mêmes : on interroge Modrinth pour récupérer,
// pour la version de Minecraft choisie, la bonne version de chaque mod de perf.
// 100% légal (source officielle) et toujours à jour.
//
// Deux garanties de compatibilité :
//  1) on ne met dans le catalogue que des mods MUTUELLEMENT compatibles avec le
//     Sodium récent (on a retiré Nvidium/Indium/More Culling qui exigent un vieux
//     Sodium ou une version pas encore sortie) ;
//  2) on résout AUTOMATIQUEMENT les dépendances requises (ex. cloth-config) que
//     Modrinth déclare pour chaque version de mod.

const MODRINTH_API = 'https://api.modrinth.com/v2'

const HEADERS = {
  'User-Agent': 'perf-launcher/0.1.0 (launcher éducatif d\'optimisation)'
}

// Catalogue des mods de perf, classés par ce qu'ils corrigent.
//   cat  : catégorie de lag ciblée (affichée dans l'UI)
//   gpu  : si présent, mod installé UNIQUEMENT pour ce vendeur de GPU
//   core : true = installé même sur le profil le plus léger
const PERF_MODS = [
  // --- Dépendance de base ---
  { slug: 'fabric-api', label: 'Fabric API', cat: 'core', core: true,
    why: 'Dépendance requise par la plupart des mods de perf.' },

  // --- Rendu / FPS ---
  { slug: 'sodium', label: 'Sodium', cat: 'fps', core: true,
    why: 'Réécrit le moteur de rendu, multithreadé → gros gain de FPS.' },
  { slug: 'sodium-extra', label: 'Sodium Extra', cat: 'entities', core: true,
    why: 'Contrôle fin des particules/entités (exactement le cas MagicSpells).' },
  { slug: 'immediatelyfast', label: 'ImmediatelyFast', cat: 'fps', core: true,
    why: 'Accélère le rendu des particules, textes et items.' },

  // --- Entités (ton cas MagicSpells) ---
  { slug: 'entityculling', label: 'EntityCulling', cat: 'entities', core: true,
    why: 'Ne rend pas les entités derrière les murs.' },

  // --- Réseau / ping ---
  { slug: 'krypton', label: 'Krypton', cat: 'network', core: true,
    why: 'Optimise la pile réseau → réduit les pics de ping.' },

  // --- Logique / tick ---
  { slug: 'lithium', label: 'Lithium', cat: 'logic', core: true,
    why: 'Optimise la logique du jeu côté client (physique, IA).' },

  // --- Mémoire / démarrage ---
  { slug: 'ferrite-core', label: 'FerriteCore', cat: 'memory', core: true,
    why: 'Réduit fortement la RAM utilisée.' },
  { slug: 'modernfix', label: 'ModernFix', cat: 'memory', core: true,
    why: 'Démarrage plus rapide, moins de RAM.' },
  { slug: 'dynamic-fps', label: 'Dynamic FPS', cat: 'memory',
    why: 'Réduit la charge quand le jeu est en arrière-plan.' },
  { slug: 'threadtweak', label: 'ThreadTweak', cat: 'logic',
    why: 'Ajuste la priorité des threads de Minecraft.' }

  // RETIRÉS (incompatibles avec le Sodium récent, cause de crashs Fabric) :
  //  - nvidium   : exige une vieille version de Sodium (0.5.x)
  //  - indium    : inutile/incompatible avec Sodium récent (rendering API intégré)
  //  - moreculling: exige cloth-config ET une version pas encore compatible Sodium
]

// Mods COMPAGNONS : vont ensemble mais NE sont PAS déclarés comme dépendances sur
// Modrinth (même auteur / paire de fonctionnalités). Ex. ETF (textures) + EMF
// (modèles) de Traben. Quand on installe l'un, on installe aussi l'autre.
// Clé = projectId OU slug ; valeur = slugs/ids à installer aussi (bidirectionnel).
const COMPANIONS = {
  BVzZfTc1: ['entity-model-features'], entitytexturefeatures: ['entity-model-features'], // ETF -> EMF
  '4I1XuqiY': ['entitytexturefeatures'], 'entity-model-features': ['entitytexturefeatures'] // EMF -> ETF
}
// Renvoie la liste (dédupliquée) des compagnons pour un mod (par id et/ou slug).
function getCompanions(...keys) {
  const out = new Set()
  for (const k of keys) for (const c of (COMPANIONS[k] || [])) out.add(c)
  return [...out]
}

function modApplies(mod, { gpuVendor, coreOnly }) {
  if (coreOnly && !mod.core) return false
  if (mod.gpu && mod.gpu !== gpuVendor) return false
  return true
}

function gpuVendorFromModel(model = '') {
  const m = model.toLowerCase()
  if (m.includes('nvidia') || m.includes('geforce') || m.includes('rtx') || m.includes('gtx')) return 'nvidia'
  if (m.includes('amd') || m.includes('radeon') || m.includes('rx ')) return 'amd'
  if (m.includes('intel') || m.includes('arc') || m.includes('iris') || m.includes('uhd')) return 'intel'
  return 'unknown'
}

// Transforme une version Modrinth (objet API) en entrée d'installation.
function toEntry(v) {
  const file = (v.files || []).find(f => f.primary) || (v.files || [])[0]
  if (!file) return null
  return {
    slug: v.project_id,
    projectId: v.project_id,
    versionId: v.id,
    versionNumber: v.version_number,
    fileName: file.filename,
    downloadUrl: file.url,
    sha1: file.hashes && file.hashes.sha1,
    dependencies: v.dependencies || []
  }
}

// Recherche de mods sur Modrinth (barre de recherche du gestionnaire).
// Renvoie une liste de projets compatibles avec la version MC + le loader.
async function searchMods(query, gameVersion, loader = 'fabric', limit = 40) {
  const facets = [['project_type:mod'], [`categories:${loader}`], [`versions:${gameVersion}`]]
  const url = `${MODRINTH_API}/search`
    + `?limit=${limit}`
    + `&index=${query ? 'relevance' : 'downloads'}`
    + `&query=${encodeURIComponent(query || '')}`
    + `&facets=${encodeURIComponent(JSON.stringify(facets))}`

  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Modrinth search: HTTP ${res.status}`)
  const data = await res.json()
  return (data.hits || []).map(h => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    downloads: h.downloads,
    iconUrl: h.icon_url || '',
    categories: h.categories || []
  }))
}

// Métadonnées (logo + nom + slug) de plusieurs projets, par lots de 100.
// Renvoie { [projectId]: { icon, title, slug } }.
async function getProjectsMeta(ids) {
  const out = {}
  const unique = [...new Set((ids || []).filter(Boolean))]
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const url = `${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) continue
      for (const p of await res.json()) out[p.id] = { icon: p.icon_url || '', title: p.title, slug: p.slug }
    } catch (_) { /* lot en échec : on continue */ }
  }
  return out
}

// Résout des projets Modrinth à partir des hash SHA1 de fichiers (POST /version_files).
// Renvoie { [sha1]: projectId } pour les jars connus de Modrinth.
async function getProjectsByHashes(hashes) {
  const out = {}
  const list = [...new Set((hashes || []).filter(Boolean))]
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    try {
      const res = await fetch(`${MODRINTH_API}/version_files`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: chunk, algorithm: 'sha1' })
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const [h, v] of Object.entries(data)) if (v && v.project_id) out[h] = v.project_id
    } catch (_) { /* lot en échec : on continue */ }
  }
  return out
}

// Comme getProjectsByHashes mais renvoie AUSSI le numéro de version installé :
// { [sha1]: { projectId, versionNumber } }. Sert à marquer « installé » + la version
// dans le gestionnaire, même pour les jars ajoutés à la main / via un modpack.
async function getVersionsByHashes(hashes) {
  const out = {}
  const list = [...new Set((hashes || []).filter(Boolean))]
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100)
    try {
      const res = await fetch(`${MODRINTH_API}/version_files`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: chunk, algorithm: 'sha1' })
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const [h, v] of Object.entries(data)) if (v && v.project_id) out[h] = { projectId: v.project_id, versionNumber: v.version_number }
    } catch (_) { /* lot en échec : on continue */ }
  }
  return out
}

// Meilleure version STABLE d'un projet (slug ou id) pour MC+loader. null si aucune.
async function getBestVersion(idOrSlug, gameVersion, loader = 'fabric', opts = {}) {
  const url = `${MODRINTH_API}/project/${idOrSlug}/version`
    + `?game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`
    + `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`

  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Modrinth ${idOrSlug}: HTTP ${res.status}`)

  const versions = await res.json()
  if (!Array.isArray(versions) || versions.length === 0) return null
  // Par défaut on privilégie une version STABLE ; allowBeta = la PLUS RÉCENTE
  // (utile quand la dernière stable est incompatible avec un autre mod).
  const v = opts.allowBeta ? versions[0] : (versions.find(x => x.version_type === 'release') || versions[0])
  return toEntry(v)
}

// Meilleure version d'un projet qui RESPECTE un prédicat imposé par un AUTRE mod.
// `allow(versionNumber)` -> booléen (fourni par l'appelant, qui connaît les contraintes
// depscan). Ex. Iris exige sodium "0.6.x" -> renvoie la plus haute Sodium 0.6.x.
// Préfère une version STABLE parmi celles qui conviennent, sinon la plus récente qui
// convient (Modrinth renvoie déjà du plus récent au plus ancien). null si aucune.
async function getBestVersionMatching(idOrSlug, gameVersion, loader, allow) {
  const url = `${MODRINTH_API}/project/${idOrSlug}/version`
    + `?game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`
    + `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  let res
  try { res = await fetch(url, { headers: HEADERS }) } catch (_) { return null }
  if (!res.ok) return null
  const versions = await res.json()
  if (!Array.isArray(versions) || !versions.length) return null
  const okv = versions.filter(v => { try { return allow(v.version_number) } catch (_) { return false } })
  if (!okv.length) return null
  const stable = okv.find(v => v.version_type === 'release')
  return toEntry(stable || okv[0])
}

// Liste TOUTES les versions d'un mod compatibles avec la version MC + le loader
// (les plus récentes d'abord). Sert au sélecteur « choisir la version du mod ».
async function listModVersions(idOrSlug, gameVersion, loader = 'fabric') {
  const url = `${MODRINTH_API}/project/${idOrSlug}/version`
    + `?game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}`
    + `&loaders=${encodeURIComponent(JSON.stringify([loader]))}`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`Modrinth ${idOrSlug}: HTTP ${res.status}`)
  const versions = await res.json()
  if (!Array.isArray(versions)) return []
  return versions.map(v => ({
    versionId: v.id,
    versionNumber: v.version_number,
    versionType: v.version_type, // release | beta | alpha
    datePublished: v.date_published
  }))
}

// Version précise par id (pour une dépendance qui épingle une version).
async function getVersionById(versionId) {
  const res = await fetch(`${MODRINTH_API}/version/${versionId}`, { headers: HEADERS })
  if (!res.ok) return null
  return toEntry(await res.json())
}

// Métadonnées d'un projet (nom lisible + slug), avec cache.
const projectCache = new Map()
async function getProjectMeta(id) {
  if (projectCache.has(id)) return projectCache.get(id)
  let out = { title: id, slug: id }
  try {
    const res = await fetch(`${MODRINTH_API}/project/${id}`, { headers: HEADERS })
    if (res.ok) { const p = await res.json(); out = { title: p.title, slug: p.slug } }
  } catch (_) { /* on garde le fallback */ }
  projectCache.set(id, out)
  return out
}

// Résout les mods de perf + leurs DÉPENDANCES requises pour une version de MC.
// opts.gpuVendor : filtre les mods spécifiques à un GPU.
// opts.coreOnly  : ne garder que les mods essentiels (petits PC).
// Renvoie { resolved, unavailable, errored, missing, skipped }.
async function resolvePerfMods(gameVersion, loader = 'fabric', opts = {}) {
  const resolved = []
  const unavailable = []
  const errored = []
  const skipped = []
  const seen = new Set() // project ids déjà inclus (dédup mods + dépendances)

  // 1) Mods de base du catalogue.
  for (const mod of PERF_MODS) {
    if (!modApplies(mod, opts)) { skipped.push(mod.slug); continue }
    try {
      const best = await getBestVersion(mod.slug, gameVersion, loader)
      if (best) { resolved.push({ ...mod, ...best }); seen.add(best.projectId) }
      else unavailable.push(mod.slug)
    } catch (e) {
      errored.push({ slug: mod.slug, error: e.message })
    }
  }

  // 2) Dépendances REQUISES, en largeur (les deps de deps sont incluses aussi).
  let frontier = [...resolved]
  while (frontier.length) {
    const next = []
    for (const item of frontier) {
      for (const dep of item.dependencies || []) {
        if (dep.dependency_type !== 'required') continue
        if (!dep.project_id || seen.has(dep.project_id)) continue
        seen.add(dep.project_id)
        try {
          const best = dep.version_id
            ? await getVersionById(dep.version_id)
            : await getBestVersion(dep.project_id, gameVersion, loader)
          if (best) {
            const meta = await getProjectMeta(dep.project_id)
            const depItem = {
              ...best,
              slug: meta.slug,
              label: meta.title,
              cat: 'dependency',
              why: `Dépendance requise par ${item.label}.`
            }
            resolved.push(depItem)
            next.push(depItem)
          } else {
            unavailable.push(dep.project_id)
          }
        } catch (e) {
          errored.push({ slug: dep.project_id, error: e.message })
        }
      }
    }
    frontier = next
  }

  const missing = [...unavailable, ...errored.map(e => e.slug)]
  return { resolved, unavailable, errored, missing, skipped }
}

module.exports = {
  PERF_MODS, resolvePerfMods, getBestVersion, getBestVersionMatching, getVersionById, listModVersions,
  gpuVendorFromModel, searchMods, getProjectsMeta, getProjectsByHashes, getVersionsByHashes, getCompanions
}
