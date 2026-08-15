package com.pipou.pipoumod;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Éditeur de placement du HUD (façon Feather), refonte visuelle : cadres arrondis, tout le
 * chrome (titre / astuce / tiroir des masqués / boutons) dans un panneau arrondi EN BAS — donc
 * plus de barre en haut qui chevauche les overlays (ex. la boussole centrée en haut).
 *
 * Fusion : la fusion en bulle est AUTOMATIQUE (par proximité, voir {@link PipouHud}) — rapprocher
 * deux modules les met dans la même bulle, les éloigner les sépare. Ici on ne fait que déplacer.
 */
public class PipouHudEditScreen extends Screen {

	private static final int C_DIM = 0xC0140018;
	private static final int C_PANEL = 0xF01C1230, C_PANEL_EDGE = 0x55FF7EC9;
	private static final int C_PINK = 0xFFFF7EC9, C_PINKL = 0xFFFFB0DC, C_PURPLE = 0xFFB8A5D8;
	private static final int C_MUTED = 0xFFB79FCE, C_TEXT = 0xFFF7ECFB, C_INK = 0xFF2A0F26;
	private static final int C_CHIP = 0x66402040, C_CHIP_H = 0x88FF7EC9;

	private int offX, offY;                                   // décalage curseur -> coin (drag)
	private final LinkedHashMap<String, int[]> trayHit = new LinkedHashMap<>();
	private int panelTop;                                     // haut du panneau (maj en render)
	private int[] resetRect = new int[4], closeRect = new int[4];

	public PipouHudEditScreen() { super(Component.literal("Éditeur de HUD")); }

	@Override public boolean isPauseScreen() { return true; }
	public void renderBackground(GuiGraphics g, int mx, int my, float pt) {}
	public void renderBackground(GuiGraphics g) {}

	private static boolean in(int mx, int my, int[] r) { return mx >= r[0] && my >= r[1] && mx < r[0] + r[2] && my < r[1] + r[3]; }
	private static boolean in(int mx, int my, int x, int y, int w, int h) { return mx >= x && my >= y && mx < x + w && my < y + h; }
	private static String label(String id) {
		PipouModules.Module m = PipouModules.byId(id);
		return m != null ? m.label() : id;
	}

	// --- Rectangles arrondis (coins ~3px) ---
	private static void rFill(GuiGraphics g, int x, int y, int w, int h, int c) {
		if (w <= 0 || h <= 0) return;
		g.fill(x + 3, y, x + w - 3, y + h, c);
		g.fill(x, y + 3, x + 3, y + h - 3, c);
		g.fill(x + w - 3, y + 3, x + w, y + h - 3, c);
		g.fill(x + 1, y + 1, x + 3, y + 3, c);
		g.fill(x + w - 3, y + 1, x + w - 1, y + 3, c);
		g.fill(x + 1, y + h - 3, x + 3, y + h - 1, c);
		g.fill(x + w - 3, y + h - 3, x + w - 1, y + h - 1, c);
	}
	private static void rOutline(GuiGraphics g, int x, int y, int w, int h, int c) {
		g.fill(x + 3, y, x + w - 3, y + 1, c);
		g.fill(x + 3, y + h - 1, x + w - 3, y + h, c);
		g.fill(x, y + 3, x + 1, y + h - 3, c);
		g.fill(x + w - 1, y + 3, x + w, y + h - 3, c);
		g.fill(x + 1, y + 2, x + 2, y + 3, c); g.fill(x + 2, y + 1, x + 3, y + 2, c);
		g.fill(x + w - 2, y + 2, x + w - 1, y + 3, c); g.fill(x + w - 3, y + 1, x + w - 2, y + 2, c);
		g.fill(x + 1, y + h - 3, x + 2, y + h - 2, c); g.fill(x + 2, y + h - 2, x + 3, y + h - 1, c);
		g.fill(x + w - 2, y + h - 3, x + w - 1, y + h - 2, c); g.fill(x + w - 3, y + h - 2, x + w - 2, y + h - 1, c);
	}

	private List<String> hidden() {
		List<String> out = new ArrayList<>();
		for (String id : PipouHud.DASHES) if (!PipouOptions.isEnabled(id)) out.add(id);
		return out;
	}

	private static final int CHIP_MAXX_PAD = 14; // marge droite des pastilles du tiroir

	// Nombre de rangées de pastilles (même logique de wrap que le rendu -> panneau à la bonne hauteur).
	private int chipRows() {
		int rows = 0, x = 12, maxX = this.width - CHIP_MAXX_PAD;
		for (String id : hidden()) {
			int cw = this.font.width(label(id)) + 14;
			if (rows == 0) rows = 1;
			if (x + cw > maxX && x > 12) { rows++; x = 12; }
			x += cw + 5;
		}
		return rows;
	}
	// Panneau = titre + astuce + libellé « Masqués » (45px) + rangées de pastilles + marge basse.
	private int computePanelH() { return 45 + chipRows() * 16 + 8; }

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float pt) {
		Minecraft mc = this.minecraft;
		g.fill(0, 0, this.width, this.height, C_DIM);

		if (mc.player == null) {
			String msg = "Rejoins un monde pour placer le HUD.";
			g.drawString(mc.font, Component.literal(msg), (this.width - mc.font.width(msg)) / 2, this.height / 2 - 4, C_TEXT);
			closeRect = new int[]{ this.width - 70, this.height - 26, 60, 18 };
			resetRect = new int[]{ -99, -99, 0, 0 };
			rFill(g, closeRect[0], closeRect[1], closeRect[2], closeRect[3], in(mouseX, mouseY, closeRect) ? C_CHIP_H : C_CHIP);
			g.drawString(mc.font, Component.literal("Fermer"), closeRect[0] + 14, closeRect[1] + 5, C_TEXT, false);
			return;
		}

		float f = PipouHud.factor(mc);
		int[] vp = PipouHud.viewport(mc);
		int vw = vp[0], vh = vp[1];
		int smx = (int) (mouseX / f), smy = (int) (mouseY / f);

		boolean sc = f != 1f;
		if (sc) { PipouGfx.push(g); PipouGfx.scale(g, f, f); }
		try {
			PipouHud.layout(g, mc, vw, vh, true); // overlays + bulles de fusion (proximité)

			// Guides d'aimantation au centre pendant le glissement.
			if (PipouHud.dragId != null) {
				int[] b = PipouHud.boxes().get(PipouHud.dragId);
				if (b != null) {
					int cx = vw / 2, cy = vh / 2;
					if (Math.abs(b[0] + b[2] / 2 - cx) <= 1) g.fill(cx, 0, cx + 1, vh, 0x40FF7EC9);
					if (Math.abs(b[1] + b[3] / 2 - cy) <= 1) g.fill(0, cy, vw, cy + 1, 0x40FF7EC9);
				}
			}

			// Cadres arrondis + libellé au survol / sélection.
			for (Map.Entry<String, int[]> e : PipouHud.boxes().entrySet()) {
				int[] b = e.getValue();
				boolean sel = e.getKey().equals(PipouHud.dragId);
				boolean hov = sel || in(smx, smy, b[0], b[1], b[2], b[3]);
				rOutline(g, b[0] - 3, b[1] - 3, b[2] + 6, b[3] + 6, sel ? C_PINK : (hov ? C_PINKL : 0x44FFFFFF));
				if (hov) {
					String lb = label(e.getKey());
					int lw = mc.font.width(lb);
					int ly = b[1] - 15 < 0 ? b[1] + b[3] + 5 : b[1] - 15;
					rFill(g, b[0] - 3, ly, lw + 8, 12, 0xE62A0F30);
					g.drawString(mc.font, Component.literal(lb), b[0] + 1, ly + 2, C_PINKL, false);
				}
			}
		} finally {
			if (sc) { PipouGfx.pop(g); }
		}

		// --- Panneau du bas (espace GUI, non transformé) ---
		int ph = computePanelH();
		panelTop = this.height - ph;
		g.fill(0, panelTop, this.width, panelTop + 1, C_PANEL_EDGE);
		g.fill(0, panelTop + 1, this.width, this.height, C_PANEL);

		g.drawString(mc.font, Component.literal("Éditeur de HUD"), 12, panelTop + 8, C_PINK);
		String hint = "Glisse pour déplacer · rapproche 2 modules = fusion · clic droit = masquer";
		g.drawString(mc.font, Component.literal(hint), 12, panelTop + 21, C_MUTED, false);

		// Boutons sur la ligne de titre (à droite) — hors des rangées de pastilles.
		resetRect = new int[]{ this.width - 138, panelTop + 6, 66, 18 };
		closeRect = new int[]{ this.width - 66, panelTop + 6, 58, 18 };
		drawBtn(g, mouseX, mouseY, resetRect, "Réinitialiser", false);
		drawBtn(g, mouseX, mouseY, closeRect, "Fermer", true);

		// Tiroir des masqués (label sur sa ligne, pastilles arrondies dessous, wrap plein largeur).
		g.drawString(mc.font, Component.literal("Masqués :"), 12, panelTop + 33, C_PURPLE, false);
		trayHit.clear();
		List<String> hid = hidden();
		if (hid.isEmpty()) {
			g.drawString(mc.font, Component.literal("(aucun)"), 12 + mc.font.width("Masqués :") + 8, panelTop + 33, C_MUTED, false);
		} else {
			int tx = 12, ty = panelTop + 45, maxX = this.width - CHIP_MAXX_PAD;
			for (String id : hid) {
				String lb = label(id);
				int cw = mc.font.width(lb) + 14;
				if (tx + cw > maxX && tx > 12) { tx = 12; ty += 16; }
				boolean h = in(mouseX, mouseY, tx, ty, cw, 13);
				rFill(g, tx, ty, cw, 13, h ? C_CHIP_H : C_CHIP);
				g.drawString(mc.font, Component.literal(lb), tx + 7, ty + 3, h ? C_INK : C_TEXT, false);
				trayHit.put(id, new int[]{ tx, ty, cw, 13 });
				tx += cw + 5;
			}
		}
	}

	private void drawBtn(GuiGraphics g, int mx, int my, int[] r, String label, boolean primary) {
		boolean h = in(mx, my, r);
		int bg = primary ? (h ? C_PINK : 0x99FF7EC9) : (h ? C_CHIP_H : C_CHIP);
		rFill(g, r[0], r[1], r[2], r[3], bg);
		int tw = this.font.width(label);
		g.drawString(this.font, Component.literal(label), r[0] + (r[2] - tw) / 2, r[1] + 5, primary ? C_INK : C_TEXT, false);
	}

	@Override
	public boolean mouseClicked(double mxr, double myr, int button) {
		Minecraft mc = this.minecraft;
		int mx = (int) mxr, my = (int) myr;

		if (in(mx, my, closeRect)) { this.onClose(); return true; }
		if (mc.player == null) return super.mouseClicked(mxr, myr, button);
		if (in(mx, my, resetRect)) {
			for (String id : PipouHud.DASHES) { PipouOptions.clearNum("hud.x." + id); PipouOptions.clearNum("hud.y." + id); }
			return true;
		}
		// Tiroir : clic = réafficher.
		for (Map.Entry<String, int[]> e : trayHit.entrySet())
			if (in(mx, my, e.getValue())) { PipouOptions.toggle(e.getKey()); return true; }

		// Clic sur le FOND du panneau (hors bouton/pastille) : on consomme -> pas de drag d'un
		// overlay caché derrière le panneau.
		if (my >= panelTop) return true;

		// Canevas (coordonnées HUD = souris / facteur), du plus haut au plus bas.
		float f = PipouHud.factor(mc);
		int smx = (int) (mxr / f), smy = (int) (myr / f);
		List<Map.Entry<String, int[]>> ents = new ArrayList<>(PipouHud.boxes().entrySet());
		for (int i = ents.size() - 1; i >= 0; i--) {
			Map.Entry<String, int[]> e = ents.get(i);
			int[] b = e.getValue();
			if (in(smx, smy, b[0], b[1], b[2], b[3])) {
				if (button == 1) { PipouOptions.toggle(e.getKey()); return true; } // clic droit = masquer
				int[] vp = PipouHud.viewport(mc);
				PipouHud.dragId = e.getKey();
				offX = smx - b[0]; offY = smy - b[1];
				PipouHud.dragFx = b[0] / (float) vp[0];
				PipouHud.dragFy = b[1] / (float) vp[1];
				return true;
			}
		}
		return super.mouseClicked(mxr, myr, button);
	}

	@Override
	public boolean mouseDragged(double mxr, double myr, int button, double dx, double dy) {
		if (PipouHud.dragId == null) return false;
		Minecraft mc = this.minecraft;
		float f = PipouHud.factor(mc);
		int[] vp = PipouHud.viewport(mc);
		int vw = vp[0], vh = vp[1];
		int[] b = PipouHud.boxes().get(PipouHud.dragId);
		if (b == null) return true;
		int w = b[2], h = b[3];
		int nx = (int) (mxr / f) - offX, ny = (int) (myr / f) - offY;
		nx = Math.max(0, Math.min(nx, vw - w));
		ny = Math.max(0, Math.min(ny, vh - h));
		int cx = vw / 2 - w / 2, cy = vh / 2 - h / 2, S = 3;
		if (Math.abs(nx) <= S) nx = 0; else if (Math.abs(nx + w - vw) <= S) nx = vw - w; else if (Math.abs(nx - cx) <= S) nx = cx;
		if (Math.abs(ny) <= S) ny = 0; else if (Math.abs(ny + h - vh) <= S) ny = vh - h; else if (Math.abs(ny - cy) <= S) ny = cy;
		PipouHud.dragFx = nx / (float) vw;
		PipouHud.dragFy = ny / (float) vh;
		return true;
	}

	@Override
	public boolean mouseReleased(double mxr, double myr, int button) {
		if (PipouHud.dragId != null) {
			PipouOptions.setNum("hud.x." + PipouHud.dragId, PipouHud.dragFx);
			PipouOptions.setNum("hud.y." + PipouHud.dragId, PipouHud.dragFy);
			PipouHud.dragId = null;
		}
		return super.mouseReleased(mxr, myr, button);
	}

	@Override
	public void onClose() { PipouHud.dragId = null; super.onClose(); }
}
