package com.pipou.pipoumod;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** État persistant des modules (activés + favoris + réglages numériques), dans config/pipoumod.json. */
public final class PipouOptions {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("pipoumod.json");

	// Fonctions activées PAR DÉFAUT (si l'utilisateur n'a jamais touché la bascule).
	// Les features chat/tab sont ON d'emblée pour marcher sans configuration.
	private static final Map<String, Boolean> DEFAULTS = new HashMap<>();
	static {
		DEFAULTS.put("chat", true);
		DEFAULTS.put("chat.timestamps", true);
		DEFAULTS.put("chat.stacking", true);
		DEFAULTS.put("chat.copyscreen", true);
		DEFAULTS.put("tabbadge", true);
		DEFAULTS.put("emoji", true);
	}

	private static Map<String, Boolean> enabled = new HashMap<>();
	private static Map<String, Boolean> favorites = new HashMap<>();
	private static Map<String, Double> nums = new HashMap<>();
	private static Map<String, String> strs = new HashMap<>();

	private PipouOptions() {}

	public static boolean isEnabled(String id) {
		Boolean v = enabled.get(id);
		if (v != null) return v;
		return Boolean.TRUE.equals(DEFAULTS.get(id)); // défaut selon la table
	}
	public static void toggle(String id) { enabled.put(id, !isEnabled(id)); save(); }

	public static boolean isFavorite(String id) { return Boolean.TRUE.equals(favorites.get(id)); }
	public static void toggleFavorite(String id) { favorites.put(id, !isFavorite(id)); save(); }

	// Réglages numériques (sliders : niveau de zoom…).
	public static double getNum(String id, double def) {
		Double v = nums.get(id);
		return v != null ? v : def;
	}
	public static void setNum(String id, double val) { nums.put(id, val); save(); }

	// Réglages texte (messages auto-texte…).
	public static String getStr(String id, String def) {
		String v = strs.get(id);
		return v != null ? v : def;
	}
	public static void setStr(String id, String val) { strs.put(id, val == null ? "" : val); save(); }

	// --- Macros auto-texte : lignes { texte, touche GLFW } ---
	public record Macro(String text, int key) {}
	private static java.util.List<Macro> macros = new java.util.ArrayList<>();
	public static java.util.List<Macro> macros() { return macros; }
	private static boolean valid(int i) { return i >= 0 && i < macros.size(); }
	public static void macroAdd() { macros.add(new Macro("", -1)); save(); }
	public static void macroText(int i, String t) { if (valid(i)) { macros.set(i, new Macro(t == null ? "" : t, macros.get(i).key())); save(); } }
	public static void macroKey(int i, int k) { if (valid(i)) { macros.set(i, new Macro(macros.get(i).text(), k)); save(); } }
	public static void macroRemove(int i) { if (valid(i)) { macros.remove(i); save(); } }

	@SuppressWarnings("unchecked")
	public static void load() {
		try (Reader r = Files.newBufferedReader(FILE)) {
			Map<String, Object> m = GSON.fromJson(r, Map.class);
			if (m == null) return;
			enabled = new HashMap<>();
			favorites = new HashMap<>();
			nums = new HashMap<>();
			strs = new HashMap<>();
			Object en = m.get("enabled");
			Object fv = m.get("favorites");
			Object nm = m.get("nums");
			Object st = m.get("strs");
			if (en instanceof Map || fv instanceof Map || nm instanceof Map || st instanceof Map) {
				// Nouveau format { enabled:{}, favorites:{}, nums:{}, strs:{} }.
				if (en instanceof Map) for (Map.Entry<String, Object> e : ((Map<String, Object>) en).entrySet())
					enabled.put(e.getKey(), Boolean.TRUE.equals(e.getValue()));
				if (fv instanceof Map) for (Map.Entry<String, Object> e : ((Map<String, Object>) fv).entrySet())
					favorites.put(e.getKey(), Boolean.TRUE.equals(e.getValue()));
				if (nm instanceof Map) for (Map.Entry<String, Object> e : ((Map<String, Object>) nm).entrySet())
					if (e.getValue() instanceof Number) nums.put(e.getKey(), ((Number) e.getValue()).doubleValue());
				if (st instanceof Map) for (Map.Entry<String, Object> e : ((Map<String, Object>) st).entrySet())
					if (e.getValue() != null) strs.put(e.getKey(), String.valueOf(e.getValue()));
				macros = new java.util.ArrayList<>();
				Object mc = m.get("macros");
				if (mc instanceof java.util.List<?> ml) for (Object o : ml) if (o instanceof Map<?, ?> mm) {
					Object tObj = mm.get("text");
					String t = tObj != null ? String.valueOf(tObj) : "";
					int k = mm.get("key") instanceof Number n ? n.intValue() : -1;
					macros.add(new Macro(t, k));
				}
			} else {
				// Ancien format plat (id -> booléen) : ce sont les "enabled".
				for (Map.Entry<String, Object> e : m.entrySet())
					enabled.put(e.getKey(), Boolean.TRUE.equals(e.getValue()));
			}
		} catch (Exception e) {
			// Fichier absent, illisible, OU JSON corrompu/tronqué (JsonSyntaxException est
			// une RuntimeException, pas une IOException) : on retombe PROPREMENT sur les
			// valeurs par défaut au lieu de laisser l'exception remonter hors de
			// onInitializeClient -> sinon crash-loop client à chaque démarrage.
			enabled = new HashMap<>();
			favorites = new HashMap<>();
			nums = new HashMap<>();
			strs = new HashMap<>();
			macros = new java.util.ArrayList<>();
		}
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			JsonObject root = new JsonObject();
			root.add("enabled", GSON.toJsonTree(enabled));
			root.add("favorites", GSON.toJsonTree(favorites));
			root.add("nums", GSON.toJsonTree(nums));
			root.add("strs", GSON.toJsonTree(strs));
			com.google.gson.JsonArray marr = new com.google.gson.JsonArray();
			for (Macro mac : macros) {
				JsonObject o = new JsonObject();
				o.addProperty("text", mac.text());
				o.addProperty("key", mac.key());
				marr.add(o);
			}
			root.add("macros", marr);
			try (Writer w = Files.newBufferedWriter(FILE)) { GSON.toJson(root, w); }
		} catch (IOException e) {
			// on ignore : la sauvegarde n'est pas critique.
		}
	}
}
