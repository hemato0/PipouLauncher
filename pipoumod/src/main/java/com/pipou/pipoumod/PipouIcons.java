package com.pipou.pipoumod;

import com.google.gson.Gson;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.resources.ResourceLocation;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Logos des cartes = VRAIES TEXTURES PNG dessinées via {@code GuiGraphics.blit} avec mise à
 * l'échelle. Deux gains vs l'ancienne police bitmap :
 *   - pas de « glyphe manquant » (carré) : on dessine la texture directement ;
 *   - rendu LISSE : le .mcmeta {blur:true} applique un filtrage LINÉAIRE au sampling de la
 *     texture (la police bitmap, elle, reste en plus-proche-voisin = pixelisé).
 * Le blit avec échelle a une signature (ResourceLocation, i,i,i,i, f,f, i,i,i,i) sur
 * 1.20.1–1.21.1 : on la résout par SIGNATURE (invariante au remap intermediary), pas par nom.
 */
public final class PipouIcons {
	private PipouIcons() {}

	private static final int SRC = 128; // côté des PNG source (128×128)
	private static final Map<String, ResourceLocation> TEX = new HashMap<>();
	private static boolean inited = false;
	private static Method mBlit;   // blit(ResourceLocation, x,y,w,h, u,v, rw,rh, tw,th)
	private static Method mColor;  // setColor(float,float,float,float) — teinte optionnelle

	public static void load() {
		try (InputStream in = PipouIcons.class.getResourceAsStream("/assets/pipoumod/icons_map.json")) {
			if (in == null) return;
			@SuppressWarnings("unchecked")
			Map<String, Object> raw = new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Map.class);
			if (raw != null) for (String id : raw.keySet())
				TEX.put(id, PipouRL.of("pipoumod", "textures/gui/icons/" + id + ".png"));
		} catch (Throwable ignored) {}
	}

	private static void initGfx(GuiGraphics g) {
		if (inited) return;
		inited = true;
		for (Method m : g.getClass().getMethods()) {
			Class<?>[] p = m.getParameterTypes();
			if (mBlit == null && p.length == 11 && !p[0].isPrimitive()   // p[0] = ResourceLocation
					&& p[1] == int.class && p[2] == int.class && p[3] == int.class && p[4] == int.class
					&& p[5] == float.class && p[6] == float.class
					&& p[7] == int.class && p[8] == int.class && p[9] == int.class && p[10] == int.class)
				mBlit = m;
			if (mColor == null && m.getReturnType() == void.class && p.length == 4
					&& p[0] == float.class && p[1] == float.class && p[2] == float.class && p[3] == float.class
					&& m.getName().toLowerCase().contains("color"))
				mColor = m;
		}
	}

	/** Dessine le logo `id` centré en (cx,cy), côté `size` px, teinté par `color` (ARGB). */
	public static void draw(GuiGraphics g, String id, int cx, int cy, int size, int color) {
		ResourceLocation rl = TEX.get(id);
		if (rl == null) return;
		initGfx(g);
		if (mBlit == null) return; // version sans ce blit (1.21.2+) : pas de logo plutôt qu'un carré
		int x = cx - size / 2, y = cy - size / 2;
		float r = ((color >> 16) & 0xFF) / 255f, gc = ((color >> 8) & 0xFF) / 255f, b = (color & 0xFF) / 255f;
		try {
			if (mColor != null) mColor.invoke(g, r, gc, b, 1f);   // teinte (PNG blanc -> couleur)
			mBlit.invoke(g, rl, x, y, size, size, 0f, 0f, SRC, SRC, SRC, SRC);
			if (mColor != null) mColor.invoke(g, 1f, 1f, 1f, 1f);  // reset
		} catch (Throwable ignored) {}
	}
}
