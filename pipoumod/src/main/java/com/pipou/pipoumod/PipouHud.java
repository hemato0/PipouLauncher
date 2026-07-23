package com.pipou.pipoumod;

import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.item.ItemStack;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Dessine les overlays HUD activés (rose PipouLauncher).
 *
 * Chaque overlay est un « dashboard » identifié (même id que le module du mod menu).
 * {@link #layout} calcule sa position puis le dessine : par défaut les modules
 * s'empilent (colonne haut-gauche + armure à droite + keystrokes en bas), mais dès
 * que l'utilisateur en déplace un dans l'ÉDITEUR (PipouHudEditScreen), sa position est
 * mémorisée en FRACTION d'écran (hud.x.<id>/hud.y.<id>) et suit la résolution.
 * Le même {@link #layout} sert au rendu en jeu (editor=false) et à l'éditeur (editor=true).
 */
public class PipouHud {

	// Couleurs ARGB — l'octet alpha (FF) est OBLIGATOIRE sinon invisible.
	private static final int PINK = 0xFFFF7EC9;
	private static final int WHITE = 0xFFFFFFFF;
	private static final int LAV = 0xFFB8A5D8;
	private static final int INK = 0xFF3A0F30;

	// Familles de position par défaut.
	private static final int FAM_COL = 0, FAM_RIGHT = 1, FAM_BOTTOM = 2;

	/** Ordre d'empilement par défaut (colonne haut-gauche), puis potions, armure, keystrokes. */
	public static final String[] DASHES = {
			"fps", "coords", "ping", "clock", "speed", "memory", "light", "target",
			"session", "xp", "serverip", "hunger", "cps", "potions", "armor", "keystrokes"
	};

	private static int fam(String id) {
		return id.equals("armor") ? FAM_RIGHT : id.equals("keystrokes") ? FAM_BOTTOM : FAM_COL;
	}
	private static String label(String id) {
		PipouModules.Module m = PipouModules.byId(id);
		return m != null ? m.label() : id;
	}

	// --- État de glissement (piloté par l'éditeur) : position transitoire d'un module ---
	public static String dragId = null;
	public static float dragFx, dragFy;
	// Dernières boîtes calculées {x, y, w, h} en coordonnées HUD (échelle appliquée) — lues par l'éditeur.
	private static final LinkedHashMap<String, int[]> lastBoxes = new LinkedHashMap<>();
	public static Map<String, int[]> boxes() { return lastBoxes; }

	public static void register() {
		HudRenderCallback.EVENT.register((g, delta) -> {
			Minecraft mc = Minecraft.getInstance();
			if (mc.options.hideGui || mc.player == null) return;
			float f = factor(mc);
			int[] vp = viewport(mc);
			boolean pushed = false;
			if (f != 1f) { PipouGfx.push(g); PipouGfx.scale(g, f, f); pushed = true; }
			try { layout(g, mc, vp[0], vp[1], false); }
			finally { if (pushed) PipouGfx.pop(g); }
		});
	}

	// Échelle du HUD INDÉPENDANTE de la « Taille de l'interface » (GUI Scale) de MC : le HUD
	// garde une taille CONSTANTE. facteur = échelle visée / GUI réel (1 = pas de transformation).
	public static float factor(Minecraft mc) {
		if (PipouOptions.isEnabled("hudscale") && mc.getWindow().getGuiScale() > 0) {
			int hs = Math.max(1, (int) PipouOptions.getNum("hud.scale", 2));
			return hs / (float) mc.getWindow().getGuiScale();
		}
		return 1f;
	}
	// Dimensions de l'espace HUD (après échelle) : {largeur, hauteur}.
	public static int[] viewport(Minecraft mc) {
		if (PipouOptions.isEnabled("hudscale") && mc.getWindow().getGuiScale() > 0) {
			int hs = Math.max(1, (int) PipouOptions.getNum("hud.scale", 2));
			return new int[]{ Math.round(mc.getWindow().getWidth() / (float) hs),
					Math.round(mc.getWindow().getHeight() / (float) hs) };
		}
		return new int[]{ mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight() };
	}

	private static int clamp(int v, int lo, int hi) { return Math.max(lo, Math.min(hi, v)); }

	/**
	 * Positionne + dessine tous les dashboards activés. editor=true dessine un cartouche
	 * fantôme pour un module activé mais momentanément vide (ex. potions sans effet), afin
	 * qu'il reste sélectionnable/déplaçable.
	 */
	public static void layout(GuiGraphics g, Minecraft mc, int vw, int vh, boolean editor) {
		lastBoxes.clear();
		int stackY = 4;
		for (String id : DASHES) {
			if (!PipouOptions.isEnabled(id)) continue;
			int[] size = measure(mc, id);
			boolean empty = size[0] == 0 || size[1] == 0;
			if (empty && !editor) continue; // rien à dessiner en jeu
			int w = empty ? Math.max(46, mc.font.width(label(id)) + 12) : size[0];
			int h = empty ? 13 : size[1];

			int x, y;
			if (id.equals(dragId)) {
				x = clamp(Math.round(dragFx * vw), 0, Math.max(0, vw - w));
				y = clamp(Math.round(dragFy * vh), 0, Math.max(0, vh - h));
			} else if (PipouOptions.hasNum("hud.x." + id)) {
				float fx = (float) PipouOptions.getNum("hud.x." + id, 0);
				float fy = (float) PipouOptions.getNum("hud.y." + id, 0);
				x = clamp(Math.round(fx * vw), 0, Math.max(0, vw - w));
				y = clamp(Math.round(fy * vh), 0, Math.max(0, vh - h));
			} else {
				switch (fam(id)) {
					case FAM_RIGHT -> { x = clamp(vw - w - 4, 0, Math.max(0, vw - w)); y = clamp(vh / 2 - h / 2, 0, Math.max(0, vh - h)); }
					case FAM_BOTTOM -> { x = 6; y = clamp(vh - 92, 0, Math.max(0, vh - h)); }
					default -> {
						int gap = id.equals("potions") ? 4 : 0;
						x = 4; y = stackY + gap; stackY = y + h;
					}
				}
			}

			if (empty) ghost(g, mc, x, y, w, h, label(id));
			else drawDash(g, mc, id, x, y);
			lastBoxes.put(id, new int[]{ x, y, w, h });
		}
	}

	// Cartouche fantôme (éditeur uniquement) pour un module activé sans contenu à l'instant.
	private static void ghost(GuiGraphics g, Minecraft mc, int x, int y, int w, int h, String label) {
		g.fill(x - 2, y - 1, x + w + 2, y + h + 1, 0x552A0F30);
		g.drawString(mc.font, Component.literal(label), x + 2, y + (h - 8) / 2, LAV, false);
	}

	// --- Mesure + dessin par dashboard --------------------------------------------------

	private record Line(Component text, int color, boolean shadow) {}

	// Taille {largeur, hauteur} du dashboard. {0,0} = rien à afficher pour l'instant.
	private static int[] measure(Minecraft mc, String id) {
		if (id.equals("armor")) return armorSize(mc);
		if (id.equals("keystrokes")) return new int[]{ 64, 64 };
		List<Line> ls = lines(mc, id);
		int w = 0;
		for (Line l : ls) w = Math.max(w, mc.font.width(l.text()));
		return new int[]{ w, ls.size() * 11 };
	}

	private static void drawDash(GuiGraphics g, Minecraft mc, String id, int x, int y) {
		if (id.equals("armor")) { drawArmor(g, mc, x, y); return; }
		if (id.equals("keystrokes")) { drawKeystrokes(g, mc, x, y); return; }
		List<Line> ls = lines(mc, id);
		for (int i = 0; i < ls.size(); i++) {
			Line l = ls.get(i);
			if (l.shadow()) g.drawString(mc.font, l.text(), x, y + i * 11, l.color());
			else g.drawString(mc.font, l.text(), x, y + i * 11, l.color(), false);
		}
	}

	// Construit les lignes de texte d'un dashboard (vide = rien à afficher).
	private static List<Line> lines(Minecraft mc, String id) {
		List<Line> out = new ArrayList<>();
		var p = mc.player;
		switch (id) {
			case "fps" -> out.add(new Line(Component.literal(mc.getFps() + " FPS"), PINK, PipouOptions.isEnabled("fps.shadow")));
			case "coords" -> {
				out.add(new Line(Component.literal(String.format("XYZ  %.1f  %.1f  %.1f", p.getX(), p.getY(), p.getZ())), WHITE, true));
				if (PipouOptions.isEnabled("coords.direction"))
					out.add(new Line(Component.literal("Direction : " + p.getDirection().getName()), LAV, true));
				if (PipouOptions.isEnabled("coords.biome") && mc.level != null)
					out.add(new Line(Component.literal("Biome : " + mc.level.getBiome(p.blockPosition()).unwrapKey().map(k -> k.location().getPath()).orElse("?")), LAV, true));
				if (PipouOptions.isEnabled("coords.day") && mc.level != null)
					out.add(new Line(Component.literal("Jour " + (mc.level.getDayTime() / 24000L)), LAV, true));
			}
			case "ping" -> out.add(new Line(Component.literal("Ping : " + ping(mc) + " ms"), LAV, true));
			case "clock" -> {
				String fmt = PipouOptions.isEnabled("clock.seconds") ? "HH:mm:ss" : "HH:mm";
				out.add(new Line(Component.literal(new SimpleDateFormat(fmt).format(new Date())), LAV, true));
			}
			case "speed" -> {
				var v = p.getDeltaMovement();
				out.add(new Line(Component.literal(String.format("Vitesse %.1f b/s", Math.sqrt(v.x * v.x + v.z * v.z) * 20.0)), PINK, true));
			}
			case "memory" -> {
				Runtime rt = Runtime.getRuntime();
				out.add(new Line(Component.literal("RAM " + ((rt.totalMemory() - rt.freeMemory()) / 1048576L) + " / " + (rt.maxMemory() / 1048576L) + " Mo"), WHITE, true));
			}
			case "light" -> {
				if (mc.level != null)
					out.add(new Line(Component.literal("Lumière : " + mc.level.getMaxLocalRawBrightness(p.blockPosition())), WHITE, true));
			}
			case "target" -> out.add(new Line(Component.literal("Visé : " + targetBlock(mc)), WHITE, true));
			case "session" -> out.add(new Line(Component.literal("Session : " + sessionTime()), LAV, true));
			case "xp" -> out.add(new Line(Component.literal("XP : niveau " + p.experienceLevel), WHITE, true));
			case "serverip" -> out.add(new Line(Component.literal("Serveur : " + serverName(mc)), LAV, true));
			case "hunger" -> {
				var fd = p.getFoodData();
				out.add(new Line(Component.literal(String.format("Faim %d/20  Sat %.1f", fd.getFoodLevel(), fd.getSaturationLevel())), WHITE, true));
			}
			case "cps" -> out.add(new Line(Component.literal("CPS  " + PipouTracker.leftCps() + " | " + PipouTracker.rightCps()), PINK, true));
			case "potions" -> {
				for (MobEffectInstance eff : p.getActiveEffects()) {
					// getEffect() = Holder<MobEffect> en 1.21, MobEffect direct en 1.20.x.
					Object h = eff.getEffect();
					net.minecraft.world.effect.MobEffect me = h instanceof net.minecraft.core.Holder<?> hh
							? (net.minecraft.world.effect.MobEffect) hh.value() : (net.minecraft.world.effect.MobEffect) h;
					out.add(new Line(Component.literal(me.getDisplayName().getString() + " " + (eff.getAmplifier() + 1) + "  " + time(eff.getDuration())), WHITE, true));
				}
			}
			default -> {}
		}
		return out;
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

	private static int[] armorSize(Minecraft mc) {
		if (mc.player == null) return new int[]{ 0, 0 };
		int count = 0; boolean anyPct = false;
		for (net.minecraft.world.entity.EquipmentSlot slot : ARMOR) {
			ItemStack st = mc.player.getItemBySlot(slot);
			if (st.isEmpty()) continue;
			count++;
			if (st.isDamageableItem()) anyPct = true;
		}
		if (count == 0) return new int[]{ 0, 0 };
		int w = anyPct ? 20 + mc.font.width("100%") : 18;
		return new int[]{ w, count * 20 };
	}

	// Armure dessinée en colonne depuis (x,y) : icône + pourcentage de durabilité.
	private static void drawArmor(GuiGraphics g, Minecraft mc, int x, int y) {
		int yy = y;
		for (net.minecraft.world.entity.EquipmentSlot slot : ARMOR) {
			ItemStack st = mc.player.getItemBySlot(slot);
			if (st.isEmpty()) continue;
			g.renderItem(st, x, yy);
			if (st.isDamageableItem()) {
				int pct = 100 - (st.getDamageValue() * 100 / st.getMaxDamage());
				g.drawString(mc.font, Component.literal(pct + "%"), x + 20, yy + 4, pct > 25 ? WHITE : 0xFFFF5D8F);
			}
			yy += 20;
		}
	}

	// Bloc keystrokes (W/A/S/D + LMB/RMB) ancré en (x,y) : bloc 64×64.
	private static void drawKeystrokes(GuiGraphics g, Minecraft mc, int x, int y) {
		box(g, mc, x + 22, y, 20, mc.options.keyUp.isDown(), "W");
		box(g, mc, x, y + 22, 20, mc.options.keyLeft.isDown(), "A");
		box(g, mc, x + 22, y + 22, 20, mc.options.keyDown.isDown(), "S");
		box(g, mc, x + 44, y + 22, 20, mc.options.keyRight.isDown(), "D");
		box(g, mc, x, y + 44, 30, mc.options.keyAttack.isDown(), "LMB");
		box(g, mc, x + 34, y + 44, 30, mc.options.keyUse.isDown(), "RMB");
	}

	private static void box(GuiGraphics g, Minecraft mc, int x, int y, int w, boolean down, String label) {
		g.fill(x, y, x + w, y + 20, down ? 0xE6FF7EC9 : 0x99201530);
		int tw = mc.font.width(label);
		g.drawString(mc.font, Component.literal(label), x + (w - tw) / 2, y + 6, down ? INK : WHITE);
	}
}
