package com.pipou.pipoumod;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;

import java.text.SimpleDateFormat;
import java.util.Date;

/** Dessine les overlays HUD activés (rose PipouLauncher). */
public class PipouHud {

	// Couleurs ARGB — l'octet alpha (FF) est OBLIGATOIRE sinon invisible.
	private static final int PINK = 0xFFFF7EC9;
	private static final int WHITE = 0xFFFFFFFF;
	private static final int LAV = 0xFFB8A5D8;
	private static final int INK = 0xFF3A0F30;

	public static void register() {
		HudRenderCallback.EVENT.register((g, delta) -> {
			Minecraft mc = Minecraft.getInstance();
			if (mc.options.hideGui || mc.player == null) return;

			// --- Colonne d'infos en haut à gauche ---
			int y = 4;
			if (PipouOptions.isEnabled("fps")) {
				y = line(g, mc, Component.literal(mc.getFps() + " FPS"), y, PINK);
			}
			if (PipouOptions.isEnabled("coords")) {
				String c = String.format("XYZ  %.1f  %.1f  %.1f", mc.player.getX(), mc.player.getY(), mc.player.getZ());
				y = line(g, mc, Component.literal(c), y, WHITE);
			}
			if (PipouOptions.isEnabled("direction")) {
				y = line(g, mc, Component.literal("Direction : " + mc.player.getDirection().getName()), y, WHITE);
			}
			if (PipouOptions.isEnabled("cps")) {
				y = line(g, mc, Component.literal("CPS  " + PipouTracker.leftCps() + " | " + PipouTracker.rightCps()), y, PINK);
			}
			if (PipouOptions.isEnabled("ping")) {
				y = line(g, mc, Component.literal("Ping : " + ping(mc) + " ms"), y, LAV);
			}
			if (PipouOptions.isEnabled("clock")) {
				y = line(g, mc, Component.literal(new SimpleDateFormat("HH:mm").format(new Date())), y, LAV);
			}

			// --- Effets de potions (sous la colonne) ---
			if (PipouOptions.isEnabled("potions")) {
				y += 4;
				for (MobEffectInstance eff : mc.player.getActiveEffects()) {
					String name = eff.getEffect().value().getDisplayName().getString();
					int lvl = eff.getAmplifier() + 1;
					y = line(g, mc, Component.literal(name + " " + lvl + "  " + time(eff.getDuration())), y, WHITE);
				}
			}

			// --- HUD armure (à droite) ---
			if (PipouOptions.isEnabled("armor")) {
				drawArmor(g, mc);
			}

			// --- Keystrokes (bas gauche) ---
			if (PipouOptions.isEnabled("keystrokes")) {
				drawKeystrokes(g, mc);
			}
		});
	}

	private static int line(GuiGraphics g, Minecraft mc, Component text, int y, int color) {
		g.drawString(mc.font, text, 4, y, color);
		return y + 11;
	}

	private static int ping(Minecraft mc) {
		if (mc.getConnection() == null) return 0;
		var info = mc.getConnection().getPlayerInfo(mc.player.getUUID());
		return info != null ? info.getLatency() : 0;
	}

	private static String time(int ticks) {
		int s = ticks / 20;
		return (s / 60) + ":" + String.format("%02d", s % 60);
	}

	private static void drawArmor(GuiGraphics g, Minecraft mc) {
		int x = mc.getWindow().getGuiScaledWidth() - 40;
		int y = mc.getWindow().getGuiScaledHeight() / 2 - 44;
		// getArmorSlots() renvoie bottes -> casque : on affiche de haut en bas casque -> bottes.
		java.util.List<ItemStack> pieces = new java.util.ArrayList<>();
		for (ItemStack st : mc.player.getArmorSlots()) pieces.add(st);
		for (int i = pieces.size() - 1; i >= 0; i--) {
			ItemStack st = pieces.get(i);
			if (st.isEmpty()) continue;
			g.renderItem(st, x, y);
			if (st.isDamageableItem()) {
				int pct = 100 - (st.getDamageValue() * 100 / st.getMaxDamage());
				String p = pct + "%";
				g.drawString(mc.font, Component.literal(p), x - mc.font.width(p) - 4, y + 4, pct > 25 ? WHITE : 0xFFFF5D8F);
			}
			y += 20;
		}
	}

	private static void drawKeystrokes(GuiGraphics g, Minecraft mc) {
		int bx = 6;
		int by = mc.getWindow().getGuiScaledHeight() - 92;
		box(g, mc, bx + 22, by, 20, mc.options.keyUp.isDown(), "W");
		box(g, mc, bx, by + 22, 20, mc.options.keyLeft.isDown(), "A");
		box(g, mc, bx + 22, by + 22, 20, mc.options.keyDown.isDown(), "S");
		box(g, mc, bx + 44, by + 22, 20, mc.options.keyRight.isDown(), "D");
		box(g, mc, bx, by + 44, 30, mc.options.keyAttack.isDown(), "LMB");
		box(g, mc, bx + 34, by + 44, 30, mc.options.keyUse.isDown(), "RMB");
	}

	private static void box(GuiGraphics g, Minecraft mc, int x, int y, int w, boolean down, String label) {
		g.fill(x, y, x + w, y + 20, down ? 0xE6FF7EC9 : 0x99201530);
		int tw = mc.font.width(label);
		g.drawString(mc.font, Component.literal(label), x + (w - tw) / 2, y + 6, down ? INK : WHITE);
	}
}
