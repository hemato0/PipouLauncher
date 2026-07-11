package com.pipou.pipoumod;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/**
 * Entrypoint CLIENT de PipouMod : touche Maj droit (mod menu), overlays HUD, chat
 * custom (horodatage / doublons empilés), copie de capture, et présence tab (cœur Pipou).
 */
public class PipouModClient implements ClientModInitializer {

	public static final String CATEGORY = "category.pipoumod";
	private static KeyMapping openMenuKey;
	private static KeyMapping copyShotKey;
	private static KeyMapping zoomKey;

	// État Zoom (FOV) et Luminosité (gamma) pour restaurer la valeur d'origine.
	private static boolean zooming = false;
	private static int savedFov = 70;
	private static boolean brightening = false;
	private static double savedGamma = 0.5;
	private static KeyMapping autoTextKey;
	private static final java.util.Set<Integer> macroDownLast = new java.util.HashSet<>();

	@Override
	public void onInitializeClient() {
		PipouOptions.load();
		PipouEmoji.load();
		PipouIcons.load();

		// URL du service de présence (badge Pipou dans le tab) : lue sans recompiler,
		// via -Dpipou.presence.url=... (le launcher peut l'injecter) ou la variable
		// d'environnement PIPOU_PRESENCE_URL. Vide = seul le joueur local a son cœur.
		String presence = System.getProperty("pipou.presence.url", System.getenv("PIPOU_PRESENCE_URL"));
		PipouPresence.setBackendUrl(presence);

		// Touche Maj droit (RIGHT_SHIFT) pour ouvrir le menu.
		openMenuKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
				"key.pipoumod.open_menu",
				InputConstants.Type.KEYSYM,
				GLFW.GLFW_KEY_RIGHT_SHIFT,
				CATEGORY));

		// Touche « copier la dernière capture » (non liée par défaut).
		copyShotKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
				"key.pipoumod.copy_screenshot",
				InputConstants.Type.KEYSYM,
				GLFW.GLFW_KEY_UNKNOWN,
				CATEGORY));

		// Touche Zoom (maintenir) — défaut C.
		zoomKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
				"key.pipoumod.zoom",
				InputConstants.Type.KEYSYM,
				GLFW.GLFW_KEY_C,
				CATEGORY));

		// Touche pour ouvrir le mini-menu Auto-texte (défaut : point-virgule).
		autoTextKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
				"key.pipoumod.autotext",
				InputConstants.Type.KEYSYM,
				GLFW.GLFW_KEY_SEMICOLON,
				CATEGORY));

		// Commande client /pipoucopyshot (déclenchée par le bouton [Copier] du chat).
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, registry) ->
				dispatcher.register(ClientCommandManager.literal("pipoucopyshot").executes(ctx -> {
					doCopyScreenshot();
					return 1;
				})));

		// Connexion à un monde/serveur : remet la session à zéro.
		ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
			PipouHud.sessionStart = System.currentTimeMillis();
			macroDownLast.clear();
		});

		// À chaque tick client.
		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (openMenuKey.consumeClick()) client.setScreen(new PipouScreen());
			while (copyShotKey.consumeClick()) doCopyScreenshot();
			while (autoTextKey.consumeClick()) client.setScreen(new PipouAutoTextScreen());
			if (client.player != null) {
				PipouTracker.tick(client);
				PipouPresence.tick(client);
				applyAutoSprint(client);
				handleMacros(client);
			}
			applyZoom(client);
			applyBrightness(client);
		});

		// Overlays HUD (FPS / coords / keystrokes / horloge…).
		PipouHud.register();
	}

	/** Copie la dernière capture (thread séparé pour ne pas bloquer le rendu) puis feedback chat. */
	private static void doCopyScreenshot() {
		new Thread(() -> {
			boolean ok = PipouScreenshot.copyLast();
			Minecraft mc = Minecraft.getInstance();
			mc.execute(() -> {
				if (mc.player == null) return;
				mc.player.displayClientMessage(Component.literal(ok
								? "Capture copiée dans le presse-papiers ✓"
								: "Aucune capture récente à copier.")
						.withStyle(s -> s.withColor(ok ? 0xFF7EC9 : 0xFFAA88)), false);
			});
		}, "pipou-copy-screenshot").start();
	}

	/** Zoom : touche maintenue -> FOV réduit ; relâchée -> FOV restauré. */
	private static void applyZoom(Minecraft mc) {
		boolean want = PipouOptions.isEnabled("zoom") && zoomKey.isDown();
		if (want) {
			if (!zooming) { savedFov = mc.options.fov().get(); zooming = true; }
			int level = Math.max(2, (int) PipouOptions.getNum("zoom.level", 3));
			mc.options.fov().set(Math.max(1, savedFov / level));
		} else if (zooming) {
			mc.options.fov().set(savedFov);
			zooming = false;
		}
	}

	/** Auto-sprint : force le sprint quand on avance. */
	private static void applyAutoSprint(Minecraft mc) {
		if (!PipouOptions.isEnabled("autosprint") || mc.player == null) return;
		// keyUp.isDown() = touche avancer : stable sur toutes les versions (player.input a changé en 1.21.5).
		if (mc.options.keyUp.isDown() && !mc.player.isUsingItem())
			mc.player.setSprinting(true);
	}

	/** Auto-texte : détecte l'appui sur la touche assignée d'une macro et envoie son texte. */
	private static void handleMacros(Minecraft mc) {
		if (!PipouOptions.isEnabled("autotext") || mc.screen != null || mc.player == null) { macroDownLast.clear(); return; }
		long win = mc.getWindow().getWindow();
		java.util.Set<Integer> now = new java.util.HashSet<>();
		for (PipouOptions.Macro m : PipouOptions.macros()) {
			int k = m.key();
			if (k < 0) continue;
			boolean down;
			try { down = InputConstants.isKeyDown(win, k); } catch (Throwable e) { down = false; }
			if (down) {
				now.add(k);
				if (!macroDownLast.contains(k)) sendChat(mc, m.text()); // front montant
			}
		}
		macroDownLast.clear();
		macroDownLast.addAll(now);
	}

	private static void sendChat(Minecraft mc, String msg) {
		if (msg == null || msg.isBlank() || mc.player == null || mc.player.connection == null) return;
		String m = msg.trim();
		if (m.startsWith("/")) mc.player.connection.sendCommand(m.substring(1));
		else mc.player.connection.sendChat(m);
	}

	/** Luminosité + : gamma poussé au max vanilla (1.0), restauré quand désactivé. */
	private static void applyBrightness(Minecraft mc) {
		if (PipouOptions.isEnabled("brightness")) {
			if (!brightening) { savedGamma = mc.options.gamma().get(); brightening = true; }
			if (mc.options.gamma().get() < 0.999) mc.options.gamma().set(1.0);
		} else if (brightening) {
			mc.options.gamma().set(savedGamma);
			brightening = false;
		}
	}
}
