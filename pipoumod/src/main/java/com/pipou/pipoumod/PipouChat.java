package com.pipou.pipoumod;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;

/**
 * État + helpers pour le chat custom de PipouMod : horodatage des messages et
 * empilement des doublons (compteur « (xN) »). Utilisé par ChatComponentMixin.
 */
public final class PipouChat {
	private PipouChat() {}

	// Garde de ré-entrée : quand on re-injecte un message décoré, on laisse passer.
	public static volatile boolean reentrant = false;
	// Dernier message BRUT (sans horodatage ni compteur) et son nombre d'occurrences.
	public static String lastKey = null;
	public static int lastCount = 1;
	// Référence exacte du dernier Component ajouté en tête : sert à VÉRIFIER que la ligne
	// [0] est bien celle de lastKey avant d'empiler (sinon un lastKey périmé — toggle
	// stacking, autre serveur — écraserait une ligne de chat sans rapport).
	public static net.minecraft.network.chat.Component lastAdded = null;

	/** Réinitialise l'état d'empilement (à appeler au changement de monde/serveur). */
	public static void reset() { lastKey = null; lastCount = 1; lastAdded = null; }

	private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("HH:mm");
	private static final int PINK = 0xFF7EC9;

	private static final DateTimeFormatter FMT_S = DateTimeFormatter.ofPattern("HH:mm:ss");

	/** Préfixe le message d'un horodatage rose « [HH:mm] » (ou avec secondes). */
	public static Component withTimestamp(Component msg) {
		DateTimeFormatter f = PipouOptions.isEnabled("chat.timestamps.seconds") ? FMT_S : FMT;
		MutableComponent ts = Component.literal("[" + LocalTime.now().format(f) + "] ")
				.withStyle(s -> s.withColor(PINK));
		return Component.empty().append(ts).append(msg);
	}

	/** Suffixe compteur « (xN) » en gris pour les doublons empilés. */
	public static Component counter(int n) {
		return Component.literal("  (x" + n + ")").withStyle(ChatFormatting.GRAY);
	}
}
