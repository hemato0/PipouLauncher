package com.pipou.pipoumod;

import net.minecraft.client.Minecraft;

import java.util.ArrayDeque;

/**
 * Suit les clics gauche/droit pour calculer le CPS (clics/seconde).
 * Détection par front montant à chaque tick client (sans mixin).
 */
public class PipouTracker {

	private static final ArrayDeque<Long> left = new ArrayDeque<>();
	private static final ArrayDeque<Long> right = new ArrayDeque<>();
	private static boolean lastLeft = false;
	private static boolean lastRight = false;

	public static void tick(Minecraft mc) {
		long now = System.currentTimeMillis();
		boolean l = mc.options.keyAttack.isDown();
		boolean r = mc.options.keyUse.isDown();
		if (l && !lastLeft) left.addLast(now);
		if (r && !lastRight) right.addLast(now);
		lastLeft = l;
		lastRight = r;
		prune(left, now);
		prune(right, now);
	}

	private static void prune(ArrayDeque<Long> q, long now) {
		while (!q.isEmpty() && now - q.peekFirst() > 1000) q.pollFirst();
	}

	public static int leftCps() { return left.size(); }
	public static int rightCps() { return right.size(); }
}
