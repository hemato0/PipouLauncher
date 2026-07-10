// Générateur d'arguments JVM optimisés — pour un CLIENT (pas un serveur).
//
// L'ancienne version copiait les "flags Aikar", conçus pour des SERVEURS à gros
// heap : sur un client ils collectent l'oldgen trop agressivement et produisent
// des stutters. On adopte donc une approche par SÉLECTEUR DE GC selon le matériel
// (consensus brucethemoose/Minecraft-Performance-Flags-Benchmarks) :
//
//   • Petit PC / peu de cœurs / Java < 21  → G1 tuné client (pauses courtes,
//     young gen large pour absorber les rafales d'allocations = particules).
//   • PC avec marge (heap >= ~5 Go, >= 4 cœurs, Java >= 21) → ZGC générationnel :
//     pauses sub-milliseconde quasi indépendantes de la taille du heap = l'arme
//     anti-freeze quand MagicSpells crache des milliers de particules/entités.
//
// Règle d'or : NE JAMAIS mélanger des flags G1 et ZGC (les G1* sont ignorés/
// erronés sous ZGC).

// Flags communs bénéfiques quel que soit le GC.
function baseFlags(ramMB, totalRamMB) {
  const flags = [
    `-Xms${ramMB}M`,
    `-Xmx${ramMB}M`,
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',           // ignore les System.gc() de certains mods
    '-XX:+ParallelRefProcEnabled',
    '-XX:+PerfDisableSharedMem',         // évite les micro-stalls I/O (hsperfdata)
    '-XX:+AlwaysActAsServerClassMachine',// force JIT C2 même sur machine "faible"
    // Code cache élargi : un setup Fabric moddé (Sodium/Lithium…) déborde le cache
    // JIT par défaut, ce qui provoque des désoptimisations et des freezes.
    '-XX:ReservedCodeCacheSize=400M',
    '-XX:NonNMethodCodeHeapSize=12M',
    '-XX:ProfiledCodeHeapSize=194M',
    '-XX:NonProfiledCodeHeapSize=194M',
    '-XX:-DontCompileHugeMethods'
  ]

  // AlwaysPreTouch : bon pour la fluidité en jeu, mais réclame TOUT le heap en RAM
  // physique dès le boot. Sur un PC à RAM serrée ça fait swapper (OS/Discord) =>
  // l'inverse du but. On ne l'active que si l'OS garde une marge confortable.
  if (totalRamMB && (totalRamMB - ramMB) >= 3500) {
    flags.push('-XX:+AlwaysPreTouch')
  }

  return flags
}

// G1 réglé pour un CLIENT : cible de pause courte + young gen généreux.
function g1Flags(ramMB) {
  const regionSize = ramMB >= 4096 ? 16 : 8
  return [
    '-XX:+UseG1GC',
    '-XX:MaxGCPauseMillis=37',
    `-XX:G1HeapRegionSize=${regionSize}M`,
    '-XX:G1NewSizePercent=28',   // young gen large = moins de collectes sous rafale
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:InitiatingHeapOccupancyPercent=20'
  ]
}

// ZGC générationnel : self-tuning, on ajoute juste ce qu'il faut.
// +ZGenerational n'est requis QUE sur Java 21/22 (défaut sur 23+, supprimé sur 24+).
function zgcFlags(javaMajor) {
  const flags = ['-XX:+UseZGC']
  if (javaMajor === 21 || javaMajor === 22) flags.push('-XX:+ZGenerational')
  return flags
}

// Choisit le GC selon le matériel + la version de Java détectée.
// Renvoie 'zgc' seulement si on a la marge ET Java >= 21.
function chooseGc({ ramMB, cores, javaMajor }) {
  const hasMargin = ramMB >= 5000 && (cores || 0) >= 4
  if (hasMargin && javaMajor && javaMajor >= 21) return 'zgc'
  return 'g1'
}

// Étiquette lisible pour l'UI.
function gcLabel(gc, javaMajor) {
  if (gc === 'zgc') return (javaMajor >= 23) ? 'ZGC générationnel' : 'ZGC générationnel (Java 21+)'
  return 'G1 (réglé client)'
}

// Construit la liste finale d'arguments JVM.
// opts = { ramMB, cores, javaMajor, totalRamMB }
// Accepte aussi un simple nombre (ramMB) pour compatibilité.
function buildJvmArgs(opts) {
  if (typeof opts === 'number') opts = { ramMB: opts }
  const { ramMB, cores = 4, javaMajor = null, totalRamMB = null } = opts

  const gc = chooseGc({ ramMB, cores, javaMajor })
  const gcArgs = gc === 'zgc' ? zgcFlags(javaMajor) : g1Flags(ramMB)
  return [...baseFlags(ramMB, totalRamMB), ...gcArgs]
}

// Variante qui renvoie aussi le GC choisi (pour affichage UI).
function buildJvmPlan(opts) {
  if (typeof opts === 'number') opts = { ramMB: opts }
  const { ramMB, cores = 4, javaMajor = null } = opts
  const gc = chooseGc({ ramMB, cores, javaMajor })
  return { args: buildJvmArgs(opts), gc, gcLabel: gcLabel(gc, javaMajor) }
}

module.exports = { buildJvmArgs, buildJvmPlan, chooseGc, gcLabel }
