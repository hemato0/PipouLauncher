package com.pipou.pipoumod;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Le mod menu en jeu : grille de cartes toggles, façon Feather (rose/violet). */
public class PipouScreen extends Screen {

	// { id, libellé }
	private static final String[][] FEATURES = {
			{"fps", "FPS"},
			{"coords", "Coordonnées"},
			{"cps", "CPS"},
			{"keystrokes", "Keystrokes"},
			{"armor", "Armure"},
			{"potions", "Potions"},
			{"ping", "Ping"},
			{"direction", "Direction"},
			{"clock", "Horloge"}
	};

	private static final int COLS = 4;
	private static final int CW = 150;
	private static final int CH = 96;
	private static final int GAP = 12;

	public PipouScreen() {
		super(Component.literal("PipouMod"));
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	private int gridX() {
		return (this.width - (COLS * CW + (COLS - 1) * GAP)) / 2;
	}

	private int gridY() {
		return 74;
	}

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
		this.renderBackground(g, mouseX, mouseY, partialTick);

		int gx = gridX();
		g.drawString(this.font, Component.literal("PipouMod — Mod Menu"), gx, 34, 0xFFFF7EC9);
		g.drawString(this.font, Component.literal("Maj droit pour ouvrir / fermer · Echap pour revenir au jeu"), gx, 48, 0xFFB8A5D8);

		for (int i = 0; i < FEATURES.length; i++) {
			int x = cardX(i);
			int y = cardY(i);
			boolean on = PipouOptions.isEnabled(FEATURES[i][0]);
			boolean hover = mouseX >= x && mouseX < x + CW && mouseY >= y && mouseY < y + CH;

			g.fill(x, y, x + CW, y + CH, 0xCC1C1230);
			int border = on ? 0xFFFF7EC9 : (hover ? 0x88FF7EC9 : 0x33FFFFFF);
			drawBorder(g, x, y, CW, CH, border);

			String name = FEATURES[i][1];
			g.drawString(this.font, Component.literal(name), x + (CW - this.font.width(name)) / 2, y + 22, 0xFFFFFFFF);

			// Pilule d'état en bas de la carte.
			int py = y + CH - 26;
			int px1 = x + 14;
			int px2 = x + CW - 14;
			g.fill(px1, py, px2, py + 18, on ? 0xFF2FAE66 : 0x55FFFFFF);
			String st = on ? "Activé" : "Désactivé";
			g.drawString(this.font, Component.literal(st), x + (CW - this.font.width(st)) / 2, py + 5, on ? 0xFF06210F : 0xFFDDDDDD);
		}

		super.render(g, mouseX, mouseY, partialTick);
	}

	private int cardX(int i) {
		return gridX() + (i % COLS) * (CW + GAP);
	}

	private int cardY(int i) {
		return gridY() + (i / COLS) * (CH + GAP);
	}

	private void drawBorder(GuiGraphics g, int x, int y, int w, int h, int color) {
		g.fill(x, y, x + w, y + 1, color);
		g.fill(x, y + h - 1, x + w, y + h, color);
		g.fill(x, y, x + 1, y + h, color);
		g.fill(x + w - 1, y, x + w, y + h, color);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button) {
		if (button == 0) {
			for (int i = 0; i < FEATURES.length; i++) {
				int x = cardX(i);
				int y = cardY(i);
				if (mouseX >= x && mouseX < x + CW && mouseY >= y && mouseY < y + CH) {
					PipouOptions.toggle(FEATURES[i][0]);
					return true;
				}
			}
		}
		return super.mouseClicked(mouseX, mouseY, button);
	}
}
