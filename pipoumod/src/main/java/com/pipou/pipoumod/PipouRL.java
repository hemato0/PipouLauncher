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
		// 1.21+ : méthode STATIQUE (String,String) -> ResourceLocation (= fromNamespaceAndPath).
		// PIÈGE : en jeu le nom est remappé (intermediary) -> getMethod PAR NOM échoue et
		// renvoyait null (+ ctor privé en 1.21) -> PipouRL.of renvoyait NULL => polices/logos
		// cassés. On la résout donc par SIGNATURE (invariante au remap).
		try {
			for (Method m : ResourceLocation.class.getMethods()) {
				if (java.lang.reflect.Modifier.isStatic(m.getModifiers())
						&& m.getReturnType() == ResourceLocation.class
						&& m.getParameterCount() == 2
						&& m.getParameterTypes()[0] == String.class
						&& m.getParameterTypes()[1] == String.class) {
					fromNsPath = m; break;
				}
			}
		} catch (Throwable ignored) {}
		// 1.20.x : pas de méthode statique -> constructeur public (String,String).
		if (fromNsPath == null) {
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
