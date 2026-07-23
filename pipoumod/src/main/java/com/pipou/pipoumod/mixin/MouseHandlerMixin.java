package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouModClient;
import com.pipou.pipoumod.PipouOptions;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Molette = réglage de la DISTANCE de zoom en temps réel, uniquement quand la touche zoom
 * est maintenue (sinon la molette garde son rôle vanilla : changer d'emplacement de barre).
 * On modifie zoom.level (lu chaque tick par PipouModClient.applyZoom) puis on annule
 * l'événement pour ne pas aussi faire défiler la hotbar.
 *
 * Non-requis (defaultRequire:0) : si une version renomme onScroll, le mixin ne s'applique
 * simplement pas — pas de crash.
 */
@Mixin(MouseHandler.class)
public class MouseHandlerMixin {

	@Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
	private void pipou$scrollZoom(long window, double xOffset, double yOffset, CallbackInfo ci) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.screen != null) return;                       // menu ouvert -> molette normale
		if (!PipouOptions.isEnabled("zoom")) return;
		if (!PipouModClient.isZoomKeyDown()) return;         // zoom non maintenu -> molette normale
		if (yOffset == 0) return;                            // scroll horizontal pur -> on ne touche pas au zoom
		double lvl = PipouOptions.getNum("zoom.level", 3);
		lvl += (yOffset > 0 ? 0.5 : -0.5);                   // molette haut = zoom + loin
		lvl = Math.max(1.5, Math.min(30.0, lvl));
		PipouOptions.setNum("zoom.level", lvl);
		ci.cancel();
	}
}
