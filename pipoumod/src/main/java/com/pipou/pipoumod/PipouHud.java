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
	private static final int FAM_COL = 0, FAM_RIGHT = 1, FAM_BOTTOM = 2, FAM_TOP = 3;
	private static final int COMPASS_W = 150; // largeur de la barre boussole

	/** Ordre d'empilement par défaut (colonne haut-gauche), puis potions, armure, keystrokes, boussole. */
	public static final String[] DASHES = {
			"fps", "coords", "ping", "clock", "speed", "memory", "light", "target",
			"session", "xp", "serverip", "hunger", "cps", "potions", "armor", "keystrokes", "compass"
	};

	private static int fam(String id) {
		return id.equals("armor") ? FAM_RIGHT
				: id.equals("keystrokes") ? FAM_BOTTOM
				: id.equals("compass") ? FAM_TOP
				: FAM_COL;
	}

	// Unité de rendu = un dashboard positionné (x,y,w,h). inCol = dans la colonne par défaut
	// (candidat à la fusion en une seule bulle). empty = activé mais sans contenu (éditeur).
	private record Unit(String id, int x, int y, int w, int h, boolean empty, boolean inCol) {}
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

		// --- Passe 1 : position + taille de chaque dashboard activé ---
		List<Unit> units = new ArrayList<>();
		int stackY = 4;
		for (String id : DASHES) {
			if (!PipouOptions.isEnabled(id)) continue;
			int[] size = measure(mc, id);
			boolean empty = size[0] == 0 || size[1] == 0;
			if (empty && !editor) continue; // rien à dessiner en jeu
			int w = empty ? Math.max(46, mc.font.width(label(id)) + 12) : size[0];
			int h = empty ? 13 : size[1];

			int x, y;
			boolean inCol = false;
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
					case FAM_TOP -> { x = clamp(vw / 2 - w / 2, 0, Math.max(0, vw - w)); y = 4; }
					default -> {
						int gap = id.equals("potions") ? 4 : 0;
						x = 4; y = stackY + gap; stackY = y + h;
						inCol = true; // membre de la colonne par défaut (fusionnable)
					}
				}
			}
			units.add(new Unit(id, x, y, w, h, empty, inCol));
		}

		// --- Passe 2 : fonds (badges) — arrière-plan translucide arrondi, opacité réglable ---
		if (PipouOptions.isEnabled("hudstyle")) {
			int op = (int) Math.max(0, Math.min(10, PipouOptions.getNum("hud.opacity", 6)));
			int alpha = Math.round(op / 10f * 235f);
			if (alpha > 4) {
				int col = (alpha << 24) | 0x1A1026;
				boolean merge = PipouOptions.isEnabled("hud.merge");
				if (merge) {
					// Fusion : un seul badge englobe tous les membres de la colonne par défaut.
					int minx = Integer.MAX_VALUE, miny = Integer.MAX_VALUE, maxx = Integer.MIN_VALUE, maxy = Integer.MIN_VALUE, n = 0;
					for (Unit u : units) if (u.inCol()) { minx = Math.min(minx, u.x()); miny = Math.min(miny, u.y()); maxx = Math.max(maxx, u.x() + u.w()); maxy = Math.max(maxy, u.y() + u.h()); n++; }
					if (n > 0) badge(g, minx - 3, miny - 2, maxx + 3, maxy + 2, col);
					for (Unit u : units) if (!u.inCol()) badge(g, u.x() - 3, u.y() - 2, u.x() + u.w() + 3, u.y() + u.h() + 2, col);
				} else {
					for (Unit u : units) badge(g, u.x() - 3, u.y() - 2, u.x() + u.w() + 3, u.y() + u.h() + 2, col);
				}
			}
		}

		// --- Passe 3 : contenu + boîtes pour l'éditeur ---
		for (Unit u : units) {
			if (u.empty()) ghost(g, mc, u.x(), u.y(), u.w(), u.h(), label(u.id()));
			else drawDash(g, mc, u.id(), u.x(), u.y());
			lastBoxes.put(u.id(), new int[]{ u.x(), u.y(), u.w(), u.h() });
		}
	}

	// Fond « badge » arrondi (coins 2px) semi-transparent.
	private static void badge(GuiGraphics g, int x1, int y1, int x2, int y2, int color) {
		if (x2 <= x1 || y2 <= y1) return;
		g.fill(x1 + 2, y1, x2 - 2, y2, color);       // bande centrale (pleine hauteur)
		g.fill(x1, y1 + 2, x1 + 2, y2 - 2, color);   // bord gauche
		g.fill(x2 - 2, y1 + 2, x2, y2 - 2, color);   // bord droit
		g.fill(x1 + 1, y1 + 1, x1 + 2, y1 + 2, color); // coins (1px)
		g.fill(x2 - 2, y1 + 1, x2 - 1, y1 + 2, color);
		g.fill(x1 + 1, y2 - 2, x1 + 2, y2 - 1, color);
		g.fill(x2 - 2, y2 - 2, x2 - 1, y2 - 1, color);
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
		if (id.equals("compass")) return new int[]{ COMPASS_W, PipouOptions.isEnabled("compass.degrees") ? 20 : 11 };
		List<Line> ls = lines(mc, id);
		int w = 0;
		for (Line l : ls) w = Math.max(w, mc.font.width(l.text()));
		return new int[]{ w, ls.size() * 11 };
	}

	private static void drawDash(GuiGraphics g, Minecraft mc, String id, int x, int y) {
		if (id.equals("armor")) { drawArmor(g, mc, x, y); return; }
		if (id.equals("keystrokes")) { drawKeystrokes(g, mc, x, y); return; }
		if (id.equals("compass")) { drawCompass(g, mc, x, y); return; }
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

	// Boussole horizontale (façon Feather) : ruban gradué N/E/S/O, pointeur central = direction visée.
	private static void drawCompass(GuiGraphics g, Minecraft mc, int x, int y) {
		int cx = x + COMPASS_W / 2;
		// Cap boussole (N=0, E=90, S=180, O=270) depuis le yaw MC (0=S, 90=O, 180=N, 270=E).
		double facing = (mc.player.getYRot() + 180.0) % 360.0;
		if (facing < 0) facing += 360.0;
		double visibleDeg = 120.0;
		double pxPerDeg = COMPASS_W / visibleDeg;
		for (int b = 0; b < 360; b += 15) {
			double diff = ((b - facing + 540.0) % 360.0) - 180.0; // écart signé [-180,180]
			if (Math.abs(diff) > visibleDeg / 2.0) continue;
			int tx = cx + (int) Math.round(diff * pxPerDeg);
			String card = cardinal(b);
			if (card != null) {
				int col = b == 0 ? 0xFFFF6B6B : (b % 90 == 0 ? WHITE : LAV); // Nord en rouge
				g.drawString(mc.font, Component.literal(card), tx - mc.font.width(card) / 2, y + 2, col);
			} else {
				g.fill(tx, y + 2, tx + 1, y + 6, 0x66FFFFFF); // graduation intermédiaire
			}
		}
		g.fill(cx, y, cx + 1, y + 10, PINK); // pointeur central
		if (PipouOptions.isEnabled("compass.degrees")) {
			String deg = Math.round(facing) + "°";
			g.drawString(mc.font, Component.literal(deg), cx - mc.font.width(deg) / 2, y + 11, WHITE);
		}
	}

	// Lettre cardinale à la relève boussole b (0=N,90=E,180=S,270=O ; 45=NE...), sinon null (graduation).
	private static String cardinal(int b) {
		return switch (b) {
			case 0 -> "N";
			case 45 -> "NE";
			case 90 -> "E";
			case 135 -> "SE";
			case 180 -> "S";
			case 225 -> "SO";
			case 270 -> "O";
			case 315 -> "NO";
			default -> null;
		};
	}
}
