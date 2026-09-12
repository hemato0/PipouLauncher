package com.pipou.pipoumod;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

import javax.imageio.ImageIO;
import java.awt.Image;
import java.awt.Toolkit;
import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.Transferable;
import java.awt.datatransfer.UnsupportedFlavorException;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Copie de capture d'écran : on repère le fichier de la capture dans le message
 * « capture enregistrée » (via son nom .png dans le texte, sans dépendre de ClickEvent
 * dont l'API change entre versions), puis la touche « Copier la dernière capture »
 * le copie dans le presse-papiers. Compatible toutes versions.
 */
public final class PipouScreenshot {
	private PipouScreenshot() {}

	public static volatile File lastFile = null;
	private static final Pattern PNG = Pattern.compile("(\\S+\\.png)");

	/** Enveloppe le consumer du message de capture : mémorise le fichier (branché par ScreenshotMixin).
	 *  On mémorise TOUJOURS (indépendamment des toggles) pour que la touche « copier la
	 *  dernière capture » ne soit jamais silencieusement inopérante. */
	public static Consumer<Component> wrap(Consumer<Component> original) {
		return (msg) -> {
			boolean found = false;
			try {
				Matcher m = PNG.matcher(msg.getString());
				if (m.find()) {
					File shots = new File(Minecraft.getInstance().gameDirectory, "screenshots");
					lastFile = new File(shots, new File(m.group(1)).getName());
					found = true;
				}
			} catch (Throwable ignored) {
			}
			// Capture réussie -> message PROPRE avec boutons cliquables (au lieu du texte vanilla verbeux).
			if (found && PipouOptions.isEnabled("chat.copyscreen")) original.accept(badge());
			else original.accept(msg);
		};
	}

	// Badge de chat : « Capture enregistrée  [ Copier ]  [ Ouvrir ] » (boutons RUN_COMMAND cliquables).
	private static Component badge() {
		MutableComponent out = Component.empty();
		out.append(Component.literal("Capture enregistrée  ").withStyle(s -> s.withColor(0xB8A5D8)));
		out.append(PipouClick.button("[ Copier ]", 0xFF7EC9, "/pipoucopyshot"));
		out.append(Component.literal("  "));
		out.append(PipouClick.button("[ Ouvrir ]", 0xB8A5D8, "/pipouopenshot"));
		return out;
	}

	/** LA dernière capture = le PNG le plus récent du dossier screenshots/. FIABLE (aucun parsing
	 *  de texte, aucun chemin deviné). On garde lastFile comme repli si le dossier était vide. */
	public static File latest() {
		try {
			File shots = new File(Minecraft.getInstance().gameDirectory, "screenshots");
			File[] pngs = shots.listFiles((d, n) -> n.toLowerCase().endsWith(".png"));
			File newest = null;
			if (pngs != null) for (File f : pngs)
				if (f.isFile() && (newest == null || f.lastModified() > newest.lastModified())) newest = f;
			if (newest != null) return newest;
		} catch (Throwable ignored) {}
		return (lastFile != null && lastFile.isFile()) ? lastFile : null;
	}

	/**
	 * Copie l'image de la dernière capture dans le presse-papiers.
	 *
	 * ATTENTION : Minecraft force `java.awt.headless=true` au démarrage -> TOUT AWT lève
	 * HeadlessException (presse-papiers ET Desktop). On tente AWT seulement s'il est utilisable,
	 * sinon on passe par une commande SYSTÈME (processus séparé, donc pas headless).
	 */
	public static boolean copyLast() {
		File f = latest();
		if (f == null || !f.isFile()) return false;
		if (!java.awt.GraphicsEnvironment.isHeadless()) {
			try {
				BufferedImage img = ImageIO.read(f);
				if (img != null) {
					Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new ImageTransferable(img), null);
					return true;
				}
			} catch (Throwable ignored) { /* on bascule sur l'OS */ }
		}
		return copyViaOs(f);
	}

	/** Presse-papiers via l'OS (sans AWT). Windows : PowerShell -sta + SetDataObject(persist=true). */
	private static boolean copyViaOs(File f) {
		String os = System.getProperty("os.name", "").toLowerCase();
		String path = f.getAbsolutePath();
		try {
			ProcessBuilder pb;
			if (os.contains("win")) {
				// -sta : Clipboard exige un thread STA. SetDataObject($i,$true) : la donnée SURVIT
				// à la fin du processus PowerShell (sinon le presse-papiers serait vidé aussitôt).
				String ps = "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;"
						+ "$i=[System.Drawing.Image]::FromFile('" + path.replace("'", "''") + "');"
						+ "[System.Windows.Forms.Clipboard]::SetDataObject($i,$true);";
				pb = new ProcessBuilder("powershell", "-sta", "-NoProfile", "-NonInteractive", "-Command", ps);
			} else if (os.contains("mac")) {
				pb = new ProcessBuilder("osascript", "-e",
						"set the clipboard to (read (POSIX file \"" + path + "\") as TIFF picture)");
			} else {
				pb = new ProcessBuilder("xclip", "-selection", "clipboard", "-t", "image/png", "-i", path);
			}
			Process pr = pb.redirectErrorStream(true).start();
			if (!pr.waitFor(20, java.util.concurrent.TimeUnit.SECONDS)) { pr.destroy(); return false; }
			return pr.exitValue() == 0;
		} catch (Throwable e) {
			return false;
		}
	}

	/** Ouvre la dernière capture dans la visionneuse de l'OS. Renvoie null si OK, sinon l'erreur. */
	public static String openLast() {
		File f = latest();
		if (f == null || !f.isFile()) return "aucune capture trouvée";
		String path = f.getAbsolutePath();
		if (!java.awt.GraphicsEnvironment.isHeadless()) {
			try { java.awt.Desktop.getDesktop().open(f); return null; } catch (Throwable ignored) {}
		}
		String os = System.getProperty("os.name", "").toLowerCase();
		try {
			ProcessBuilder pb;
			if (os.contains("win")) pb = new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", path);
			else if (os.contains("mac")) pb = new ProcessBuilder("open", path);
			else pb = new ProcessBuilder("xdg-open", path);
			pb.start();
			return null;
		} catch (Throwable e) {
			return e.getClass().getSimpleName() + ": " + e.getMessage();
		}
	}

	private static final class ImageTransferable implements Transferable {
		private final Image image;
		ImageTransferable(Image image) { this.image = image; }
		@Override public DataFlavor[] getTransferDataFlavors() { return new DataFlavor[]{DataFlavor.imageFlavor}; }
		@Override public boolean isDataFlavorSupported(DataFlavor f) { return DataFlavor.imageFlavor.equals(f); }
		@Override public Object getTransferData(DataFlavor f) throws UnsupportedFlavorException {
			if (!DataFlavor.imageFlavor.equals(f)) throw new UnsupportedFlavorException(f);
			return image;
		}
	}
}
