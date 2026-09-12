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
			List<GuiMessage.Line> lines = acc.pipou$trimmed();
			if (lines == null || lines.isEmpty()) return null;

			// 1) Méthode vanilla (précise quand elle marche).
			int idx = -1;
			try { idx = acc.pipou$lineAt(mx, my); } catch (Throwable ignored) {}

			// 2) Repli GÉOMÉTRIQUE : sur certaines versions getMessageLineIndexAt renvoie -1 même
			//    en visant une ligne. On recalcule l'index avec la même formule que vanilla, mais
			//    SANS la borne « lignes par page » -> plus tolérant.
			if (idx < 0) {
				try {
					double scale = chat.getScale();
					double spacing = mc.options.chatLineSpacing().get() + 1.0;
					// HAUTEUR DE LIGNE : vanilla = (int)(9 * (interligne + 1)). L'oublier donnait un
					// index ~9x trop grand -> aucune ligne trouvée. Même formule que screenToChatY.
					int lineH = Math.max(1, (int) (9.0 * spacing));
					int guiH = mc.getWindow().getGuiScaledHeight();
					double e = (guiH - my - 40.0) / (scale * lineH);
					if (e >= 0) {
						int j = (int) Math.floor(e) + acc.pipou$scrollPos();
						if (j >= 0 && j < lines.size()) idx = j;
					}
				} catch (Throwable ignored) {}
			}

			if (idx < 0 || idx >= lines.size()) return null;
			FormattedCharSequence fcs = lines.get(idx).content();
			StringBuilder sb = new StringBuilder();
			fcs.accept((i, style, cp) -> { sb.appendCodePoint(cp); return true; });
			return sb.toString();
		} catch (Throwable e) {
			return null; // internes absents/différents sur une version : pas de copie, pas de crash
		}
	}
}
