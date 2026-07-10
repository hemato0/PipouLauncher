package com.pipou.pipoumod;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** État persistant des modules (id -> activé), sauvegardé dans config/pipoumod.json. */
public final class PipouOptions {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("pipoumod.json");

	private static Map<String, Boolean> enabled = new HashMap<>();

	private PipouOptions() {}

	public static boolean isEnabled(String id) {
		return Boolean.TRUE.equals(enabled.get(id));
	}

	public static void toggle(String id) {
		enabled.put(id, !isEnabled(id));
		save();
	}

	@SuppressWarnings("unchecked")
	public static void load() {
		try (Reader r = Files.newBufferedReader(FILE)) {
			Map<String, Object> m = GSON.fromJson(r, Map.class);
			if (m != null) {
				enabled = new HashMap<>();
				for (Map.Entry<String, Object> e : m.entrySet()) {
					enabled.put(e.getKey(), Boolean.TRUE.equals(e.getValue()));
				}
			}
		} catch (IOException e) {
			// Pas encore de fichier : on garde les valeurs par défaut (tout désactivé).
		}
	}

	public static void save() {
		try {
			Files.createDirectories(FILE.getParent());
			try (Writer w = Files.newBufferedWriter(FILE)) {
				GSON.toJson(enabled, w);
			}
		} catch (IOException e) {
			// on ignore : la sauvegarde n'est pas critique.
		}
	}
}
