package com.pipou.pipoumod;

import com.google.gson.Gson;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.ResourceLocation;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Emojis dans le chat : les raccourcis :nom: (ex :heart:, :fire:) sont remplacés par
 * de VRAIES images (police bitmap Twemoji `pipoumod:emoji`) au moment de l'affichage,
 * en préservant le formatage (couleurs). La table nom→emoji vient de emoji_map.json.
 */
public final class PipouEmoji {
	private PipouEmoji() {}

	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "emoji");
	private static final Pattern SHORT = Pattern.compile(":([a-z0-9_]+):");
	private static final Map<String, String> MAP = new HashMap<>(); // nom -> caractère(s) emoji

	public static void load() {
		try (InputStream in = PipouEmoji.class.getResourceAsStream("/assets/pipoumod/emoji_map.json")) {
			if (in == null) return;
			@SuppressWarnings("unchecked")
			Map<String, Object> raw = new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Map.class);
			if (raw != null) for (Map.Entry<String, Object> e : raw.entrySet())
				if (e.getValue() instanceof Number n) MAP.put(e.getKey(), new String(Character.toChars(n.intValue())));
		} catch (Throwable ignored) {
		}
	}

	public static Map<String, String> map() { return MAP; }

	/** Remplace les :raccourcis: connus par des emojis image (compatible toutes versions :
	 *  on aplatit le message via getString() quand un emoji est présent). */
	public static Component process(Component in) {
		if (MAP.isEmpty() || !PipouOptions.isEnabled("emoji")) return in;
		String s = in.getString();
		if (s.indexOf(':') < 0 || !hasKnown(s)) return in;
		// On aplatit via getString() (compatible toutes versions), ce qui PERD les
		// composants interactifs. On refuse donc d'aplatir un message qui en contient
		// (Click/Hover) — ex. un [Reclamer] cliquable — pour ne pas le rendre inerte.
		// Rare (ces messages contiennent rarement des :raccourcis:) ; reconstruire l'arbre
		// serait fragile multi-version (accès à ComponentContents), on préfère préserver.
		if (hasInteractive(in)) return in;
		MutableComponent out = Component.empty();
		appendText(s, in.getStyle(), out);
		return out;
	}

	/** Vrai si un noeud de l'arbre porte un ClickEvent/HoverEvent (composant interactif). */
	private static boolean hasInteractive(Component c) {
		Style st = c.getStyle();
		if (st != null && (st.getClickEvent() != null || st.getHoverEvent() != null)) return true;
		for (Component sib : c.getSiblings()) if (hasInteractive(sib)) return true;
		return false;
	}

	private static boolean hasKnown(String s) {
		Matcher m = SHORT.matcher(s);
		while (m.find()) if (MAP.containsKey(m.group(1))) return true;
		return false;
	}

	private static void appendText(String text, Style style, MutableComponent out) {
		Matcher m = SHORT.matcher(text);
		int last = 0;
		while (m.find()) {
			String emoji = MAP.get(m.group(1));
			if (emoji == null) continue; // raccourci inconnu : laissé tel quel
			if (m.start() > last) out.append(Component.literal(text.substring(last, m.start())).setStyle(style));
			out.append(Component.literal(emoji).setStyle(style.withFont(FONT)));
			last = m.end();
		}
		if (last < text.length()) out.append(Component.literal(text.substring(last)).setStyle(style));
	}
}
