// Détection du matériel + choix d'un profil de performance.
// On lit la RAM/CPU/GPU pour deviner ce que la machine peut encaisser,
// puis on en déduit combien de RAM allouer et quel preset appliquer.

const os = require('os')
const si = require('systeminformation')

// Profils de perf. Chaque profil décrit une intention, pas des chiffres fixes :
// les Mo de RAM sont recalculés ensuite en fonction de la RAM réellement dispo.
// Chaque profil pilote AUSSI les réglages du jeu (options.txt) :
//   particles  : 0=tous, 1=réduits, 2=minimum
//   entityDist : distance de rendu des entités en % (100 = normal)
//   coreOnly   : true => on n'installe que les mods de perf essentiels
const PROFILES = {
  'anti-lag': {
    id: 'anti-lag',
    name: 'Anti-lag extrême',
    description: 'Petit PC / serveur bondé : tout au minimum, particules coupées, culling max.',
    ramFraction: 0.4,
    renderDistance: 5,
    simulationDistance: 5,
    maxFps: 120,        // plafonné : moins de charge GPU/chauffe, frametime + stable
    graphics: 'fast',
    particles: 2,       // minimum
    entityDist: 50,     // moitié de la distance normale
    coreOnly: true
  },
  'low-end': {
    id: 'low-end',
    name: 'Low-end',
    description: 'PC modeste : on privilégie la fluidité, distance de rendu réduite.',
    // fraction de la RAM totale qu'on ose allouer à Minecraft
    ramFraction: 0.4,
    renderDistance: 6,
    simulationDistance: 6,
    maxFps: 120,
    graphics: 'fast',
    particles: 1,
    entityDist: 75,
    coreOnly: true
  },
  'balanced': {
    id: 'balanced',
    name: 'Équilibré',
    description: 'Bon compromis fluidité / qualité pour la majorité des PC.',
    ramFraction: 0.45,
    renderDistance: 10,
    simulationDistance: 8,
    maxFps: 240,
    graphics: 'fancy',
    particles: 1,
    entityDist: 100,
    coreOnly: false
  },
  'high-end': {
    id: 'high-end',
    name: 'High-end',
    description: 'Machine puissante : on pousse la distance de rendu et le FPS.',
    ramFraction: 0.5,
    renderDistance: 16,
    simulationDistance: 12,
    maxFps: 260,
    graphics: 'fancy',
    particles: 0,
    entityDist: 100,
    coreOnly: false
  }
}

// Borne une valeur entre min et max.
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// Détecte le matériel de façon robuste : si un composant échoue, on garde
// une valeur par défaut plutôt que de planter le launcher.
async function detectHardware() {
  const totalRamBytes = os.totalmem()
  const totalRamGB = totalRamBytes / (1024 ** 3)
  const cpuThreads = os.cpus().length

  let cpuBrand = 'Inconnu'
  let gpuModel = 'Inconnu'
  let gpuVramMB = 0

  try {
    const cpu = await si.cpu()
    cpuBrand = `${cpu.manufacturer} ${cpu.brand}`.trim()
  } catch (_) { /* on garde la valeur par défaut */ }

  try {
    const graphics = await si.graphics()
    // On prend le GPU avec le plus de VRAM (le dédié, pas l'intégré).
    const best = (graphics.controllers || [])
      .filter(c => c && c.model)
      .sort((a, b) => (b.vram || 0) - (a.vram || 0))[0]
    if (best) {
      gpuModel = best.model
      gpuVramMB = best.vram || 0
    }
  } catch (_) { /* idem */ }

  return {
    totalRamGB: Math.round(totalRamGB * 10) / 10,
    cpuThreads,
    cpuBrand,
    gpuModel,
    gpuVramMB
  }
}

// Choisit un profil automatiquement selon le matériel détecté.
function pickProfile(hw) {
  // Machine très modeste -> anti-lag d'office.
  if (hw.totalRamGB <= 4 || hw.cpuThreads <= 2) return PROFILES['anti-lag']
  if (hw.totalRamGB <= 8 || hw.cpuThreads <= 4) return PROFILES['low-end']
  if (hw.totalRamGB >= 16 && hw.cpuThreads >= 8) return PROFILES['high-end']
  return PROFILES['balanced']
}

// Calcule les Mo de RAM à allouer à partir du profil et de la RAM totale.
// Principes (contre le mythe "alloue un max de RAM") :
//   - on ne descend jamais sous 2 Go ;
//   - on ne dépasse jamais 8 Go (au-delà, le GC gère mal et ça peut ralentir) ;
//   - on garde TOUJOURS une réserve pour l'OS + navigateur + Discord, sinon la
//     machine swappe et c'est l'inverse du but.
function computeRamMB(hw, profile) {
  const totalMB = hw.totalRamGB * 1024
  const osReserveMB = 3072                      // marge OS incompressible
  const raw = totalMB * profile.ramFraction
  const ceiling = Math.max(2048, totalMB - osReserveMB) // ne jamais tout prendre
  return Math.round(clamp(Math.min(raw, ceiling), 2048, 8192))
}

module.exports = { PROFILES, detectHardware, pickProfile, computeRamMB }
