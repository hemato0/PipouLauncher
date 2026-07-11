package com.pipou.pipoumod;

import com.google.gson.Gson;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Logos des cartes = VRAIES IMAGES (PNG couleur) rendues via une POLICE BITMAP
 * (pipoumod:icons) avec drawString + pose. Aucune utilisation de GuiGraphics.blit
 * (dont la signature change entre versions) -> compile et fonctionne sur toutes les
 * versions 1.21.x et au-delà. Table id->glyphe dans icons_map.json.
 */
public final class PipouIcons {
	private PipouIcons() {}

	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "icons");
	private static final Map<String, String> MAP = new HashMap<>(); // id -> caractère glyphe
	private static final float BASE = 13f; // hauteur d'un glyphe dans icons.json

	public static void load() {
		try (InputStream in = PipouIcons.class.getResourceAsStream("/assets/pipoumod/icons_map.json")) {
			if (in == null) return;
			@SuppressWarnings("unchecked")
			Map<String, Object> raw = new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Map.class);
			if (raw != null) for (Map.Entry<String, Object> e : raw.entrySet())
				if (e.getValue() instanceof Number n) MAP.put(e.getKey(), new String(Character.toChars(n.intValue())));
		} catch (Throwable ignored) {
		}
	}

	/** Dessine le logo `id` centré en (cx,cy), hauteur ~= size. */
	public static void draw(GuiGraphics g, String id, int cx, int cy, int size) {
		String ch = MAP.get(id);
		if (ch == null) return;
		Minecraft mc = Minecraft.getInstance();
		Component glyph = Component.literal(ch).withStyle(s -> s.withFont(FONT));
		float scale = size / BASE;
		PipouGfx.push(g);
		PipouGfx.translate(g, cx, cy);
		PipouGfx.scale(g, scale, scale);
		int w = mc.font.width(glyph);
		g.drawString(mc.font, glyph, -w / 2, Math.round(-BASE / 2f), 0xFFFFFFFF, false);
		PipouGfx.pop(g);
	}
}
