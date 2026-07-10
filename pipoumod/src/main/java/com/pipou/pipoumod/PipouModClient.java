package com.pipou.pipoumod;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.KeyMapping;
import org.lwjgl.glfw.GLFW;

/**
 * Entrypoint CLIENT de PipouMod : enregistre la touche Maj droit qui ouvre le
 * mod menu, et branche les overlays HUD.
 */
public class PipouModClient implements ClientModInitializer {

	public static final String CATEGORY = "category.pipoumod";
	private static KeyMapping openMenuKey;

	@Override
	public void onInitializeClient() {
		PipouOptions.load();

		// Touche Maj droit (RIGHT_SHIFT) pour ouvrir le menu.
		openMenuKey = KeyBindingHelper.registerKeyBinding(new KeyMapping(
				"key.pipoumod.open_menu",
				InputConstants.Type.KEYSYM,
				GLFW.GLFW_KEY_RIGHT_SHIFT,
				CATEGORY));

		// À chaque tick client : ouvrir le menu si la touche a été pressée.
		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (openMenuKey.consumeClick()) {
				client.setScreen(new PipouScreen());
			}
			if (client.player != null) PipouTracker.tick(client);
		});

		// Overlays HUD (FPS / coords / keystrokes / horloge).
		PipouHud.register();
	}
}
