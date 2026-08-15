package com.pipou.pipoumod;

import net.minecraft.client.Minecraft;

/**
 * Freelook : regarder autour SANS tourner le personnage (le corps + l'aim restent figés).
 *
 * Technique (fluide PAR FRAME) : {@code MouseHandler.turnPlayer} est appelé à chaque frame et
 * tourne le joueur avec la souris. On l'intercepte au RETURN ({@link #captureFrame}) : on lit le
 * delta que la souris vient d'appliquer, on l'ajoute à une caméra libre (freeYaw/freePitch), puis
 * on REMET le joueur à l'orientation gelée. La caméra elle-même est réorientée via CameraMixin
 * (@ModifyVariable sur setRotation) avec freeYaw/freePitch -> correct en 1re ET 3e personne.
 */
public final class PipouFreelook {
	private PipouFreelook() {}

	private static boolean active = false;
	private static float freeYaw, freePitch;   // orientation de la caméra libre
	private static float savedYaw, savedPitch;  // orientation réelle GELÉE du joueur

	public static boolean isActive() { return active; }
	public static float yaw() { return freeYaw; }
	public static float pitch() { return freePitch; }

	/** Active/désactive selon la touche (appelé au tick). Au démarrage, gèle l'orientation courante. */
	public static void setHeld(Minecraft mc, boolean held) {
		var p = mc.player;
		if (p == null) { active = false; return; }
		if (held && !active) {
			savedYaw = p.getYRot();
			savedPitch = p.getXRot();
			freeYaw = savedYaw;
			freePitch = savedPitch;
			active = true;
		} else if (!held && active) {
			// Relâché : le joueur est déjà à savedYaw/savedPitch (remis chaque frame). On rend la main.
			active = false;
		}
	}

	/** Appelé au RETURN de turnPlayer (chaque frame) : accumule le delta souris et re-gèle le joueur. */
	public static void captureFrame(Minecraft mc) {
		var p = mc.player;
		if (!active || p == null) return;
		float dYaw = p.getYRot() - savedYaw;
		float dPitch = p.getXRot() - savedPitch;
		freeYaw += dYaw;
		freePitch = Math.max(-90f, Math.min(90f, freePitch + dPitch));
		// Remet le joueur (et l'interpolation de rendu) à l'orientation gelée : il ne tourne pas.
		p.setYRot(savedYaw);
		p.setXRot(savedPitch);
		p.yRotO = savedYaw;
		p.xRotO = savedPitch;
	}
}
