// Catalogue des MODULES (fonctions type Feather) : chaque module = UNE fonction
// client (FPS, zoom, armure…) fournie par un mod Fabric OPEN-SOURCE, présentée
// comme un interrupteur "à la Feather". Distinct des mods de PERF (modrinth.js).
//
// Tous les slugs sont VÉRIFIÉS présents sur Modrinth pour 1.21.1 Fabric.
// serverNote != '' = avertissement (fonction potentiellement bannie anticheat).
//   icon = emoji affiché sur la carte (équivalent de l'aperçu Feather).

const MODULES = [
  // ---------- Notre mod maison (menu en jeu) ----------
  { id: 'pipoumod', label: 'PipouMod (menu en jeu)', category: 'hud', local: true, jar: 'pipoumod.jar', icon: '💜',
    description: 'Notre mod menu Maj-droit : FPS, coords, keystrokes, CPS, armure, potions, ping, direction.', serverNote: '' },

  // ---------- HUD / Infos ----------
  { id: 'fps-coords', label: 'FPS & Coordonnées', category: 'hud', slug: 'betterf3', icon: '📊',
    description: 'FPS, coordonnées, ping, direction (écran F3 revisité, propre).', serverNote: '' },
  { id: 'hunger', label: 'Faim & saturation', category: 'hud', slug: 'appleskin', icon: '🍖',
    description: 'Détaille faim, saturation et régénération.', serverNote: '' },
  { id: 'block-info', label: 'Infos du bloc visé', category: 'hud', slug: 'jade', icon: '🔎',
    description: 'Affiche le nom/les infos du bloc ou de l\'entité visée.', serverNote: '' },

  // ---------- PvP ----------
  { id: 'armor', label: 'Armure & durabilité', category: 'pvp', slug: 'armor-hud', icon: '🛡️',
    description: 'HUD de ton armure et de sa durabilité.', serverNote: '' },
  { id: 'potions', label: 'Effets de potions', category: 'pvp', slug: 'status-effect-bars', icon: '🧪',
    description: 'Barres des effets de potions actifs.', serverNote: '' },

  // ---------- Confort ----------
  { id: 'zoom', label: 'Zoom', category: 'comfort', slug: 'zoomify', icon: '🔍',
    description: 'Zoom à la touche (maintenir C par défaut).', serverNote: '' },
  { id: 'fullbright', label: 'Fullbright', category: 'comfort', slug: 'gamma-utils', icon: '💡',
    description: 'Luminosité maximale — voir dans le noir.', serverNote: '' },
  { id: 'crosshair', label: 'Crosshair dynamique', category: 'comfort', slug: 'dynamiccrosshair', icon: '✛',
    description: 'Le viseur réagit selon ce que tu vises.', serverNote: '' },
  { id: 'first-person', label: 'Corps en 1re personne', category: 'comfort', slug: 'first-person-model', icon: '🧍',
    description: 'Vois ton propre corps en vue première personne.', serverNote: '' },
  { id: 'shulker-preview', label: 'Aperçu shulker', category: 'comfort', slug: 'shulkerboxtooltip', icon: '📦',
    description: 'Voir le contenu d\'une boîte de shulker au survol.', serverNote: '' },
  { id: 'tooltips', label: 'Tooltips stylés', category: 'comfort', slug: 'legendary-tooltips', icon: '🏷️',
    description: 'Infobulles d\'objets plus jolies et lisibles.', serverNote: '' },

  // ---------- Visuel ----------
  { id: 'shaders', label: 'Shaders (Iris)', category: 'visual', slug: 'iris', icon: '🌈',
    description: 'Support des shaders (fonctionne avec Sodium).', serverNote: '' },
  { id: 'skin3d', label: 'Couches de skin 3D', category: 'visual', slug: '3dskinlayers', icon: '👕',
    description: 'Rend les couches de skin en 3D (chapeau, veste…).', serverNote: '' },
  { id: 'capes', label: 'Capes', category: 'visual', slug: 'capes', icon: '🧣',
    description: 'Capes cosmétiques (OptiFine, MinecraftCapes…).', serverNote: '' },
  { id: 'animations', label: 'Animations joueur', category: 'visual', slug: 'not-enough-animations', icon: '🤸',
    description: 'Animations de joueur plus fluides et réalistes.', serverNote: '' },
  { id: 'particles', label: 'Particules d\'ambiance', category: 'visual', slug: 'visuality', icon: '✨',
    description: 'Particules ambiantes améliorées.', serverNote: '' },
  { id: 'connected-textures', label: 'Textures connectées', category: 'visual', slug: 'continuity', icon: '🧱',
    description: 'Verre/blocs à textures connectées (via Sodium).', serverNote: '' },
  { id: 'eating', label: 'Animation manger/boire', category: 'visual', slug: 'eating-animation', icon: '🍎',
    description: 'Animation quand tu manges ou bois.', serverNote: '' },
  { id: 'highlight', label: 'Surbrillance du bloc', category: 'visual', slug: 'highlight', icon: '🔦',
    description: 'Contour net du bloc visé.', serverNote: '' },

  // ---------- Divers / Ambiance ----------
  { id: 'ambient-sounds', label: 'Sons d\'ambiance', category: 'misc', slug: 'ambientsounds', icon: '🔊',
    description: 'Ambiances sonores selon le biome et le lieu.', serverNote: '' },
  { id: 'footsteps', label: 'Bruits de pas', category: 'misc', slug: 'presence-footsteps', icon: '👣',
    description: 'Sons de pas selon le bloc sous tes pieds.', serverNote: '' },
  { id: 'screenshots', label: 'Screenshots HD', category: 'misc', slug: 'fabrishot', icon: '📸',
    description: 'Captures d\'écran en très haute résolution.', serverNote: '' },
  { id: 'freecam', label: 'Caméra libre', category: 'misc', slug: 'freecam', icon: '🎥',
    description: 'Détache la caméra de ton personnage.', serverNote: 'peut être interdit sur serveurs anticheat' },
  { id: 'tips', label: 'Astuces au chargement', category: 'misc', slug: 'tips', icon: '💬',
    description: 'Conseils affichés sur les écrans de chargement.', serverNote: '' }
]

function getModule(id) { return MODULES.find(m => m.id === id) || null }

module.exports = { MODULES, getModule }
