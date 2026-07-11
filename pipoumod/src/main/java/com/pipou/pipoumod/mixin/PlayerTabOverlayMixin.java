package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouOptions;
import com.pipou.pipoumod.PipouPresence;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Ajoute un cœur rose devant le nom des joueurs qui utilisent PipouLauncher dans la
 * liste des joueurs (tab), façon Feather. getNameForDisplay est le point unique qui
 * produit le nom affiché de chaque joueur.
 */
@Mixin(PlayerTabOverlay.class)
public class PlayerTabOverlayMixin {

	@Inject(method = "getNameForDisplay", at = @At("RETURN"), cancellable = true)
	private void pipou$badge(PlayerInfo info, CallbackInfoReturnable<Component> cir) {
		if (!PipouOptions.isEnabled("tabbadge")) return;
		if (info == null || info.getProfile() == null) return;
		if (!PipouPresence.isPipou(info.getProfile().getId())) return;
		Component name = cir.getReturnValue();
		if (name == null) return;
		Component heart = Component.literal("♥ ").withStyle(s -> s.withColor(0xFF7EC9));
		cir.setReturnValue(Component.empty().append(heart).append(name));
	}
}
