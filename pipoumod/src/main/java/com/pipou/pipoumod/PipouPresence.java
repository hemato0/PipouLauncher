package com.pipou.pipoumod;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Présence « qui utilise PipouLauncher », façon Feather : le mod signale sa présence
 * à un petit backend (heartbeat) et récupère la liste des UUID des autres joueurs Pipou
 * en ligne sur le MÊME serveur, pour afficher un cœur dans le tab (PlayerTabOverlayMixin).
 *
 * Sans backend configuré (BACKEND_URL vide), seul le joueur LOCAL a son cœur (il utilise
 * bien Pipou). Renseigne BACKEND_URL une fois le service de présence hébergé.
 */
public final class PipouPresence {
	private PipouPresence() {}

	// URL du service de présence (ex. "https://pipou-presence.fly.dev"). Vide = désactivé.
	private static volatile String backendUrl = "";

	private static final Gson GSON = new Gson();
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
	private static volatile Set<UUID> pipouUsers = new HashSet<>();
	private static int tickCounter = 0;
	private static volatile boolean inFlight = false;

	public static void setBackendUrl(String u) { backendUrl = u == null ? "" : u.trim(); }
	public static boolean hasBackend() { return !backendUrl.isEmpty(); }

	/** Vrai si ce joueur utilise Pipou (moi = toujours vrai). */
	public static boolean isPipou(UUID id) {
		if (id == null) return false;
		Minecraft mc = Minecraft.getInstance();
		if (mc.player != null && id.equals(mc.player.getUUID())) return true;
		return pipouUsers.contains(id);
	}

	/** Appelé chaque tick client ; heartbeat + fetch toutes les ~5 s, en asynchrone. */
	public static void tick(Minecraft mc) {
		if (!PipouOptions.isEnabled("tabbadge") || !hasBackend()) return;
		if (mc.player == null || mc.getConnection() == null) return;
		if (++tickCounter < 100) return; // 20 tps -> ~5 s
		tickCounter = 0;
		if (inFlight) return;

		String server = serverId(mc);
		if (server == null) return; // solo : pas de présence multi
		UUID me = mc.player.getUUID();
		inFlight = true;
		pushAndFetch(me, mc.player.getGameProfile().getName(), server);
	}

	private static String serverId(Minecraft mc) {
		ServerData sd = mc.getCurrentServer();
		return sd != null ? sd.ip : null;
	}

	private static void pushAndFetch(UUID uuid, String name, String server) {
		try {
			JsonObject body = new JsonObject();
			body.addProperty("uuid", uuid.toString());
			body.addProperty("name", name);
			body.addProperty("server", server);
			HttpRequest req = HttpRequest.newBuilder(URI.create(backendUrl + "/presence"))
					.timeout(Duration.ofSeconds(5))
					.header("Content-Type", "application/json")
					.POST(HttpRequest.BodyPublishers.ofString(body.toString()))
					.build();
			HTTP.sendAsync(req, HttpResponse.BodyHandlers.ofString())
					.whenComplete((resp, err) -> {
						try {
							if (err == null && resp.statusCode() == 200) parseOnline(resp.body());
						} catch (Throwable ignored) {
						} finally {
							inFlight = false;
						}
					});
		} catch (Throwable e) {
			inFlight = false;
		}
	}

	/** Réponse attendue : { "online": ["uuid", ...] }. */
	private static void parseOnline(String json) {
		Set<UUID> next = new HashSet<>();
		try {
			JsonObject o = GSON.fromJson(json, JsonObject.class);
			if (o != null && o.has("online")) {
				JsonArray arr = o.getAsJsonArray("online");
				for (int i = 0; i < arr.size(); i++) {
					try { next.add(UUID.fromString(arr.get(i).getAsString())); } catch (Throwable ignored) {}
				}
			}
		} catch (Throwable ignored) {
		}
		pipouUsers = next;
	}
}
