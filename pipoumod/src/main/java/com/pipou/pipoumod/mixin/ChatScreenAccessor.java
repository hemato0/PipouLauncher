package com.pipou.pipoumod.mixin;

import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.ChatScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Accès au champ de saisie du chat (pour lire le texte en cours quand on ouvre le sélecteur d'emojis). */
@Mixin(ChatScreen.class)
public interface ChatScreenAccessor {
	@Accessor("input") EditBox pipou$input();
}
