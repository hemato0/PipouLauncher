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
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Emojis dans le chat. Deux temps :
 *  - À l'ENVOI ({@link #toChars}) : les raccourcis :nom: sont remplacés par le VRAI caractère
 *    emoji Unicode qui est transmis tel quel. Les autres joueurs SANS le launcher ne voient donc
 *    plus le texte « :nom: » (au pire un carré □ — le vraiment-invisible est impossible côté
 *    vanilla, on ne contrôle pas leur police).
 *  - À l'AFFICHAGE ({@link #process}) : pour NOUS (launcher), chaque caractère emoji (ou :nom:
 *    encore présent) est stylé avec la police bitmap `pipoumod:emoji` -> vraie image.
 * La table nom→codepoint vient de emoji_map.json ; la police des images de font/emoji.json.
 */
public final class PipouEmoji {
	private PipouEmoji() {}

	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "emoji");
	private static final Pattern SHORT = Pattern.compile(":([a-z0-9_]+):");
	private static final Map<String, String> MAP = new HashMap<>();   // nom -> caractère emoji
	private static final Set<Integer> EMOJI_CP = new HashSet<>();      // codepoints emoji connus

	public static void load() {
		try (InputStream in = PipouEmoji.class.getResourceAsStream("/assets/pipoumod/emoji_map.json")) {
			if (in == null) return;
			@SuppressWarnings("unchecked")
			Map<String, Object> raw = new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Map.class);
			if (raw != null) for (Map.Entry<String, Object> e : raw.entrySet())
				if (e.getValue() instanceof Number n) MAP.put(e.getKey(), new String(Character.toChars(n.intValue())));
		} catch (Throwable ignored) {
		}
		for (String v : MAP.values()) if (!v.isEmpty()) EMOJI_CP.add(v.codePointAt(0));
	}

	public static Map<String, String> map() { return MAP; }

	/** ENVOI : remplace :nom: par le vrai caractère emoji (ce qui part sur le réseau). */
	public static String toChars(String msg) {
		if (msg == null || MAP.isEmpty() || msg.indexOf(':') < 0) return msg;
		return replaceShortcodes(msg);
	}

	/** AFFICHAGE : :nom: ET caractères emoji bruts -> images (police pipoumod:emoji). */
	public static Component process(Component in) {
		if (MAP.isEmpty() || !PipouOptions.isEnabled("emoji")) return in;
		String s = in.getString();
		if (!hasKnown(s)) return in;
		// On aplatit via getString() (compatible toutes versions), ce qui PERD les composants
		// interactifs -> on refuse d'aplatir un message qui en contient (ex. [Réclamer] cliquable).
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
		if (s.indexOf(':') >= 0) {
			Matcher m = SHORT.matcher(s);
			while (m.find()) if (MAP.containsKey(m.group(1))) return true;
		}
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			if (EMOJI_CP.contains(cp)) return true;
			i += Character.charCount(cp);
		}
		return false;
	}

	// Découpe le texte (après remplacement des :nom:) en segments : chaque caractère emoji est
	// dessiné avec la police image, le reste garde le style d'origine.
	private static void appendText(String text, Style style, MutableComponent out) {
		String s = replaceShortcodes(text);
		StringBuilder plain = new StringBuilder();
		for (int i = 0; i < s.length(); ) {
			int cp = s.codePointAt(i);
			int cc = Character.charCount(cp);
			if (EMOJI_CP.contains(cp)) {
				if (plain.length() > 0) { out.append(Component.literal(plain.toString()).setStyle(style)); plain.setLength(0); }
				out.append(Component.literal(new String(Character.toChars(cp))).setStyle(style.withFont(FONT)));
			} else {
				plain.append(s, i, i + cc);
			}
			i += cc;
		}
		if (plain.length() > 0) out.append(Component.literal(plain.toString()).setStyle(style));
	}

	private static String replaceShortcodes(String text) {
		if (text.indexOf(':') < 0) return text;
		Matcher m = SHORT.matcher(text);
		StringBuffer sb = new StringBuffer();
		while (m.find()) {
			String e = MAP.get(m.group(1));
			m.appendReplacement(sb, Matcher.quoteReplacement(e != null ? e : m.group()));
		}
		m.appendTail(sb);
		return sb.toString();
	}
}
