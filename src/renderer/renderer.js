// Logique de l'UI. Aucune dépendance : on parle au backend via window.launcher
// (exposé par le preload). On garde un petit état local `state`.

const state = {
  hw: null,
  profile: null,
  ramMB: null,
  jvmArgs: [],
  gcLabel: '',
  java: null,
  gameOptions: {},
  gpuVendor: 'unknown',
  profiles: [],
  account: null,
  install: { vanilla: false, fabric: { installed: false }, mods: new Set() },
  moduleCatalog: [],
  moduleInstalled: new Set(),
  versions: [],
  activeLoader: 'fabric'
}

const LOADER_LABELS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }
const isFabricLike = (l) => l === 'fabric' || l === 'quilt'

// Reflète le loader actif dans l'UI : tag de la launchbar + gating des catalogues
// Fabric/Quilt (mods d'optimisation + Modules) quand le profil est Forge/NeoForge.
function applyLoaderUi(loader) {
  state.activeLoader = loader || 'fabric'
  const tag = $('loaderTag'); if (tag) tag.textContent = LOADER_LABELS[state.activeLoader] || state.activeLoader
  const fabricLike = isFabricLike(state.activeLoader)
  ;['resolveBtn', 'installBtn'].forEach(id => { const b = $(id); if (b) b.disabled = !fabricLike })
  const note = $('optimLoaderNote')
  if (note) {
    note.hidden = fabricLike
    note.textContent = `Catalogue Fabric/Quilt uniquement — profil actif : ${LOADER_LABELS[state.activeLoader]}. Les mods de ce pack viennent du modpack lui-même.`
  }
  if (state.moduleCatalog.length) renderModuleCards()
}
let moduleFilter = 'all'

// Traduction lisible des réglages générés pour options.txt.
const OPTION_LABELS = {
  renderDistance: 'Distance de rendu',
  simulationDistance: 'Distance de simulation',
  maxFps: 'FPS max',
  graphicsMode: 'Graphismes (0=fast)',
  particles: 'Particules (2=min)',
  entityDistanceScaling: 'Distance des entités',
  enableVsync: 'VSync',
  entityShadows: 'Ombres des entités',
  renderClouds: 'Nuages',
  ao: 'Occlusion ambiante',
  biomeBlendRadius: 'Fondu des biomes',
  mipmapLevels: 'Mipmaps'
}

const $ = (id) => document.getElementById(id)

function setStatus(msg) { $('status').textContent = msg }

// Échappe une valeur avant injection dans innerHTML (anti-XSS : les libellés de
// mods, noms de GPU, messages d'erreur viennent du réseau/API tierce).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Remplace une icône <img> qui échoue (hors-ligne, 404 CDN, CSP) par un emoji.
// L'attribut onerror inline est bloqué par la CSP -> on l'attache en JS.
function attachIconFallback(container, selector, cls, glyph) {
  container.querySelectorAll(selector).forEach(img => {
    const swap = () => {
      const d = document.createElement('div')
      d.className = cls; d.textContent = glyph
      img.replaceWith(d)
    }
    img.addEventListener('error', swap)
    if (img.complete && img.naturalWidth === 0) swap() // échec déjà survenu
  })
}

// --- Rendu du matériel détecté ---
function renderHardware(hw) {
  const rows = [
    ['Processeur', hw.cpuBrand],
    ['Threads CPU', String(hw.cpuThreads)],
    ['Carte graphique', hw.gpuModel],
    ['VRAM', hw.gpuVramMB ? `${hw.gpuVramMB} Mo` : '—'],
    ['RAM totale', `${hw.totalRamGB} Go`],
    ['Java détecté', state.java ? `Java ${state.java.major} (${state.java.version})` : '⚠ aucun Java 21']
  ]
  $('hwRows').innerHTML = rows.map(([k, v]) =>
    `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`
  ).join('')
}

// --- Rendu des boutons de profil ---
function renderProfiles() {
  $('profiles').innerHTML = state.profiles.map(p =>
    `<div class="profile ${p.id === state.profile.id ? 'active' : ''}" data-id="${esc(p.id)}">
       ${esc(p.name)}
     </div>`
  ).join('')

  document.querySelectorAll('.profile').forEach(el => {
    el.addEventListener('click', () => selectProfile(el.dataset.id))
  })
}

// --- Rendu du profil courant (description, RAM, args JVM, réglages jeu) ---
function renderCurrent() {
  $('profileDesc').textContent = state.profile.description
  $('ramValue').textContent = `${(state.ramMB / 1024).toFixed(1)} Go (${state.ramMB} Mo)`
  $('jvmArgs').textContent = state.jvmArgs.join('\n')
  // Méta JVM : GC choisi + Java.
  $('gcLabel').textContent = state.gcLabel || '—'
  $('javaInfo').textContent = state.java
    ? `Java ${state.java.major}`
    : 'Java 21 introuvable'
  // Résumé dans la barre de lancement.
  $('footProfile').textContent = state.profile.name
  $('footRam').textContent = `${(state.ramMB / 1024).toFixed(1)} Go`
  renderGameOptions()
}

// --- Détection de l'état d'installation (déjà fait / à faire) ---
async function refreshInstallStatus() {
  const gv = $('gameVersion').value
  try {
    const st = await window.launcher.getInstallStatus(gv)
    state.install = {
      vanilla: st.vanilla,
      fabric: st.fabric || { installed: false },
      mods: new Set(st.mods || [])
    }
  } catch (_) {
    state.install = { vanilla: false, fabric: { installed: false }, mods: new Set() }
  }
  renderInstallStatus()
}

function renderInstallStatus() {
  const st = state.install
  const gv = $('gameVersion').value

  // Étape 1 · Minecraft
  if (st.vanilla) {
    $('vanillaBtn').textContent = '↻ Réinstaller'
    $('vanillaDl').hidden = false
    $('vanillaFill').style.width = '100%'
    $('vanillaText').innerHTML = `<span class="ok-tag">✓ Minecraft ${esc(gv)} déjà installé</span> — rien à faire.`
  } else {
    $('vanillaBtn').textContent = '⬇ Installer Minecraft'
    $('vanillaDl').hidden = true
  }

  // Étape 2 · Fabric
  if (st.fabric && st.fabric.installed) {
    $('fabricBtn').textContent = '↻ Réinstaller'
    $('fabricDl').hidden = false
    $('fabricFill').style.width = '100%'
    $('fabricText').innerHTML = `<span class="ok-tag">✓ Fabric déjà installé</span> (${esc(st.fabric.versionId)}).`
  } else {
    $('fabricBtn').textContent = '⚙ Installer Fabric'
    $('fabricDl').hidden = true
  }
}

// --- Mode hors-ligne (pseudo seul) ---
function setupOffline() {
  const go = async () => {
    const name = $('offlineName').value.trim()
    try {
      const acct = await window.launcher.authOffline(name)
      renderAccount(acct)
      $('offlineStatus').textContent = `✓ Connecté hors-ligne : ${acct.name}`
      setStatus(`Mode hors-ligne : ${acct.name} — tu peux jouer (solo / serveurs cracked) ✓`)
    } catch (e) {
      $('offlineStatus').textContent = e.message
    }
  }
  $('offlineBtn').addEventListener('click', go)
  $('offlineName').addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
}

// --- ID d'application Azure (client_id pour l'auth) ---
async function setupClientId() {
  const input = $('clientIdInput')
  const status = $('azureStatus')
  try {
    const st = await window.launcher.getClientId()
    if (st.clientId) input.value = st.clientId
    if (st.ready) status.textContent = st.fromEnv && !st.clientId
      ? '✓ client_id fourni par la variable d\'environnement.'
      : '✓ client_id configuré — tu peux te connecter.'
    else status.textContent = 'Aucun client_id : la connexion est désactivée tant qu\'il manque.'
  } catch (_) { /* ignore */ }

  $('saveClientId').addEventListener('click', async () => {
    const id = input.value.trim()
    try {
      const r = await window.launcher.setClientId(id)
      status.textContent = r.ready
        ? '✓ Enregistré — tu peux maintenant te connecter.'
        : 'Enregistré, mais vide : renseigne un client_id valide.'
      setStatus(r.ready ? 'client_id Azure enregistré ✓' : 'client_id vidé.')
    } catch (e) {
      status.textContent = 'Erreur : ' + e.message
    }
  })
}

// --- Toggle GPU dédié (opt-in, réversible) ---
async function setupGpuToggle() {
  const box = $('gpuToggle')
  try {
    const st = await window.launcher.gpuPrefGet()
    if (!st.supported) {
      box.disabled = true
      box.closest('.toggle-row').querySelector('.toggle-desc').textContent =
        'Disponible uniquement sous Windows.'
      return
    }
    box.checked = !!st.enabled
  } catch (_) { /* on laisse décoché */ }

  box.addEventListener('change', async () => {
    box.disabled = true
    try {
      await window.launcher.gpuPrefSet(box.checked)
      setStatus(box.checked ? 'GPU dédié forcé pour Minecraft ✓' : 'Préférence GPU retirée (auto).')
    } catch (e) {
      box.checked = !box.checked // rollback visuel
      setStatus('Préférence GPU : ' + e.message)
    } finally {
      box.disabled = false
    }
  })
}

// --- Compte Microsoft ---
function renderAccount(acct, opts = {}) {
  if (acct) {
    state.account = acct
    $('avatar').textContent = (acct.name || '?').charAt(0).toUpperCase()
    $('acctName').textContent = acct.name
    $('acctSub').textContent = acct.offline
      ? 'Hors-ligne · cliquer pour changer'
      : 'Connecté · cliquer pour déconnecter'
  } else if (opts.code) {
    $('avatar').textContent = '⧗'
    $('acctName').textContent = opts.code
    $('acctSub').textContent = 'sur microsoft.com/link'
  } else {
    state.account = null
    $('avatar').textContent = '?'
    $('acctName').textContent = 'Se connecter'
    $('acctSub').textContent = 'Compte Microsoft'
  }
  updatePlay()
}

// Le bouton JOUER n'est actif qu'une fois connecté.
function updatePlay() {
  const btn = $('playBtn')
  btn.disabled = !state.account
  btn.title = state.account
    ? 'Lancer Minecraft optimisé'
    : 'Connecte-toi avec Microsoft pour jouer'
}

// Lance le jeu et streame les logs dans la barre d'état.
async function launchGame() {
  if (!state.account) return
  const gameVersion = $('gameVersion').value
  $('playBtn').disabled = true
  setStatus('Lancement de Minecraft…')

  // Progression de l'auto-préparation (Minecraft + Fabric téléchargés si absents).
  const unsubPrep = window.launcher.onPrepareProgress((p) => {
    if (p.step === 'done') return
    if (p.total > 1) setStatus(`Préparation — ${p.step} ${p.done}/${p.total}…`)
    else setStatus(`Préparation — ${p.step}…`)
  })
  const unsubLog = window.launcher.onGameLog((line) => {
    const t = line.trim()
    if (t) setStatus(t.slice(0, 160))
  })
  const unsubExit = window.launcher.onGameExit((code) => {
    setStatus(`Jeu fermé (code ${code}).`)
    unsubLog && unsubLog(); unsubExit && unsubExit()
    updatePlay()
  })

  try {
    const info = await window.launcher.launchGame(gameVersion, state.profile.id)
    unsubPrep && unsubPrep()
    setStatus(`Minecraft lancé (pid ${info.pid}${info.modded ? ' · Fabric' : ''})…`)
  } catch (e) {
    setStatus('Échec du lancement : ' + e.message)
    unsubPrep && unsubPrep(); unsubLog && unsubLog(); unsubExit && unsubExit()
    updatePlay()
  }
}

let loginBusy = false

async function handleAccountClick() {
  // Un clic pendant la connexion = annulation.
  if (loginBusy) {
    window.launcher.authCancel()
    return
  }
  // Déjà connecté -> déconnexion.
  if (state.account) {
    await window.launcher.authLogout()
    renderAccount(null)
    setStatus('Déconnecté.')
    return
  }
  // Connexion interactive : le navigateur s'ouvre sur l'écran Microsoft.
  loginBusy = true
  $('acctName').textContent = 'Connexion…'
  $('acctSub').textContent = 'choisis ton compte (re-clic = annuler)'
  setStatus('Fenêtre Microsoft ouverte — choisis ton compte…')
  try {
    const acct = await window.launcher.authLogin()
    renderAccount(acct)
    setStatus(`Connecté en tant que ${acct.name} ✓`)
  } catch (e) {
    renderAccount(null)
    const full = (e && e.message || String(e)).replace(/^Error invoking remote method '[^']+':\s*/, '')
    setStatus('Échec de connexion : ' + full)
    // La barre d'état tronque : on affiche le message COMPLET dans l'onglet Avancé.
    const az = $('azureStatus')
    if (az) az.textContent = '❌ Échec de connexion : ' + full
    // Repli visible immédiat sur le compte.
    $('acctName').textContent = 'Échec — voir Avancé'
    $('acctSub').textContent = full.slice(0, 40)
  } finally {
    loginBusy = false
  }
}

// --- Navigation par onglets (sidebar) ---
function setupTabs() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'))
      btn.classList.add('active')
      const view = document.getElementById('view-' + btn.dataset.view)
      if (view) view.classList.add('active')
    })
  })
}

// --- Rendu des réglages options.txt générés ---
function renderGameOptions() {
  const rows = Object.entries(state.gameOptions).map(([k, v]) => {
    const label = OPTION_LABELS[k] || k
    const val = v === true ? 'activé' : v === false ? 'coupé' : v
    return `<div class="row"><span class="k">${esc(label)}</span><span class="v">${esc(val)}</span></div>`
  })
  $('gameOpts').innerHTML = rows.join('')
}

// --- Changement de profil : on recalcule côté backend ---
async function selectProfile(profileId) {
  setStatus('Recalcul du profil…')
  const r = await window.launcher.recompute(profileId)
  Object.assign(state, {
    profile: r.profile, ramMB: r.ramMB, jvmArgs: r.jvmArgs,
    gcLabel: r.gcLabel, java: r.java, gameOptions: r.gameOptions
  })
  renderProfiles()
  renderCurrent()
  // Re-rend l'instance active : footRam = RAM effective (respecte l'override
  // manuel) et le libellé « Auto : X Go » est recalculé avec le nouveau profil de perf.
  await refreshProfiles()
  setStatus(`Profil « ${state.profile.name} » appliqué.`)
}

// --- Résolution des mods de perf via Modrinth ---
async function resolveMods() {
  const gameVersion = $('gameVersion').value
  setStatus(`Recherche des mods pour ${gameVersion} (Fabric)…`)
  $('mods').innerHTML = '<div class="muted">Interrogation de Modrinth…</div>'

  try {
    const { resolved, unavailable, errored } =
      await window.launcher.resolveMods(gameVersion, state.profile.id)

    const present = state.install.mods || new Set()
    const okHtml = resolved.map(m => {
      const already = present.has(m.fileName)
      return `
      <div class="mod ok">
        <span class="dot"></span>
        <div>
          <div class="name">${esc(m.label)}${already ? ' <span class="badge">déjà installé</span>' : ''}</div>
          <div class="why">${esc(m.why)}</div>
        </div>
        <span class="ver">${esc(m.versionNumber)}</span>
      </div>`
    }).join('')

    const already = resolved.filter(m => present.has(m.fileName)).length

    const naHtml = (unavailable || []).map(slug => `
      <div class="mod missing">
        <span class="dot"></span>
        <div><div class="name">${esc(slug)}</div>
        <div class="why">Pas de version compatible ${esc(gameVersion)}/Fabric.</div></div>
      </div>`).join('')

    const errHtml = (errored || []).map(e => `
      <div class="mod missing">
        <span class="dot"></span>
        <div><div class="name">${esc(e.slug)}</div>
        <div class="why">Erreur réseau : ${esc(e.error)}</div></div>
      </div>`).join('')

    $('mods').innerHTML = (okHtml + naHtml + errHtml) || '<div class="muted">Aucun mod trouvé.</div>'
    setStatus(`${resolved.length} compatible(s) — ${already} déjà installé(s), ${resolved.length - already} à télécharger.`)
  } catch (e) {
    $('mods').innerHTML = `<div class="muted">Erreur : ${esc(e.message)}</div>`
    setStatus('Échec de la résolution des mods.')
  }
}

// Libellés lisibles des phases de téléchargement vanilla.
const VANILLA_PHASES = {
  'client-json': 'Métadonnées',
  'client-jar': 'Client Minecraft',
  'libraries': 'Librairies',
  'asset-index': 'Index des assets',
  'assets': 'Assets',
  'natives': 'Natives'
}

// --- Téléchargement de Minecraft vanilla (Mojang) ---
async function installVanilla() {
  const gameVersion = $('gameVersion').value

  $('vanillaBtn').disabled = true
  $('vanillaDl').hidden = false
  $('vanillaFill').style.width = '0%'
  $('vanillaText').textContent = 'Contact de Mojang…'
  setStatus('Téléchargement de Minecraft…')

  const unsub = window.launcher.onVanillaProgress((p) => {
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
    $('vanillaFill').style.width = `${pct}%`
    const phase = VANILLA_PHASES[p.phase] || p.phase
    $('vanillaText').textContent = `${phase} — ${p.done}/${p.total}`
  })

  try {
    const m = await window.launcher.installVanilla(gameVersion)
    $('vanillaFill').style.width = '100%'
    const c = m.counts
    const errs = (c.assetErrors || 0) + (c.nativesErrors || 0)
    $('vanillaText').textContent =
      `Minecraft ${m.versionId} prêt — ${c.libraries} libs, ${c.assets} assets, ` +
      `${c.nativesExtracted} natives` +
      (errs ? ` (${errs} erreur(s) non bloquante(s))` : '')
    setStatus(`Minecraft ${m.versionId} installé ✓ (Java ${m.javaMajor} requis)`)
    await refreshInstallStatus()
  } catch (e) {
    $('vanillaText').textContent = `Erreur : ${e.message}`
    setStatus('Échec du téléchargement de Minecraft.')
  } finally {
    unsub && unsub()
    $('vanillaBtn').disabled = false
  }
}

// --- Installation du loader Fabric ---
async function installFabric() {
  const gameVersion = $('gameVersion').value

  $('fabricBtn').disabled = true
  $('fabricDl').hidden = false
  $('fabricFill').style.width = '0%'
  $('fabricText').textContent = 'Contact de Fabric Meta…'
  setStatus('Installation de Fabric…')

  const unsub = window.launcher.onFabricProgress((p) => {
    const pct = Math.round((p.done / p.total) * 100)
    $('fabricFill').style.width = `${pct}%`
    $('fabricText').textContent = `${p.done}/${p.total} — ${p.name}`
  })

  try {
    const r = await window.launcher.installFabric(gameVersion)
    const err = r.results.filter(x => x.status === 'error').length
    $('fabricFill').style.width = '100%'
    $('fabricText').textContent =
      `Fabric ${r.loaderVersion} installé — ${r.libCount} librairie(s)` +
      (err ? `, ${err} en erreur` : '') + `. (profil : ${r.versionId})`
    setStatus(err ? `Fabric : ${err} librairie(s) en erreur.` : `Fabric ${r.loaderVersion} prêt ✓`)
    await refreshInstallStatus()
  } catch (e) {
    $('fabricText').textContent = `Erreur : ${e.message}`
    setStatus('Échec de l\'installation de Fabric.')
  } finally {
    unsub && unsub()
    $('fabricBtn').disabled = false
  }
}

// --- Téléchargement effectif des mods dans le dossier géré ---
async function installMods() {
  const gameVersion = $('gameVersion').value

  $('installBtn').disabled = true
  $('resolveBtn').disabled = true
  $('dl').hidden = false
  $('dlFill').style.width = '0%'
  $('dlText').textContent = 'Préparation…'
  setStatus('Téléchargement des mods…')

  const unsub = window.launcher.onDownloadProgress((p) => {
    const pct = Math.round((p.done / p.total) * 100)
    $('dlFill').style.width = `${pct}%`
    const st = p.phase === 'done' ? (p.status || '') : '…'
    $('dlText').textContent = `${p.done}/${p.total} — ${p.label} ${st}`
  })

  try {
    const r = await window.launcher.installMods(gameVersion, state.profile.id)
    const dl = r.results.filter(x => x.status === 'downloaded').length
    const cached = r.results.filter(x => x.status === 'cached').length
    const err = r.results.filter(x => x.status === 'error').length
    const removed = (r.removed || []).length

    $('dlFill').style.width = '100%'
    $('dlText').textContent =
      `Terminé : ${dl} téléchargé(s), ${cached} déjà présent(s)` +
      (removed ? `, ${removed} obsolète(s) supprimé(s)` : '') +
      (err ? `, ${err} en erreur` : '') + `. → ${esc(r.dir)}`
    setStatus(err ? `${err} mod(s) en erreur — voir la liste.` : 'Mods installés ✓')

    renderInstallResults(r.results)
    await refreshInstallStatus()
  } catch (e) {
    $('dlText').textContent = `Erreur : ${esc(e.message)}`
    setStatus('Échec du téléchargement.')
  } finally {
    unsub && unsub()
    $('installBtn').disabled = false
    $('resolveBtn').disabled = false
  }
}

// Affiche l'état après installation (téléchargé / caché / erreur).
function renderInstallResults(results) {
  $('mods').innerHTML = results.map(r => {
    const cls = r.status === 'error' ? 'missing' : 'ok'
    const tag = r.status === 'downloaded' ? 'téléchargé'
      : r.status === 'cached' ? 'déjà présent' : `erreur : ${r.error || ''}`
    return `<div class="mod ${cls}">
      <span class="dot"></span>
      <div><div class="name">${esc(r.slug || r.label)}</div><div class="why">${esc(tag)}</div></div>
    </div>`
  }).join('')
}

// --- Modules (mod menu façon Feather : grille de cartes) ---
async function setupModules() {
  const grid = $('modulesGrid')
  try {
    const data = await window.launcher.modulesList()
    state.moduleCatalog = data.modules || []
    state.moduleInstalled = new Set(data.installed || [])
  } catch (_) {
    grid.innerHTML = '<div class="muted">Erreur de chargement des modules.</div>'
    return
  }

  document.querySelectorAll('.mtab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.mtab').forEach(x => x.classList.remove('active'))
    t.classList.add('active')
    moduleFilter = t.dataset.cat
    renderModuleCards()
  }))
  $('modulesSearch').addEventListener('input', renderModuleCards)
  renderModuleCards()
}

// Recharge l'état des modules (après un changement de profil) sans re-binder.
async function reloadModules() {
  try {
    const data = await window.launcher.modulesList()
    state.moduleInstalled = new Set(data.installed || [])
    renderModuleCards()
  } catch (_) { /* ignore */ }
}

function renderModuleCards() {
  const grid = $('modulesGrid')
  const q = $('modulesSearch').value.trim().toLowerCase()
  const gated = !isFabricLike(state.activeLoader)
  const banner = gated
    ? `<div class="loader-gate">Ces modules sont Fabric/Quilt uniquement — profil actif : ${esc(LOADER_LABELS[state.activeLoader] || state.activeLoader)}.</div>`
    : ''

  const html = state.moduleCatalog.filter(m => {
    if (moduleFilter !== 'all' && m.category !== moduleFilter) return false
    if (q && !m.label.toLowerCase().includes(q) && !(m.description || '').toLowerCase().includes(q)) return false
    return true
  }).map(m => {
    const on = state.moduleInstalled.has(m.id)
    const warn = m.serverNote ? `<span class="mc-warn" title="${esc(m.serverNote)}">⚠</span>` : ''
    return `<div class="module-card ${on ? 'on' : ''}">
      <div class="mc-top"><span class="mc-name">${esc(m.label)}</span>${warn}</div>
      <div class="mc-icon">${esc(m.icon || '♥')}</div>
      <div class="mc-desc">${esc(m.description)}</div>
      <button class="mc-toggle ${on ? 'on' : ''}" data-module="${esc(m.id)}" ${gated && !on ? 'disabled' : ''}>${on ? 'Activé' : 'Désactivé'}</button>
    </div>`
  }).join('')

  grid.innerHTML = banner + (html || '<div class="muted">Aucun module dans cette catégorie.</div>')
  grid.querySelectorAll('.mc-toggle').forEach(b => b.addEventListener('click', () => toggleModule(b)))
}

async function toggleModule(btn) {
  const id = btn.dataset.module
  const on = state.moduleInstalled.has(id)
  btn.disabled = true
  btn.textContent = on ? 'Retrait…' : 'Installation…'
  setStatus(on ? `Retrait de « ${id} »…` : `Activation de « ${id} »…`)
  try {
    if (on) { await window.launcher.removeModule(id); state.moduleInstalled.delete(id) }
    else { await window.launcher.installModule(id, $('gameVersion').value); state.moduleInstalled.add(id) }
    setStatus(on ? 'Module retiré.' : 'Module activé ✓')
  } catch (e) {
    setStatus('Module : ' + e.message)
  } finally {
    btn.disabled = false
    renderModuleCards()
    refreshProfiles() // met à jour le compte + la liste de mods du profil
  }
}

// --- Liste dynamique des versions Minecraft (toutes les releases Mojang) ---
async function setupVersions() {
  const sel = $('gameVersion')
  const current = sel.value || '1.21.1'
  try {
    const versions = await window.launcher.listVersions()
    if (versions && versions.length) {
      state.versions = versions
      sel.innerHTML = versions.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')
      sel.value = versions.includes(current) ? current : versions[0]
    }
  } catch (_) { /* on garde les options par défaut */ }
}

// --- Gestionnaire de mods (recherche + installer/retirer) ---
let browserTimer
async function setupModBrowser() {
  await loadBrowser('')
  $('modSearch').addEventListener('input', () => {
    clearTimeout(browserTimer)
    browserTimer = setTimeout(() => loadBrowser($('modSearch').value.trim()), 350)
  })
}

async function loadBrowser(query) {
  const grid = $('browserGrid')
  grid.innerHTML = '<div class="muted">Recherche…</div>'
  try {
    const hits = await window.launcher.searchMods(query, $('gameVersion').value)
    if (!hits.length) { grid.innerHTML = '<div class="muted">Aucun mod trouvé.</div>'; return }
    grid.innerHTML = hits.map(browserCard).join('')
    attachIconFallback(grid, 'img.bm-icon', 'bm-icon bm-noicon', '❖')
    grid.querySelectorAll('.bm-btn').forEach(b => b.addEventListener('click', () => toggleBrowserMod(b)))
  } catch (e) {
    grid.innerHTML = `<div class="muted">Erreur : ${esc(e.message)}</div>`
  }
}

function fmtDl(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
}

function browserCard(m) {
  const icon = m.iconUrl
    ? `<img class="bm-icon" src="${esc(m.iconUrl)}" alt="" />`
    : `<div class="bm-icon bm-noicon">❖</div>`
  return `<div class="browser-card">
    ${icon}
    <div class="bm-info">
      <div class="bm-title">${esc(m.title)}</div>
      <div class="bm-desc">${esc(m.description)}</div>
      <div class="bm-meta">⬇ ${fmtDl(m.downloads)}</div>
    </div>
    <button class="bm-btn ${m.installed ? 'on' : ''}" data-pid="${esc(m.projectId)}"
      data-slug="${esc(m.slug)}" data-title="${esc(m.title)}" data-icon="${esc(m.iconUrl || '')}"
      >${m.installed ? 'Installé' : 'Installer'}</button>
  </div>`
}

async function toggleBrowserMod(btn) {
  const pid = btn.dataset.pid
  const on = btn.classList.contains('on')
  btn.disabled = true
  btn.textContent = on ? 'Retrait…' : 'Installation…'
  try {
    if (on) {
      await window.launcher.removeSearchedMod(pid)
      btn.classList.remove('on'); btn.textContent = 'Installer'
      setStatus('Mod retiré.')
    } else {
      await window.launcher.installSearchedMod(
        { projectId: pid, slug: btn.dataset.slug, title: btn.dataset.title, iconUrl: btn.dataset.icon },
        $('gameVersion').value)
      btn.classList.add('on'); btn.textContent = 'Installé'
      setStatus(`${btn.dataset.title} installé ✓`)
    }
  } catch (e) {
    btn.textContent = on ? 'Installé' : 'Installer'
    setStatus('Mod : ' + e.message)
  } finally {
    btn.disabled = false
    refreshProfiles() // met à jour le compte + la liste de mods du profil
  }
}

// --- Profils de mods (sélecteur launchbar + gestion dans l'onglet Mods) ---
async function refreshProfiles() {
  let data
  try { data = await window.launcher.listProfiles() } catch (_) { return }
  const { profiles, active } = data

  // Sélecteur dans la barre de lancement (à côté de la version).
  const sel = $('profileSelect')
  if (sel) {
    sel.innerHTML = Object.entries(profiles).map(([id, p]) =>
      `<option value="${esc(id)}">${esc(p.name)} · ${p.count} mod${p.count > 1 ? 's' : ''}</option>`).join('')
    if (active) sel.value = active
  }

  // La version de la launchbar suit le profil ACTIF (version « par instance »).
  const activeVer = (profiles[active] || {}).gameVersion
  if (activeVer) {
    ensureVersionOption($('gameVersion'), activeVer)
    refreshInstallStatus()
  }
  // Le loader actif pilote le tag de la launchbar + le gating des catalogues.
  applyLoaderUi((profiles[active] || {}).loader || 'fabric')

  // Chips de gestion (onglet Mods).
  const chips = $('profilesChips')
  if (chips) {
    chips.innerHTML = Object.entries(profiles).map(([id, p]) => {
      const on = id === active
      const del = id !== 'default' ? `<span class="chip-del" data-del="${esc(id)}" title="Supprimer">🗑</span>` : ''
      return `<div class="profile-chip ${on ? 'on' : ''}" data-pid="${esc(id)}"><span>${esc(p.name)} · ${p.count}</span>${del}</div>`
    }).join('')
    chips.querySelectorAll('.profile-chip').forEach(c => c.addEventListener('click', (e) => {
      if (e.target.classList.contains('chip-del')) return
      switchToProfile(c.dataset.pid)
    }))
    chips.querySelectorAll('.chip-del').forEach(d => d.addEventListener('click', (e) => {
      e.stopPropagation()
      deleteProfile(d.dataset.del)
    }))
  }

  // Vue détail (« instance ») du profil actif.
  await renderProfileDetail(active)
}

// Garantit qu'une version existe dans un <select> puis la sélectionne.
function ensureVersionOption(sel, v) {
  if (!sel || !v) return
  if (![...sel.options].some(o => o.value === v)) {
    const o = document.createElement('option')
    o.value = v; o.textContent = v
    sel.insertBefore(o, sel.firstChild)
  }
  sel.value = v
}

// Vue détaillée d'un profil (façon instance CurseForge) : version, RAM, mods+logos.
// On affiche toujours le profil ACTIF (cliquer un chip le rend actif d'abord).
async function renderProfileDetail(id) {
  const box = $('profileDetail')
  if (!box || !id) return
  let d
  try {
    d = await window.launcher.profileDetail(id, state.profile ? state.profile.id : null)
  } catch (e) { box.innerHTML = `<div class="muted">Erreur : ${esc(e.message)}</div>`; return }

  const versions = state.versions && state.versions.length ? state.versions : [d.gameVersion]
  const verList = versions.includes(d.gameVersion) ? versions : [d.gameVersion, ...versions]
  const verOpts = verList.map(v =>
    `<option value="${esc(v)}" ${v === d.gameVersion ? 'selected' : ''}>${esc(v)}</option>`).join('')
  const loaderOpts = ['fabric', 'quilt', 'forge', 'neoforge'].map(l =>
    `<option value="${l}" ${l === d.loader ? 'selected' : ''}>${LOADER_LABELS[l]}</option>`).join('')

  const manual = !!(d.ram && d.ram.mode === 'manual')
  const maxMB = Math.max(4096, d.totalRamMB || 8192)
  const sliderVal = Math.min(maxMB, manual && d.ram.mb ? d.ram.mb : d.effectiveRamMB)
  const effGB = (d.effectiveRamMB / 1024).toFixed(1)

  const modsHtml = d.mods.length ? d.mods.map(m => {
    const ic = m.isImage && m.icon
      ? `<img class="pd-mod-icon" src="${esc(m.icon)}" alt="" loading="lazy" />`
      : `<div class="pd-mod-icon pd-mod-emoji">${esc(m.icon || '❖')}</div>`
    const ver = m.version
      ? `<span class="pd-mod-ver">${esc(m.version)}</span>`
      : (m.type === 'module' ? '<span class="pd-mod-ver">module</span>' : '')
    return `<div class="pd-mod">
      ${ic}
      <div class="pd-mod-info"><div class="pd-mod-name">${esc(m.name)}</div>${ver}</div>
      <span class="pd-mod-del" data-type="${m.type}" data-id="${esc(m.id)}" title="Retirer">✕</span>
    </div>`
  }).join('') : '<div class="muted pd-empty">Aucun mod. Ajoute-en via la recherche ci-dessous ou l\'onglet Modules.</div>'

  box.innerHTML = `
    <div class="pd-head">
      <div class="pd-title">${esc(d.name)} <span class="pd-badge">actif</span></div>
      <button class="btn ghost pd-icons-btn" id="pdRefreshIcons" title="Récupérer les logos des mods depuis Modrinth">🔄 Logos</button>
    </div>
    <div class="pd-settings">
      <div class="pd-field">
        <label>Loader</label>
        <select class="pd-select" id="pdLoader">${loaderOpts}</select>
        <div class="muted pd-hint">${d.loaderVersion ? 'Version : ' + esc(d.loaderVersion) : 'Version résolue à l\'installation.'}</div>
      </div>
      <div class="pd-field">
        <label>Version Minecraft</label>
        <select class="pd-select" id="pdVersion">${verOpts}</select>
      </div>
      <div class="pd-field">
        <div class="pd-ram-top">
          <label>RAM allouée</label>
          <span class="pd-ram-mode">
            <button class="pd-ram-btn ${manual ? '' : 'on'}" data-mode="auto">Auto</button>
            <button class="pd-ram-btn ${manual ? 'on' : ''}" data-mode="manual">Manuel</button>
          </span>
        </div>
        <div class="pd-ram-row">
          <input type="range" id="pdRam" min="2048" max="${maxMB}" step="512" value="${sliderVal}" ${manual ? '' : 'disabled'} />
          <strong id="pdRamVal">${(sliderVal / 1024).toFixed(1)} Go</strong>
        </div>
        <div class="muted pd-hint">${manual ? 'RAM fixée manuellement pour ce profil.' : `Auto : ${effGB} Go (selon ta machine et ton profil de perf).`}</div>
      </div>
    </div>
    <div class="pd-mods-head">Mods · ${d.mods.length}</div>
    <div class="pd-mods">${modsHtml}</div>
  `
  attachIconFallback(box, 'img.pd-mod-icon', 'pd-mod-icon pd-mod-emoji', '❖')

  // Récupération des logos des mods (via Modrinth, par hash — pas de re-téléchargement).
  const iconsBtn = $('pdRefreshIcons')
  iconsBtn && iconsBtn.addEventListener('click', async () => {
    iconsBtn.disabled = true
    setStatus('Récupération des logos des mods…')
    const unsub = window.launcher.onModpackProgress((p) =>
      setStatus(`Logos — ${p.name || ''} ${p.total > 1 ? (p.done + '/' + p.total) : ''}`))
    try {
      const r = await window.launcher.refreshProfileIcons(id)
      unsub && unsub()
      await renderProfileDetail(id)
      setStatus(r.updated ? `${r.updated} logo(s) récupéré(s) ✓` : 'Aucun logo trouvé (mods hors Modrinth).')
    } catch (e) { unsub && unsub(); setStatus('Logos : ' + e.message); iconsBtn.disabled = false }
  })

  // Loader par profil (Forge/NeoForge résolvent la dernière version côté backend).
  const loaderSel = $('pdLoader')
  loaderSel && loaderSel.addEventListener('change', async () => {
    const nl = loaderSel.value
    loaderSel.disabled = true
    setStatus(`Changement de loader → ${LOADER_LABELS[nl]}…`)
    try {
      const r = await window.launcher.setProfileLoader(id, nl)
      await afterProfileChange() // tag, gating, browser, détail
      setStatus(r && r.cleared
        ? `Loader → ${LOADER_LABELS[nl]} ✓ — mods incompatibles retirés (changement de famille).`
        : `Loader du profil « ${d.name} » : ${LOADER_LABELS[nl]} ✓`)
    } catch (e) { setStatus('Loader : ' + e.message); renderProfileDetail(id) }
  })

  // Version par profil → met à jour la launchbar + l'état d'installation.
  const verSel = $('pdVersion')
  verSel && verSel.addEventListener('change', async () => {
    try {
      await window.launcher.setProfileVersion(id, verSel.value)
      ensureVersionOption($('gameVersion'), verSel.value)
      refreshInstallStatus()
      loadBrowser($('modSearch').value.trim())
      setStatus(`Version de « ${d.name} » : ${verSel.value}.`)
    } catch (e) { setStatus('Version : ' + e.message) }
  })

  // Bascule Auto / Manuel (re-render pour refléter l'état).
  box.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => {
    try {
      await window.launcher.setProfileRam(id, b.dataset.mode, parseInt($('pdRam').value, 10))
      await renderProfileDetail(id)
    } catch (e) { setStatus('RAM : ' + e.message) }
  }))

  // Slider RAM (mode manuel).
  const ram = $('pdRam')
  ram && ram.addEventListener('input', () => {
    $('pdRamVal').textContent = (parseInt(ram.value, 10) / 1024).toFixed(1) + ' Go'
  })
  ram && ram.addEventListener('change', async () => {
    const mb = parseInt(ram.value, 10)
    try {
      await window.launcher.setProfileRam(id, 'manual', mb)
      $('footRam').textContent = `${(mb / 1024).toFixed(1)} Go`
      setStatus(`RAM de « ${d.name} » : ${(mb / 1024).toFixed(1)} Go.`)
    } catch (e) { setStatus('RAM : ' + e.message) }
  })

  // Retirer un mod du profil.
  box.querySelectorAll('.pd-mod-del').forEach(x => x.addEventListener('click', async () => {
    try {
      if (x.dataset.type === 'mod') await window.launcher.removeSearchedMod(x.dataset.id)
      else await window.launcher.removeModule(x.dataset.id)
      await afterProfileChange()
    } catch (e) { setStatus('Retrait : ' + e.message) }
  }))

  // La launchbar reflète la RAM effective du profil actif.
  $('footRam').textContent = `${effGB} Go`
}

async function switchToProfile(id) {
  try {
    await window.launcher.switchProfile(id)
    await afterProfileChange()
    setStatus('Profil activé.')
  } catch (e) { setStatus('Profil : ' + e.message) }
}

async function deleteProfile(id) {
  try {
    await window.launcher.deleteProfile(id)
    await afterProfileChange()
    setStatus('Profil supprimé.')
  } catch (e) { setStatus('Profil : ' + e.message) }
}

// Recharge tout ce qui dépend du profil actif (mods installés).
async function afterProfileChange() {
  await refreshProfiles()
  loadBrowser($('modSearch').value.trim())
  reloadModules()
}

async function setupProfiles() {
  await refreshProfiles()
  const sel = $('profileSelect')
  if (sel) sel.addEventListener('change', () => switchToProfile(sel.value))
  const cb = $('createProfileBtn')
  if (cb) cb.addEventListener('click', async () => {
    const name = $('newProfileName').value.trim()
    if (!name) { setStatus('Donne un nom au nouveau profil.'); return }
    try {
      const r = await window.launcher.createProfile(name, { duplicate: true })
      $('newProfileName').value = ''
      await window.launcher.switchProfile(r.id)
      await afterProfileChange()
      setStatus(`Profil « ${name} » créé et activé.`)
    } catch (e) { setStatus('Profil : ' + e.message) }
  })
  const ib = $('importPackBtn')
  if (ib) ib.addEventListener('click', importModpack)
}

// Importe un modpack .mrpack → crée un profil du nom du pack et l'active.
async function importModpack() {
  const btn = $('importPackBtn')
  btn.disabled = true
  const unsub = window.launcher.onModpackProgress((p) => {
    $('modpackDl').hidden = false
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
    $('modpackFill').style.width = pct + '%'
    $('modpackText').textContent = `${p.done}/${p.total} — ${p.name}`
  })
  setStatus('Sélectionne un fichier .mrpack…')
  try {
    const r = await window.launcher.importModpack()
    if (r.canceled) { setStatus('Import annulé.'); return }
    await window.launcher.switchProfile(r.id)
    await afterProfileChange()
    const issues = [...(r.failed || []), ...(r.skipped || [])]
    if (issues.length) {
      setStatus(`Modpack « ${r.name} » : ${r.count}/${r.modTotal} mod(s) installés — ${issues.length} problème(s) : ${issues.slice(0, 4).join(', ')}${issues.length > 4 ? '…' : ''}. Le pack peut être incomplet (risque de crash au lancement).`)
    } else {
      setStatus(`Modpack « ${r.name} » importé : ${r.count} mod(s) — profil créé et activé ✓`)
    }
  } catch (e) {
    // Le message d'erreur IPC est préfixé par « Error invoking remote method … » :
    // on le retire pour afficher la vraie raison, en entier, dans la zone (non tronquée).
    let msg = (e && e.message || String(e))
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error:\s*/, '')
    if (/index\.json|\.mrpack invalide|illisible/i.test(msg)) {
      msg += ' — Vérifie que c\'est bien un modpack Modrinth (.mrpack). Les modpacks CurseForge (.zip) ne sont pas supportés.'
    }
    $('modpackDl').hidden = false
    $('modpackFill').style.width = '0%'
    $('modpackText').textContent = '❌ ' + msg
    setStatus('Import du modpack échoué — voir le détail ci-dessus.')
  } finally {
    unsub && unsub()
    btn.disabled = false
    setTimeout(() => { const dl = $('modpackDl'); if (dl && !/❌/.test($('modpackText').textContent)) dl.hidden = true }, 1800)
  }
}

// --- Démarrage : on analyse la machine dès l'ouverture ---
async function init() {
  const r = await window.launcher.analyze()
  Object.assign(state, {
    hw: r.hw, profile: r.profile, ramMB: r.ramMB, jvmArgs: r.jvmArgs,
    gcLabel: r.gcLabel, java: r.java, gameOptions: r.gameOptions,
    gpuVendor: r.gpuVendor, profiles: r.profiles
  })

  renderHardware(state.hw)
  renderProfiles()
  renderCurrent()
  setStatus(`Profil détecté automatiquement : « ${state.profile.name} ».`)

  setupTabs()
  await setupVersions()
  refreshInstallStatus()
  $('gameVersion').addEventListener('change', async () => {
    // La version choisie est enregistrée sur le profil ACTIF (version par instance).
    const active = $('profileSelect') ? $('profileSelect').value : null
    if (active) {
      try { await window.launcher.setProfileVersion(active, $('gameVersion').value) } catch (_) {}
      renderProfileDetail(active)
    }
    refreshInstallStatus()
    loadBrowser($('modSearch').value.trim())
  })
  $('vanillaBtn').addEventListener('click', installVanilla)
  $('fabricBtn').addEventListener('click', installFabric)
  $('resolveBtn').addEventListener('click', resolveMods)
  $('installBtn').addEventListener('click', installMods)
  $('openDirBtn').addEventListener('click', () => window.launcher.openModsDir())
  $('accountChip').addEventListener('click', handleAccountClick)
  $('playBtn').addEventListener('click', launchGame)
  updatePlay()
  setupOffline()
  setupClientId()
  setupGpuToggle()
  setupModules()
  // Les profils AVANT le gestionnaire : refreshProfiles fixe #gameVersion sur la
  // version du profil actif, que loadBrowser lit ensuite (sinon version par défaut).
  await setupProfiles()
  setupModBrowser()

  // Restauration silencieuse d'une session précédente.
  window.launcher.authSilent().then((acct) => {
    if (acct) renderAccount(acct)
  }).catch(() => {})
}

init()
