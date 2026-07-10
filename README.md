# PipouLauncher 💜

A free desktop launcher for **Minecraft: Java Edition**, focused on **client-side
performance optimization**. PipouLauncher tunes the JVM for the player's hardware
and installs open-source performance mods so weaker PCs can run more mods without
lag.

> Personal / hobby project by a single developer. This repository also serves as
> the **"associated website"** for the Minecraft app-registration review
> (https://aka.ms/mce-reviewappid).
>
> **Azure Application (client) ID:** `ac86e5e9-c19c-451e-9a6b-4ba3e8e321a0`

---

## What it does

- **Performance tuning** — detects CPU / RAM / GPU and generates optimized JVM
  arguments (client-side GC selection: tuned G1 for small PCs, generational ZGC
  for powerful ones) and an optimized `options.txt`.
- **Optimization mods** — installs verified open-source mods from
  [Modrinth](https://modrinth.com) (Sodium, Lithium, FerriteCore, EntityCulling,
  Krypton, ModernFix…) with automatic dependency resolution.
- **Mod profiles ("instances")** — CurseForge-style: each profile has its own
  Minecraft version, RAM allocation, loader and mod list (with logos).
- **Multi-loader** — Fabric, Quilt, Forge and NeoForge. Fabric/Quilt via their
  Meta APIs; Forge/NeoForge via their official installers, run headless.
- **Modpack import** — imports Modrinth `.mrpack` modpacks into a new profile.
- **In-game overlay (PipouMod)** — our own open-source Fabric mod: a Right-Shift
  menu with FPS, coordinates, keystrokes, CPS, armor, potions and ping.
- **Offline mode** — play solo / cracked servers without a Microsoft account.

## Authentication & privacy

- Sign-in uses the **standard Microsoft OAuth 2.0 authorization-code + PKCE flow**
  with a **loopback redirect** (`http://127.0.0.1`). Login happens in the user's
  **system browser** — the launcher **never sees the password**.
- Only an **OS-encrypted refresh token** is stored locally (Electron
  `safeStorage` / Windows DPAPI).
- Access to the Minecraft Services API (`login_with_xbox`, `/minecraft/profile`)
  is used **only** to authenticate the player's own account and launch the game
  they already own.
- **No user data is collected, sold or shared.**
- The app is a **public client** (PKCE, no client secret), supported account type
  `AzureADandPersonalMicrosoftAccount`.

## Tech

- **Electron** (main / preload / renderer, `contextIsolation` on, sandboxed).
- Mojang launcher protocol (version manifest, libraries with OS rules, assets by
  hash, native extraction); Fabric/Quilt Meta; Forge/NeoForge official installers.
- Mods sourced exclusively from the official **Modrinth** API — 100% legal, no
  proprietary or redistributed launcher code.

## Run in dev

```bash
npm install
npm start
```

## Status

Work in progress. Microsoft/Minecraft **online** login requires this Azure app to
be approved for the Minecraft API (review pending); until then, **offline mode**
is available for solo and cracked servers.

## License

Personal project. Third-party mods keep their own licenses and are downloaded
from Modrinth **at the user's request** — never redistributed.
