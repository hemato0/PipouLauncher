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
  profiles: [],
  account: null,
  accounts: [],
  selectedAccountId: null,
  install: { vanilla: false, fabric: { installed: false } },
  versions: [],
  activeLoader: 'fabric'
}

const LOADER_LABELS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }

// Reflète le loader actif dans l'UI : tag de la launchbar + gating des catalogues
// Fabric/Quilt (mods d'optimisation + Modules) quand le profil est Forge/NeoForge.
function applyLoaderUi(loader) {
  state.activeLoader = loader || 'fabric'
  const tag = $('loaderTag'); if (tag) tag.textContent = LOADER_LABELS[state.activeLoader] || state.activeLoader
}

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

// --- Écran de chargement (splash) ---
function splashProgress(pct, msg) {
  const fill = $('splashFill'); if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%'
  const m = $('splashMsg'); if (m && msg) m.textContent = msg
}
function hideSplash() {
  const s = $('splash'); if (!s) return
  s.classList.add('splash-hide')
  setTimeout(() => { s.hidden = true }, 550)
}

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
      fabric: st.fabric || { installed: false }
    }
  } catch (_) {
    state.install = { vanilla: false, fabric: { installed: false } }
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

// (Cartes « Mode hors-ligne » et « client_id Azure » retirées de la page Avancé :
//  l'ajout de comptes hors-ligne/Microsoft se fait via le panneau multi-comptes,
//  et le client_id est intégré par défaut. IPC get/set-client-id conservés au besoin.)

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

// --- Comptes Minecraft (multi-comptes) ---
// Met à jour la puce compte de la sidebar (compte ACTIF pour jouer).
function renderAccountChip() {
  const a = state.account
  const av = $('avatar')
  if (a) {
    av.textContent = (a.name || '?').charAt(0).toUpperCase()
    av.classList.toggle('off', !!a.offline)
    $('acctName').textContent = a.name
    $('acctSub').textContent = a.offline ? 'Hors-ligne' : 'Microsoft'
  } else {
    av.textContent = '?'; av.classList.remove('off')
    $('acctName').textContent = 'Ajouter un compte'
    $('acctSub').textContent = 'Minecraft'
  }
  updatePlay()
}

// Rend la liste des comptes dans le panneau.
function renderAccountsList() {
  const box = $('accountsList')
  if (!box) return
  if (!state.accounts.length) {
    box.innerHTML = '<div class="ap-empty">Aucun compte. Ajoute-en un ci-dessous.</div>'
    return
  }
  box.innerHTML = state.accounts.map(a => {
    const on = a.id === state.selectedAccountId
    const initial = esc((a.name || '?').charAt(0).toUpperCase())
    return `<div class="ap-row ${on ? 'on' : ''}" data-id="${esc(a.id)}">
      <div class="ap-av ${a.offline ? 'off' : ''}">${initial}</div>
      <div class="ap-info">
        <div class="ap-name">${esc(a.name)}</div>
        <div class="ap-type">${a.offline ? 'Hors-ligne' : 'Microsoft'}</div>
      </div>
      ${on ? '<span class="ap-check">✓</span>' : ''}
      <span class="ap-del" data-del="${esc(a.id)}" title="Retirer">🗑</span>
    </div>`
  }).join('')
  box.querySelectorAll('.ap-row').forEach(r => r.addEventListener('click', (e) => {
    if (e.target.classList.contains('ap-del')) return
    selectAccount(r.dataset.id)
  }))
  box.querySelectorAll('.ap-del').forEach(d => d.addEventListener('click', (e) => {
    e.stopPropagation(); removeAccount(d.dataset.del)
  }))
}

function apStatus(msg) { const el = $('apStatus'); if (el) el.textContent = msg || '' }

// Charge la liste des comptes + le compte actif depuis le backend.
// RÉSILIENT : si l'IPC échoue (verrou fichier transitoire côté main), on RÉESSAIE
// au lieu d'abandonner en silence — sinon le compte reste "perdu" toute la session
// (JOUER grisé) alors qu'il est bien enregistré.
async function refreshAccounts() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms))
  // Budget de réessai LARGE (~6,5 s) : doit dépasser un cycle complet de lecture config
  // côté main (~1,7 s) sinon on abandonne trop tôt et le compte reste "perdu" au boot
  // à froid (verrou fichier). On réessaie aussi tant que le main répond "dégradé".
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const data = await window.launcher.accountsList()
      state.accounts = data.accounts || []
      state.selectedAccountId = data.selected || null
      state.account = data.current || null
      renderAccountChip()
      renderAccountsList()
      // Config pas encore lisible côté main : on retente au lieu de figer "aucun compte".
      if (data.degraded && !state.account) { await sleep(400); continue }
      return
    } catch (e) {
      console.warn('[accounts] échec accountsList, réessai', attempt + 1, e && e.message)
      await sleep(300 + attempt * 150)
    }
  }
  renderAccountChip()
  renderAccountsList()
}

async function selectAccount(id) {
  if (id === state.selectedAccountId && state.account) { toggleAccountPanel(false); return }
  apStatus('Changement de compte…')
  try {
    const acc = await window.launcher.accountSelect(id)
    state.account = acc; state.selectedAccountId = id
    renderAccountChip(); renderAccountsList()
    apStatus('')
    setStatus(`Compte : ${acc.name}`)
    toggleAccountPanel(false)
  } catch (e) {
    apStatus('Reconnexion nécessaire : ' + stripIpc(e.message))
    await refreshAccounts()
  }
}

async function removeAccount(id) {
  try {
    await window.launcher.accountRemove(id)
    await refreshAccounts()
    setStatus('Compte retiré.')
  } catch (e) { apStatus('Retrait : ' + stripIpc(e.message)) }
}

async function addMicrosoft() {
  const btn = $('addMsBtn'); if (btn) btn.disabled = true
  apStatus('Fenêtre Microsoft ouverte — choisis ton compte…')
  try {
    const acc = await window.launcher.accountAddMicrosoft()
    await refreshAccounts()
    apStatus('')
    setStatus(`Connecté : ${acc.name} ✓`)
  } catch (e) {
    apStatus('❌ ' + stripIpc(e.message))
  } finally { if (btn) btn.disabled = false }
}

async function addOffline() {
  const input = $('apOfflineName'); const name = (input.value || '').trim()
  if (!name) { apStatus('Entre un pseudo (3-16 caractères).'); return }
  try {
    const acc = await window.launcher.accountAddOffline(name)
    input.value = ''
    await refreshAccounts()
    apStatus('')
    setStatus(`Compte hors-ligne : ${acc.name} ✓`)
  } catch (e) { apStatus(stripIpc(e.message)) }
}

function stripIpc(msg) {
  return String(msg || '').replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

function toggleAccountPanel(force) {
  const panel = $('accountPanel'); if (!panel) return
  const open = force === undefined ? panel.hidden : force
  panel.hidden = !open
  const caret = $('acctCaret'); if (caret) caret.textContent = open ? '▾' : '▴'
  if (open) renderAccountsList()
}

// Le bouton JOUER n'est actif qu'une fois connecté.
function updatePlay() {
  const btn = $('playBtn')
  // Gate sur compte ET profil : launchGame déréférence state.profile.id (null si
  // l'analyse machine a échoué) -> sans ce garde, TypeError cryptique au clic.
  btn.disabled = !(state.account && state.profile)
  btn.title = !state.account
    ? 'Connecte-toi avec Microsoft pour jouer'
    : (!state.profile ? 'Analyse de la machine incomplète — relance le launcher' : 'Lancer Minecraft optimisé')
}

// Lance le jeu et streame les logs dans la barre d'état.
async function launchGame() {
  if (!state.account) return
  if (!state.profile) { setStatus('Analyse de la machine incomplète — relance le launcher.'); return }
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

// --- Diagnostic de crash (conflit de mods détecté) ---
// Affiche une modale expliquant le conflit + propose de corriger (mettre à jour vers
// des versions compatibles, ou désactiver le mod fautif).
function showCrashModal(data) {
  const overlay = $('crashOverlay')
  if (!overlay || !data) return
  const c = data.culprit, t = data.target
  $('crashTitle').textContent = '⚠️ Le jeu a planté — conflit de mods'
  const actions = $('crashActions')
  actions.innerHTML = ''
  $('crashStatus').textContent = ''

  let msg
  if ((data.kind === 'mixin-conflict' || data.kind === 'class-conflict') && c) {
    msg = t
      ? `Le mod « ${c.name} » n'est pas compatible avec la version installée de « ${t.name} » — c'est ce qui a fait planter le jeu.`
      : `Le mod « ${c.name} » a provoqué le crash (il référence une API absente d'un autre mod).`
  } else if (data.kind === 'missing-dependency' && t) {
    msg = `Un mod a besoin de « ${t.name} »${data.requiredVersion ? ' (version ' + data.requiredVersion + ')' : ''}, absent ou en mauvaise version.`
  } else {
    msg = 'Un conflit de mods a été détecté au lancement.'
  }
  $('crashMsg').textContent = msg

  const mods = []
  if (c && c.installed) mods.push({ modid: c.modid, slug: c.modid, name: c.name })
  if (t && t.installed && (!c || t.modid !== c.modid)) mods.push({ modid: t.modid, slug: t.modid, name: t.name })

  const addBtn = (label, cls, fn) => {
    const b = document.createElement('button')
    b.className = 'btn ' + cls
    b.textContent = label
    b.addEventListener('click', fn)
    actions.appendChild(b)
  }
  const busy = (on) => actions.querySelectorAll('button').forEach(b => { b.disabled = on })

  if (mods.length) {
    addBtn(`🔄 Mettre à jour ${mods.map(m => m.name).join(' + ')} (versions compatibles)`, 'play', async () => {
      busy(true); $('crashStatus').textContent = 'Recherche + téléchargement des versions compatibles…'
      try {
        const r = await window.launcher.crashUpdateMods(mods, data.gameVersion)
        const unchanged = r.unchanged || []
        if (r.done.length) {
          // Détail avant→après pour que ce soit VISIBLE (ex. « Iris : 1.8.14-beta → 1.8.8 »).
          let s = '✓ ' + r.done.map(d => `${d.name} : ${d.from ? d.from + ' → ' : ''}${d.to}`).join(' · ')
          if (unchanged.length) s += ` · ${unchanged.map(u => u.name + ' déjà à jour').join(', ')}`
          if (r.failed.length) s += ` · ⚠ échec : ${r.failed.map(f => (f.name || f.slug) + ' (' + f.reason + ')').join(', ')}`
          $('crashStatus').textContent = s
          showRelaunch()
        } else if (r.failed.length) {
          $('crashStatus').textContent = '⚠ ' + r.failed.map(f => (f.name || f.slug) + ' : ' + f.reason).join(' · ') + ' — désactive plutôt un mod ci-dessus.'
          busy(false)
        } else if (unchanged.length) {
          $('crashStatus').textContent = 'Déjà en dernière version stable : la mise à jour ne peut pas résoudre le conflit. Désactive plutôt un des deux mods ci-dessus (tu ne perds pas l\'autre).'
          busy(false)
        } else {
          $('crashStatus').textContent = 'Rien à mettre à jour — désactive plutôt un mod ci-dessus.'
          busy(false)
        }
      } catch (e) { $('crashStatus').textContent = 'Échec : ' + (e && e.message || e); busy(false) }
    })
  }
  if (c && c.installed && c.file) addBtn(`🚫 Désactiver ${c.name}`, 'ghost', () => disableCrashMod(c))
  if (t && t.installed && t.file && (!c || t.modid !== c.modid)) addBtn(`🚫 Désactiver ${t.name}`, 'ghost', () => disableCrashMod(t))

  overlay.hidden = false
}

async function disableCrashMod(m) {
  const actions = $('crashActions')
  actions.querySelectorAll('button').forEach(b => { b.disabled = true })
  $('crashStatus').textContent = `Désactivation de ${m.name}…`
  try {
    await window.launcher.crashDisableMod(m.file)
    $('crashStatus').textContent = `✓ ${m.name} désactivé.`
    showRelaunch()
  } catch (e) {
    $('crashStatus').textContent = 'Échec : ' + (e && e.message || e)
    actions.querySelectorAll('button').forEach(b => { b.disabled = false })
  }
}

function showRelaunch() {
  const actions = $('crashActions')
  actions.innerHTML = ''
  const b = document.createElement('button')
  b.className = 'btn play'
  b.textContent = '▶ Relancer Minecraft'
  b.addEventListener('click', () => { $('crashOverlay').hidden = true; launchGame() })
  actions.appendChild(b)
}

// Clic sur la puce compte -> ouvre/ferme le panneau des comptes.
function handleAccountClick() { toggleAccountPanel() }

// Câble le panneau des comptes (boutons + fermeture au clic extérieur).
function setupAccountPanel() {
  const ms = $('addMsBtn'); if (ms) ms.addEventListener('click', addMicrosoft)
  const off = $('addOfflineBtn'); if (off) off.addEventListener('click', addOffline)
  const input = $('apOfflineName')
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addOffline() })
  // Ferme le panneau si on clique en dehors.
  document.addEventListener('click', (e) => {
    const panel = $('accountPanel'), chip = $('accountChip')
    if (!panel || panel.hidden) return
    if (!panel.contains(e.target) && !chip.contains(e.target)) toggleAccountPanel(false)
  })
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
  try {
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
  } catch (e) {
    setStatus('Changement de profil échoué : ' + (e && e.message || e))
  } finally {
    updatePlay() // le bouton reflète l'état (profil chargé ou non)
  }
}

// (resolveMods/installMods retirés : les mods d'optimisation manquants sont installés
//  AUTOMATIQUEMENT au lancement, cf launch-game côté main.)

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

// (Page « Modules » retirée : les fonctions client vivent dans le mod menu en jeu
//  PipouMod, toujours actif ; les mods externes s'installent via l'onglet « Mods ».)

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
    grid.querySelectorAll('.bm-ver').forEach(b => b.addEventListener('click', () => openVersionPicker(b)))
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
  return `<div class="browser-card" data-pid="${esc(m.projectId)}"
      data-slug="${esc(m.slug)}" data-title="${esc(m.title)}" data-icon="${esc(m.iconUrl || '')}">
    ${icon}
    <div class="bm-info">
      <div class="bm-title">${esc(m.title)}</div>
      <div class="bm-desc">${esc(m.description)}</div>
      <div class="bm-meta">⬇ ${fmtDl(m.downloads)}</div>
    </div>
    <div class="bm-cta">
      <button class="bm-btn ${m.installed ? 'on' : ''}">${m.installed ? 'Installé' : 'Installer'}</button>
      <button class="bm-ver" title="Choisir la version">▾</button>
    </div>
  </div>`
}

// versionId (optionnel) : installe une version PRÉCISE (depuis le sélecteur ▾) —
// dans ce cas on installe/remplace, jamais on ne retire.
async function toggleBrowserMod(btn, versionId) {
  const d = btn.closest('.browser-card').dataset
  const pid = d.pid
  const doRemove = btn.classList.contains('on') && !versionId
  btn.disabled = true
  btn.textContent = doRemove ? 'Retrait…' : 'Installation…'
  try {
    if (doRemove) {
      await window.launcher.removeSearchedMod(pid)
      btn.classList.remove('on'); btn.textContent = 'Installer'
      setStatus('Mod retiré.')
    } else {
      const r = await window.launcher.installSearchedMod(
        { projectId: pid, slug: d.slug, title: d.title, iconUrl: d.icon, versionId },
        $('gameVersion').value)
      btn.classList.add('on'); btn.textContent = 'Installé'
      const added = (r && r.added) || []
      setStatus(added.length
        ? `${d.title} installé ✓ — avec ${added.length} mod${added.length > 1 ? 's' : ''} lié${added.length > 1 ? 's' : ''} : ${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''}`
        : `${d.title} installé ✓`)
    }
  } catch (e) {
    btn.textContent = doRemove ? 'Installé' : 'Installer'
    setStatus('Mod : ' + e.message)
  } finally {
    btn.disabled = false
    refreshProfiles() // met à jour le compte + la liste de mods du profil
  }
}

// --- Sélecteur « choisir la version du mod » (popover, chargé à la demande) ---
let activeVerPop = null
function closeVersionPicker() {
  if (activeVerPop) { activeVerPop.remove(); activeVerPop = null }
  document.removeEventListener('mousedown', onVerOutside, true)
}
function onVerOutside(e) {
  if (activeVerPop && !activeVerPop.contains(e.target) && !e.target.classList.contains('bm-ver')) closeVersionPicker()
}
async function openVersionPicker(verBtn) {
  const wasOpen = activeVerPop && activeVerPop.dataset.for === verBtn.closest('.browser-card').dataset.pid
  closeVersionPicker()
  if (wasOpen) return // re-clic sur le même ▾ = fermer
  const card = verBtn.closest('.browser-card'); const d = card.dataset
  const pop = document.createElement('div')
  pop.className = 'ver-pop'; pop.dataset.for = d.pid
  pop.innerHTML = `<div class="ver-pop-head">Version de « ${esc(d.title)} » <span class="muted">(${esc($('gameVersion').value)})</span></div><div class="ver-pop-list muted">Chargement…</div>`
  document.body.appendChild(pop)
  const r = verBtn.getBoundingClientRect()
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 300) + 'px'
  pop.style.left = Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) + 'px'
  activeVerPop = pop
  setTimeout(() => document.addEventListener('mousedown', onVerOutside, true), 0)
  try {
    const vers = await window.launcher.modVersions(d.slug, $('gameVersion').value)
    const list = pop.querySelector('.ver-pop-list')
    if (!vers.length) { list.textContent = 'Aucune version pour cette version de Minecraft.'; return }
    list.classList.remove('muted'); list.innerHTML = ''
    vers.slice(0, 50).forEach(v => {
      const item = document.createElement('button')
      item.className = 'ver-item'
      const badge = v.versionType && v.versionType !== 'release'
        ? `<span class="ver-badge ${v.versionType}">${v.versionType}</span>` : ''
      item.innerHTML = `<span class="ver-num">${esc(v.versionNumber)}</span>${badge}`
      item.addEventListener('click', () => { closeVersionPicker(); toggleBrowserMod(card.querySelector('.bm-btn'), v.versionId) })
      list.appendChild(item)
    })
  } catch (e) {
    const list = pop.querySelector('.ver-pop-list'); if (list) list.textContent = 'Erreur : ' + (e && e.message || e)
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
    return `<div class="pd-mod" data-file="${esc(m.file || '')}">
      ${ic}
      <div class="pd-mod-info"><div class="pd-mod-name">${esc(m.name)}</div>${ver}</div>
      <span class="pd-mod-del" data-type="${m.type}" data-id="${esc(m.id)}" title="Retirer">✕</span>
    </div>`
  }).join('') : '<div class="muted pd-empty">Aucun mod. Ajoute-en via la recherche ci-dessous.</div>'

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
      else if (x.dataset.type === 'file') await window.launcher.removeModFile(x.dataset.id) // jar ajouté à la main
      else await window.launcher.removeModule(x.dataset.id)
      await afterProfileChange()
    } catch (e) { setStatus('Retrait : ' + e.message) }
  }))

  // Enrichissement ASYNCHRONE des logos : on identifie chaque jar par son hash sur
  // Modrinth (marche aussi pour les mods ajoutés à la main) et on remplace l'emoji ❖
  // par la vraie image + le vrai nom. Non bloquant (les logos apparaissent après).
  window.launcher.profileModIcons(id).then(icons => {
    if (!icons) return
    box.querySelectorAll('.pd-mod[data-file]').forEach(card => {
      const meta = card.dataset.file && icons[card.dataset.file]
      if (!meta) return
      const iconEl = card.querySelector('.pd-mod-icon')
      if (meta.icon && iconEl && iconEl.tagName !== 'IMG') {
        const img = document.createElement('img')
        img.className = 'pd-mod-icon'; img.src = meta.icon; img.loading = 'lazy'; img.alt = ''
        iconEl.replaceWith(img)
      }
      const nameEl = card.querySelector('.pd-mod-name')
      if (meta.title && nameEl) nameEl.textContent = meta.title
    })
  }).catch(() => {})

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
const B = (m) => { try { window.launcher.bootLog && window.launcher.bootLog(m) } catch (_) {} }
async function init() {
  const started = Date.now()
  B('init START')

  // Démarrage réel de l'app, factorisé : lancé tout de suite, OU après l'échec d'une MAJ.
  let booted = false
  const bootApp = () => {
    if (booted) return Promise.resolve()
    booted = true
    return bootRest(started).catch((e) => {
      B('bootRest A JETÉ: ' + (e && e.message || e))
      splashProgress(100, 'Erreur : ' + (e && e.message || e))
      setTimeout(hideSplash, 1200)
    })
  }

  // MISE À JOUR AUTO (app packagée) : vérifiée AVANT tout, pendant le splash. Si une MAJ
  // se télécharge, on reste sur le splash tant qu'elle avance ; si elle échoue ou stagne
  // (error/timeout/none), on démarre QUAND MÊME l'app -> jamais de splash figé.
  window.launcher.onUpdateStatus((s) => {
    if (s.state === 'checking') splashProgress(4, 'Vérification des mises à jour…')
    else if (s.state === 'available') splashProgress(6, `Mise à jour ${s.version || ''} trouvée…`)
    else if (s.state === 'downloading') splashProgress(Math.max(6, Math.min(99, s.percent || 0)), `Téléchargement de la mise à jour ${s.percent || 0}%…`)
    else if (s.state === 'installing') splashProgress(100, 'Installation… le launcher va redémarrer 💜')
    else if (s.state === 'error' || s.state === 'timeout' || s.state === 'none') bootApp()
  })
  let u = { state: 'none' }
  try {
    splashProgress(4, 'Vérification des mises à jour…')
    u = await window.launcher.checkUpdate()
  } catch (_) {}
  if (u && u.state === 'updating') {
    setTimeout(bootApp, 60000) // filet de sécurité : download bloqué -> on démarre au lieu de figer
    return
  }
  await bootApp()
}

// Démarrage effectif de l'application (tout ce qui suit la vérification de mise à jour).
async function bootRest(started) {
  // LE COMPTE D'ABORD — indépendamment de tout le reste. Il est purement local
  // (config.json) et ne doit JAMAIS dépendre de analyze / versions / profils / réseau.
  // Cause du bug "compte pas affiché, JOUER grisé" : refreshAccounts était la DERNIÈRE
  // étape d'init ; le moindre échec en amont (analyze, rendu, réseau) tuait init AVANT
  // et le compte n'était jamais chargé. On le charge donc en tout premier, gardé.
  splashProgress(10, 'Ton compte…')
  try { await refreshAccounts() } catch (_) {}
  B('après refreshAccounts (early) state.account=' + (state.account ? state.account.name : 'null'))

  splashProgress(20, 'Analyse de ta machine…')
  try {
    const r = await window.launcher.analyze()
    Object.assign(state, {
      hw: r.hw, profile: r.profile, ramMB: r.ramMB, jvmArgs: r.jvmArgs,
      gcLabel: r.gcLabel, java: r.java, gameOptions: r.gameOptions,
      profiles: r.profiles
    })
    renderHardware(state.hw)
    renderProfiles()
    renderCurrent()
    setStatus(`Profil détecté automatiquement : « ${state.profile.name} ».`)
  } catch (e) {
    setStatus('Analyse partielle : ' + (e && e.message || e))
  }
  splashProgress(40, 'Versions de Minecraft…')

  setupTabs()
  await setupVersions()
  refreshInstallStatus()
  splashProgress(60, 'Réglages & système…')
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
  $('accountChip').addEventListener('click', handleAccountClick)
  $('playBtn').addEventListener('click', launchGame)
  // Diagnostic de crash (conflit de mods) : écoute persistante + fermeture de la modale.
  window.launcher.onGameCrash(showCrashModal)
  { const cc = $('crashClose'); if (cc) cc.addEventListener('click', () => { $('crashOverlay').hidden = true }) }
  updatePlay()
  setupGpuToggle()
  setupAccountPanel()
  splashProgress(78, 'Profils & mods…')
  // Les profils AVANT le gestionnaire : refreshProfiles fixe #gameVersion sur la
  // version du profil actif, que loadBrowser lit ensuite (sinon version par défaut).
  try { await setupProfiles() } catch (e) { console.warn('setupProfiles:', e && e.message) }
  try { setupModBrowser() } catch (_) {}

  // Ré-sync du compte (déjà affiché tôt) — non bloquant : garantit l'état à jour
  // après le chargement des profils.
  splashProgress(92, 'Comptes…')
  try { await refreshAccounts() } catch (_) {}

  // Prêt : on laisse le splash affiché au moins ~800 ms (pas de flash), puis on masque.
  B('init FIN state.account=' + (state.account ? state.account.name : 'null'))
  splashProgress(100, 'Prêt ! 💜')
  const elapsed = Date.now() - started
  setTimeout(hideSplash, Math.max(0, 800 - elapsed))
}

// Si l'init plante, on masque quand même le splash pour ne pas rester bloqué.
init().catch((e) => {
  B('init A JETÉ: ' + (e && e.message || e) + ' | ' + (e && e.stack || '').split('\n').slice(0, 3).join(' <<< '))
  splashProgress(100, 'Erreur : ' + (e && e.message || e))
  setTimeout(hideSplash, 1200)
})
