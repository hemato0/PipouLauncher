package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouScreenshot;
import net.minecraft.client.Screenshot;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

import java.util.function.Consumer;

/**
 * Enveloppe le consumer du message de capture pour ajouter le bouton « [Copier] »
 * et mémoriser le fichier (voir PipouScreenshot). _grab est le point d'entrée commun
 * des deux surcharges publiques grab(...).
 */
@Mixin(Screenshot.class)
public class ScreenshotMixin {

	@ModifyVariable(
			method = "_grab(Ljava/io/File;Ljava/lang/String;Lcom/mojang/blaze3d/pipeline/RenderTarget;Ljava/util/function/Consumer;)V",
			at = @At("HEAD"),
			argsOnly = true)
	private static Consumer<Component> pipou$wrapConsumer(Consumer<Component> original) {
		return PipouScreenshot.wrap(original);
	}
}
