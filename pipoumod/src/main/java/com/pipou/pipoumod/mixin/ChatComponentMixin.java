package com.pipou.pipoumod.mixin;

import com.pipou.pipoumod.PipouChat;
import com.pipou.pipoumod.PipouEmoji;
import com.pipou.pipoumod.PipouOptions;
import net.minecraft.client.GuiMessage;
import net.minecraft.client.GuiMessageTag;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MessageSignature;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.List;

/**
 * Chat custom PipouMod : horodatage « [HH:mm] » + empilement des doublons « (xN) ».
 * Point d'entrée unique de tous les messages : addMessage(Component, MessageSignature,
 * GuiMessageTag). allMessages[0] = message le plus récent (le jeu insère en tête).
 */
@Mixin(ChatComponent.class)
public class ChatComponentMixin {

	@Shadow @Final private List<GuiMessage> allMessages;
	@Shadow private void refreshTrimmedMessages() { throw new AssertionError(); }

	@Inject(
			method = "addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/GuiMessageTag;)V",
			at = @At("HEAD"),
			cancellable = true)
	private void pipou$chat(Component component, MessageSignature sig, GuiMessageTag tag, CallbackInfo ci) {
		if (PipouChat.reentrant) return; // notre propre ré-ajout décoré : laisser passer tel quel

		boolean chat = PipouOptions.isEnabled("chat");
		boolean ts = chat && PipouOptions.isEnabled("chat.timestamps");
		boolean stack = chat && PipouOptions.isEnabled("chat.stacking");
		boolean emoji = PipouOptions.isEnabled("emoji");
		if (!ts && !stack && !emoji) return;

		Component base = emoji ? PipouEmoji.process(component) : component;
		Component decorated = ts ? PipouChat.withTimestamp(base) : base;
		String key = component.getString(); // clé BRUTE (ni horodatage ni compteur)

		// Doublon consécutif : on empile sur le dernier message (compteur), pas de nouvelle
		// ligne. Garde d'identité : la ligne [0] DOIT être exactement celle qu'on a ajoutée
		// en dernier (lastAdded) — sinon un lastKey périmé (toggle stacking, autre serveur)
		// écraserait une ligne de chat sans rapport dont le texte coïncide par hasard.
		if (stack && key.equals(PipouChat.lastKey) && !this.allMessages.isEmpty()
				&& this.allMessages.get(0).content() == PipouChat.lastAdded) {
			PipouChat.lastCount++;
			Component counted = Component.empty().append(decorated).append(PipouChat.counter(PipouChat.lastCount));
			int addedTime = this.allMessages.get(0).addedTime();
			this.allMessages.set(0, new GuiMessage(addedTime, counted, sig, tag));
			PipouChat.lastAdded = counted;
			this.refreshTrimmedMessages(); // reconstruit les lignes affichées depuis allMessages
			ci.cancel();
			return;
		}

		// Message neuf : on mémorise, et si un rendu a changé (horodatage/emoji) on ré-ajoute.
		PipouChat.lastKey = key;
		PipouChat.lastCount = 1;
		if (ts || emoji) {
			PipouChat.reentrant = true;
			try {
				((ChatComponent) (Object) this).addMessage(decorated, sig, tag);
			} finally {
				PipouChat.reentrant = false;
			}
			PipouChat.lastAdded = decorated; // la ligne [0] ajoutée par le jeu == decorated
			ci.cancel();
		} else {
			// stacking ON, horodatage/emoji OFF : le jeu ajoute l'original -> c'est notre dernier.
			PipouChat.lastAdded = component;
		}
	}
}
