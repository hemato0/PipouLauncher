package com.pipou.pipoumod.mixin;

import net.minecraft.client.GuiMessage;
import net.minecraft.client.gui.components.ChatComponent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

import java.util.List;

/** Accès aux internes de ChatComponent pour retrouver la ligne de chat sous le curseur (copie). */
@Mixin(ChatComponent.class)
public interface ChatComponentAccessor {
	/** Index de la ligne AFFICHÉE sous (x,y), ou -1. Coordonnées écran (GUI). */
	@Invoker("getMessageLineIndexAt") int pipou$lineAt(double x, double y);

	/** Lignes actuellement affichées (les plus récentes en tête). */
	@Accessor("trimmedMessages") List<GuiMessage.Line> pipou$trimmed();
}
