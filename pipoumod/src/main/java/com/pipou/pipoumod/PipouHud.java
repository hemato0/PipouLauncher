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
				g.drawString(mc.font, Component.literal(mc.getFps() + " FPS"), 4, y, PINK, PipouOptions.isEnabled("fps.shadow"));
				y += 11;
			}
			if (PipouOptions.isEnabled("coords")) {
				y = line(g, mc, Component.literal(String.format("XYZ  %.1f  %.1f  %.1f", mc.player.getX(), mc.player.getY(), mc.player.getZ())), y, WHITE);
				if (PipouOptions.isEnabled("coords.direction"))
					y = line(g, mc, Component.literal("Direction : " + mc.player.getDirection().getName()), y, LAV);
				if (PipouOptions.isEnabled("coords.biome") && mc.level != null)
					y = line(g, mc, Component.literal("Biome : " + mc.level.getBiome(mc.player.blockPosition()).unwrapKey().map(k -> k.location().getPath()).orElse("?")), y, LAV);
				if (PipouOptions.isEnabled("coords.day") && mc.level != null)
					y = line(g, mc, Component.literal("Jour " + (mc.level.getDayTime() / 24000L)), y, LAV);
			}
			if (PipouOptions.isEnabled("ping"))
				y = line(g, mc, Component.literal("Ping : " + ping(mc) + " ms"), y, LAV);
			if (PipouOptions.isEnabled("clock")) {
				String fmt = PipouOptions.isEnabled("clock.seconds") ? "HH:mm:ss" : "HH:mm";
				y = line(g, mc, Component.literal(new SimpleDateFormat(fmt).format(new Date())), y, LAV);
			}
			if (PipouOptions.isEnabled("speed")) {
				var v = mc.player.getDeltaMovement();
				y = line(g, mc, Component.literal(String.format("Vitesse %.1f b/s", Math.sqrt(v.x * v.x + v.z * v.z) * 20.0)), y, PINK);
			}
			if (PipouOptions.isEnabled("memory")) {
				Runtime rt = Runtime.getRuntime();
				y = line(g, mc, Component.literal("RAM " + ((rt.totalMemory() - rt.freeMemory()) / 1048576L) + " / " + (rt.maxMemory() / 1048576L) + " Mo"), y, WHITE);
			}
			if (PipouOptions.isEnabled("light") && mc.level != null)
				y = line(g, mc, Component.literal("Lumière : " + mc.level.getMaxLocalRawBrightness(mc.player.blockPosition())), y, WHITE);
			if (PipouOptions.isEnabled("target"))
				y = line(g, mc, Component.literal("Visé : " + targetBlock(mc)), y, WHITE);
			if (PipouOptions.isEnabled("session"))
				y = line(g, mc, Component.literal("Session : " + sessionTime()), y, LAV);
			if (PipouOptions.isEnabled("xp"))
				y = line(g, mc, Component.literal("XP : niveau " + mc.player.experienceLevel), y, WHITE);
			if (PipouOptions.isEnabled("serverip"))
				y = line(g, mc, Component.literal("Serveur : " + serverName(mc)), y, LAV);
			if (PipouOptions.isEnabled("hunger")) {
				var fd = mc.player.getFoodData();
				y = line(g, mc, Component.literal(String.format("Faim %d/20  Sat %.1f", fd.getFoodLevel(), fd.getSaturationLevel())), y, WHITE);
			}
			if (PipouOptions.isEnabled("cps"))
				y = line(g, mc, Component.literal("CPS  " + PipouTracker.leftCps() + " | " + PipouTracker.rightCps()), y, PINK);

			// --- Effets de potions (sous la colonne) ---
			if (PipouOptions.isEnabled("potions")) {
				y += 4;
				for (MobEffectInstance eff : mc.player.getActiveEffects()) {
					// getEffect() = Holder<MobEffect> en 1.21, MobEffect direct en 1.20.x.
				Object h = eff.getEffect();
				net.minecraft.world.effect.MobEffect me = h instanceof net.minecraft.core.Holder<?> hh
						? (net.minecraft.world.effect.MobEffect) hh.value() : (net.minecraft.world.effect.MobEffect) h;
				String name = me.getDisplayName().getString();
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

	// Début de session (remis à zéro à la connexion, voir PipouModClient).
	public static long sessionStart = System.currentTimeMillis();
	private static String sessionTime() {
		long s = (System.currentTimeMillis() - sessionStart) / 1000L;
		return String.format("%d:%02d", s / 60, s % 60);
	}

	private static String targetBlock(Minecraft mc) {
		if (mc.level != null && mc.hitResult instanceof net.minecraft.world.phys.BlockHitResult bhr)
			return mc.level.getBlockState(bhr.getBlockPos()).getBlock().getName().getString();
		return "—";
	}

	private static String serverName(Minecraft mc) {
		var sd = mc.getCurrentServer();
		return sd != null ? sd.ip : "Solo";
	}

	// Emplacements d'armure (casque -> bottes) via getItemBySlot : stable sur toutes
	// les versions (getArmorSlots() a disparu en 1.21.5).
	private static final net.minecraft.world.entity.EquipmentSlot[] ARMOR = {
			net.minecraft.world.entity.EquipmentSlot.HEAD,
			net.minecraft.world.entity.EquipmentSlot.CHEST,
			net.minecraft.world.entity.EquipmentSlot.LEGS,
			net.minecraft.world.entity.EquipmentSlot.FEET
	};

	private static void drawArmor(GuiGraphics g, Minecraft mc) {
		int x = mc.getWindow().getGuiScaledWidth() - 40;
		int y = mc.getWindow().getGuiScaledHeight() / 2 - 44;
		for (net.minecraft.world.entity.EquipmentSlot slot : ARMOR) {
			ItemStack st = mc.player.getItemBySlot(slot);
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
