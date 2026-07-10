// Processus principal Electron.
// Il crée la fenêtre et expose au renderer, via IPC, les fonctions "métier"
// (détection matériel/Java, calcul du profil, args JVM, résolution des mods).

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = require('fs/promises')

const { detectHardware, pickProfile, computeRamMB, PROFILES } = require('./hardware')
const { buildJvmPlan } = require('./jvm')
const { resolvePerfMods, gpuVendorFromModel, getBestVersion, searchMods, getProjectsMeta, getProjectsByHashes } = require('./modrinth')
const crypto = require('crypto')
const { optionsForProfile } = require('./settings')
const { downloadMods, reconcileMods, downloadFile, fetchJson } = require('./downloader')
const { MODULES, getModule } = require('./modules')
const { installFabric } = require('./fabric')
const { installVanilla } = require('./mojang')
const { parseModpack } = require('./modpack')
const { detectJava } = require('./java')
const { launch, findModdedProfile } = require('./launch')
const { installLoader, LOADER_LABEL, LOADERS, FABRIC_LIKE, isValidLoader, latestLoaderVersion } = require('./loaders')
const { setGpuPreference, clearGpuPreference, getGpuPreference } = require('./system')
const { getConfig, setConfig, updateConfig } = require('./config')
const profiles = require('./profiles')
const auth = require('./auth')

// Compte connecté (garde le token de jeu EN MAIN, jamais exposé au renderer).
let currentAccount = null
function publicAccount(a) { return a ? { uuid: a.uuid, name: a.name, offline: !!a.offline } : null }

// Dossier de jeu GÉRÉ par le launcher (on ne touche pas au .minecraft vanilla).
function gameDir() { return path.join(app.getPath('userData'), 'minecraft') }
// Dossier où l'on INSTALLE/LIT les mods = dossier RÉEL du profil actif.
// (Le jeu lit gameDir/mods, alimenté par profiles.syncToGame au lancement.)
function modsDir() { return profiles.activeModsDir(gameDir()) }

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

// Va chercher les mods de perf compatibles avec la version de MC choisie.
// On filtre selon le GPU (ex. Nvidium NVIDIA-only) et le profil (coreOnly).
ipcMain.handle('resolve-mods', async (_evt, { gameVersion, profileId }) => {
  const hw = await getHardware()
  const profile = PROFILES[profileId] || pickProfile(hw)
  return await resolvePerfMods(gameVersion, LOADER, {
    gpuVendor: gpuVendorFromModel(hw.gpuModel),
    coreOnly: !!profile.coreOnly
  })
})

// Résout PUIS télécharge les mods dans le dossier géré, avec vérif SHA1.
// La progression est poussée au renderer via l'événement 'download-progress'.
ipcMain.handle('install-mods', async (evt, { gameVersion, profileId }) => {
  const { loader } = await activeLoaderInfo()
  if (!FABRIC_LIKE.has(loader)) throw new Error(`Les mods d'optimisation du catalogue sont Fabric/Quilt uniquement (profil actif : ${LOADER_LABEL[loader] || loader}).`)
  const hw = await getHardware()
  const profile = PROFILES[profileId] || pickProfile(hw)
  const resolution = await resolvePerfMods(gameVersion, LOADER, {
    gpuVendor: gpuVendorFromModel(hw.gpuModel),
    coreOnly: !!profile.coreOnly
  })

  const dir = await modsDir()
  const results = await downloadMods(resolution.resolved, dir, (p) => {
    evt.sender.send('download-progress', {
      done: p.done,
      total: p.total,
      label: p.mod.label,
      phase: p.phase,
      status: p.result ? p.result.status : null
    })
  })

  // Nettoie les .jar obsolètes (anciens mods de perf), SANS toucher aux modules.
  const wanted = [...resolution.resolved.map(m => m.fileName), ...(await moduleFilenames())]
  const { removed } = await reconcileMods(dir, wanted)

  return { dir, results, removed, unavailable: resolution.unavailable, errored: resolution.errored }
})

// Liste de TOUTES les versions Minecraft release (depuis le manifest Mojang).
let versionsCache = null
ipcMain.handle('list-versions', async () => {
  if (!versionsCache) {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    versionsCache = (manifest.versions || []).filter(v => v.type === 'release').map(v => v.id)
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

// ---------- MODULES (fonctions type Feather) ----------

// Résout un module + ses dépendances requises (ex. cloth-config) en une liste
// d'items {fileName, downloadUrl, sha1}.
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

// Liste du catalogue + modules déjà activés.
ipcMain.handle('modules-list', async () => {
  const cfg = await getConfig()
  return { modules: MODULES, installed: Object.keys(cfg.modules || {}) }
})

// Active un module : télécharge son mod (+ dépendances) OU copie le jar maison,
// puis le mémorise.
ipcMain.handle('install-module', async (_evt, { id, gameVersion }) => {
  const mod = getModule(id)
  if (!mod) throw new Error('Module inconnu.')
  const { loader } = await activeLoaderInfo()
  if (!FABRIC_LIKE.has(loader)) throw new Error(`Les modules sont Fabric/Quilt uniquement (profil actif : ${LOADER_LABEL[loader] || loader}).`)

  const dir = await modsDir()
  await fsp.mkdir(dir, { recursive: true })
  let files

  if (mod.local) {
    // Mod maison (PipouMod) : copie le jar embarqué dans l'app.
    const src = path.join(app.getAppPath(), 'assets', mod.jar)
    await fsp.copyFile(src, path.join(dir, mod.jar))
    files = [mod.jar]
  } else {
    const { items, missing } = await resolveModuleItems(mod.slug, gameVersion)
    if (!items.length) throw new Error(`${mod.label} : aucune version compatible ${gameVersion}/Fabric.`)
    if (missing.length) throw new Error(`${mod.label} : dépendance(s) requise(s) introuvable(s) pour ${gameVersion}/Fabric : ${missing.join(', ')}.`)
    for (const it of items) {
      await downloadFile(it.downloadUrl, path.join(dir, it.fileName), it.sha1)
    }
    files = items.map(it => it.fileName)
  }

  const cfg = await getConfig()
  const modules = cfg.modules || {}
  modules[id] = { slug: mod.slug || null, files }
  await setConfig({ modules })
  return { id, files }
})

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

// Fichiers de tous les modules + mods du gestionnaire (à préserver au nettoyage).
async function moduleFilenames() {
  const cfg = await getConfig()
  return [
    ...Object.values(cfg.modules || {}).flatMap(m => m.files || []),
    ...Object.values(cfg.installedMods || {}).flatMap(m => m.files || [])
  ]
}

// ---------- PROFILS DE MODS ----------
ipcMain.handle('profiles-list', async () => profiles.list())

// Mods du profil ACTIF (pour affichage dans l'onglet Mods).
ipcMain.handle('active-profile-mods', async () => {
  const cfg = await getConfig()
  const labels = Object.fromEntries(MODULES.map(m => [m.id, m.label]))
  const mods = Object.entries(cfg.installedMods || {}).map(([projectId, m]) =>
    ({ type: 'mod', id: projectId, name: m.title || m.slug }))
  const mods2 = Object.keys(cfg.modules || {}).map(id =>
    ({ type: 'module', id, name: labels[id] || id }))
  return [...mods, ...mods2]
})
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
ipcMain.handle('loaders-list', async () => ({ loaders: LOADERS, labels: LOADER_LABEL }))

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
  for (const of of pack.overrideFiles) {
    step(of.relPath)
    try {
      const dest = path.join(ovDir, of.relPath)
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
  const { items, missing } = await resolveModuleItems(slug, gameVersion, ml)
  if (!items.length) throw new Error(`Aucune version compatible ${gameVersion}/${LOADER_LABEL[loader] || loader}.`)
  if (missing.length) throw new Error(`Dépendance(s) requise(s) introuvable(s) pour ${gameVersion}/${LOADER_LABEL[loader] || loader} : ${missing.join(', ')}.`)
  const dir = await modsDir()
  await fsp.mkdir(dir, { recursive: true })
  for (const it of items) await downloadFile(it.downloadUrl, path.join(dir, it.fileName), it.sha1)

  const cfg = await getConfig()
  const installedMods = cfg.installedMods || {}
  installedMods[projectId] = {
    slug, title,
    icon: iconUrl || '',
    version: (items[0] && items[0].versionNumber) || '',
    files: items.map(it => it.fileName)
  }
  await setConfig({ installedMods })
  return { projectId, files: installedMods[projectId].files }
})

// Retire un mod du gestionnaire (jars non partagés).
ipcMain.handle('remove-searched-mod', async (_evt, { projectId }) => {
  const cfg = await getConfig()
  const installedMods = cfg.installedMods || {}
  const entry = installedMods[projectId]
  if (entry) {
    const dir = await modsDir()
    const others = new Set(
      Object.entries(installedMods).filter(([k]) => k !== projectId).flatMap(([, m]) => m.files || [])
    )
    for (const f of entry.files || []) {
      if (!others.has(f)) await fsp.rm(path.join(dir, f), { force: true }).catch(() => {})
    }
    delete installedMods[projectId]
    await setConfig({ installedMods })
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

// --- Configuration : ID d'application Azure (client_id) ---
ipcMain.handle('get-client-id', async () => {
  const cfg = await getConfig()
  return {
    clientId: cfg.msaClientId || '',
    fromEnv: !!process.env.MSA_CLIENT_ID,
    ready: auth.hasClientId()
  }
})
ipcMain.handle('set-client-id', async (_evt, { clientId }) => {
  await setConfig({ msaClientId: clientId || '' })
  auth.setClientId(clientId)
  return { ready: auth.hasClientId() }
})

// --- Authentification Microsoft ---

// Connexion interactive : ouvre le navigateur sur la page Microsoft et affiche
// le code. Le token de jeu reste en main ; on ne renvoie que {uuid, name}.
ipcMain.handle('auth-login', async () => {
  currentAccount = await auth.login({ openUrl: (url) => shell.openExternal(url) })
  return publicAccount(currentAccount)
})

// Connexion HORS-LIGNE (pseudo seul, sans Microsoft).
ipcMain.handle('auth-offline', async (_evt, { username }) => {
  currentAccount = auth.offlineAccount(username)
  return publicAccount(currentAccount)
})

// Annule une connexion en cours (navigateur fermé, re-clic…).
ipcMain.handle('auth-cancel', async () => { auth.cancelLogin(); return true })

// Reconnexion silencieuse au démarrage (via le refresh token stocké).
ipcMain.handle('auth-silent', async () => {
  try {
    currentAccount = await auth.silentLogin()
  } catch (_) {
    currentAccount = null // refresh expiré : l'utilisateur devra se reconnecter
  }
  return publicAccount(currentAccount)
})

// Déconnexion : efface le compte stocké.
ipcMain.handle('auth-logout', async () => {
  await auth.clearAccount()
  currentAccount = null
  return true
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

// --- Lancement du jeu ---
ipcMain.handle('launch-game', async (evt, { gameVersion, profileId }) => {
  if (!currentAccount) throw new Error('Connecte-toi avec Microsoft avant de jouer.')
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

// Ouvre le dossier des mods dans l'explorateur (le crée au besoin).
ipcMain.handle('open-mods-dir', async () => {
  const dir = await modsDir()
  await fsp.mkdir(dir, { recursive: true })
  shell.openPath(dir)
  return dir
})

app.whenReady().then(async () => {
  // Charge l'ID d'application Azure stocké (s'il existe) avant toute auth.
  try {
    const cfg = await getConfig()
    if (cfg.msaClientId) auth.setClientId(cfg.msaClientId)
  } catch (_) { /* pas de config : on garde l'éventuelle variable d'env */ }

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
