package com.pipou.pipoumod;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

import java.util.List;

/**
 * Mini-menu Auto-texte : liste de LIGNES (texte + touche assignée). Appuyer sur la
 * touche d'une ligne (en jeu) envoie son texte dans le chat (géré par PipouModClient).
 * Ici on crée/édite/supprime les lignes et on assigne les touches.
 */
public class PipouAutoTextScreen extends Screen {

	private static final int C_OVERLAY = 0xCC0E0717, C_PANEL = 0xFF181026, C_HEADER = 0xFF221436;
	private static final int C_CARD = 0xFF221334, C_PINK = 0xFFFF7EC9, C_PINK_DIM = 0x55FF7EC9;
	private static final int C_TEXT = 0xFFF7ECFB, C_MUTED = 0xFFB79FCE, C_PILL = 0xFF2A1A40;
	private static final int C_DARK = 0xFF120A1E, C_INK = 0xFF1A0A16, C_GREEN = 0xFF33C270, C_RED = 0xFFFF5D6C;

	private float sc = 1f;
	private int px, py, pw, ph, listTop, listBottom;
	private int scroll = 0, maxScroll = 0;
	private int editing = -1, capturing = -1;
	private static final int ROW_H = 26;

	public PipouAutoTextScreen() { super(Component.literal("Auto-texte")); }

	@Override public boolean isPauseScreen() { return false; }
	public void renderBackground(GuiGraphics g, int mx, int my, float pt) {}
	public void renderBackground(GuiGraphics g) {}

	private float scale() { return Math.max(0.5f, Math.min(1.1f, 0.62f * this.width / 560f)); }
	private int vw() { return Math.round(this.width / sc); }
	private int vh() { return Math.round(this.height / sc); }

	@Override
	protected void init() {
		sc = scale();
		pw = Math.min(560, vw() - 16);
		ph = Math.min(340, vh() - 16);
		px = (vw() - pw) / 2;
		py = (vh() - ph) / 2;
		listTop = py + 40;
		listBottom = py + ph - 30;
	}

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float pt) {
		sc = scale();
		int mx = (int) (mouseX / sc), my = (int) (mouseY / sc);
		PipouGfx.push(g);
		PipouGfx.scale(g, sc, sc);

		g.fill(0, 0, vw(), vh(), C_OVERLAY);
		g.fill(px, py, px + pw, py + ph, C_PANEL);
		border(g, px, py, pw, ph, C_PINK_DIM);
		g.fill(px, py, px + pw, py + 32, C_HEADER);
		drawHeart(g, px + 11, py + 10, 2, C_PINK);
		draw(g, "Auto-texte", px + 26, py + 7, C_PINK, true);
		draw(g, "touche -> envoie le message", px + 26, py + 18, C_MUTED, false);
		boolean hClose = in(mx, my, px + pw - 28, py + 7, 18, 18);
		g.fill(px + pw - 28, py + 7, px + pw - 10, py + 25, hClose ? 0x66FF5D8F : C_PILL);
		drawC(g, "×", px + pw - 19, py + 12, hClose ? 0xFFFFAAAA : C_TEXT);

		List<PipouOptions.Macro> macros = PipouOptions.macros();
		int contentH = macros.size() * ROW_H;
		maxScroll = Math.max(0, contentH - (listBottom - listTop));
		scroll = Math.max(0, Math.min(scroll, maxScroll));

		g.enableScissor(Math.round((px + 3) * sc), Math.round(listTop * sc), Math.round((px + pw - 3) * sc), Math.round(listBottom * sc));
		for (int i = 0; i < macros.size(); i++) {
			int y = listTop + i * ROW_H - scroll;
			if (y + ROW_H < listTop || y > listBottom) continue;
			row(g, i, macros.get(i), y, mx, my);
		}
		g.disableScissor();
		if (macros.isEmpty())
			drawC(g, "Aucune ligne. Clique « + Ajouter une ligne ».", px + pw / 2, listTop + 16, C_MUTED);

		// Barre du bas : bouton ajouter.
		int by = py + ph - 26;
		boolean hAdd = in(mx, my, px + 12, by, 150, 18);
		g.fill(px + 12, by, px + 162, by + 18, hAdd ? 0x3333C270 : C_PILL);
		border(g, px + 12, by, 150, 18, C_GREEN);
		drawC(g, "+ Ajouter une ligne", px + 87, by + 5, C_GREEN);
		draw(g, "Astuce : commence par / pour une commande.", px + 172, by + 5, C_MUTED, false);

		PipouGfx.pop(g);
	}

	private void row(GuiGraphics g, int i, PipouOptions.Macro m, int y, int mx, int my) {
		g.fill(px + 12, y + 2, px + pw - 12, y + ROW_H - 2, C_CARD);
		// champ texte
		int tx = px + 16, tw = pw - 200;
		boolean ed = editing == i;
		g.fill(tx, y + 4, tx + tw, y + 20, C_DARK);
		border(g, tx, y + 4, tw, 16, ed ? C_PINK : C_PINK_DIM);
		String txt = m.text().isEmpty() && !ed ? "(clique et tape ton texte)" : m.text() + (ed ? "_" : "");
		draw(g, clip(txt, tw - 8), tx + 4, y + 8, m.text().isEmpty() && !ed ? C_MUTED : C_TEXT, false);
		// bouton touche
		int kx = px + pw - 176, kw = 120;
		boolean cap = capturing == i;
		g.fill(kx, y + 4, kx + kw, y + 20, cap ? 0x44FF7EC9 : C_PILL);
		border(g, kx, y + 4, kw, 16, cap ? C_PINK : C_PINK_DIM);
		String kn = cap ? "Appuie sur une touche..." : "Touche : " + keyName(m.key());
		drawC(g, clip(kn, kw - 6), kx + kw / 2, y + 8, cap ? C_PINK : C_TEXT);
		// supprimer
		int dx = px + pw - 50;
		boolean hDel = in(mx, my, dx, y + 4, 30, 16);
		g.fill(dx, y + 4, dx + 30, y + 20, hDel ? 0x44FF5D6C : C_PILL);
		drawC(g, "×", dx + 15, y + 8, hDel ? C_RED : C_MUTED);
	}

	public boolean mouseScrolled(double mxr, double myr, double dx, double dy) {
		int my = (int) (myr / sc);
		if (my >= listTop && my <= listBottom) { scroll = Math.max(0, Math.min(scroll - (int) (dy * 24), maxScroll)); return true; }
		return false;
	}
	public boolean mouseScrolled(double mxr, double myr, double amount) {
		return mouseScrolled(mxr, myr, 0, amount);
	}

	@Override
	public boolean mouseClicked(double mxr, double myr, int button) {
		if (button != 0) return false;
		int mx = (int) (mxr / sc), my = (int) (myr / sc);
		if (in(mx, my, px + pw - 28, py + 7, 18, 18)) { this.onClose(); return true; }
		if (in(mx, my, px + 12, py + ph - 26, 150, 18)) { PipouOptions.macroAdd(); editing = PipouOptions.macros().size() - 1; capturing = -1; return true; }

		editing = -1; capturing = -1;
		if (my < listTop || my > listBottom) return true;
		List<PipouOptions.Macro> macros = PipouOptions.macros();
		for (int i = 0; i < macros.size(); i++) {
			int y = listTop + i * ROW_H - scroll;
			if (y + ROW_H < listTop || y > listBottom) continue;
			if (in(mx, my, px + 16, y + 4, pw - 200, 16)) { editing = i; return true; }
			if (in(mx, my, px + pw - 176, y + 4, 120, 16)) { capturing = i; return true; }
			if (in(mx, my, px + pw - 50, y + 4, 30, 16)) { PipouOptions.macroRemove(i); return true; }
		}
		return true;
	}

	@Override
	public boolean charTyped(char c, int mods) {
		if (editing >= 0 && c >= 32) {
			String v = PipouOptions.macros().get(editing).text();
			if (v.length() < 128) PipouOptions.macroText(editing, v + c);
			return true;
		}
		return super.charTyped(c, mods);
	}

	@Override
	public boolean keyPressed(int key, int scan, int mods) {
		if (capturing >= 0) {
			if (key != 256) PipouOptions.macroKey(capturing, key); // Échap = annuler
			capturing = -1;
			return true;
		}
		if (editing >= 0) {
			if (key == 259) { String v = PipouOptions.macros().get(editing).text(); if (!v.isEmpty()) PipouOptions.macroText(editing, v.substring(0, v.length() - 1)); return true; }
			if (key == 256 || key == 257 || key == 335) { editing = -1; return true; }
			return true;
		}
		if (key == 256) { this.onClose(); return true; }
		return super.keyPressed(key, scan, mods);
	}

	private static String keyName(int key) {
		if (key < 0) return "aucune";
		try { return InputConstants.Type.KEYSYM.getOrCreate(key).getDisplayName().getString(); }
		catch (Throwable e) { return "?"; }
	}
	private String clip(String s, int maxPx) {
		if (tw(s) <= maxPx) return s;
		while (s.length() > 1 && tw(s + "...") > maxPx) s = s.substring(0, s.length() - 1);
		return s + "...";
	}

	// --- police + helpers ---
	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "pipou");
	private Component T(String s) { return Component.literal(s).withStyle(st -> st.withFont(FONT)); }
	private int tw(String s) { return this.font.width(T(s)); }
	private void draw(GuiGraphics g, String s, int x, int y, int color, boolean shadow) { g.drawString(this.font, T(s), x, y, color, shadow); }
	private void drawC(GuiGraphics g, String s, int cx, int y, int color) { Component c = T(s); g.drawString(this.font, c, cx - this.font.width(c) / 2, y, color, false); }
	private static boolean in(int mx, int my, int x, int y, int w, int h) { return mx >= x && mx < x + w && my >= y && my < y + h; }
	private static void border(GuiGraphics g, int x, int y, int w, int h, int c) {
		g.fill(x, y, x + w, y + 1, c); g.fill(x, y + h - 1, x + w, y + h, c);
		g.fill(x, y, x + 1, y + h, c); g.fill(x + w - 1, y, x + w, y + h, c);
	}
	// Cœur en TEXTURE lisse (blit), décalé de +2px à droite.
	private static final ResourceLocation HEART_PINK = PipouRL.of("pipoumod", "textures/gui/icons/heart.png");
	private static void drawHeart(GuiGraphics g, int x, int y, int s, int color) {
		PipouIcons.drawTex(g, HEART_PINK, x + (7 * s) / 2 + 2, y + (6 * s) / 2, 6 * s + 1, 0xFFFFFFFF);
	}
}
