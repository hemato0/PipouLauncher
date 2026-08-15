package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouOptions;
import com.pipou.pipoumod.PipouZoom;
import net.minecraft.client.Camera;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Zoom LISSE : multiplie le FOV du monde par le facteur interpolé PAR FRAME
 * ({@link PipouZoom}). Appliqué seulement au FOV « réglable » (useFovSetting) pour ne
 * pas déformer la main / les effets. Non-requis : si une version renomme/déplace getFov,
 * le mixin ne s'applique pas (le zoom est simplement inactif sur cette version).
 */
@Mixin(GameRenderer.class)
public class GameRendererMixin {

	@Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
	private void pipou$zoom(Camera camera, float partialTicks, boolean useFovSetting, CallbackInfoReturnable<Double> cir) {
		if (!useFovSetting) return;                    // seulement le FOV du monde
		if (!PipouOptions.isEnabled("zoom")) return;
		double f = PipouZoom.factor();
		if (f < 0.9999) cir.setReturnValue(cir.getReturnValue() * f);
	}
}
