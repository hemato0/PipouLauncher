package com.pipou.pipoumod;

import net.minecraft.resources.ResourceLocation;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Crée un ResourceLocation quelle que soit la version : 1.21+ via
 * ResourceLocation.fromNamespaceAndPath(...), 1.20.x via le constructeur public
 * new ResourceLocation(ns, path) (rendu privé en 1.21). Détection par réflexion.
 */
public final class PipouRL {
	private PipouRL() {}

	private static boolean inited = false;
	private static Method fromNsPath;
	private static Constructor<ResourceLocation> ctor;

	private static void init() {
		if (inited) return;
		inited = true;
		try {
			fromNsPath = ResourceLocation.class.getMethod("fromNamespaceAndPath", String.class, String.class);
		} catch (Throwable e) {
			try { ctor = ResourceLocation.class.getConstructor(String.class, String.class); } catch (Throwable ignored) {}
		}
	}

	public static ResourceLocation of(String ns, String path) {
		init();
		try {
			if (fromNsPath != null) return (ResourceLocation) fromNsPath.invoke(null, ns, path);
			if (ctor != null) return ctor.newInstance(ns, path);
		} catch (Throwable ignored) {
		}
		return null;
	}
}
