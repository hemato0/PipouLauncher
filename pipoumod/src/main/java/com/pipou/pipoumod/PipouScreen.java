package com.pipou.pipoumod;

import com.pipou.pipoumod.PipouModules.Module;
import com.pipou.pipoumod.PipouModules.Opt;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Mod menu EN JEU de PipouMod — piloté par PipouModules (cartes = modules à sous-options
 * regroupées). Design MAISON compact, échelle interne fixe, logos images, police Poppins.
 * La roue ⚙ ouvre les sous-paramètres (bascules, sliders, champs texte).
 */
public class PipouScreen extends Screen {

	private static final String[] TABS = {"Tout", "HUD", "PvP", "Rendu", "Chat", "Tab", "Favoris"};

	// Fond SEMI-TRANSPARENT (on revoit le jeu derrière). Sûr désormais : le menu n'utilise
	// PLUS aucune police détournable par le serveur (texte en Poppins réel depuis le fix
	// PipouRL, symboles Poppins, roue + cœurs en primitives/textures) -> aucun glyphe-image
	// du pack serveur ne peut se déclencher, donc plus de « menus dorés » qui transparaissent.
	private static final int C_OVERLAY = 0xCC0E0717, C_PANEL = 0xFF181026, C_HEADER = 0xFF221436;
	private static final int C_CARD = 0xFF221334, C_CARD_HOVER = 0xFF2C1A44, C_PINK = 0xFFFF7EC9;
	private static final int C_PINK_DIM = 0x55FF7EC9, C_PURPLE = 0xFFA855F7, C_TEXT = 0xFFF7ECFB;
	private static final int C_MUTED = 0xFFB79FCE, C_GREEN = 0xFF33C270, C_GREY = 0x33FFFFFF;
	private static final int C_INK = 0xFF1A0A16, C_PILL = 0xFF2A1A40, C_DARK = 0xFF120A1E;

	private static final int PANEL_W = 600, GAP = 8, CARD_H = 74, HEAD_H = 34, TABS_Y = 40, GRID_Y = 62;

	private float sc = 1f;
	private int px, py, pw, ph, gridTop, gridBottom, cols, cardW, searchX, searchW;
	private int scroll = 0, maxScroll = 0, setScroll = 0, setMax = 0;
	private String tab = "Tout", settingsOf = null, searchQuery = "", editingKey = null;
	private boolean searchFocused = false;

	public PipouScreen() { super(Component.literal("PipouMod")); }

	@Override public boolean isPauseScreen() { return false; }
	// Deux surcharges (pas de @Override) : 1.20.2+/1.21 = 4 args, 1.20.1 = 1 arg. Vide = pas de flou.
	public void renderBackground(GuiGraphics g, int mx, int my, float pt) {}
	public void renderBackground(GuiGraphics g) {}

	private float scale() { return Math.max(0.5f, Math.min(1.1f, 0.62f * this.width / PANEL_W)); }
	private int vw() { return Math.round(this.width / sc); }
	private int vh() { return Math.round(this.height / sc); }

	@Override
	protected void init() {
		sc = scale();
		pw = Math.min(PANEL_W, vw() - 16);
		ph = Math.min(360, vh() - 16);
		px = (vw() - pw) / 2;
		py = (vh() - ph) / 2;
		searchW = Math.min(140, pw / 4);
		searchX = px + pw - 8 - searchW;
		gridTop = py + GRID_Y;
		gridBottom = py + ph - 8;
		int contentW = pw - 18;
		cols = contentW >= 500 ? 4 : contentW >= 360 ? 3 : 2;
		cardW = (contentW - (cols - 1) * GAP) / cols;
	}

	private List<Module> visible() {
		String q = searchQuery.trim().toLowerCase();
		List<Module> out = new ArrayList<>();
		for (Module m : PipouModules.MODULES) {
			if (!tab.equals("Tout") && !tab.equals("Favoris") && !m.category().equals(tab)) continue;
			if (tab.equals("Favoris") && !PipouOptions.isFavorite(m.id())) continue;
			if (!q.isEmpty() && !m.label().toLowerCase().contains(q)) continue;
			out.add(m);
		}
		return out;
	}

	private int cardX(int i) { return px + 9 + (i % cols) * (cardW + GAP); }
	private int cardYRaw(int i) { return gridTop + (i / cols) * (CARD_H + GAP); }

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
		sc = scale();
		int mx = (int) (mouseX / sc), my = (int) (mouseY / sc);
		Minecraft mc = Minecraft.getInstance();

		PipouGfx.push(g);
		PipouGfx.scale(g, sc, sc);

		g.fill(0, 0, vw(), vh(), C_OVERLAY);
		int R = 9;
		roundBox(g, px, py, pw, ph, R, C_PANEL, C_PINK_DIM);                 // panneau arrondi + bord
		roundRectTop(g, px + 1, py + 1, pw - 2, HEAD_H, R - 1, C_HEADER);     // en-tête, haut arrondi
		drawHeart(g, px + 11, py + 11, 2, C_PINK);
		draw(g, "PipouMod", px + 26, py + 7, C_PINK, true);
		draw(g, "Mod Menu", px + 26, py + 18, C_MUTED, false);
		String clock = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"));
		int cw = tw(clock) + 18, cx0 = px + pw / 2 - cw / 2;
		roundBox(g, cx0, py + 8, cw, 18, 8, C_PILL, C_PINK_DIM);             // horloge = pilule
		draw(g, clock, cx0 + 9, py + 13, C_TEXT, false);
		String pn = mc.player != null ? mc.player.getGameProfile().getName() : "Joueur";
		int nx = px + pw - 36 - tw(pn);
		drawHeart(g, nx - 13, py + 11, 2, C_PURPLE);
		draw(g, pn, nx, py + 13, C_TEXT, false);
		boolean hClose = in(mx, my, px + pw - 28, py + 8, 18, 18);
		roundRect(g, px + pw - 28, py + 8, 18, 18, 6, hClose ? 0x66FF5D8F : C_PILL); // croix ronde
		drawC(g, "×", px + pw - 19, py + 13, hClose ? 0xFFFFAAAA : C_TEXT);

		if (settingsOf != null) { renderSettings(g, mx, my); PipouGfx.pop(g); return; }

		int tx = px + 9;
		for (String t : TABS) {
			int tw = tw(t) + 16;
			if (tx + tw > searchX - 6) break;
			boolean on = t.equals(tab), h = in(mx, my, tx, py + TABS_Y, tw, 18);
			roundRect(g, tx, py + TABS_Y, tw, 18, 6, on ? C_PINK : (h ? 0x33FF7EC9 : C_PILL));
			drawC(g, t, tx + tw / 2, py + TABS_Y + 5, on ? C_INK : C_TEXT);
			tx += tw + 5;
		}
		roundBox(g, searchX, py + TABS_Y, searchW, 18, 6, C_DARK, searchFocused ? C_PINK : C_PINK_DIM);
		String shown = searchQuery.isEmpty() ? "Rechercher..." : searchQuery + (searchFocused ? "_" : "");
		draw(g, shown, searchX + 6, py + TABS_Y + 5, searchQuery.isEmpty() ? C_MUTED : C_TEXT, false);

		List<Module> list = visible();
		int rows = (list.size() + cols - 1) / cols, contentH = rows * (CARD_H + GAP);
		maxScroll = Math.max(0, contentH - (gridBottom - gridTop));
		scroll = Math.max(0, Math.min(scroll, maxScroll));
		g.enableScissor(Math.round((px + 3) * sc), Math.round(gridTop * sc), Math.round((px + pw - 3) * sc), Math.round(gridBottom * sc));
		for (int i = 0; i < list.size(); i++) {
			int x = cardX(i), y = cardYRaw(i) - scroll;
			if (y + CARD_H < gridTop || y > gridBottom) continue;
			drawCard(g, list.get(i), x, y, mx, my);
		}
		g.disableScissor();
		if (maxScroll > 0) {
			int th = gridBottom - gridTop, bh = Math.max(18, th * th / contentH);
			int byy = gridTop + (th - bh) * scroll / maxScroll;
			g.fill(px + pw - 5, gridTop, px + pw - 3, gridBottom, 0x22FFFFFF);
			g.fill(px + pw - 5, byy, px + pw - 3, byy + bh, C_PINK);
		}
		if (list.isEmpty()) drawC(g, "Rien ici.", px + pw / 2, gridTop + 18, C_MUTED);

		PipouGfx.pop(g);
	}

	private void drawCard(GuiGraphics g, Module m, int x, int y, int mx, int my) {
		boolean on = PipouOptions.isEnabled(m.id()), fav = PipouOptions.isFavorite(m.id());
		boolean hover = in(mx, my, x, y, cardW, CARD_H) && my >= gridTop && my <= gridBottom;
		roundBox(g, x, y, cardW, CARD_H, 7, hover ? C_CARD_HOVER : C_CARD,
				on ? C_PINK : (hover ? C_PINK_DIM : 0x22FFFFFF));
		if (m.isNew()) roundRect(g, x + 3, y + 9, 3, CARD_H - 18, 1, C_GREEN); // accent « nouveau »

		draw(g, m.label(), x + 9, y + 7, C_TEXT, false);
		drawHeart(g, x + cardW - 16, y + 7, 2, fav ? C_PINK : 0x55FFFFFF);
		PipouIcons.draw(g, m.icon(), x + cardW / 2, y + 33, 26, on ? C_PINK : C_TEXT); // logo teinté

		int by = y + CARD_H - 17;
		if (m.id().equals("hudlayout")) {
			// Carte-action : ouvre l'éditeur de placement (pas un interrupteur).
			boolean hOpen = in(mx, my, x + 7, by, cardW - 15, 13);
			roundRect(g, x + 7, by, cardW - 15, 13, 6, hOpen ? C_PINK : C_PILL);
			drawC(g, "Ouvrir  »", x + 7 + (cardW - 15) / 2, by + 3, hOpen ? C_INK : C_TEXT);
			return;
		}
		boolean hasGear = m.options().length > 0 || m.id().equals("autotext");
		boolean hGear = in(mx, my, x + 7, by, 14, 13);
		roundRect(g, x + 7, by, 14, 13, 4, hGear && hasGear ? 0x44FF7EC9 : C_PILL);
		drawGear(g, x + 10, by + 2, 1, hasGear ? (hGear ? C_PINK : C_MUTED) : 0x44FFFFFF);
		int b1 = x + 24, b2 = x + cardW - 8;
		roundRect(g, b1, by, b2 - b1, 13, 6, on ? C_GREEN : C_GREY);
		drawC(g, on ? "Activé" : "Désactivé", (b1 + b2) / 2, by + 3, on ? C_INK : C_MUTED);
	}

	// --- Sous-paramètres d'un module ---
	private void renderSettings(GuiGraphics g, int mx, int my) {
		Module m = PipouModules.byId(settingsOf);
		if (m == null) { settingsOf = null; return; }
		boolean hBack = in(mx, my, px + 9, py + TABS_Y, 58, 18);
		roundRect(g, px + 9, py + TABS_Y, 58, 18, 6, hBack ? 0x33FF7EC9 : C_PILL);
		drawC(g, "« Retour", px + 38, py + TABS_Y + 5, C_TEXT);
		draw(g, "Paramètres — " + m.label(), px + 78, py + TABS_Y + 5, C_PINK, false);

		g.enableScissor(Math.round((px + 3) * sc), Math.round(gridTop * sc), Math.round((px + pw - 3) * sc), Math.round(gridBottom * sc));
		int y = gridTop + 6 - setScroll;
		y = rowBool(g, "Activé (module)", PipouOptions.isEnabled(m.id()), y, mx, my);
		for (Opt o : m.options()) {
			switch (o.type()) {
				case "bool" -> y = rowBool(g, o.label(), PipouOptions.isEnabled(o.key()), y, mx, my);
				case "slider" -> y = rowSlider(g, o.label(), PipouOptions.getNum(o.key(), o.def()), y);
				case "text" -> y = rowText(g, o.label(), PipouOptions.getStr(o.key(), o.defStr()), o.key(), y);
			}
		}
		g.disableScissor();
		setMax = Math.max(0, (y + setScroll) - gridBottom + 6);
		if (setScroll > setMax) setScroll = setMax;
	}

	private int rowBool(GuiGraphics g, String label, boolean val, int y, int mx, int my) {
		roundRect(g, px + 12, y, px + pw - 24, 22, 6, C_CARD);
		draw(g, label, px + 20, y + 7, C_TEXT, false);
		int tw = 68, tx = px + pw - 20 - tw;
		roundRect(g, tx, y + 3, tw, 16, 6, val ? C_GREEN : C_GREY);
		drawC(g, val ? "Activé" : "Désactivé", tx + tw / 2, y + 7, val ? C_INK : C_MUTED);
		return y + 26;
	}

	private int rowSlider(GuiGraphics g, String label, double val, int y) {
		roundRect(g, px + 12, y, px + pw - 24, 22, 6, C_CARD);
		draw(g, label, px + 20, y + 7, C_TEXT, false);
		int bx = px + pw - 20 - 96;
		roundRect(g, bx, y + 3, 16, 16, 5, C_PILL); drawC(g, "-", bx + 8, y + 7, C_TEXT);
		drawC(g, "x" + (int) val, bx + 48, y + 7, C_PINK);
		roundRect(g, bx + 80, y + 3, 16, 16, 5, C_PILL); drawC(g, "+", bx + 88, y + 7, C_TEXT);
		return y + 26;
	}

	private int rowText(GuiGraphics g, String label, String val, String key, int y) {
		roundRect(g, px + 12, y, px + pw - 24, 22, 6, C_CARD);
		draw(g, label, px + 20, y + 7, C_MUTED, false);
		int bw = 150, bx = px + pw - 20 - bw;
		boolean editing = key.equals(editingKey);
		roundBox(g, bx, y + 3, bw, 16, 5, C_DARK, editing ? C_PINK : C_PINK_DIM);
		String shown = val.isEmpty() && !editing ? "(vide)" : val + (editing ? "_" : "");
		draw(g, shown, bx + 5, y + 7, val.isEmpty() && !editing ? C_MUTED : C_TEXT, false);
		return y + 26;
	}

	// Deux surcharges (pas de @Override, pas de super car la signature varie) :
	// 1.20.2+/1.21 = 4 args ; 1.20.1 = 3 args (délègue au 4-args, dy = amount).
	public boolean mouseScrolled(double mxr, double myr, double dx, double dy) {
		int my = (int) (myr / sc);
		if (my >= gridTop && my <= gridBottom) {
			if (settingsOf != null) setScroll = Math.max(0, Math.min(setScroll - (int) (dy * 24), setMax));
			else scroll = Math.max(0, Math.min(scroll - (int) (dy * 24), maxScroll));
			return true;
		}
		return false;
	}
	public boolean mouseScrolled(double mxr, double myr, double amount) {
		return mouseScrolled(mxr, myr, 0, amount);
	}

	@Override
	public boolean mouseClicked(double mxr, double myr, int button) {
		if (button != 0) return false;
		int mx = (int) (mxr / sc), my = (int) (myr / sc);
		if (in(mx, my, px + pw - 28, py + 8, 18, 18)) { this.onClose(); return true; }

		if (settingsOf != null) return clickSettings(mx, my);

		int tx = px + 9;
		for (String t : TABS) {
			int tw = tw(t) + 16;
			if (tx + tw > searchX - 6) break;
			if (in(mx, my, tx, py + TABS_Y, tw, 18)) { tab = t; scroll = 0; searchFocused = false; return true; }
			tx += tw + 5;
		}
		searchFocused = in(mx, my, searchX, py + TABS_Y, searchW, 18);
		if (searchFocused) return true;

		if (my < gridTop || my > gridBottom) return false;
		List<Module> list = visible();
		for (int i = 0; i < list.size(); i++) {
			int x = cardX(i), y = cardYRaw(i) - scroll;
			if (y + CARD_H < gridTop || y > gridBottom) continue;
			Module m = list.get(i);
			if (in(mx, my, x + cardW - 18, y + 4, 16, 14)) { PipouOptions.toggleFavorite(m.id()); return true; }
			if (m.id().equals("hudlayout")) {
				if (in(mx, my, x, y, cardW, CARD_H)) { this.minecraft.setScreen(new PipouHudEditScreen()); return true; }
				continue; // carte-action : pas d'interrupteur à basculer
			}
			int by = y + CARD_H - 17;
			boolean hasGear = m.options().length > 0 || m.id().equals("autotext");
			if (hasGear && in(mx, my, x + 7, by, 14, 13)) {
				if (m.id().equals("autotext")) this.minecraft.setScreen(new PipouAutoTextScreen());
				else { settingsOf = m.id(); setScroll = 0; editingKey = null; }
				return true;
			}
			if (in(mx, my, x, y, cardW, CARD_H)) { PipouOptions.toggle(m.id()); return true; }
		}
		return false;
	}

	private boolean clickSettings(int mx, int my) {
		if (in(mx, my, px + 9, py + TABS_Y, 58, 18)) { settingsOf = null; editingKey = null; return true; }
		Module m = PipouModules.byId(settingsOf);
		if (m == null) { settingsOf = null; return true; }
		editingKey = null;
		int y = gridTop + 6 - setScroll;
		if (boolHit(mx, my, y)) { PipouOptions.toggle(m.id()); return true; }
		y += 26;
		for (Opt o : m.options()) {
			switch (o.type()) {
				case "bool" -> { if (boolHit(mx, my, y)) { PipouOptions.toggle(o.key()); return true; } }
				case "slider" -> {
					double v = PipouOptions.getNum(o.key(), o.def());
					int bx = px + pw - 20 - 96;
					if (in(mx, my, bx, y + 3, 16, 16)) { PipouOptions.setNum(o.key(), Math.max(o.min(), v - 1)); return true; }
					if (in(mx, my, bx + 80, y + 3, 16, 16)) { PipouOptions.setNum(o.key(), Math.min(o.max(), v + 1)); return true; }
				}
				case "text" -> {
					int bw = 150, bx = px + pw - 20 - bw;
					if (in(mx, my, bx, y + 3, bw, 16)) { editingKey = o.key(); return true; }
				}
			}
			y += 26;
		}
		return true;
	}

	private boolean boolHit(int mx, int my, int y) {
		int tw = 68, tx = px + pw - 20 - tw;
		return in(mx, my, tx, y + 3, tw, 16);
	}

	@Override
	public boolean charTyped(char c, int mods) {
		if (editingKey != null) {
			if (c >= 32) { String v = PipouOptions.getStr(editingKey, ""); if (v.length() < 96) PipouOptions.setStr(editingKey, v + c); }
			return true;
		}
		if (searchFocused && c >= 32 && searchQuery.length() < 24) { searchQuery += c; scroll = 0; return true; }
		return super.charTyped(c, mods);
	}

	@Override
	public boolean keyPressed(int key, int scan, int mods) {
		if (editingKey != null) {
			if (Screen.isPaste(key)) { // Ctrl+V dans un champ texte de réglage
				String clip = this.minecraft.keyboardHandler.getClipboard();
				if (clip != null && !clip.isBlank()) {
					String v = PipouOptions.getStr(editingKey, ""), add = clip.replaceAll("[\\r\\n]", " ");
					if (v.length() + add.length() > 96) add = add.substring(0, Math.max(0, 96 - v.length()));
					if (!add.isEmpty()) PipouOptions.setStr(editingKey, v + add);
				}
				return true;
			}
			if (key == 259) { String v = PipouOptions.getStr(editingKey, ""); if (!v.isEmpty()) PipouOptions.setStr(editingKey, v.substring(0, v.length() - 1)); return true; }
			if (key == 256 || key == 257 || key == 335) { editingKey = null; return true; }
			return true;
		}
		if (searchFocused) {
			if (Screen.isPaste(key)) { // Ctrl+V dans la recherche
				String clip = this.minecraft.keyboardHandler.getClipboard();
				if (clip != null && !clip.isBlank()) {
					String add = clip.replaceAll("[\\r\\n]", " ");
					if (searchQuery.length() + add.length() > 24) add = add.substring(0, Math.max(0, 24 - searchQuery.length()));
					searchQuery += add; scroll = 0;
				}
				return true;
			}
			if (key == 259 && !searchQuery.isEmpty()) { searchQuery = searchQuery.substring(0, searchQuery.length() - 1); scroll = 0; return true; }
			if (key == 256) { searchFocused = false; return true; }
			if (key == 259) return true;
		}
		if (key == 256) { this.onClose(); return true; }
		return super.keyPressed(key, scan, mods);
	}

	// --- police custom (Poppins) ---
	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "pipou");
	private Component T(String s) { return Component.literal(s).withStyle(st -> st.withFont(FONT)); }
	private int tw(String s) { return this.font.width(T(s)); }
	private void draw(GuiGraphics g, String s, int x, int y, int color, boolean shadow) { g.drawString(this.font, T(s), x, y, color, shadow); }
	private void drawC(GuiGraphics g, String s, int cx, int y, int color) { Component c = T(s); g.drawString(this.font, c, cx - this.font.width(c) / 2, y, color, false); }

	// --- helpers ---
	private static boolean in(int mx, int my, int x, int y, int w, int h) { return mx >= x && mx < x + w && my >= y && my < y + h; }
	private static void border(GuiGraphics g, int x, int y, int w, int h, int c) {
		g.fill(x, y, x + w, y + 1, c); g.fill(x, y + h - 1, x + w, y + h, c);
		g.fill(x, y, x + 1, y + h, c); g.fill(x + w - 1, y, x + w, y + h, c);
	}
	// --- Rectangles ARRONDIS (look premium, « moins carré ») ---
	// Rempli, 4 coins arrondis de rayon r. Coins tracés par test de disque (anti-escalier léger).
	// Rangée de coin ANTI-ALIASÉE : partie pleine + 1 pixel-frontière gauche/droite en alpha
	// partiel (couverture du disque) -> le bord de la courbe est LISSE, pas en escalier.
	private static void aaRow(GuiGraphics g, int x, int w, int yy, int r, int i, int c) {
		double dy = r - i - 0.5;
		double exact = r - Math.sqrt(Math.max(0, (double) r * r - dy * dy)); // inset fractionnaire
		int full = (int) Math.floor(exact);
		int a = (c >>> 24) & 0xFF, rgb = c & 0xFFFFFF;
		int bc = ((int) Math.round(a * (1.0 - (exact - full))) << 24) | rgb; // pixel-frontière
		g.fill(x + full + 1, yy, x + w - full - 1, yy + 1, c);        // plein
		g.fill(x + full, yy, x + full + 1, yy + 1, bc);               // frontière gauche (AA)
		g.fill(x + w - full - 1, yy, x + w - full, yy + 1, bc);       // frontière droite (AA)
	}
	static void roundRect(GuiGraphics g, int x, int y, int w, int h, int r, int c) {
		r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
		if (r == 0) { g.fill(x, y, x + w, y + h, c); return; }
		g.fill(x, y + r, x + w, y + h - r, c); // bande centrale pleine largeur
		for (int i = 0; i < r; i++) { aaRow(g, x, w, y + i, r, i, c); aaRow(g, x, w, y + h - 1 - i, r, i, c); }
	}
	// Comme roundRect mais SEULS les 2 coins du HAUT sont arrondis (bandeau d'en-tête).
	static void roundRectTop(GuiGraphics g, int x, int y, int w, int h, int r, int c) {
		r = Math.max(0, Math.min(r, Math.min(w, h)));
		g.fill(x, y + r, x + w, y + h, c);
		for (int i = 0; i < r; i++) aaRow(g, x, w, y + i, r, i, c);
	}
	// Fond arrondi + bord 1px arrondi.
	static void roundBox(GuiGraphics g, int x, int y, int w, int h, int r, int fill, int border) {
		roundRect(g, x, y, w, h, r, border);
		roundRect(g, x + 1, y + 1, w - 2, h - 2, r - 1, fill);
	}
	// Cœurs = VRAIES TEXTURES lisses (blit + blur), plus de bitmap pixelisé. 3 couleurs
	// pré-teintées (rose / violet / éteint) pour ne pas dépendre d'une teinte runtime.
	private static final ResourceLocation HEART_PINK = PipouRL.of("pipoumod", "textures/gui/icons/heart.png");
	private static final ResourceLocation HEART_PURPLE = PipouRL.of("pipoumod", "textures/gui/icons/heart_purple.png");
	private static final ResourceLocation HEART_OFF = PipouRL.of("pipoumod", "textures/gui/icons/heart_off.png");
	private static void drawHeart(GuiGraphics g, int x, int y, int s, int color) {
		ResourceLocation rl = color == C_PINK ? HEART_PINK : (color == C_PURPLE ? HEART_PURPLE : HEART_OFF);
		int size = 6 * s + 1;
		// centré sur l'ancienne position du bitmap, décalé de +2 px VERS LA DROITE.
		PipouIcons.drawTex(g, rl, x + (7 * s) / 2 + 2, y + (6 * s) / 2, size, 0xFFFFFFFF);
	}
	// Engrenage ⚙ dessiné en PRIMITIVES (jamais via une police vanilla surchargeable par un
	// pack serveur). Anneau à dents + trou central. 9×9.
	private static final int[][] GEAR = {
			{0, 0, 0, 1, 1, 1, 0, 0, 0}, {1, 0, 0, 1, 1, 1, 0, 0, 1}, {1, 1, 1, 1, 1, 1, 1, 1, 1},
			{0, 1, 1, 0, 0, 0, 1, 1, 0}, {1, 1, 1, 0, 0, 0, 1, 1, 1}, {0, 1, 1, 0, 0, 0, 1, 1, 0},
			{1, 1, 1, 1, 1, 1, 1, 1, 1}, {1, 0, 0, 1, 1, 1, 0, 0, 1}, {0, 0, 0, 1, 1, 1, 0, 0, 0}
	};
	private static void drawGear(GuiGraphics g, int x, int y, int s, int color) {
		for (int r = 0; r < GEAR.length; r++)
			for (int c = 0; c < GEAR[r].length; c++)
				if (GEAR[r][c] == 1) g.fill(x + c * s, y + r * s, x + c * s + s, y + r * s + s, color);
	}
}
