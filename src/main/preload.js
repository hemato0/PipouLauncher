// Pont sécurisé entre le renderer (l'UI) et le processus principal.
// contextIsolation étant activé, l'UI n'a PAS accès direct à Node :
// elle ne peut appeler que ce qu'on expose explicitement ici.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  analyze: () => ipcRenderer.invoke('analyze'),
  recompute: (profileId) => ipcRenderer.invoke('recompute', { profileId }),
  resolveMods: (gameVersion, profileId) =>
    ipcRenderer.invoke('resolve-mods', { gameVersion, profileId }),
  installMods: (gameVersion, profileId) =>
    ipcRenderer.invoke('install-mods', { gameVersion, profileId }),
  getInstallStatus: (gameVersion) =>
    ipcRenderer.invoke('install-status', { gameVersion }),
  installVanilla: (gameVersion) =>
    ipcRenderer.invoke('install-vanilla', { gameVersion }),

  // Configuration Azure (client_id)
  getClientId: () => ipcRenderer.invoke('get-client-id'),
  setClientId: (clientId) => ipcRenderer.invoke('set-client-id', { clientId }),

  // Authentification Microsoft
  authLogin: () => ipcRenderer.invoke('auth-login'),
  authOffline: (username) => ipcRenderer.invoke('auth-offline', { username }),
  authCancel: () => ipcRenderer.invoke('auth-cancel'),
  authSilent: () => ipcRenderer.invoke('auth-silent'),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  installFabric: (gameVersion) =>
    ipcRenderer.invoke('install-fabric', { gameVersion }),
  openModsDir: () => ipcRenderer.invoke('open-mods-dir'),

  // Modules (fonctions type Feather)
  modulesList: () => ipcRenderer.invoke('modules-list'),
  installModule: (id, gameVersion) => ipcRenderer.invoke('install-module', { id, gameVersion }),
  removeModule: (id) => ipcRenderer.invoke('remove-module', { id }),

  // Profils de mods
  listProfiles: () => ipcRenderer.invoke('profiles-list'),
  activeProfileMods: () => ipcRenderer.invoke('active-profile-mods'),
  createProfile: (name, opts) => ipcRenderer.invoke('create-profile', { name, opts }),
  switchProfile: (id) => ipcRenderer.invoke('switch-profile', { id }),
  deleteProfile: (id) => ipcRenderer.invoke('delete-profile', { id }),
  profileDetail: (id, perfProfileId) => ipcRenderer.invoke('profile-detail', { id, perfProfileId }),
  setProfileVersion: (id, version) => ipcRenderer.invoke('set-profile-version', { id, version }),
  setProfileRam: (id, mode, mb) => ipcRenderer.invoke('set-profile-ram', { id, mode, mb }),
  setProfileLoader: (id, loader) => ipcRenderer.invoke('set-profile-loader', { id, loader }),
  loadersList: () => ipcRenderer.invoke('loaders-list'),
  importModpack: () => ipcRenderer.invoke('import-modpack'),
  refreshProfileIcons: (id) => ipcRenderer.invoke('refresh-profile-icons', { id }),
  onModpackProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('modpack-progress', listener)
    return () => ipcRenderer.removeListener('modpack-progress', listener)
  },

  // Gestionnaire de mods (recherche Modrinth)
  listVersions: () => ipcRenderer.invoke('list-versions'),
  searchMods: (query, gameVersion) => ipcRenderer.invoke('search-mods', { query, gameVersion }),
  installSearchedMod: (m, gameVersion) => ipcRenderer.invoke('install-searched-mod', { ...m, gameVersion }),
  removeSearchedMod: (projectId) => ipcRenderer.invoke('remove-searched-mod', { projectId }),

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

  // Abonnement à la progression du téléchargement des mods.
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('download-progress', listener)
    return () => ipcRenderer.removeListener('download-progress', listener)
  },

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
