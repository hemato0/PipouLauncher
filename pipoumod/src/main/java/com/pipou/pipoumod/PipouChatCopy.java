package com.pipou.pipoumod;

import com.pipou.pipoumod.mixin.ChatComponentAccessor;
import net.minecraft.client.GuiMessage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.util.FormattedCharSequence;

import java.util.List;

/** Copie du texte d'une ligne de chat sous le curseur (Ctrl+clic droit). */
public final class PipouChatCopy {
	private PipouChatCopy() {}

	/** Texte de la ligne de chat sous (mx,my) en coordonnées écran, ou null si aucune. */
	public static String messageAt(Minecraft mc, double mx, double my) {
		try {
			ChatComponent chat = mc.gui.getChat();
			ChatComponentAccessor acc = (ChatComponentAccessor) (Object) chat;
			int idx = acc.pipou$lineAt(mx, my);
			if (idx < 0) return null;
			List<GuiMessage.Line> lines = acc.pipou$trimmed();
			if (idx >= lines.size()) return null;
			FormattedCharSequence fcs = lines.get(idx).content();
			StringBuilder sb = new StringBuilder();
			fcs.accept((i, style, cp) -> { sb.appendCodePoint(cp); return true; });
			return sb.toString();
		} catch (Throwable e) {
			return null; // internes absents/différents sur une version : pas de copie, pas de crash
		}
	}
}
