package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouChatCopy;
import com.pipou.pipoumod.PipouOptions;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Ctrl + clic droit sur un message du chat = copie son texte dans le presse-papiers. */
@Mixin(ChatScreen.class)
public class ChatScreenMixin {

	@Inject(method = "mouseClicked", at = @At("HEAD"), cancellable = true)
	private void pipou$copy(double mx, double my, int button, CallbackInfoReturnable<Boolean> cir) {
		if (button != 1 || !Screen.hasControlDown()) return; // clic droit + Ctrl
		if (!PipouOptions.isEnabled("chatcopy")) return;
		Minecraft mc = Minecraft.getInstance();
		String s = PipouChatCopy.messageAt(mc, mx, my);
		if (s != null && !s.isBlank()) {
			mc.keyboardHandler.setClipboard(s);
			if (mc.player != null)
				mc.player.displayClientMessage(Component.literal("Message copié ✓").withStyle(st -> st.withColor(0xFF7EC9)), true);
			cir.setReturnValue(true);
		}
	}
}
