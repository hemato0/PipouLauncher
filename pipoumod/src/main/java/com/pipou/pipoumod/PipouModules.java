package com.pipou.pipoumod;

/**
 * Registre des MODULES du mod menu : une carte = un module, avec un interrupteur
 * principal (id) et des SOUS-OPTIONS regroupées (bool/slider/texte) accessibles via
 * la roue ⚙. C'est la source unique de vérité pour l'UI ET le gating du comportement.
 * Pour ajouter une future fonction : ajouter un Module ici (options regroupées dedans).
 */
public final class PipouModules {
	private PipouModules() {}

	public record Opt(String key, String label, String type, double min, double max, double def, String defStr) {
		public static Opt bool(String k, String l) { return new Opt(k, l, "bool", 0, 0, 0, ""); }
		public static Opt slider(String k, String l, double mn, double mx, double d) { return new Opt(k, l, "slider", mn, mx, d, ""); }
		public static Opt text(String k, String l, String d) { return new Opt(k, l, "text", 0, 0, 0, d); }
	}

	public record Module(String id, String label, String category, String icon, boolean isNew, Opt[] options) {}

	private static final Opt[] NONE = new Opt[0];

	public static final Module[] MODULES = {
			// --- HUD ---
			new Module("fps", "FPS", "HUD", "fps", false, new Opt[]{Opt.bool("fps.shadow", "Ombre du texte")}),
			new Module("hudscale", "Taille du HUD", "HUD", "perspective", true, new Opt[]{Opt.slider("hud.scale", "Échelle", 1, 4, 2)}),
			new Module("hudlayout", "Placer le HUD", "HUD", "perspective", true, NONE),
			new Module("coords", "Coordonnées", "HUD", "coords", false, new Opt[]{
					Opt.bool("coords.direction", "Ajouter la direction"),
					Opt.bool("coords.biome", "Ajouter le biome"),
					Opt.bool("coords.day", "Ajouter le jour du monde")}),
			new Module("ping", "Ping", "HUD", "ping", false, NONE),
			new Module("clock", "Horloge", "HUD", "clock", false, new Opt[]{Opt.bool("clock.seconds", "Afficher les secondes")}),
			new Module("memory", "Mémoire", "HUD", "memory", false, NONE),
			new Module("speed", "Vitesse", "HUD", "speed", false, NONE),
			new Module("light", "Niveau de lumière", "HUD", "light", true, NONE),
			new Module("target", "Bloc visé", "HUD", "target", true, NONE),
			new Module("session", "Temps de session", "HUD", "session", true, NONE),
			new Module("xp", "Niveau XP", "HUD", "xp", true, NONE),
			new Module("serverip", "Adresse serveur", "HUD", "serverip", true, NONE),
			new Module("hunger", "Faim & saturation", "HUD", "hunger", true, NONE),
			// --- PvP ---
			new Module("cps", "CPS", "PvP", "cps", false, NONE),
			new Module("keystrokes", "Keystrokes", "PvP", "keystrokes", false, NONE),
			new Module("armor", "Armure", "PvP", "armor", false, NONE),
			new Module("potions", "Potions", "PvP", "potions", false, NONE),
			// --- Rendu ---
			new Module("zoom", "Zoom", "Rendu", "zoom", false, new Opt[]{Opt.slider("zoom.level", "Niveau de zoom", 2, 8, 3)}),
			new Module("brightness", "Luminosité +", "Rendu", "brightness", false, NONE),
			new Module("autosprint", "Auto-sprint", "Rendu", "autosprint", true, NONE),
			new Module("hitbox", "Hitbox", "Rendu", "nametags", true, NONE),
			// --- Chat (options regroupées) ---
			new Module("chat", "Chat", "Chat", "chat_stacking", false, new Opt[]{
					Opt.bool("chat.timestamps", "Horodatage des messages"),
					Opt.bool("chat.timestamps.seconds", "   > avec les secondes"),
					Opt.bool("chat.stacking", "Empiler les doublons (xN)"),
					Opt.bool("chat.copyscreen", "Bouton « Copier » sur les captures")}),
			new Module("autotext", "Auto-texte", "Chat", "autotext", true, NONE),
			new Module("emoji", "Emojis chat", "Chat", "emoji", true, NONE),
			// --- Tab ---
			new Module("tabbadge", "Badge Pipou (tab)", "Tab", "tab_pipou", false, NONE)
	};

	public static Module byId(String id) {
		for (Module m : MODULES) if (m.id().equals(id)) return m;
		return null;
	}
}
