package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouFreelook;
import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/**
 * Freelook — réorientation de la caméra. setRotation(yaw, pitch) est appelé par Camera.setup
 * chaque frame avec l'orientation du joueur. Quand la freelook est active, on remplace ces deux
 * arguments par l'orientation libre : la caméra ET le calcul de position 3e personne (qui lit la
 * rotation juste après) utilisent alors les angles libres -> correct en 1re ET 3e personne.
 *
 * Cible setRotation(FF)V : la signature (deux float) est INVARIANTE entre versions ; seul le nom
 * est remappé (géré par Loom). Non-requis : sans effet si absent.
 */
@Mixin(Camera.class)
public class CameraMixin {

	@ModifyVariable(method = "setRotation(FF)V", at = @At("HEAD"), argsOnly = true, ordinal = 0)
	private float pipou$yaw(float yaw) {
		return PipouFreelook.isActive() ? PipouFreelook.yaw() : yaw;
	}

	@ModifyVariable(method = "setRotation(FF)V", at = @At("HEAD"), argsOnly = true, ordinal = 1)
	private float pipou$pitch(float pitch) {
		return PipouFreelook.isActive() ? PipouFreelook.pitch() : pitch;
	}
}
