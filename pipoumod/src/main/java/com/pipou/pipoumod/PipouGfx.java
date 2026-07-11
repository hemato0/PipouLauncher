package com.pipou.pipoumod;

import net.minecraft.client.gui.GuiGraphics;

import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Helper de transformations (push/pop/translate/scale) COMPATIBLE TOUTES VERSIONS.
 * 1.20.1–1.21.5 : g.pose() = PoseStack (classe Minecraft class_4587).
 * 1.21.6+        : g.pose() = org.joml.Matrix3x2fStack (classe JOML, hors Minecraft).
 *
 * PIÈGE CORRIGÉ : en JEU (production), les classes Minecraft sont remappées en
 * INTERMEDIARY (PoseStack.scale = method_22905…). Résoudre les méthodes par NOM
 * ("scale", "pushPose") échoue donc au runtime -> toutes les transformations
 * devenaient des no-op -> menu géant décalé hors écran + icônes dessinées à l'origine.
 * Fix : pour PoseStack on résout scale/translate par SIGNATURE (invariante au remap),
 * jamais par nom ; push/pop (0 argument, indistinguables par signature) sont émulés en
 * REJOUANT les inverses au pop. JOML n'étant PAS remappé, ses noms restent utilisables.
 */
public final class PipouGfx {
	private PipouGfx() {}

	private static boolean inited = false;
	private static boolean joml = false; // true = 1.21.6+ (Matrix3x2fStack, non remappé)
	private static Method mPush, mPop, mScale, mTranslate;
	// Pile de transfos pour l'ère PoseStack : chaque frame retient ses scale/translate pour
	// pouvoir les ANNULER au pop (on ne peut pas retrouver popPose par signature : 0 arg).
	private static final Deque<List<float[]>> frames = new ArrayDeque<>();

	private static void init(Object pose) {
		if (inited) return;
		inited = true;
		Class<?> c = pose.getClass();
		joml = c.getName().toLowerCase().contains("matrix3x2f");
		try {
			if (joml) {
				// JOML n'est PAS remappé -> les noms sont stables et utilisables directement.
				mPush = c.getMethod("pushMatrix");
				mPop = c.getMethod("popMatrix");
				mScale = c.getMethod("scale", float.class, float.class);
				mTranslate = c.getMethod("translate", float.class, float.class);
			} else {
				// PoseStack = classe Minecraft REMAPPÉE en jeu -> résolution par SIGNATURE.
				// scale(float,float,float) et translate(double,double,double) sont uniques.
				mScale = bySig(c, float.class, float.class, float.class);
				mTranslate = bySig(c, double.class, double.class, double.class);
			}
		} catch (Throwable e) {
			mPush = mPop = mScale = mTranslate = null;
		}
	}

	// Première méthode PUBLIQUE dont les types de paramètres correspondent EXACTEMENT
	// (le nom peut être n'importe lequel : method_22905 en jeu, scale en dev).
	private static Method bySig(Class<?> c, Class<?>... params) {
		for (Method m : c.getMethods()) {
			Class<?>[] p = m.getParameterTypes();
			if (p.length != params.length) continue;
			boolean ok = true;
			for (int i = 0; i < p.length; i++) if (p[i] != params[i]) { ok = false; break; }
			if (ok) return m;
		}
		return null;
	}

	private static void applyScale(Object p, float sx, float sy) {
		try {
			if (mScale == null) return;
			if (joml) mScale.invoke(p, sx, sy);
			else mScale.invoke(p, sx, sy, 1f);
		} catch (Throwable ignored) {}
	}

	private static void applyTranslate(Object p, float x, float y) {
		try {
			if (mTranslate == null) return;
			if (joml) mTranslate.invoke(p, x, y);
			else mTranslate.invoke(p, (double) x, (double) y, 0.0);
		} catch (Throwable ignored) {}
	}

	public static void push(GuiGraphics g) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mPush != null) mPush.invoke(p); } catch (Throwable ignored) {} }
		else frames.push(new ArrayList<>());
	}

	public static void pop(GuiGraphics g) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mPop != null) mPop.invoke(p); } catch (Throwable ignored) {} return; }
		if (frames.isEmpty()) return;
		List<float[]> ops = frames.pop();
		// Annule dans l'ORDRE INVERSE : la dernière transfo appliquée est la première défaite.
		for (int i = ops.size() - 1; i >= 0; i--) {
			float[] o = ops.get(i);
			if (o[0] == 0f) applyScale(p, 1f / o[1], 1f / o[2]);
			else applyTranslate(p, -o[1], -o[2]);
		}
	}

	public static void translate(GuiGraphics g, float x, float y) {
		Object p = g.pose(); init(p);
		applyTranslate(p, x, y);
		if (!joml && !frames.isEmpty()) frames.peek().add(new float[]{1f, x, y});
	}

	public static void scale(GuiGraphics g, float sx, float sy) {
		Object p = g.pose(); init(p);
		applyScale(p, sx, sy);
		if (!joml && !frames.isEmpty()) frames.peek().add(new float[]{0f, sx, sy});
	}
}
