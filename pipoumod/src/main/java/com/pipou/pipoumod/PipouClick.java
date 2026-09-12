package com.pipou.pipoumod;

import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.chat.Style;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

/**
 * Construit un texte de chat CLIQUABLE (ClickEvent RUN_COMMAND) de façon compatible toutes
 * versions, PAR RÉFLEXION (l'API ClickEvent a été refondue en 1.21.5 : classe + enum Action
 * -> interface + records ; `getPermittedSubclasses()` est strippé donc inutilisable).
 *
 * On ne référence QUE {@code ClickEvent.class} dans le source (jamais Action/RunCommand par nom)
 * -> compile sur les 15 versions. Détection de l'ère au runtime via {@code isInterface()} :
 *  - ancienne : ctor public (Action, String), RUN_COMMAND = enum ordinal 2 ;
 *  - nouvelle : record RunCommand(String), reconnu par « ctor String unique + action().ordinal()==2 ».
 * En cas d'échec (version inattendue), {@link #button} renvoie du texte simple NON cliquable.
 */
public final class PipouClick {
	private PipouClick() {}

	private static boolean init = false;
	private static Constructor<?> oldCtor; // (Action, String)
	private static Object oldRun;          // Action.RUN_COMMAND
	private static Constructor<?> newCtor;  // RunCommand(String)
	private static Method withClick;        // Style.withClickEvent(ClickEvent)

	private static synchronized void init() {
		if (init) return;
		init = true;
		try {
			Class<?> ce = net.minecraft.network.chat.ClickEvent.class;
			if (ce.isInterface()) {
				// Nouvelle ère : trouver le record dont le ctor est (String) et action().ordinal()==2.
				Class<?> actionEnum = null;
				for (Class<?> nc : ce.getDeclaredClasses()) if (nc.isEnum()) { actionEnum = nc; break; }
				for (Class<?> nc : ce.getDeclaredClasses()) {
					if (nc.isEnum() || !ce.isAssignableFrom(nc)) continue;
					Constructor<?> c;
					try { c = nc.getConstructor(String.class); } catch (NoSuchMethodException e) { continue; }
					try {
						Object inst = c.newInstance("");
						if (actionEnum != null) {
							for (Method m : nc.getMethods()) {
								if (m.getParameterCount() == 0 && m.getReturnType() == actionEnum) {
									Object act = m.invoke(inst);
									if (act instanceof Enum<?> en && en.ordinal() == 2) { newCtor = c; break; }
								}
							}
						}
					} catch (Throwable ignored) {}
					if (newCtor != null) break;
				}
			} else {
				// Ancienne ère : ctor (Action, String) ; RUN_COMMAND = 3e constante (ordinal 2).
				for (Constructor<?> c : ce.getConstructors()) {
					Class<?>[] p = c.getParameterTypes();
					if (p.length == 2 && p[0].isEnum() && p[1] == String.class) {
						oldCtor = c;
						Object[] cs = p[0].getEnumConstants();
						if (cs != null && cs.length > 2) oldRun = cs[2];
						break;
					}
				}
			}
			// Style.withClickEvent(ClickEvent) : méthode Style -> Style à 1 param exactement de type ClickEvent.
			for (Method m : Style.class.getMethods()) {
				if (m.getReturnType() == Style.class && m.getParameterCount() == 1 && m.getParameterTypes()[0] == ce) {
					withClick = m; break;
				}
			}
		} catch (Throwable ignored) {}
	}

	private static Object clickEvent(String cmd) {
		init();
		try {
			if (newCtor != null) return newCtor.newInstance(cmd);
			if (oldCtor != null && oldRun != null) return oldCtor.newInstance(oldRun, cmd);
		} catch (Throwable ignored) {}
		return null;
	}

	private static boolean logged = false;

	/** Texte de chat cliquable qui exécute {@code cmd} (RUN_COMMAND). Repli : texte coloré non cliquable. */
	public static MutableComponent button(String label, int rgb, String cmd) {
		Style st = Style.EMPTY.withColor(rgb).withBold(true);
		Object ce = clickEvent(cmd);
		boolean attached = false;
		if (ce != null && withClick != null) {
			try { st = (Style) withClick.invoke(st, ce); attached = true; } catch (Throwable ignored) {}
		}
		// Sonde (une seule fois) : dit dans latest.log si les boutons du chat sont VRAIMENT cliquables.
		if (!logged) {
			logged = true;
			org.slf4j.LoggerFactory.getLogger("pipoumod").info(
					"[bouton chat] clickEvent={} withClickEvent={} -> cliquable={}",
					(ce != null), (withClick != null), attached);
		}
		return Component.literal(label).setStyle(st);
	}
}
