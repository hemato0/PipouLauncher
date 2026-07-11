package com.pipou.pipoumod;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

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
			try {
				Matcher m = PNG.matcher(msg.getString());
				if (m.find()) {
					File shots = new File(Minecraft.getInstance().gameDirectory, "screenshots");
					lastFile = new File(shots, new File(m.group(1)).getName());
				}
			} catch (Throwable ignored) {
			}
			original.accept(msg);
		};
	}

	/** Copie l'image de la dernière capture dans le presse-papiers système (AWT). */
	public static boolean copyLast() {
		File f = lastFile;
		if (f == null || !f.isFile()) return false;
		try {
			BufferedImage img = ImageIO.read(f);
			if (img == null) return false;
			Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new ImageTransferable(img), null);
			return true;
		} catch (Throwable e) {
			return false;
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
