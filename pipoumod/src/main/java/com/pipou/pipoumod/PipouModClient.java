package com.pipou.pipoumod;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
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
			PipouChat.reset(); // repart à zéro pour l'empilement des doublons (autre serveur)
		});

		// Fermeture du jeu : restaure le gamma d'origine AVANT que options.txt ne soit
		// sauvegardé (sinon la « Luminosité + » figerait le gamma de l'utilisateur à 1.0).
		ClientLifecycleEvents.CLIENT_STOPPING.register(PipouModClient::restoreBrightnessOnStop);

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
			applyHitboxes(client);
		});

		// Bouton « PipouMod » ajouté à l'écran de PAUSE (Échap) -> ouvre le mod menu.
		ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
			if (screen instanceof PauseScreen) {
				Button b = Button.builder(Component.literal("PipouMod"),
						btn -> client.setScreen(new PipouScreen()))
						.bounds(w - 96, 6, 90, 20).build();
				Screens.getButtons(screen).add(b);
			}
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

	// Zoom LISSE : le FOV interpole progressivement vers la cible (anti « violent »), et on
	// écrit la valeur BRUTE pour descendre SOUS 30 (zoom plus loin, le set() clampe à [30,110]).
	private static double zoomCur = 0, zoomSavedFov = 0;
	private static boolean zoomActive = false;
	private static void applyZoom(Minecraft mc) {
		boolean want = PipouOptions.isEnabled("zoom") && zoomKey.isDown();
		if (want && !zoomActive) { zoomSavedFov = mc.options.fov().get(); zoomCur = zoomSavedFov; zoomActive = true; }
		if (!zoomActive) return; // ni zoom ni animation de retour -> on ne touche pas au FOV
		double level = Math.max(1.5, PipouOptions.getNum("zoom.level", 3)); // + level grand = + on zoome loin
		double target = want ? zoomSavedFov / level : zoomSavedFov;
		zoomCur += (target - zoomCur) * 0.30; // interpolation PROGRESSIVE (30%/tick)
		if (!want && Math.abs(zoomCur - zoomSavedFov) < 0.5) { // retour terminé -> on rend la main
			setFovRaw(mc, zoomSavedFov); zoomActive = false; return;
		}
		setFovRaw(mc, zoomCur);
	}

	// Force le FOV (OptionInstance<Integer>) en écrivant le champ interne (set() clampe [30,110]).
	// Champ repéré par sa VALEUR = FOV courant (indépendant du nom remappé). Repli set() clampé.
	private static void setFovRaw(Minecraft mc, double value) {
		int iv = (int) Math.round(value), cur = mc.options.fov().get();
		Object opt = mc.options.fov();
		boolean done = false;
		for (java.lang.reflect.Field f : opt.getClass().getDeclaredFields()) {
			try {
				f.setAccessible(true);
				Object v = f.get(opt);
				if (v instanceof Integer d && d == cur) {
					f.set(opt, iv);
					if (mc.options.fov().get() == iv) { done = true; break; }
					f.set(opt, cur);
				}
			} catch (Throwable ignored) {}
		}
		if (!done) { try { mc.options.fov().set(Math.max(30, iv)); } catch (Throwable ignored) {} }
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

	// Valeur « fullbright » : gamma poussé BIEN au-delà du max vanilla (1.0) pour voir dans
	// le noir total. On considère tout gamma ≥ 5 comme « déjà le nôtre » (pour ne pas
	// mémoriser notre propre valeur comme l'originale de l'utilisateur).
	private static final double FULLBRIGHT = 15.0;

	/** Luminosité + : gamma poussé en fullbright (contourne le clamp [0,1] de set()). */
	private static void applyBrightness(Minecraft mc) {
		double cur = mc.options.gamma().get();
		if (PipouOptions.isEnabled("brightness")) {
			if (!brightening) {
				// Mémorise le gamma d'origine SEULEMENT si ce n'est pas déjà le nôtre (≥5).
				if (cur < 5.0) PipouOptions.setNum("brightness.gamma0", cur);
				savedGamma = PipouOptions.getNum("brightness.gamma0", 0.5);
				brightening = true;
			}
			// set() clampe à [0,1] (OptionInstance.UnitDouble) -> on écrit la valeur BRUTE
			// dans le champ interne de l'OptionInstance pour dépasser 1.0 (vrai fullbright).
			if (cur < 5.0) setGammaRaw(mc, FULLBRIGHT);
		} else if (brightening) {
			setGammaRaw(mc, PipouOptions.getNum("brightness.gamma0", savedGamma));
			brightening = false;
		}
	}

	// Force la valeur du gamma en écrivant DIRECTEMENT le champ de l'OptionInstance (le
	// set() public clampe à [0,1]). On repère le champ par sa VALEUR (= gamma actuel),
	// donc indépendant du NOM remappé en jeu. Repli sur set() clampé si la réflexion rate.
	private static void setGammaRaw(Minecraft mc, double value) {
		Object opt = mc.options.gamma();
		double cur = mc.options.gamma().get();
		boolean done = false;
		for (java.lang.reflect.Field f : opt.getClass().getDeclaredFields()) {
			try {
				f.setAccessible(true);
				Object v = f.get(opt);
				if (v instanceof Double d && d == cur) {
					f.set(opt, value);
					// Confirme qu'on a touché le BON champ (celui que get() lit) et pas un
					// homonyme (ex. initialValue = même valeur par défaut) : sinon on annule.
					if (mc.options.gamma().get() == value) { done = true; break; }
					f.set(opt, cur);
				}
			} catch (Throwable ignored) {}
		}
		if (!done) { try { mc.options.gamma().set(value); } catch (Throwable ignored) {} }
	}

	/** Restaure le gamma d'origine à la fermeture (sinon options.txt garderait le fullbright). */
	public static void restoreBrightnessOnStop(Minecraft mc) {
		if (brightening) {
			try { setGammaRaw(mc, PipouOptions.getNum("brightness.gamma0", savedGamma)); } catch (Throwable ignored) {}
			brightening = false;
		}
	}

	/** Hitbox : affiche les boîtes de collision des entités (comme F3+B). On n'écrit le champ
	 * QUE sur TRANSITION de l'option (sinon on écraserait le F3+B vanilla à chaque tick). */
	private static boolean hitboxApplied = false;
	private static void applyHitboxes(Minecraft mc) {
		boolean want = PipouOptions.isEnabled("hitbox");
		if (want == hitboxApplied) return; // rien changé -> laisse F3+B piloter entre-temps
		try { mc.getEntityRenderDispatcher().setRenderHitBoxes(want); hitboxApplied = want; }
		catch (Throwable ignored) { /* méthode absente sur une version : sans effet */ }
	}
}
