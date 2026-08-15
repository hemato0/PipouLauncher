package com.pipou.pipoumod;

/**
 * Zoom LISSE : le facteur multiplicatif du FOV est interpolé PAR FRAME (pas par tick),
 * ce qui supprime la saccade (20 pas/s) de l'ancienne approche. Easing exponentiel basé
 * sur le temps réel écoulé -> même douceur quel que soit le FPS. Lu par GameRendererMixin
 * qui multiplie le FOV de rendu par ce facteur (1.0 = pas de zoom, <1 = zoomé).
 *
 * « Zoom plus loin » = zoom.level grand -> cible = 1/level petite -> FOV réduit d'autant.
 */
public final class PipouZoom {
	private PipouZoom() {}

	private static double cur = 1.0;   // facteur courant (interpolé)
	private static long lastNano = 0L; // horodatage de la dernière frame (pour dt réel)

	/** Constante de temps de l'easing (s) : petit = réactif, grand = très doux. */
	private static final double TAU = 0.07;

	/** Facteur multiplicatif du FOV à appliquer cette frame (1.0 = neutre). */
	public static double factor() {
		boolean want = PipouOptions.isEnabled("zoom") && PipouModClient.isZoomKeyDown();
		double level = Math.max(1.2, PipouOptions.getNum("zoom.level", 3));
		double target = want ? 1.0 / level : 1.0;

		long now = System.nanoTime();
		double dt = lastNano == 0L ? 0.016 : Math.min(0.1, (now - lastNano) / 1_000_000_000.0);
		lastNano = now;

		double a = 1.0 - Math.exp(-dt / TAU); // lissage exponentiel indépendant du FPS
		cur += (target - cur) * a;
		if (Math.abs(cur - target) < 0.0005) cur = target; // évite une queue d'asymptote infinie
		return cur;
	}
}
