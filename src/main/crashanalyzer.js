// Analyse d'un log de crash Minecraft pour DÉTECTER un conflit de mods et proposer
// un correctif (mettre à jour vers des versions compatibles, ou désactiver le fautif).
//
// Cas principal ciblé (le plus fréquent et le plus lisible) : un mixin qui échoue à
// s'appliquer parce qu'un mod A patche un mod B dont la version installée a changé
// d'API. Ex. réel : Flashback @Shadow une méthode `isHandTranslucent` qui n'existe
// plus dans la version d'Iris installée -> le jeu plante (code -1).

// Mappe un package de classe (ou un segment de config mixin) vers un mod connu.
// Sert à NOMMER le mod « cible » d'un mixin de compatibilité.
const CLASS_MOD = [
  [/iris(shaders)?|coderbot\.iris/i, { modid: 'iris', name: 'Iris' }],
  [/\bsodium\b|caffeinemc\.mods?\.sodium/i, { modid: 'sodium', name: 'Sodium' }],
  [/\breplaymod\b/i, { modid: 'replaymod', name: 'ReplayMod' }],
  [/\bflashback\b/i, { modid: 'flashback', name: 'Flashback' }],
  [/distant.?horizons|seibel\.distanthorizons/i, { modid: 'distanthorizons', name: 'Distant Horizons' }],
  [/\bcreate\b/i, { modid: 'create', name: 'Create' }],
  [/\blithium\b/i, { modid: 'lithium', name: 'Lithium' }],
  [/\bindium\b/i, { modid: 'indium', name: 'Indium' }],
  [/\boculus\b/i, { modid: 'oculus', name: 'Oculus' }]
]

function modFromHint(mixinClass, targetClass) {
  // 1) Un mixin de compatibilité se nomme souvent `compat.<mod>.MixinXxx`.
  const c = String(mixinClass || '')
  const seg = c.match(/(?:compat|compatibility|mixins?)\.([a-z0-9_]+)\./i)
  if (seg) {
    const key = seg[1].toLowerCase()
    for (const [re, mod] of CLASS_MOD) if (re.test(key)) return mod
    return { modid: key, name: key.charAt(0).toUpperCase() + key.slice(1) }
  }
  // 2) Sinon on déduit du package de la classe cible.
  const t = String(targetClass || '')
  for (const [re, mod] of CLASS_MOD) if (re.test(t)) return mod
  return null
}

// Renvoie une DIAGNOSE brute (ids de mods) ou null. main.js l'enrichit ensuite avec
// les noms/fichiers réels des mods installés.
function analyzeCrash(log) {
  if (!log || typeof log !== 'string') return null

  // --- 1) Mixin apply failed : conflit de VERSIONS entre deux mods ---
  // Ex : "Mixin apply for mod flashback failed flashback.mixins.json:compat.iris.MixinIrisHandRenderer
  //       from mod flashback -> net.irisshaders.iris.pathways.HandRenderer: ..."
  const mx = log.match(/Mixin apply for mod (\S+) failed (\S+?)(?::(\S+))? from mod \S+ -> ([\w.$]+)\s*:/)
  if (mx) {
    const culpritId = mx[1]
    const mixinClass = mx[3] || ''
    const targetClass = mx[4] || ''
    const target = modFromHint(mixinClass, targetClass)
    const missing = (log.match(/@Shadow method (\w+)/) || [])[1] || null
    return {
      kind: 'mixin-conflict',
      culpritId,
      targetId: target ? target.modid : null,
      targetName: target ? target.name : null,
      targetClass,
      missingMethod: missing
    }
  }

  // --- 2) Dépendance Fabric manquante / incompatible (le loader refuse de démarrer) ---
  // Ex : "requires version 1.2.3 or later of sodium, which is missing!"
  const dep = log.match(/requires (?:version )?([^\s]+(?: or later)?) of ([a-z0-9_-]+)/i)
  if (/Incompatible mod set|which is missing|A potential solution/i.test(log) && dep) {
    return {
      kind: 'missing-dependency',
      culpritId: null,
      targetId: dep[2],
      targetName: dep[2],
      requiredVersion: dep[1]
    }
  }

  return null
}

module.exports = { analyzeCrash }
