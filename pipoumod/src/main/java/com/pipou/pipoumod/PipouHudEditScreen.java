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
 * Éditeur de placement du HUD (façon Feather) : chaque overlay activé est dessiné
 * en vrai (WYSIWYG) et se glisse à la souris. Aimantation aux bords/centre, clic droit
 * pour masquer un module, tiroir des modules masqués (clic = réafficher), réinitialiser.
 *
 * Les positions sont mémorisées en FRACTION d'écran par {@link PipouHud} (hud.x/hud.y).
 */
public class PipouHudEditScreen extends Screen {

	private int offX, offY; // décalage curseur -> coin du module en cours de glissement
	private final LinkedHashMap<String, int[]> trayHit = new LinkedHashMap<>(); // chips « masqués »

	public PipouHudEditScreen() { super(Component.literal("Éditeur de HUD")); }

	@Override public boolean isPauseScreen() { return true; }
	// Deux surcharges (pas de @Override) : 1.20.2+/1.21 = 4 args, 1.20.1 = 1 arg. Vide = pas de flou.
	public void renderBackground(GuiGraphics g, int mx, int my, float pt) {}
	public void renderBackground(GuiGraphics g) {}

	private static boolean in(int mx, int my, int x, int y, int w, int h) {
		return mx >= x && my >= y && mx < x + w && my < y + h;
	}
	private static void outline(GuiGraphics g, int x, int y, int w, int h, int c) {
		g.fill(x, y, x + w, y + 1, c);
		g.fill(x, y + h - 1, x + w, y + h, c);
		g.fill(x, y, x + 1, y + h, c);
		g.fill(x + w - 1, y, x + w, y + h, c);
	}
	private static String label(String id) {
		PipouModules.Module m = PipouModules.byId(id);
		return m != null ? m.label() : id;
	}

	private int[] btnClose() { return new int[]{ this.width - 66, this.height - 24, 60, 18 }; }
	private int[] btnReset() { return new int[]{ this.width - 130, this.height - 24, 60, 18 }; }

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float pt) {
		Minecraft mc = this.minecraft;
		g.fill(0, 0, this.width, this.height, 0xB4160020); // fond violet sombre

		if (mc.player == null) {
			String msg = "Rejoins un monde pour placer le HUD.";
			g.drawString(mc.font, Component.literal(msg), (this.width - mc.font.width(msg)) / 2, this.height / 2 - 4, 0xFFFFFFFF);
			drawBtn(g, mouseX, mouseY, btnClose(), "Fermer");
			return;
		}

		float f = PipouHud.factor(mc);
		int[] vp = PipouHud.viewport(mc);
		int vw = vp[0], vh = vp[1];
		int smx = (int) (mouseX / f), smy = (int) (mouseY / f);

		boolean sc = f != 1f;
		if (sc) { PipouGfx.push(g); PipouGfx.scale(g, f, f); }
		// try/finally : si un rendu de module lève (donnée modée exotique), on RESTAURE la
		// pose-stack, sinon tout le rendu GUI suivant serait décalé (cohérent avec PipouHud).
		try {
			// Dessine tous les dashboards activés à leur position (placeholder si vide).
			PipouHud.layout(g, mc, vw, vh, true);

			// Guides d'aimantation (centre) pendant le glissement.
			if (PipouHud.dragId != null) {
				int[] b = PipouHud.boxes().get(PipouHud.dragId);
				if (b != null) {
					int cx = vw / 2, cy = vh / 2;
					if (Math.abs(b[0] + b[2] / 2 - cx) <= 1) g.fill(cx, 0, cx + 1, vh, 0x55FF7EC9);
					if (Math.abs(b[1] + b[3] / 2 - cy) <= 1) g.fill(0, cy, vw, cy + 1, 0x55FF7EC9);
				}
			}

			// Contours + libellé au survol / sélection.
			for (Map.Entry<String, int[]> e : PipouHud.boxes().entrySet()) {
				int[] b = e.getValue();
				boolean sel = e.getKey().equals(PipouHud.dragId);
				boolean hov = sel || in(smx, smy, b[0], b[1], b[2], b[3]);
				outline(g, b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4, sel ? 0xFFFF7EC9 : (hov ? 0xFFFFB0DC : 0x66FFFFFF));
				if (hov) {
					String lb = label(e.getKey());
					int ly = b[1] - 11 < 0 ? b[1] + b[3] + 3 : b[1] - 11;
					g.fill(b[0] - 2, ly - 1, b[0] + mc.font.width(lb) + 3, ly + 9, 0xCC2A0F30);
					g.drawString(mc.font, Component.literal(lb), b[0] + 1, ly, 0xFFFFDCEF, false);
				}
			}
		} finally {
			if (sc) { PipouGfx.pop(g); }
		}

		// --- Chrome (espace GUI, non transformé) ---
		g.fill(0, 0, this.width, 15, 0xCC1A0026);
		g.drawString(mc.font, Component.literal("Éditeur de HUD"), 6, 3, 0xFFFF7EC9);
		String hint = "Glisse pour déplacer · Clic droit sur un module = masquer";
		g.drawString(mc.font, Component.literal(hint), this.width - mc.font.width(hint) - 6, 3, 0xFFB8A5D8, false);

		// Barre du bas : tiroir des masqués + boutons.
		int barTop = this.height - 46;
		g.fill(0, barTop, this.width, this.height, 0xCC1A0026);
		g.drawString(mc.font, Component.literal("Masqués (clic pour afficher) :"), 6, barTop + 3, 0xFFB8A5D8, false);
		trayHit.clear();
		int tx = 6, ty = barTop + 15, maxX = this.width - 140;
		for (String id : PipouHud.DASHES) {
			if (PipouOptions.isEnabled(id)) continue;
			String lb = label(id);
			int cw = mc.font.width(lb) + 12;
			if (tx + cw > maxX) { tx = 6; ty += 16; }
			boolean h = in(mouseX, mouseY, tx, ty, cw, 14);
			g.fill(tx, ty, tx + cw, ty + 14, h ? 0x66FF7EC9 : 0x55402040);
			g.drawString(mc.font, Component.literal(lb), tx + 6, ty + 3, 0xFFFFFFFF, false);
			trayHit.put(id, new int[]{ tx, ty, cw, 14 });
			tx += cw + 4;
		}
		drawBtn(g, mouseX, mouseY, btnReset(), "Réinitialiser");
		drawBtn(g, mouseX, mouseY, btnClose(), "Fermer");
	}

	private void drawBtn(GuiGraphics g, int mx, int my, int[] r, String label) {
		boolean h = in(mx, my, r[0], r[1], r[2], r[3]);
		g.fill(r[0], r[1], r[0] + r[2], r[1] + r[3], h ? 0x66FF7EC9 : 0x66402040);
		int tw = this.minecraft.font.width(label);
		g.drawString(this.minecraft.font, Component.literal(label), r[0] + (r[2] - tw) / 2, r[1] + (r[3] - 8) / 2, 0xFFFFFFFF, false);
	}

	@Override
	public boolean mouseClicked(double mxr, double myr, int button) {
		Minecraft mc = this.minecraft;
		int mx = (int) mxr, my = (int) myr;

		int[] r = btnClose();
		if (in(mx, my, r[0], r[1], r[2], r[3])) { this.onClose(); return true; }
		if (mc.player == null) return super.mouseClicked(mxr, myr, button);

		r = btnReset();
		if (in(mx, my, r[0], r[1], r[2], r[3])) {
			for (String id : PipouHud.DASHES) { PipouOptions.clearNum("hud.x." + id); PipouOptions.clearNum("hud.y." + id); }
			return true;
		}
		// Tiroir des masqués : clic = réafficher.
		for (Map.Entry<String, int[]> e : trayHit.entrySet()) {
			int[] b = e.getValue();
			if (in(mx, my, b[0], b[1], b[2], b[3])) { PipouOptions.toggle(e.getKey()); return true; }
		}
		// Modules sur le canevas (coordonnées HUD = souris / facteur), du plus haut au plus bas.
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
		// Aimantation : bords + centre (seuil 3 px).
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
