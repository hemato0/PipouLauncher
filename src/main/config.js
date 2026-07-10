// Configuration persistante du launcher (userData/config.json).
// Sert notamment à stocker l'ID d'application Azure (client_id) pour l'auth,
// les profils de mods, la version/RAM par profil, etc.

const { app } = require('electron')
const fsp = require('fs/promises')
const path = require('path')

function configPath() { return path.join(app.getPath('userData'), 'config.json') }

async function getConfig() {
  try { return JSON.parse(await fsp.readFile(configPath(), 'utf8')) }
  catch (_) { return {} }
}

// Toutes les écritures passent par cette file d'attente : évite les
// read-modify-write concurrents (ex. import long d'un modpack + action
// utilisateur simultanée) qui s'écraseraient l'un l'autre.
let writeChain = Promise.resolve()

// Mutation atomique : le mutator reçoit l'état FRAIS relu dans la section
// critique et renvoie l'objet complet à écrire.
async function updateConfig(mutator) {
  const run = writeChain.then(async () => {
    const cur = await getConfig()
    const next = await mutator(cur)
    await fsp.writeFile(configPath(), JSON.stringify(next, null, 2))
    return next
  })
  writeChain = run.catch(() => {}) // la file survit à une erreur
  return run
}

async function setConfig(patch) { return updateConfig(cur => ({ ...cur, ...patch })) }

module.exports = { getConfig, setConfig, updateConfig }
