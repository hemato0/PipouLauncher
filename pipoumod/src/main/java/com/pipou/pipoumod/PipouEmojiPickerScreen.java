package com.pipou.pipoumod;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Sélecteur d'emojis ouvert depuis le bouton du chat. Affiche la grille des emojis en IMAGES
 * (police pipoumod:emoji) ; un clic insère le raccourci « :nom: » dans la barre de chat (lisible,
 * converti en image à l'envoi par PipouEmoji.toChars). Rouvre le chat avec le texte + le raccourci.
 */
public class PipouEmojiPickerScreen extends Screen {

	private static final ResourceLocation FONT = PipouRL.of("pipoumod", "emoji");
	private static final int C_OVERLAY = 0xCC0E0717, C_PANEL = 0xFF181026, C_HEADER = 0xFF221436;
	private static final int C_PINK = 0xFFFF7EC9, C_PINK_DIM = 0x55FF7EC9, C_TEXT = 0xFFF7ECFB, C_MUTED = 0xFFB79FCE, C_PILL = 0xFF2A1A40;
	private static final int COLS = 9, CELL = 24;

	private final String prevText;
	private final List<Map.Entry<String, String>> emojis; // nom -> caractère
	private int px, py, pw, ph, gridTop;

	public PipouEmojiPickerScreen(String prevText) {
		super(Component.literal("Emojis"));
		this.prevText = prevText == null ? "" : prevText;
		this.emojis = new ArrayList<>(PipouEmoji.map().entrySet());
	}

	@Override public boolean isPauseScreen() { return false; }
	public void renderBackground(GuiGraphics g, int mx, int my, float pt) {}
	public void renderBackground(GuiGraphics g) {}

	@Override
	protected void init() {
		int rows = Math.max(1, (emojis.size() + COLS - 1) / COLS);
		pw = COLS * CELL + 16;
		ph = 32 + rows * CELL + 8;
		px = (this.width - pw) / 2;
		py = (this.height - ph) / 2;
		gridTop = py + 30;
	}

	@Override
	public void render(GuiGraphics g, int mouseX, int mouseY, float pt) {
		g.fill(0, 0, this.width, this.height, C_OVERLAY);
		g.fill(px, py, px + pw, py + ph, C_PANEL);
		border(g, px, py, pw, ph, C_PINK_DIM);
		g.fill(px, py, px + pw, py + 24, C_HEADER);
		g.drawString(this.font, Component.literal("Emojis"), px + 8, py + 8, C_PINK);
		g.drawString(this.font, Component.literal("clic = insérer"), px + pw - 8 - this.font.width("clic = insérer"), py + 8, C_MUTED, false);

		int hover = cellAt(mouseX, mouseY);
		for (int i = 0; i < emojis.size(); i++) {
			int cx = px + 8 + (i % COLS) * CELL;
			int cy = gridTop + (i / COLS) * CELL;
			if (i == hover) g.fill(cx, cy, cx + CELL - 2, cy + CELL - 2, 0x44FF7EC9);
			drawEmoji(g, emojis.get(i).getValue(), cx + CELL / 2 - 1, cy + CELL / 2 - 1);
		}
		if (hover >= 0)
			g.drawString(this.font, Component.literal(":" + emojis.get(hover).getKey() + ":"), px + 8, py + ph - 2 - 8, C_MUTED, false);
	}

	// Emoji dessiné en 2x (la police image fait 8px de haut) centré sur (cx,cy).
	private void drawEmoji(GuiGraphics g, String ch, int cx, int cy) {
		Component c = Component.literal(ch).withStyle(s -> s.withFont(FONT));
		int w = this.font.width(c);
		PipouGfx.push(g);
		PipouGfx.scale(g, 2f, 2f);
		g.drawString(this.font, c, Math.round(cx / 2f - w / 2f), Math.round(cy / 2f - 4f), 0xFFFFFFFF, false);
		PipouGfx.pop(g);
	}

	private int cellAt(int mx, int my) {
		if (mx < px + 8 || my < gridTop) return -1;
		int col = (mx - (px + 8)) / CELL, row = (my - gridTop) / CELL;
		if (col < 0 || col >= COLS) return -1;
		int i = row * COLS + col;
		return (i >= 0 && i < emojis.size()) ? i : -1;
	}

	@Override
	public boolean mouseClicked(double mxr, double myr, int button) {
		if (button == 0) {
			int i = cellAt((int) mxr, (int) myr);
			if (i >= 0) {
				String insert = ":" + emojis.get(i).getKey() + ":";
				this.minecraft.setScreen(new ChatScreen(prevText + insert));
				return true;
			}
		}
		return super.mouseClicked(mxr, myr, button);
	}

	@Override
	public void onClose() {
		// Retour au chat en conservant le texte déjà saisi.
		this.minecraft.setScreen(new ChatScreen(prevText));
	}

	private static void border(GuiGraphics g, int x, int y, int w, int h, int c) {
		g.fill(x, y, x + w, y + 1, c); g.fill(x, y + h - 1, x + w, y + h, c);
		g.fill(x, y, x + 1, y + h, c); g.fill(x + w - 1, y, x + w, y + h, c);
	}
}
