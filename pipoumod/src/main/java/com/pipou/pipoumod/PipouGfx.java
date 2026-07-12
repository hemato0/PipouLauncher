package com.pipou.pipoumod;

import net.minecraft.client.gui.GuiGraphics;
import org.joml.Matrix4f;

import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Helper de transformations (push/pop/translate/scale) COMPATIBLE TOUTES VERSIONS.
 * 1.20.1–1.21.5 : g.pose() = PoseStack (classe Minecraft class_4587).
 * 1.21.6+        : g.pose() = org.joml.Matrix3x2fStack (classe JOML, hors Minecraft).
 *
 * PIÈGES CORRIGÉS (bugs invisibles en dev, cassants en jeu) :
 *  - En jeu, les classes Minecraft sont remappées INTERMEDIARY -> la réflexion par NOM
 *    ("scale", "pushPose") échoue.
 *  - PoseStack a DEUX méthodes (float,float,float) : translate ET scale, indistinguables
 *    par signature, et leurs noms intermediary sont distincts (translate DDD/FFF ne
 *    partagent même pas de nom) -> impossible de résoudre `scale` par nom NI par signature.
 *
 * SOLUTION (ère PoseStack) : on ne touche plus à PoseStack.scale/translate. On récupère le
 * `Matrix4f` JOML courant via last().pose() — résolus par TYPE DE RETOUR (le seul last()
 * renvoie un objet MC qui possède un getter Matrix4f) — puis on applique scale/translate
 * DIRECTEMENT dessus (API JOML, non remappée). push/pop = copie/restauration ABSOLUE du
 * Matrix4f (set) -> aucune ambiguïté, aucune dérive flottante. JOML 1.21.6+ : par nom (JOML
 * n'est pas remappé). Validé hors-jeu sur le vrai PoseStack intermediary + ops JOML.
 */
public final class PipouGfx {
	private PipouGfx() {}

	private static boolean inited = false;
	private static boolean joml = false;             // 1.21.6+ (Matrix3x2fStack)
	private static Method mLast, mPose;              // PoseStack.last() -> Pose ; Pose.pose() -> Matrix4f
	private static Method mPush, mPop, mScale, mTranslate; // ère JOML (Matrix3x2fStack)
	private static final Deque<Matrix4f> saved = new ArrayDeque<>();

	private static void init(Object pose) {
		if (inited) return;
		inited = true;
		Class<?> c = pose.getClass();
		joml = c.getName().toLowerCase().contains("matrix3x2f");
		try {
			if (joml) {
				// JOML n'est PAS remappé -> noms stables et utilisables directement.
				mPush = c.getMethod("pushMatrix");
				mPop = c.getMethod("popMatrix");
				mScale = c.getMethod("scale", float.class, float.class);
				mTranslate = c.getMethod("translate", float.class, float.class);
			} else {
				// last() = LA méthode sans argument dont le type de retour possède lui-même un
				// getter Matrix4f sans argument (= la classe Pose). Identification structurelle,
				// indépendante des noms remappés.
				for (Method m : c.getMethods()) {
					if (m.getParameterCount() != 0 || m.getDeclaringClass() == Object.class) continue;
					Class<?> r = m.getReturnType();
					if (r == void.class || r.isPrimitive() || r == Object.class) continue;
					Method pm = noArgReturning(r, Matrix4f.class);
					if (pm != null) { mLast = m; mPose = pm; break; }
				}
			}
		} catch (Throwable e) { mLast = mPose = mPush = mPop = mScale = mTranslate = null; }
	}

	private static Method noArgReturning(Class<?> c, Class<?> ret) {
		try {
			for (Method m : c.getMethods())
				if (m.getParameterCount() == 0 && m.getReturnType() == ret) return m;
		} catch (Throwable ignored) {}
		return null;
	}

	// Matrix4f courant du PoseStack (top de pile), ou null si non résolu.
	private static Matrix4f matrix(Object poseStack) {
		if (mLast == null || mPose == null) return null;
		try { return (Matrix4f) mPose.invoke(mLast.invoke(poseStack)); } catch (Throwable e) { return null; }
	}

	public static void push(GuiGraphics g) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mPush != null) mPush.invoke(p); } catch (Throwable ignored) {} return; }
		// Backstop anti-fuite : si une exception a sauté un pop, on repart proprement.
		if (saved.size() > 32) saved.clear();
		Matrix4f m = matrix(p);
		saved.push(m != null ? new Matrix4f(m) : new Matrix4f());
	}

	public static void pop(GuiGraphics g) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mPop != null) mPop.invoke(p); } catch (Throwable ignored) {} return; }
		if (saved.isEmpty()) return;
		Matrix4f prev = saved.pop();
		Matrix4f m = matrix(p);
		if (m != null) m.set(prev); // restauration ABSOLUE (pas d'inverse -> zéro dérive)
	}

	public static void translate(GuiGraphics g, float x, float y) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mTranslate != null) mTranslate.invoke(p, x, y); } catch (Throwable ignored) {} return; }
		Matrix4f m = matrix(p);
		if (m != null) m.translate(x, y, 0f);
	}

	public static void scale(GuiGraphics g, float sx, float sy) {
		Object p = g.pose(); init(p);
		if (joml) { try { if (mScale != null) mScale.invoke(p, sx, sy); } catch (Throwable ignored) {} return; }
		Matrix4f m = matrix(p);
		if (m != null) m.scale(sx, sy, 1f);
	}
}
