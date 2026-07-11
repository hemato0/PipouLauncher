package com.pipou.pipoumod;

import net.minecraft.client.gui.GuiGraphics;

import java.lang.reflect.Method;

/**
 * Helper de transformations (push/pop/translate/scale) COMPATIBLE TOUTES VERSIONS.
 * 1.21.1–1.21.5 : g.pose() = PoseStack (pushPose / translate(d,d,d) / scale(f,f,f)).
 * 1.21.6+        : g.pose() = Matrix3x2fStack (pushMatrix / translate(f,f) / scale(f,f)).
 * On appelle donc par RÉFLEXION la bonne méthode (détectée une fois), pour que le code
 * source compile et fonctionne quelle que soit la version.
 */
public final class PipouGfx {
	private PipouGfx() {}

	private static boolean inited = false;
	private static boolean matrix2d = false; // true = API 1.21.6+ (Matrix3x2fStack)
	private static Method mPush, mPop, mTranslate, mScale;

	private static void init(Object pose) {
		if (inited) return;
		inited = true;
		Class<?> c = pose.getClass();
		try {
			Method push2d = tryGet(c, "pushMatrix");
			if (push2d != null) {
				matrix2d = true;
				mPush = push2d;
				mPop = c.getMethod("popMatrix");
				mTranslate = c.getMethod("translate", float.class, float.class);
				mScale = c.getMethod("scale", float.class, float.class);
			} else {
				matrix2d = false;
				mPush = c.getMethod("pushPose");
				mPop = c.getMethod("popPose");
				mTranslate = c.getMethod("translate", double.class, double.class, double.class);
				mScale = c.getMethod("scale", float.class, float.class, float.class);
			}
		} catch (Throwable e) {
			mPush = mPop = mTranslate = mScale = null;
		}
	}

	private static Method tryGet(Class<?> c, String name, Class<?>... args) {
		try { return c.getMethod(name, args); } catch (Throwable e) { return null; }
	}

	public static void push(GuiGraphics g) {
		Object p = g.pose(); init(p);
		try { if (mPush != null) mPush.invoke(p); } catch (Throwable ignored) {}
	}

	public static void pop(GuiGraphics g) {
		Object p = g.pose();
		try { if (mPop != null) mPop.invoke(p); } catch (Throwable ignored) {}
	}

	public static void translate(GuiGraphics g, float x, float y) {
		Object p = g.pose(); init(p);
		try {
			if (mTranslate == null) return;
			if (matrix2d) mTranslate.invoke(p, x, y);
			else mTranslate.invoke(p, (double) x, (double) y, 0.0);
		} catch (Throwable ignored) {}
	}

	public static void scale(GuiGraphics g, float sx, float sy) {
		Object p = g.pose(); init(p);
		try {
			if (mScale == null) return;
			if (matrix2d) mScale.invoke(p, sx, sy);
			else mScale.invoke(p, sx, sy, 1f);
		} catch (Throwable ignored) {}
	}
}
