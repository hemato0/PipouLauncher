package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouEmoji;
import com.pipou.pipoumod.PipouOptions;
import net.minecraft.client.multiplayer.ClientPacketListener;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/**
 * À l'envoi d'un message de chat, remplace les raccourcis :nom: par le VRAI caractère emoji
 * (transmis tel quel). Les joueurs sans le launcher ne voient donc plus « :nom: ». Non-requis.
 */
@Mixin(ClientPacketListener.class)
public class ClientPacketListenerMixin {

	@ModifyVariable(method = "sendChat(Ljava/lang/String;)V", at = @At("HEAD"), argsOnly = true, ordinal = 0)
	private String pipou$emoji(String msg) {
		return PipouOptions.isEnabled("emoji") ? PipouEmoji.toChars(msg) : msg;
	}
}
