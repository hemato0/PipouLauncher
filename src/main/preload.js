// Pont sécurisé entre le renderer (l'UI) et le processus principal.
// contextIsolation étant activé, l'UI n'a PAS accès direct à Node :
// elle ne peut appeler que ce qu'on expose explicitement ici.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  analyze: () => ipcRenderer.invoke('analyze'),
  recompute: (profileId) => ipcRenderer.invoke('recompute', { profileId }),
  getInstallStatus: (gameVersion) =>
    ipcRenderer.invoke('install-status', { gameVersion }),
  installVanilla: (gameVersion) =>
    ipcRenderer.invoke('install-vanilla', { gameVersion }),

  // Comptes Minecraft (multi-comptes persistants + sélecteur)
  bootLog: (msg) => { try { ipcRenderer.invoke('boot-log', msg) } catch (_) {} },

  // Mises à jour automatiques du launcher.
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  onUpdateStatus: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },

  accountsList: () => ipcRenderer.invoke('accounts-list'),
  accountAddMicrosoft: () => ipcRenderer.invoke('account-add-microsoft'),
  accountAddOffline: (username) => ipcRenderer.invoke('account-add-offline', { username }),
  accountSelect: (id) => ipcRenderer.invoke('account-select', { id }),
  accountRemove: (id) => ipcRenderer.invoke('account-remove', { id }),
  installFabric: (gameVersion) =>
    ipcRenderer.invoke('install-fabric', { gameVersion }),

  // Désactivation d'un module hérité (le renderer l'appelle encore au nettoyage)
  removeModule: (id) => ipcRenderer.invoke('remove-module', { id }),

  // Profils de mods
  listProfiles: () => ipcRenderer.invoke('profiles-list'),
  createProfile: (name, opts) => ipcRenderer.invoke('create-profile', { name, opts }),
  switchProfile: (id) => ipcRenderer.invoke('switch-profile', { id }),
  deleteProfile: (id) => ipcRenderer.invoke('delete-profile', { id }),
  profileDetail: (id, perfProfileId) => ipcRenderer.invoke('profile-detail', { id, perfProfileId }),
  setProfileVersion: (id, version) => ipcRenderer.invoke('set-profile-version', { id, version }),
  setProfileRam: (id, mode, mb) => ipcRenderer.invoke('set-profile-ram', { id, mode, mb }),
  setProfileLoader: (id, loader) => ipcRenderer.invoke('set-profile-loader', { id, loader }),
  importModpack: () => ipcRenderer.invoke('import-modpack'),
  refreshProfileIcons: (id) => ipcRenderer.invoke('refresh-profile-icons', { id }),
  profileModIcons: (id) => ipcRenderer.invoke('profile-mod-icons', { id }),
  onModpackProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('modpack-progress', listener)
    return () => ipcRenderer.removeListener('modpack-progress', listener)
  },

  // Gestionnaire de mods (recherche Modrinth)
  listVersions: () => ipcRenderer.invoke('list-versions'),
  searchMods: (query, gameVersion) => ipcRenderer.invoke('search-mods', { query, gameVersion }),
  modVersions: (idOrSlug, gameVersion) => ipcRenderer.invoke('mod-versions', { idOrSlug, gameVersion }),
  installSearchedMod: (m, gameVersion) => ipcRenderer.invoke('install-searched-mod', { ...m, gameVersion }),
  removeSearchedMod: (projectId) => ipcRenderer.invoke('remove-searched-mod', { projectId }),
  removeModFile: (file) => ipcRenderer.invoke('remove-mod-file', { file }),

  // Optimisation système (GPU dédié)
  gpuPrefGet: () => ipcRenderer.invoke('gpu-pref-get'),
  gpuPrefSet: (enabled) => ipcRenderer.invoke('gpu-pref-set', { enabled }),

  // Lancement du jeu
  launchGame: (gameVersion, profileId) =>
    ipcRenderer.invoke('launch-game', { gameVersion, profileId }),
  onPrepareProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('prepare-progress', listener)
    return () => ipcRenderer.removeListener('prepare-progress', listener)
  },
  onGameLog: (cb) => {
    const listener = (_e, line) => cb(line)
    ipcRenderer.on('game-log', listener)
    return () => ipcRenderer.removeListener('game-log', listener)
  },
  onGameExit: (cb) => {
    const listener = (_e, code) => cb(code)
    ipcRenderer.on('game-exit', listener)
    return () => ipcRenderer.removeListener('game-exit', listener)
  },

  // Diagnostic de crash (conflit de mods détecté) + correctifs proposés.
  onGameCrash: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('game-crash', listener)
    return () => ipcRenderer.removeListener('game-crash', listener)
  },
  crashDisableMod: (file) => ipcRenderer.invoke('crash-disable-mod', { file }),
  crashUpdateMods: (mods, gameVersion) => ipcRenderer.invoke('crash-update-mods', { mods, gameVersion }),

  // Abonnement à la progression de l'installation de Fabric.
  onFabricProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('fabric-progress', listener)
    return () => ipcRenderer.removeListener('fabric-progress', listener)
  },

  // Abonnement à la progression du téléchargement de Minecraft vanilla.
  onVanillaProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('vanilla-progress', listener)
    return () => ipcRenderer.removeListener('vanilla-progress', listener)
  }
})
