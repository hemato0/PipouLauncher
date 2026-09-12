package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouChatCopy;
import com.pipou.pipoumod.PipouOptions;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Ctrl + clic (droit OU gauche) sur un message du chat = copie son texte.
 *
 * Le chat doit être OUVERT (touche T) : un message de l'overlay n'est pas cliquable.
 * On accepte les DEUX boutons car certains mods d'input (malilib, Axiom…) peuvent
 * consommer le clic droit avant nous.
 */
@Mixin(ChatScreen.class)
public class ChatScreenMixin {

	private static final Logger PIPOU_LOG = LoggerFactory.getLogger("pipoumod");

	@Inject(method = "mouseClicked", at = @At("HEAD"), cancellable = true)
	private void pipou$copy(double mx, double my, int button, CallbackInfoReturnable<Boolean> cir) {
		if (!Screen.hasControlDown()) return;          // Ctrl obligatoire
		if (button != 0 && button != 1) return;        // clic gauche OU droit
		if (!PipouOptions.isEnabled("chatcopy")) {
			PIPOU_LOG.info("[copie chat] Ctrl+clic detecte mais l'option 'chatcopy' est desactivee");
			return;
		}
		Minecraft mc = Minecraft.getInstance();
		String s = PipouChatCopy.messageAt(mc, mx, my);
		PIPOU_LOG.info("[copie chat] Ctrl+clic bouton={} en ({},{}) -> {}",
				button, (int) mx, (int) my, (s == null ? "AUCUNE LIGNE TROUVEE" : "ligne trouvee (" + s.length() + " car)"));
		if (mc.player != null) {
			if (s != null && !s.isBlank()) {
				mc.keyboardHandler.setClipboard(s);
				mc.player.displayClientMessage(Component.literal("Message copié ✓ : " + trim(s))
						.withStyle(st -> st.withColor(0xFF7EC9)), false);
			} else {
				mc.player.displayClientMessage(Component.literal("Aucun message sous le curseur (vise le texte d'une ligne).")
						.withStyle(st -> st.withColor(0xFFFFAA66)), false);
			}
		}
		cir.setReturnValue(true); // on consomme le clic dans tous les cas
	}

	private static String trim(String s) {
		s = s.strip();
		return s.length() > 40 ? s.substring(0, 40) + "…" : s;
	}
}
