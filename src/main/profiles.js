// Profils de mods : chaque profil a son propre dossier RÉEL de mods
// (userData/profiles/<id>/mods). On y installe et on y lit.
//
// Le jeu, lui, lit toujours <base>/mods (= minecraft/mods). Au lancement on
// RECOPIE les jars du profil actif dans ce vrai dossier (syncToGame). On
// n'utilise PAS de jonction : sous Windows, une jonction dont le lien ET la
// cible sont sous le même dossier parent n'est pas résolue par le natif (donc
// ni par Java) — les mods ne se chargeraient jamais en jeu.
//
// Le suivi (config.installedMods / config.modules) reste l'état de l'ACTIF ;
// on l'archive dans config.profiles[id] et on le restaure au changement de profil.

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const { getConfig, setConfig } = require('./config')
const { MODULES } = require('./modules')

// Nom lisible depuis un nom de fichier de jar (on n'ouvre PAS le jar : lire
// fabric.mod.json de 143 mods figerait le processus). Retire l'extension et les
// suffixes de version/loader/MC les plus courants pour un affichage plus propre.
function prettyJarName(file) {
  let n = file.replace(/\.jar$/i, '')
  // coupe au 1er token « version » (ex. -1.2.3, _v2, -mc1.21) tout en gardant le nom.
  const cut = n.replace(/[ _-]+(v?\d+[.\d]*.*|mc\d.*|fabric.*|forge.*|neoforge.*|quilt.*)$/i, '')
  return (cut && cut.length >= 2 ? cut : n).replace(/[_-]+/g, ' ').trim()
}

const DEFAULT_VERSION = '1.21.1'
const DEFAULT_LOADER = 'fabric'

function profilesRoot(base) { return path.join(path.dirname(base), 'profiles') }
function profileModsDir(base, id) { return path.join(profilesRoot(base), id, 'mods') }
function gameModsDir(base) { return path.join(base, 'mods') }

function slugify(name) {
  const s = String(name || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return s || ('profil-' + Date.now())
}

async function currentFiles(dir) {
  try { return (await fsp.readdir(dir)).filter(f => f.endsWith('.jar')) } catch { return [] }
}

// S'assure que <dir> est un VRAI dossier (supprime tout lien/jonction résiduel
// hérité d'une ancienne version qui utilisait des jonctions).
async function ensureRealDir(dir) {
  try {
    const st = await fsp.lstat(dir)
    if (st.isSymbolicLink()) await fsp.unlink(dir)
  } catch (_) { /* absent : on crée juste en dessous */ }
  await fsp.mkdir(dir, { recursive: true })
}

// Dossier de mods RÉEL du profil actif (là où on installe et on lit).
async function activeModsDir(base) {
  const cfg = await getConfig()
  const id = cfg.activeProfile || 'default'
  const dir = profileModsDir(base, id)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

// Avant lancement : recopie les jars du profil actif dans <base>/mods (vrai
// dossier). Ajoute ceux qui manquent, retire ceux qui n'appartiennent plus au
// profil (bascule depuis un autre profil).
async function syncToGame(base) {
  const cfg = await getConfig()
  const id = cfg.activeProfile || 'default'
  const src = profileModsDir(base, id)
  const dst = gameModsDir(base)
  await fsp.mkdir(src, { recursive: true })
  await ensureRealDir(dst)

  const want = new Set(await currentFiles(src))
  const have = new Set(await currentFiles(dst))
  // Retire les jars en trop (venant d'un autre profil).
  for (const f of have) {
    if (!want.has(f)) await fsp.rm(path.join(dst, f), { force: true }).catch(() => {})
  }
  // Copie ceux qui manquent ou dont la taille diffère.
  for (const f of want) {
    const s = path.join(src, f), d = path.join(dst, f)
    let copy = !have.has(f)
    if (!copy) {
      try { copy = (await fsp.stat(s)).size !== (await fsp.stat(d)).size } catch { copy = true }
    }
    if (copy) await fsp.copyFile(s, d).catch(() => {})
  }

  // Applique les overrides du profil (config, resourcepacks, shaders…) par-dessus
  // le dossier de jeu. Superposition seulement (jamais de suppression).
  await overlayOverrides(base, id)
  return dst
}

// Copie récursive src -> dst (superposition, ne supprime rien).
async function copyTree(src, dst) {
  let entries
  try { entries = await fsp.readdir(src, { withFileTypes: true }) } catch { return }
  await fsp.mkdir(dst, { recursive: true })
  for (const e of entries) {
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (e.isDirectory()) await copyTree(s, d)
    else await fsp.copyFile(s, d).catch(() => {})
  }
}

// Superpose profiles/<id>/overrides/* sur le dossier de jeu (issu d'un modpack).
async function overlayOverrides(base, id) {
  const src = path.join(profilesRoot(base), id, 'overrides')
  try { await fsp.access(src) } catch { return } // pas d'overrides pour ce profil
  await copyTree(src, base)
}

// Au démarrage : garantit un profil "Défaut" et un <base>/mods réel.
// Migre les jars d'un ancien <base>/mods (vrai dossier) vers profiles/default.
async function ensureInitialized(base) {
  const cfg = await getConfig()
  const hasProfiles = cfg.profiles && Object.keys(cfg.profiles).length && cfg.activeProfile

  if (hasProfiles) {
    // Profils déjà présents : juste réparer <base>/mods s'il reste une jonction.
    await fsp.mkdir(profileModsDir(base, cfg.activeProfile), { recursive: true })
    await ensureRealDir(gameModsDir(base))
    return
  }

  // Première initialisation : crée "default" et récupère les jars présents.
  const target = profileModsDir(base, 'default')
  await fsp.mkdir(target, { recursive: true })
  const gm = gameModsDir(base)
  try {
    const st = await fsp.lstat(gm)
    if (st.isDirectory() && !st.isSymbolicLink()) {
      const inTarget = new Set(await currentFiles(target))
      for (const f of await currentFiles(gm)) {
        if (!inTarget.has(f)) await fsp.copyFile(path.join(gm, f), path.join(target, f)).catch(() => {})
      }
    }
  } catch (_) { /* pas de dossier mods préexistant */ }
  await ensureRealDir(gm)

  await setConfig({
    profiles: { default: { name: 'Défaut', installedMods: cfg.installedMods || {}, modules: cfg.modules || {} } },
    activeProfile: 'default'
  })
}

async function list(base) {
  const cfg = await getConfig()
  const out = {}
  for (const [id, p] of Object.entries(cfg.profiles || {})) {
    // Compte les VRAIS jars du dossier (inclut les mods déposés à la main), pas le
    // seul suivi installedMods. + les modules (PipouMod & co, déployés à part).
    let jars = 0
    try { jars = (await currentFiles(profileModsDir(base, id))).length } catch (_) {}
    const modules = cfg.activeProfile === id ? (cfg.modules || {}) : (p.modules || {})
    out[id] = {
      name: p.name,
      gameVersion: p.gameVersion || DEFAULT_VERSION,
      loader: p.loader || DEFAULT_LOADER,
      count: jars + Object.keys(modules).length
    }
  }
  return { profiles: out, active: cfg.activeProfile || null }
}

// opts : { duplicate, gameVersion, ram } — duplicate peut aussi être passé en booléen.
async function create(base, name, opts = {}) {
  if (typeof opts === 'boolean') opts = { duplicate: opts }
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  let id = slugify(name), n = 1
  while (profiles[id]) id = slugify(name) + '-' + (++n)

  await fsp.mkdir(profileModsDir(base, id), { recursive: true })
  let installedMods = {}, modules = {}
  const activeCfg = cfg.activeProfile ? (profiles[cfg.activeProfile] || {}) : {}
  if (opts.duplicate && cfg.activeProfile) {
    const srcDir = profileModsDir(base, cfg.activeProfile)
    const dstDir = profileModsDir(base, id)
    for (const f of await currentFiles(srcDir)) await fsp.copyFile(path.join(srcDir, f), path.join(dstDir, f))
    installedMods = { ...(cfg.installedMods || {}) }
    modules = { ...(cfg.modules || {}) }
  }
  const dup = opts.duplicate && cfg.activeProfile
  profiles[id] = {
    name,
    installedMods,
    modules,
    gameVersion: opts.gameVersion || activeCfg.gameVersion || DEFAULT_VERSION,
    loader: opts.loader || (dup ? activeCfg.loader : null) || DEFAULT_LOADER,
    loaderVersion: opts.loaderVersion || (dup ? activeCfg.loaderVersion : null) || null,
    // En duplication, on hérite AUSSI de la RAM de l'actif (comme la version).
    ram: opts.ram || (dup ? activeCfg.ram : null) || { mode: 'auto' }
  }
  await setConfig({ profiles })
  return { id, name }
}

// Fixe la version Minecraft d'un profil.
async function setVersion(base, id, version) {
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  if (!profiles[id]) throw new Error('Profil introuvable.')
  profiles[id].gameVersion = version || DEFAULT_VERSION
  await setConfig({ profiles })
  return { id, version: profiles[id].gameVersion }
}

// Fixe la RAM d'un profil : mode 'auto' (calculée) ou 'manual' (mb fixe).
async function setRam(base, id, mode, mb) {
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  if (!profiles[id]) throw new Error('Profil introuvable.')
  profiles[id].ram = mode === 'manual'
    ? { mode: 'manual', mb: Math.max(1024, Math.round(mb || 0)) }
    : { mode: 'auto' }
  await setConfig({ profiles })
  return { id, ram: profiles[id].ram }
}

// Active/désactive la gestion AUTOMATIQUE des mods pour un profil. OFF = le launcher
// ne touche plus aux versions (idéal pour un modpack déjà cohérent).
async function setManageMods(base, id, value) {
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  if (!profiles[id]) throw new Error('Profil introuvable.')
  profiles[id].manageMods = !!value
  await setConfig({ profiles })
  return { id, manageMods: !!value }
}

// Détail complet d'un profil (pour la vue « instance » type CurseForge).
// Les mods de l'actif viennent de l'état LIVE ; ceux des autres, de l'archive.
async function detail(base, id) {
  const cfg = await getConfig()
  const p = (cfg.profiles || {})[id]
  if (!p) throw new Error('Profil introuvable.')
  const active = cfg.activeProfile === id
  const installedMods = active ? (cfg.installedMods || {}) : (p.installedMods || {})
  const modules = active ? (cfg.modules || {}) : (p.modules || {})

  // Métadonnées des mods SUIVIS, indexées par nom de fichier (jolis titre/icône/version).
  const byFile = {}
  for (const [pid, m] of Object.entries(installedMods)) {
    for (const f of (m.files || [])) byFile[f] = { id: pid, name: m.title || m.slug || pid, icon: m.icon || '', version: m.version || '' }
  }

  const mods = []
  // On SCANNE le vrai dossier de mods du profil : TOUT jar présent est affiché, qu'il
  // ait été installé par le launcher OU déposé à la main dans le dossier (le bug était
  // qu'on n'affichait que les mods suivis dans installedMods).
  const dir = profileModsDir(base, id)
  for (const f of await currentFiles(dir)) {
    const meta = byFile[f]
    if (meta) {
      mods.push({ type: 'mod', id: meta.id, file: f, name: meta.name, icon: meta.icon, isImage: !!meta.icon, version: meta.version })
    } else {
      mods.push({ type: 'file', id: f, file: f, name: prettyJarName(f), icon: '', isImage: false, version: '' })
    }
  }

  // Modules (PipouMod & co) : déployés HORS du dossier profil -> ajoutés à part.
  const catalog = Object.fromEntries(MODULES.map(m => [m.id, { icon: m.icon, label: m.label }]))
  for (const mid of Object.keys(modules)) {
    const meta = catalog[mid] || {}
    mods.push({ type: 'module', id: mid, name: meta.label || mid, icon: meta.icon || '♥', isImage: false, version: '' })
  }
  mods.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return {
    id, name: p.name, active,
    gameVersion: p.gameVersion || DEFAULT_VERSION,
    loader: p.loader || DEFAULT_LOADER,
    loaderVersion: p.loaderVersion || null,
    ram: p.ram || { mode: 'auto' },
    manageMods: p.manageMods !== false,
    mods
  }
}

// Famille de loader : Fabric/Quilt partagent leurs mods ; Forge/NeoForge les leurs.
const loaderFamily = (l) => (l === 'fabric' || l === 'quilt') ? 'fabric' : 'forge'

// Fixe le loader d'un profil (et sa version exacte si connue).
// Si on change de FAMILLE, les mods du profil deviennent incompatibles : on les
// purge (dossier + suivi), sinon syncToGame recopierait des jars d'une autre
// famille dans le jeu → écran d'erreur / crash.
async function setLoader(base, id, loader, loaderVersion) {
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  if (!profiles[id]) throw new Error('Profil introuvable.')
  const prev = profiles[id].loader || DEFAULT_LOADER
  const next = loader || DEFAULT_LOADER
  profiles[id].loader = next
  profiles[id].loaderVersion = loaderVersion || null

  let cleared = false
  if (loaderFamily(prev) !== loaderFamily(next)) {
    const dir = profileModsDir(base, id)
    for (const f of await currentFiles(dir)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {})
    profiles[id].installedMods = {}
    profiles[id].modules = {}
    cleared = true
    if (cfg.activeProfile === id) {
      // Remet aussi l'état LIVE de l'actif (detail()/switchTo le lisent).
      await setConfig({ profiles, installedMods: {}, modules: {} })
      return { id, loader: next, cleared }
    }
  }
  await setConfig({ profiles })
  return { id, loader: next, cleared }
}

async function switchTo(base, id) {
  const cfg = await getConfig()
  const profiles = cfg.profiles || {}
  if (!profiles[id]) throw new Error('Profil introuvable.')

  // Archive l'état de l'actif avant de basculer.
  if (cfg.activeProfile && profiles[cfg.activeProfile]) {
    profiles[cfg.activeProfile].installedMods = cfg.installedMods || {}
    profiles[cfg.activeProfile].modules = cfg.modules || {}
  }
  await fsp.mkdir(profileModsDir(base, id), { recursive: true })
  await setConfig({
    profiles,
    activeProfile: id,
    installedMods: profiles[id].installedMods || {},
    modules: profiles[id].modules || {}
  })
  return { id }
}

async function remove(base, id) {
  let cfg = await getConfig()
  if (id === 'default') throw new Error('Le profil Défaut ne peut pas être supprimé.')
  if (!(cfg.profiles || {})[id]) return { id }

  // Si on supprime le profil ACTIF, on bascule d'abord sur Défaut.
  const switched = cfg.activeProfile === id
  if (switched) { await switchTo(base, 'default'); cfg = await getConfig() }

  const profiles = cfg.profiles || {}
  delete profiles[id]
  await fsp.rm(path.join(profilesRoot(base), id), { recursive: true, force: true }).catch(() => {})
  await setConfig({ profiles })
  return { id, switched }
}

// Chemins RÉELS d'un profil donné (pour l'import de modpack).
function modsDirFor(base, id) { return profileModsDir(base, id) }
function overridesDirFor(base, id) { return path.join(profilesRoot(base), id, 'overrides') }

module.exports = {
  ensureInitialized, activeModsDir, syncToGame, list, create, switchTo, remove,
  setVersion, setRam, setManageMods, setLoader, detail, modsDirFor, overridesDirFor
}
