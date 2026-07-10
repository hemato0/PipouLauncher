// Générateur d'un options.txt Minecraft optimisé selon le profil.
// Souvent négligé, c'est pourtant un des plus gros leviers GRATUITS : couper les
// particules, réduire simulationDistance et la distance des entités peut doubler
// les FPS sur une scène type MagicSpells (plein de particules + entités).
//
// ⚠️ Les clés d'options.txt peuvent varier selon la version de Minecraft. Les clés
// ci-dessous sont valides pour 1.21.x. mergeOptions ne touche QUE ces clés et
// préserve tout le reste du fichier du joueur (touches, langue, volume…).

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// Construit les clés/valeurs d'options.txt à forcer pour un profil.
function optionsForProfile(profile) {
  const entityScale = clamp(profile.entityDist / 100, 0.5, 5.0)

  return {
    renderDistance: profile.renderDistance,
    // simulationDistance : levier MAJEUR pour le coût des entités/particules
    // (tick des entités dans les chunks simulés). Absent = gros gain manqué.
    simulationDistance: profile.simulationDistance || profile.renderDistance,
    maxFps: profile.maxFps,
    graphicsMode: profile.graphics === 'fancy' ? 1 : 0, // 0=fast,1=fancy,2=fabulous
    particles: profile.particles,                        // 0=all,1=decreased,2=minimal
    entityDistanceScaling: entityScale.toFixed(1),
    enableVsync: false,
    entityShadows: false,
    renderClouds: profile.graphics === 'fast' ? false : true, // vraie clé 1.21
    ao: profile.graphics === 'fast' ? false : true,           // occlusion ambiante
    biomeBlendRadius: profile.graphics === 'fast' ? 0 : 2,
    mipmapLevels: profile.graphics === 'fast' ? 0 : 2
  }
}

// Fusionne nos réglages dans un options.txt existant sans écraser le reste
// (touches, langue, volume… restent ceux du joueur).
// existingText : contenu actuel du fichier (ou '' s'il n'existe pas).
function mergeOptions(existingText, overrides) {
  const lines = (existingText || '').split(/\r?\n/).filter(Boolean)
  const map = new Map()

  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    map.set(line.slice(0, idx), line.slice(idx + 1))
  }

  for (const [key, value] of Object.entries(overrides)) {
    map.set(key, String(value))
  }

  return Array.from(map, ([k, v]) => `${k}:${v}`).join('\n') + '\n'
}

module.exports = { optionsForProfile, mergeOptions }
