// Processus principal Electron.
// Il crée la fenêtre et expose au renderer, via IPC, les fonctions "métier"
// (détection matériel/Java, calcul du profil, args JVM, résolution des mods).

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')

// Nom d'app FIXE : garde userData = %APPDATA%/perf-launcher même une fois packagé
// (productName = "PipouLauncher"), pour ne pas perdre comptes/profils existants.
app.setName('perf-launcher')

const { detectHardware, pickProfile, computeRamMB, PROFILES } = require('./hardware')
const { buildJvmPlan } = require('./jvm')
const { resolvePerfMods, gpuVendorFromModel, getBestVersion, searchMods, getProjectsMeta, getProjectsByHashes, getCompanions } = require('./modrinth')
const crypto = require('crypto')
const { optionsForProfile } = require('./settings')
const { downloadMods, downloadFile, fetchJson } = require('./downloader')
const { installFabric } = require('./fabric')
const { installVanilla } = require('./mojang')
const { parseModpack } = require('./modpack')
const { detectJava } = require('./java')
const { launch, findModdedProfile } = require('./launch')
const { installLoader, LOADER_LABEL, FABRIC_LIKE, isValidLoader, latestLoaderVersion } = require('./loaders')
const { scanMissingDeps, findConflicts } = require('./depscan')
const { setGpuPreference, clearGpuPreference, getGpuPreference } = require('./system')
const { getConfig, setConfig, updateConfig } = require('./config')
const profiles = require('./profiles')
const auth = require('./auth')
const accounts = require('./accounts')

// Journal de démarrage (userData/boot.log) : trace le boot pour diagnostiquer un
// problème CHEZ L'UTILISATEUR (ex. compte non affiché) qu'on ne reproduit pas en dev.
// Repart à zéro à chaque lancement du processus primaire.
function bootLogPath() { try { return path.join(app.getPath('userData'), 'boot.log') } catch (_) { return null } }
function bootLog(msg) {
  const p = bootLogPath(); if (!p) return
  let stamp = ''; try { stamp = new Date().toISOString() } catch (_) {}
  try { fs.appendFileSync(p, `${stamp} [${process.pid}] ${msg}\n`) } catch (_) {}
}

// Compte connecté (garde le token de jeu EN MAIN, jamais exposé au renderer).
let currentAccount = null
function publicAccount(a) { return a ? { uuid: a.uuid, name: a.name, offline: !!a.offline } : null }

// Dossier de jeu GÉRÉ par le launcher (on ne touche pas au .minecraft vanilla).
function gameDir() { return path.join(app.getPath('userData'), 'minecraft') }
// Dossier où l'on INSTALLE/LIT les mods = dossier RÉEL du profil actif.
// (Le jeu lit gameDir/mods, alimenté par profiles.syncToGame au lancement.)
function modsDir() { return profiles.activeModsDir(gameDir()) }

// Installe Sinytra Connector + Forgified Fabric API (NeoForge) s'ils manquent : ils
// permettent d'exécuter les mods Fabric (dont PipouMod) sur un profil NeoForge.
async function ensureConnector(md, gv, evt) {
  const need = [
    { slug: 'connector', match: 'connector' },
    { slug: 'forgified-fabric-api', match: 'forgified' }
  ]
  let files = await fsp.readdir(md).catch(() => [])
  for (const n of need) {
    if (files.some(f => f.toLowerCase().includes(n.match) && f.endsWith('.jar'))) continue
    try {
      const v = await getBestVersion(n.slug, gv, 'neoforge', { allowBeta: true })
      if (v && v.downloadUrl) {
        await downloadFile(v.downloadUrl, path.join(md, v.fileName), v.sha1)
        files.push(v.fileName)
        evt.sender.send('game-log', `[launcher] ${n.slug} installé (Connector pour PipouMod).\n`)
      } else {
        evt.sender.send('game-log', `[launcher] ⚠ ${n.slug} introuvable pour NeoForge ${gv} — PipouMod pourrait ne pas charger.\n`)
      }
    } catch (e) {
      evt.sender.send('game-log', `[launcher] ⚠ ${n.slug} : ${e.message}\n`)
    }
  }
}

// Loader par défaut des CATALOGUES orientés Fabric (mods de perf + Modules).
// Fabric et Quilt partagent l'écosystème Fabric.
const LOADER = 'fabric'

// Loader + version du profil ACTIF (source de vérité pour lancer/chercher/installer).
async function activeLoaderInfo() {
  const cfg = await getConfig()
  const p = (cfg.profiles || {})[cfg.activeProfile] || {}
  return { loader: p.loader || 'fabric', loaderVersion: p.loaderVersion || null, gameVersion: p.gameVersion || null }
}
// Pour la recherche/install de mods : Quilt charge les mods Fabric (facette 'fabric').
function browserLoader(loader) { return loader === 'quilt' ? 'fabric' : loader }

// --- Caches : la détection matériel/Java est coûteuse et invariante. ---
let hwCache = null
async function getHardware() {
  if (!hwCache) hwCache = await detectHardware()
  return hwCache
}
let javaProbed = false
let javaCache = null
async function getJava() {
  if (!javaProbed) { javaCache = await detectJava(); javaProbed = true }
  return javaCache
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#140a1f',
    title: 'PipouLauncher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.setMenuBarVisibility(false)

  // Durcissement : pas de nouvelles fenêtres, pas de navigation hors de l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url) // liens -> navigateur système
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

// --- IPC : le renderer appelle ces "handlers" et reçoit du JSON pur. ---

// Assemble l'état complet pour un profil donné (matériel + Java déjà connus).
async function buildState(hw, profile) {
  const ramMB = computeRamMB(hw, profile)
  const java = await getJava()
  const totalRamMB = Math.round(hw.totalRamGB * 1024)
  const plan = buildJvmPlan({
    ramMB,
    cores: hw.cpuThreads,
    javaMajor: java ? java.major : null,
    totalRamMB
  })
  return {
    hw,
    profile,
    ramMB,
    jvmArgs: plan.args,
    gcLabel: plan.gcLabel,
    java: java ? { version: java.version, major: java.major, path: java.path } : null,
    gameOptions: optionsForProfile(profile),
    gpuVendor: gpuVendorFromModel(hw.gpuModel)
  }
}

// Analyse la machine et renvoie un état complet prêt à afficher.
ipcMain.handle('analyze', async () => {
  const hw = await getHardware()
  const profile = pickProfile(hw)
  return { ...(await buildState(hw, profile)), profiles: Object.values(PROFILES) }
})

// Recalcule tout quand l'utilisateur change de profil manuellement.
ipcMain.handle('recompute', async (_evt, { profileId }) => {
  const hw = await getHardware()
  const profile = PROFILES[profileId] || pickProfile(hw)
  return await buildState(hw, profile)
})

// Liste des versions Minecraft release proposées. On PLANCHE à 1.20.1 : c'est la
// borne testée/livrée (PipouMod compilé pour 1.20.1→1.21.8, schéma natives moderne
// ≥1.19, Java 17/21). En dessous, le lancement vanilla n'est pas garanti (natives
// ancien schéma, assets « legacy ») — on ne les expose donc pas dans le sélecteur.
function versionAtLeast(id, min) {
  const p = s => s.split('.').map(n => parseInt(n, 10) || 0)
  const a = p(id), b = p(min)
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0) }
  return true
}
let versionsCache = null
ipcMain.handle('list-versions', async () => {
  if (!versionsCache) {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    versionsCache = (manifest.versions || [])
      .filter(v => v.type === 'release')
      .map(v => v.id)
      .filter(id => /^\d+\.\d+(\.\d+)?$/.test(id) && versionAtLeast(id, '1.20.1'))
  }
  return versionsCache
})

// État d'installation pour une version donnée : Minecraft vanilla, Fabric, mods
// déjà présents. Sert à afficher « déjà fait » et à ne pas re-télécharger.
ipcMain.handle('install-status', async (_evt, { gameVersion }) => {
  const dir = gameDir()
  const verDir = path.join(dir, 'versions', gameVersion)
  const vanilla = fs.existsSync(path.join(verDir, `${gameVersion}.jar`)) &&
                  fs.existsSync(path.join(verDir, `${gameVersion}.json`))
  const { loader, loaderVersion } = await activeLoaderInfo()
  const mod = findModdedProfile(dir, gameVersion, loader, loaderVersion)
  let mods = []
  try { mods = (await fsp.readdir(await modsDir())).filter(n => n.endsWith('.jar')) } catch (_) {}
  return {
    vanilla,
    loader,
    fabric: mod ? { installed: true, versionId: mod.id } : { installed: false },
    mods
  }
})

// Télécharge Minecraft vanilla (client.jar + libs + assets + natives).
// Progression poussée au renderer via l'événement 'vanilla-progress'.
ipcMain.handle('install-vanilla', async (evt, { gameVersion }) => {
  return await installVanilla(gameVersion, gameDir(), {}, (p) => {
    evt.sender.send('vanilla-progress', {
      phase: p.phase, done: p.done, total: p.total, label: p.label
    })
  })
})

// ---------- RÉSOLUTION D'ITEMS DE MODS (avec dépendances) ----------

// Résout un mod + ses dépendances requises (ex. cloth-config) en une liste
// d'items {fileName, downloadUrl, sha1}. Utilisé par le gestionnaire de mods.
async function resolveModuleItems(slug, gameVersion, loader = LOADER) {
  const items = []
  const missing = [] // dépendances REQUISES introuvables (à ne pas avaler en silence)
  const seen = new Set()
  const queue = [{ id: slug, required: true }]
  while (queue.length) {
    const { id, required } = queue.shift()
    let best = null
    try { best = await getBestVersion(id, gameVersion, loader) } catch (_) { best = null }
    if (!best) { if (required) missing.push(id); continue }
    if (seen.has(best.projectId)) continue
    seen.add(best.projectId)
    items.push(best)
    for (const dep of best.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id && !seen.has(dep.project_id)) {
        queue.push({ id: dep.project_id, required: true })
      }
    }
  }
  return { items, missing }
}

// Désactive un module : supprime ses jars NON partagés avec un autre module.
ipcMain.handle('remove-module', async (_evt, { id }) => {
  const cfg = await getConfig()
  const modules = cfg.modules || {}
  const entry = modules[id]
  if (entry) {
    const dir = await modsDir()
    const othersFiles = new Set(
      Object.entries(modules).filter(([k]) => k !== id).flatMap(([, m]) => m.files || [])
    )
    for (const f of entry.files || []) {
      if (!othersFiles.has(f)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
    delete modules[id]
    await setConfig({ modules })
  }
  return { id }
})

// ---------- PROFILS DE MODS ----------
ipcMain.handle('profiles-list', async () => profiles.list())

ipcMain.handle('create-profile', async (_e, { name, opts }) => profiles.create(gameDir(), name, opts || {}))
ipcMain.handle('switch-profile', async (_e, { id }) => profiles.switchTo(gameDir(), id))
ipcMain.handle('delete-profile', async (_e, { id }) => profiles.remove(gameDir(), id))

// Détail « instance » d'un profil : version, RAM (auto/manuel), mods avec logos.
// perfProfileId sert à calculer la RAM auto cohérente avec le lancement.
ipcMain.handle('profile-detail', async (_e, { id, perfProfileId }) => {
  const d = await profiles.detail(gameDir(), id)
  const hw = await getHardware()
  const perf = PROFILES[perfProfileId] || pickProfile(hw)
  const autoRamMB = computeRamMB(hw, perf)
  const effectiveRamMB = d.ram && d.ram.mode === 'manual' && d.ram.mb ? d.ram.mb : autoRamMB
  return { ...d, autoRamMB, effectiveRamMB, totalRamMB: Math.round(hw.totalRamGB * 1024) }
})
ipcMain.handle('set-profile-version', async (_e, { id, version }) => profiles.setVersion(gameDir(), id, version))
ipcMain.handle('set-profile-ram', async (_e, { id, mode, mb }) => profiles.setRam(gameDir(), id, mode, mb))

// Change le loader d'un profil (résout la dernière version pour Forge/NeoForge).
ipcMain.handle('set-profile-loader', async (_e, { id, loader }) => {
  if (!isValidLoader(loader)) throw new Error('Loader inconnu.')
  const cfg = await getConfig()
  const p = (cfg.profiles || {})[id] || {}
  const gv = p.gameVersion || '1.21.1'
  let loaderVersion = null
  try { loaderVersion = await latestLoaderVersion(loader, gv) }
  catch (e) { throw new Error(`${LOADER_LABEL[loader] || loader} : ${e.message}`) }
  return profiles.setLoader(gameDir(), id, loader, loaderVersion)
})

async function sha1File(p) {
  const buf = await fsp.readFile(p)
  return crypto.createHash('sha1').update(buf).digest('hex')
}

// Récupère les logos + vrais noms des mods d'un profil via Modrinth : on identifie
// chaque jar par son hash SHA1 (ou son projectId déjà connu), puis on lit icon_url.
// Marche pour un modpack importé (mods sans logo) SANS re-télécharger. -> {updated}
async function resolveProfileIcons(base, id, onProgress) {
  const cfg = await getConfig()
  const active = cfg.activeProfile === id
  const prof = (cfg.profiles || {})[id]
  if (!prof) return { updated: 0 }
  const mods = active ? (cfg.installedMods || {}) : (prof.installedMods || {})
  const dir = profiles.modsDirFor(base, id)

  // Ne traite que les entrées SANS logo.
  const pending = Object.entries(mods).filter(([, e]) => !e.icon)
  const hashToKeys = {}
  const pidByKey = {}
  let done = 0
  for (const [key, entry] of pending) {
    if (entry.projectId) { pidByKey[key] = entry.projectId }
    else {
      const file = (entry.files || [])[0]
      if (file) {
        try { const h = await sha1File(path.join(dir, file)); (hashToKeys[h] = hashToKeys[h] || []).push(key) } catch (_) {}
      }
    }
    if (onProgress && (++done % 15 === 0)) onProgress({ phase: 'hash', done, total: pending.length })
  }
  const hashes = Object.keys(hashToKeys)
  if (hashes.length) {
    const byHash = await getProjectsByHashes(hashes)
    for (const [h, pid] of Object.entries(byHash)) for (const key of (hashToKeys[h] || [])) pidByKey[key] = pid
  }
  const pids = [...new Set(Object.values(pidByKey))]
  if (!pids.length) return { updated: 0 }
  if (onProgress) onProgress({ phase: 'meta', done: 0, total: pids.length })
  const meta = await getProjectsMeta(pids)

  const updates = {}
  for (const [key, pid] of Object.entries(pidByKey)) {
    const md = meta[pid]
    if (md) updates[key] = { projectId: pid, icon: md.icon || '', title: md.title, slug: md.slug }
  }
  const n = Object.keys(updates).length
  if (!n) return { updated: 0 }
  await updateConfig(cur => {
    const profs = { ...(cur.profiles || {}) }
    const p = { ...(profs[id] || {}) }
    const archMods = { ...(p.installedMods || {}) }
    const liveMods = active ? { ...(cur.installedMods || {}) } : null
    const apply = (map) => {
      if (!map) return
      for (const [key, u] of Object.entries(updates)) {
        if (!map[key]) continue
        map[key] = { ...map[key], projectId: u.projectId, ...(u.icon ? { icon: u.icon } : {}), ...(u.title ? { title: u.title } : {}), ...(u.slug ? { slug: u.slug } : {}) }
      }
    }
    apply(archMods); apply(liveMods)
    p.installedMods = archMods
    profs[id] = p
    const next = { ...cur, profiles: profs }
    if (active) next.installedMods = liveMods
    return next
  })
  return { updated: n }
}

// Récupère les logos d'un profil à la demande (bouton « logos »).
ipcMain.handle('refresh-profile-icons', async (evt, { id }) => {
  return resolveProfileIcons(gameDir(), id,
    (p) => evt.sender.send('modpack-progress', { done: p.done || 0, total: p.total || 1, name: p.phase === 'meta' ? 'lecture des logos…' : 'analyse des mods…' }))
})

// Importe un modpack .mrpack : crée un profil du nom du pack et y installe ses mods.
ipcMain.handle('import-modpack', async (evt) => {
  const res = await dialog.showOpenDialog({
    title: 'Importer un modpack Modrinth (.mrpack)',
    filters: [{ name: 'Modpack Modrinth', extensions: ['mrpack'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths.length) return { canceled: true }

  const pack = parseModpack(res.filePaths[0])
  if (!isValidLoader(pack.loader)) {
    throw new Error('Ce modpack ne déclare aucun loader connu (Fabric / Quilt / Forge / NeoForge).')
  }

  const base = gameDir()
  const { id } = await profiles.create(base, pack.name, {
    gameVersion: pack.gameVersion || undefined,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion || undefined
  })
  const dir = profiles.modsDirFor(base, id)
  await fsp.mkdir(dir, { recursive: true })

  const installedMods = {}
  const failed = []           // mods qui n'ont pas pu être installés
  const seen = new Set()      // noms de jar déjà écrits (anti-collision de basename)
  const nice = (fn) => fn.replace(/\.jar$/i, '').replace(/[-_]/g, ' ')
  const modTotal = pack.files.length + pack.overrideMods.length
  const total = modTotal + pack.overrideFiles.length
  let done = 0
  const step = (name) => evt.sender.send('modpack-progress', { done, total, name })

  // 1) Mods depuis leur URL (hôte déjà validé par parseModpack).
  for (const f of pack.files) {
    step(f.fileName)
    if (!seen.has(f.fileName)) {
      seen.add(f.fileName)
      try {
        await downloadFile(f.url, path.join(dir, f.fileName), f.sha1)
        installedMods['mp:' + f.fileName] = { slug: null, title: nice(f.fileName), icon: '', version: '', files: [f.fileName] }
      } catch (_) { failed.push(f.fileName) }
    }
    done++
  }
  // 2) Mods embarqués dans le zip (overrides). Priorité au manifeste si collision.
  for (const o of pack.overrideMods) {
    step(o.fileName)
    if (!seen.has(o.fileName)) {
      seen.add(o.fileName)
      try {
        await fsp.writeFile(path.join(dir, o.fileName), o.entry.getData())
        installedMods['mp:' + o.fileName] = { slug: null, title: nice(o.fileName), icon: '', version: '', files: [o.fileName] }
      } catch (_) { failed.push(o.fileName) }
    }
    done++
  }
  // 3) Autres overrides (config, resourcepacks…) -> dossier overrides du profil,
  //    appliqués sur le jeu au lancement (syncToGame).
  const ovDir = profiles.overridesDirFor(base, id)
  const ovRoot = path.resolve(ovDir)
  for (const of of pack.overrideFiles) {
    step(of.relPath)
    try {
      const dest = path.resolve(ovDir, of.relPath)
      // Défense en profondeur anti zip-slip : la destination DOIT rester sous ovDir
      // (parseModpack filtre déjà les `..`, mais on revérifie ici avant d'écrire).
      if (dest !== ovRoot && !dest.startsWith(ovRoot + path.sep)) continue
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, of.entry.getData())
    } catch (_) {}
    done++
  }
  evt.sender.send('modpack-progress', { done: total, total, name: 'terminé' })

  // Enregistre les mods dans le profil (écriture ATOMIQUE, relit l'état frais).
  await updateConfig(cur => {
    const profs = cur.profiles || {}
    if (profs[id]) profs[id].installedMods = installedMods
    return { ...cur, profiles: profs }
  })

  // Récupère les logos + vrais noms via Modrinth (par hash SHA1), sans re-télécharger.
  evt.sender.send('modpack-progress', { done: total, total, name: 'récupération des logos…' })
  try { await resolveProfileIcons(base, id) } catch (_) {}

  return {
    id, name: pack.name, gameVersion: pack.gameVersion,
    loader: pack.loader, loaderVersion: pack.loaderVersion,
    count: Object.keys(installedMods).length, modTotal,
    failed, skipped: pack.skipped || []
  }
})

// ---------- GESTIONNAIRE DE MODS (recherche Modrinth) ----------

// Recherche de mods, en marquant ceux déjà installés.
ipcMain.handle('search-mods', async (_evt, { query, gameVersion }) => {
  const { loader } = await activeLoaderInfo()
  const hits = await searchMods(query, gameVersion, browserLoader(loader))
  const cfg = await getConfig()
  const installed = cfg.installedMods || {}
  return hits.map(h => ({ ...h, installed: !!installed[h.projectId] }))
})

// Installe un mod cherché (+ dépendances) et le mémorise (avec logo + version).
ipcMain.handle('install-searched-mod', async (_evt, { projectId, slug, title, iconUrl, gameVersion }) => {
  const { loader } = await activeLoaderInfo()
  const ml = browserLoader(loader)
  const dir = await modsDir()
  await fsp.mkdir(dir, { recursive: true })

  // Mod choisi + ses dépendances REQUISES (BFS, pour TOUS les mods, via Modrinth).
  const { items, missing } = await resolveModuleItems(slug, gameVersion, ml)
  if (!items.length) throw new Error(`Aucune version compatible ${gameVersion}/${LOADER_LABEL[loader] || loader}.`)
  if (missing.length) throw new Error(`Dépendance(s) requise(s) introuvable(s) pour ${gameVersion}/${LOADER_LABEL[loader] || loader} : ${missing.join(', ')}.`)

  // + mods COMPAGNONS curatés (paires non déclarées sur Modrinth, ex. ETF↔EMF).
  const all = [...items]
  for (const cslug of getCompanions(projectId, slug)) {
    try { const { items: ci } = await resolveModuleItems(cslug, gameVersion, ml); all.push(...ci) } catch (_) {}
  }
  // Dédup par projectId (une dépendance partagée n'est installée qu'une fois).
  const seen = new Set(), uniq = []
  for (const it of all) { if (it.projectId && !seen.has(it.projectId)) { seen.add(it.projectId); uniq.push(it) } }

  // Télécharge tout.
  for (const it of uniq) await downloadFile(it.downloadUrl, path.join(dir, it.fileName), it.sha1)

  // Logo + vrai nom Modrinth pour chaque mod lié (le principal garde ceux de la recherche).
  const metas = await getProjectsMeta(uniq.filter(it => it.projectId !== projectId).map(it => it.projectId))

  const added = uniq.filter(it => it.projectId !== projectId)
    .map(it => (metas[it.projectId] || {}).title || it.slug)
  // Mutation ATOMIQUE : on lit/écrit installedMods DANS updateConfig pour ne pas
  // écraser un ajout concurrent (ensureDeclaredDeps/reconcile au lancement) — un
  // setConfig depuis un snapshot périmé perdrait l'entrée (jar sur disque non suivi).
  await updateConfig(cur => {
    const installedMods = { ...(cur.installedMods || {}) }
    for (const it of uniq) {
      const isMain = it.projectId === projectId
      const m = metas[it.projectId] || {}
      // Chaque mod (principal + dépendances + compagnons) = une entrée VISIBLE à part.
      installedMods[it.projectId] = {
        slug: isMain ? slug : (m.slug || it.slug),
        title: isMain ? title : (m.title || it.slug),
        icon: isMain ? (iconUrl || '') : (m.icon || ''),
        version: it.versionNumber || '',
        files: [it.fileName]
      }
    }
    return { ...cur, installedMods }
  })
  return { projectId, added }
})

// Retire un mod du gestionnaire (jars non partagés).
ipcMain.handle('remove-searched-mod', async (_evt, { projectId }) => {
  const cfg = await getConfig()
  const entry = (cfg.installedMods || {})[projectId]
  if (entry) {
    const dir = await modsDir()
    // Retire l'entrée de façon ATOMIQUE (relit l'état frais dans le mutator).
    await updateConfig(cur => {
      const installedMods = { ...(cur.installedMods || {}) }
      delete installedMods[projectId]
      return { ...cur, installedMods }
    })
    // Supprime les jars devenus orphelins (non partagés), calculé sur l'état À JOUR.
    const after = await getConfig()
    const others = new Set(Object.values(after.installedMods || {}).flatMap(m => m.files || []))
    for (const f of entry.files || []) {
      if (!others.has(f)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
  }
  return { projectId }
})

// Installe le loader Fabric (profil de version + librairies) dans le dossier géré.
// Progression poussée au renderer via l'événement 'fabric-progress'.
ipcMain.handle('install-fabric', async (evt, { gameVersion }) => {
  return await installFabric(gameVersion, gameDir(), (p) => {
    evt.sender.send('fabric-progress', {
      done: p.done, total: p.total, name: p.name, phase: p.phase
    })
  })
})

// --- Comptes Minecraft (multi-comptes, persistants, avec sélecteur) ---

// Résout un compte (par id) en compte JOUABLE (avec accessToken frais).
// Hors-ligne : direct. Microsoft : rafraîchit via le refresh token stocké.
async function resolveAccount(id) {
  const pub = await accounts.getPublic(id)
  if (!pub) return null
  if (pub.offline) return auth.offlineAccount(pub.name)
  const rt = await accounts.getSecret(id)
  if (!rt) throw new Error('Session Microsoft absente — reconnecte ce compte.')
  let acc
  try {
    acc = await auth.refreshAccount(rt)
  } catch (e) {
    // Persiste le refresh token pivoté même si la chaîne a échoué APRÈS le refresh MS
    // (sinon on garde un RT périmé et on force une reconnexion pour rien).
    if (e && e.rotatedRefreshToken && e.rotatedRefreshToken !== rt) {
      await accounts.updateSecret(id, e.rotatedRefreshToken).catch(() => {})
    }
    throw e
  }
  await accounts.updateSecret(id, acc.refreshToken) // rotation du token
  return acc
}

// Vue "compte affichable" à partir des infos PUBLIQUES en cache (nom/uuid) : évite
// d'attendre le refresh du token pour afficher le compte connecté au démarrage.
function displayAccount(pub) { return pub ? { uuid: pub.uuid, name: pub.name, offline: !!pub.offline } : null }

// Journal de démarrage écrit depuis le renderer (étapes d'init côté UI).
ipcMain.handle('boot-log', (_e, msg) => bootLog('UI ' + msg))

// Vérification + installation AUTOMATIQUE des mises à jour (app packagée uniquement,
// via GitHub Releases). Appelé par le renderer AU DÉBUT du chargement (splash).
// Résout : 'dev' (pas packagé), 'none' (à jour -> continuer), 'updating' (une MAJ se
// télécharge et va s'installer -> le splash attend le redémarrage), 'error'/'timeout'.
ipcMain.handle('check-update', async (evt) => {
  if (!app.isPackaged) return { state: 'dev' }
  const wc = evt.sender
  return await new Promise((resolve) => {
    let done = false
    const finish = (r) => { if (!done) { done = true; resolve(r) } }
    const send = (s) => { try { wc.send('update-status', s) } catch (_) {} }
    try {
      const { autoUpdater } = require('electron-updater')
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.removeAllListeners()
      autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
      autoUpdater.on('update-not-available', () => { send({ state: 'none' }); finish({ state: 'none' }) })
      autoUpdater.on('update-available', (i) => { send({ state: 'available', version: i && i.version }); finish({ state: 'updating' }) })
      autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }))
      autoUpdater.on('update-downloaded', () => { send({ state: 'installing' }); setTimeout(() => { try { autoUpdater.quitAndInstall() } catch (_) {} }, 1200) })
      autoUpdater.on('error', (e) => { bootLog('updater: ' + (e && e.message)); send({ state: 'error' }); finish({ state: 'error' }) })
      autoUpdater.checkForUpdates().catch((e) => { bootLog('updater check: ' + (e && e.message)); finish({ state: 'error' }) })
      setTimeout(() => finish({ state: 'timeout' }), 12000) // ne bloque jamais le splash
    } catch (e) { bootLog('updater init: ' + (e && e.message)); finish({ state: 'error' }) }
  })
})

// Liste des comptes + lequel est sélectionné + le compte à AFFICHER (immédiat).
// Ne REJETTE JAMAIS : si getConfig est momentanément illisible, renvoie un état
// dégradé (le renderer réessaiera) plutôt que de casser l'affichage du compte.
ipcMain.handle('accounts-list', async () => {
  try {
    const { accounts: list, selected } = await accounts.list()
    const sel = list.find(a => a.id === selected) || null
    const out = { accounts: list, selected, current: currentAccount ? publicAccount(currentAccount) : displayAccount(sel) }
    bootLog(`accounts-list -> accounts=${list.length} current=${out.current ? out.current.name : 'null'}`)
    return out
  } catch (e) {
    bootLog('accounts-list DÉGRADÉ (config illisible): ' + (e && e.message))
    return { accounts: [], selected: null, current: null, degraded: true }
  }
})

// Ajoute un compte Microsoft (ouvre le navigateur) et le sélectionne.
ipcMain.handle('account-add-microsoft', async () => {
  const acc = await auth.login({ openUrl: (url) => shell.openExternal(url) })
  await accounts.add({ type: 'msa', name: acc.name, uuid: acc.uuid, refreshToken: acc.refreshToken })
  currentAccount = acc
  return publicAccount(acc)
})

// Ajoute un compte HORS-LIGNE (pseudo) et le sélectionne.
ipcMain.handle('account-add-offline', async (_evt, { username }) => {
  const acc = auth.offlineAccount(username)
  await accounts.add({ type: 'offline', name: acc.name, uuid: acc.uuid, offline: true })
  currentAccount = acc
  return publicAccount(acc)
})

// Choisit le compte avec lequel on lance Minecraft (affichage immédiat ; le token
// de jeu sera résolu au lancement).
ipcMain.handle('account-select', async (_evt, { id }) => {
  await accounts.select(id)
  currentAccount = null // le token sera (ré)résolu au prochain lancement
  return displayAccount(await accounts.getPublic(id))
})

// Retire un compte. Si c'était l'actif, bascule sur un autre (ou aucun).
ipcMain.handle('account-remove', async (_evt, { id }) => {
  const before = (await accounts.list()).selected
  const { selected } = await accounts.remove(id)
  if (id === before) {
    currentAccount = null
    if (selected) { try { currentAccount = await resolveAccount(selected) } catch (_) {} }
  }
  return { selected, current: publicAccount(currentAccount) }
})

// --- Optimisation système : GPU dédié (opt-in, réversible) ---
ipcMain.handle('gpu-pref-get', async () => {
  const java = await getJava()
  if (!java) return { supported: false }
  return { supported: process.platform === 'win32', enabled: await getGpuPreference(java.path) }
})
ipcMain.handle('gpu-pref-set', async (_evt, { enabled }) => {
  const java = await getJava()
  if (!java) throw new Error('Java introuvable — impossible de cibler l\'exécutable.')
  const r = enabled ? await setGpuPreference(java.path) : await clearGpuPreference(java.path)
  if (!r.ok) throw new Error(r.error || r.reason || 'Échec de l\'écriture de la préférence GPU.')
  return { enabled }
})

// Alias id de mod -> slug Modrinth quand ils diffèrent (résolution des dépendances).
const DEP_ALIAS = {
  'cloth-config2': 'cloth-config', architectury: 'architectury-api',
  forgeconfigapiport: 'forge-config-api-port', roughlyenoughitems: 'rei',
  'fabric-language-kotlin': 'fabric-language-kotlin'
}

// Garantit les dépendances DÉCLARÉES par les jars présents (lues dans
// fabric.mod.json / quilt.mod.json). Le launcher « se souvient » ainsi de ce dont
// chaque mod a besoin : il installe ce qui manque (ex. Cloth Config) et le suit
// dans le profil actif. Boucle bornée (une dépendance peut en avoir d'autres).
async function ensureDeclaredDeps(gameVersion, loader, onProgress) {
  const md = await modsDir()
  const bl = browserLoader(loader)
  const added = [] // { pid, fileName, version, slug }
  for (let pass = 0; pass < 5; pass++) {
    const missing = scanMissingDeps(md)
    if (!missing.length) break
    let progressed = false
    for (const id of missing) {
      const slug = DEP_ALIAS[id] || id
      let dep = null
      try { dep = await getBestVersion(slug, gameVersion, bl) } catch (_) {}
      if (!dep) continue // introuvable sur Modrinth sous cet id : on ne peut rien faire
      try {
        await downloadFile(dep.downloadUrl, path.join(md, dep.fileName), dep.sha1)
        added.push({ pid: dep.projectId, fileName: dep.fileName, version: dep.versionNumber, slug })
        progressed = true
        if (onProgress) onProgress({ name: dep.fileName })
      } catch (_) {}
    }
    if (!progressed) break // rien de nouveau résolu : on arrête (évite la boucle infinie)
  }
  // Mémorise les dépendances ajoutées dans le profil actif (visibles + protégées).
  if (added.length) {
    const metas = await getProjectsMeta(added.map(a => a.pid))
    await updateConfig(cur => {
      const im = { ...(cur.installedMods || {}) }
      for (const a of added) {
        if (im[a.pid]) continue
        const m = metas[a.pid] || {}
        im[a.pid] = { slug: m.slug || a.slug, title: m.title || a.slug, icon: m.icon || '', version: a.version || '', files: [a.fileName], autoDep: true }
      }
      const profs = { ...(cur.profiles || {}) }
      const aid = cur.activeProfile
      if (aid && profs[aid]) profs[aid] = { ...profs[aid], installedMods: im }
      return { ...cur, installedMods: im, profiles: profs }
    })
  }
  return added.map(a => a.slug)
}

// Répare les CONFLITS de versions entre mods (pour TOUS les mods) : lit les
// contraintes déclarées dans les jars, détecte les incompatibilités (ex. Iris
// exige un vieux Sodium), puis met à jour les mods concernés vers une version
// compatible (beta autorisée). Identification par HASH -> projet Modrinth, donc
// marche quel que soit l'id du mod. Boucle bornée. Renvoie { fixed, remaining }.
async function repairVersionConflicts(gameVersion, loader, onProgress) {
  if (!FABRIC_LIKE.has(loader)) return { fixed: [], remaining: [] }
  const md = await modsDir()
  const bl = browserLoader(loader)
  const fixed = []
  for (let pass = 0; pass < 4; pass++) {
    const { conflicts, involved } = findConflicts(md)
    if (!conflicts.length) break
    let progressed = false
    for (const jarFile of involved) {
      const jarPath = path.join(md, jarFile)
      if (!fs.existsSync(jarPath)) continue
      let pid = null
      try { const h = await sha1File(jarPath); pid = (await getProjectsByHashes([h]))[h] } catch (_) {}
      if (!pid) continue // pas identifiable sur Modrinth -> on ne peut pas le corriger
      let latest = null
      try { latest = await getBestVersion(pid, gameVersion, bl, { allowBeta: true }) } catch (_) {}
      if (!latest || latest.fileName === jarFile) continue // déjà à jour / introuvable
      try {
        await downloadFile(latest.downloadUrl, path.join(md, latest.fileName), latest.sha1)
        await fsp.rm(jarPath, { force: true }).catch(() => {})
        fixed.push({ pid, from: jarFile, to: latest.fileName, version: latest.versionNumber })
        progressed = true
        if (onProgress) onProgress({ name: latest.fileName })
      } catch (_) {}
    }
    if (!progressed) break // rien de neuf à mettre à jour -> conflit non réparable auto
  }
  // Met à jour le suivi (fichier + version) des mods réparés.
  if (fixed.length) {
    await updateConfig(cur => {
      const im = { ...(cur.installedMods || {}) }
      for (const f of fixed) if (im[f.pid]) im[f.pid] = { ...im[f.pid], version: f.version, files: [f.to] }
      const profs = { ...(cur.profiles || {}) }, aid = cur.activeProfile
      if (aid && profs[aid]) profs[aid] = { ...profs[aid], installedMods: im }
      return { ...cur, installedMods: im, profiles: profs }
    })
  }
  return { fixed, remaining: findConflicts(md).conflicts }
}

// --- Lancement du jeu ---
ipcMain.handle('launch-game', async (evt, { gameVersion, profileId }) => {
  // Résout le compte (token de jeu) JUSTE À TEMPS : refresh Microsoft depuis le
  // token stocké, ou compte hors-ligne direct. Startup reste instantané.
  if (!currentAccount) {
    const { selected } = await accounts.list()
    if (!selected) throw new Error('Ajoute un compte Minecraft avant de jouer.')
    evt.sender.send('prepare-progress', { step: 'Compte', done: 0, total: 1 })
    try { currentAccount = await resolveAccount(selected) }
    catch (e) { throw new Error('Connexion au compte impossible : ' + (e.message || e)) }
  }
  const dir = gameDir()

  // Loader du profil ACTIF (Fabric / Quilt / Forge / NeoForge).
  const acfg = await getConfig()
  const aprof = (acfg.profiles || {})[acfg.activeProfile] || {}
  const loader = aprof.loader || 'fabric'
  const loaderVersion = aprof.loaderVersion || null

  // Auto-préparation : Minecraft vanilla installé si absent.
  const verDir = path.join(dir, 'versions', gameVersion)
  const vanillaOk = fs.existsSync(path.join(verDir, `${gameVersion}.jar`)) &&
                    fs.existsSync(path.join(verDir, `${gameVersion}.json`))
  if (!vanillaOk) {
    evt.sender.send('prepare-progress', { step: 'Minecraft', done: 0, total: 1 })
    await installVanilla(gameVersion, dir, {}, (p) =>
      evt.sender.send('prepare-progress', { step: 'Minecraft', phase: p.phase, done: p.done, total: p.total }))
  }
  // Auto-préparation du LOADER (installe si le profil de version EXACTE n'existe pas encore).
  if (!findModdedProfile(dir, gameVersion, loader, loaderVersion)) {
    const label = LOADER_LABEL[loader] || loader
    evt.sender.send('prepare-progress', { step: label, done: 0, total: 1 })
    const java = await getJava()
    await installLoader(loader, gameVersion, dir, {
      loaderVersion, javaPath: java && java.path,
      onProgress: (p) => evt.sender.send('prepare-progress', { step: label, phase: p.phase, name: p.name, done: p.done || 0, total: p.total || 1 })
    })
  }
  // Garantit Fabric API pour les profils Fabric/Quilt : quasi TOUS les mods en ont
  // besoin, même quand ils ne le déclarent pas (ex. ETF) ou ne le tirent pas (notre
  // PipouMod). Sans lui, le jeu planterait au démarrage. On l'ajoute au profil actif
  // s'il manque (Quilt charge aussi Fabric API).
  if (FABRIC_LIKE.has(loader)) {
    const md = await modsDir()
    const present = (await fsp.readdir(md).catch(() => []))
      .some(f => /fabric[-_]?api|qsl|quilted[-_.]?fabric[-_.]?api|qfapi/i.test(f))
    if (!present) {
      try {
        evt.sender.send('prepare-progress', { step: 'Fabric API', done: 0, total: 1 })
        const fa = await getBestVersion('fabric-api', gameVersion, browserLoader(loader))
        if (fa) await downloadFile(fa.downloadUrl, path.join(md, fa.fileName), fa.sha1)
      } catch (_) { /* réseau indispo : on tente quand même le lancement */ }
    }
    // Mods d'OPTIMISATION automatiques : on installe ceux qui MANQUENT (Sodium, Lithium…)
    // adaptés à ce PC, sans rien supprimer (downloadMods saute ceux déjà présents).
    // Remplace l'ancien bouton manuel « Installer les mods ».
    try {
      evt.sender.send('prepare-progress', { step: "Mods d'optimisation", done: 0, total: 1 })
      const phw = await getHardware()
      const pprof = PROFILES[profileId] || pickProfile(phw)
      const perf = await resolvePerfMods(gameVersion, LOADER, {
        gpuVendor: gpuVendorFromModel(phw.gpuModel),
        coreOnly: !!pprof.coreOnly
      })
      await downloadMods(perf.resolved, md, (p) => evt.sender.send('prepare-progress', {
        step: "Mods d'optimisation", name: p.mod ? p.mod.label : '', done: p.done, total: p.total
      }))
    } catch (e) { evt.sender.send('game-log', `[launcher] mods d'optimisation : ${e.message}\n`) }
    // Lit les dépendances DÉCLARÉES par chaque jar et installe ce qui manque
    // (ex. Cloth Config exigé par un mod). Sans réseau, on tente quand même.
    try {
      evt.sender.send('prepare-progress', { step: 'Dépendances', done: 0, total: 1 })
      await ensureDeclaredDeps(gameVersion, loader,
        (p) => evt.sender.send('prepare-progress', { step: 'Dépendances', name: p.name, done: 0, total: 1 }))
    } catch (_) {}
    // Détecte + répare les CONFLITS de versions entre mods (ex. Iris/Sodium).
    try {
      evt.sender.send('prepare-progress', { step: 'Compatibilité', done: 0, total: 1 })
      const rep = await repairVersionConflicts(gameVersion, loader,
        (p) => evt.sender.send('prepare-progress', { step: 'Compatibilité', name: p.name, done: 0, total: 1 }))
      if (rep.fixed.length) evt.sender.send('game-log', `[launcher] ${rep.fixed.length} mod(s) mis à jour pour compatibilité.\n`)
      if (rep.remaining.length) evt.sender.send('game-log', `[launcher] ⚠ Conflit(s) non réparable(s) : ${rep.remaining.join(' ; ')}\n`)
    } catch (_) {}
  }
  // PipouMod (mod maison) : TOUJOURS actif — on déploie le jar COMPILÉ POUR LA VERSION
  // du profil (assets/pipoumod-versions/pipoumod-<version>.jar). Fabric/Quilt en direct,
  // NeoForge via Sinytra Connector. Aucun jar pour cette version -> PipouMod retiré.
  try {
    const md = await modsDir()
    const verJar = path.join(app.getAppPath(), 'assets', 'pipoumod-versions', `pipoumod-${gameVersion}.jar`)
    const legacy = path.join(app.getAppPath(), 'assets', 'pipoumod.jar') // repli (1.21.1)
    const src = fs.existsSync(verJar) ? verJar
      : (gameVersion === '1.21.1' && fs.existsSync(legacy) ? legacy : null)
    const dst = path.join(md, 'pipoumod.jar')
    const fabricLike = FABRIC_LIKE.has(loader)
    const neoforge = loader === 'neoforge'
    if (src && (fabricLike || neoforge)) {
      await fsp.copyFile(src, dst)
      if (neoforge) {
        evt.sender.send('prepare-progress', { step: 'PipouMod (Connector)', done: 0, total: 1 })
        await ensureConnector(md, gameVersion, evt)
      }
    } else if (fs.existsSync(dst)) {
      await fsp.unlink(dst).catch(() => {})
    }
  } catch (_) {}
  // Recopie les mods du profil ACTIF dans <gameDir>/mods (vrai dossier que le jeu lit).
  evt.sender.send('prepare-progress', { step: 'Mods', done: 0, total: 1 })
  await profiles.syncToGame(dir)
  evt.sender.send('prepare-progress', { step: 'done' })

  const hw = await getHardware()
  const profile = PROFILES[profileId] || pickProfile(hw)
  let ramMB = computeRamMB(hw, profile)
  // Override RAM du profil de mods ACTIF (« rajouter de la RAM si besoin »).
  if (aprof.ram && aprof.ram.mode === 'manual' && aprof.ram.mb) ramMB = aprof.ram.mb
  const totalRamMB = Math.round(hw.totalRamGB * 1024)
  return await launch(
    { mcVersion: gameVersion, gameDir: dir, account: currentAccount, perfProfile: profile, hw, totalRamMB, ramMB, loader, loaderVersion },
    (line) => evt.sender.send('game-log', line),
    (code) => evt.sender.send('game-exit', code)
  )
})

// Une SEULE instance du launcher : si on rouvre (raccourci) alors qu'il tourne déjà,
// on remet la fenêtre existante au premier plan au lieu d'ouvrir une 2e fenêtre
// périmée (source de confusion « compte pas connecté »).
// IMPORTANT : l'instance SECONDAIRE ne doit RIEN faire d'autre que quitter — sinon
// elle démarre (createWindow, lecture/écriture config) en parallèle de la primaire et
// crée exactement la course fichier qui "perd" le compte. D'où le garde `isPrimary`.
const isPrimary = app.requestSingleInstanceLock()
if (!isPrimary) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
}

app.whenReady().then(async () => {
  if (!isPrimary) { bootLog('instance SECONDAIRE -> quit sans démarrer'); return }

  // Réinitialise le journal de ce démarrage.
  try { fs.writeFileSync(bootLogPath(), '') } catch (_) {}
  bootLog(`whenReady userData=${app.getPath('userData')} name=${app.getName()} isPrimary=${isPrimary}`)

  // AMORÇAGE ROBUSTE DU CACHE CONFIG avant d'ouvrir la fenêtre. CAUSE RACINE du bug
  // "compte pas affiché au démarrage depuis le raccourci" (confirmée par l'audit) :
  // au démarrage à FROID, config.json peut être momentanément verrouillé (antivirus
  // scannant electron.exe fraîchement lancé, OneDrive/Roaming en hydratation). L'ancien
  // warm-up avalait l'échec SANS réessayer -> le cache mémoire restait vide -> accounts-list
  // échouait -> compte null. Ici on RÉESSAIE (borné) jusqu'à amorcer le cache, pour que
  // accounts-list soit ensuite servi depuis la RAM, insensible au verrou disque.
  let cfg = null
  for (let i = 0; i < 8 && !cfg; i++) {
    try { cfg = await getConfig() }
    catch (e) {
      bootLog(`warm-up getConfig échec ${i + 1}/8: ${e && e.message}`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (cfg) {
    if (cfg.msaClientId) auth.setClientId(cfg.msaClientId)
    const accs = (cfg.accounts || []).map((a) => a.name)
    bootLog(`config amorcée: accounts=[${accs.join(',')}] selected=${cfg.selectedAccount || 'null'} activeProfile=${cfg.activeProfile || 'null'}`)
  } else {
    bootLog('config NON amorcée après 8 essais (disque verrouillé longtemps) — ouverture quand même')
  }

  // Met en place les profils (dossier réel par profil + minecraft/mods réel) avant tout.
  try { await profiles.ensureInitialized(gameDir()) } catch (e) { console.error('profiles init:', e.message) }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
