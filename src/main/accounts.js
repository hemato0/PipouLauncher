// Gestion MULTI-COMPTES persistante.
//   - La liste PUBLIQUE des comptes (id, type, name, uuid) vit dans config.json.
//   - Les refresh tokens Microsoft (secrets) sont chiffrés par l'OS (safeStorage /
//     DPAPI Windows) dans userData/accounts.dat — jamais en clair.
// Un compte hors-ligne n'a pas de secret (uuid dérivé du pseudo).
// Le compte SÉLECTIONNÉ est celui avec lequel on lance Minecraft.

const { safeStorage, app } = require('electron')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { getConfig, updateConfig } = require('./config')

function secretsPath() { return path.join(app.getPath('userData'), 'accounts.dat') }
function genId() { return crypto.randomBytes(8).toString('hex') }

async function loadSecrets() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return {}
    return JSON.parse(safeStorage.decryptString(await fsp.readFile(secretsPath())))
  } catch (_) { return {} }
}
async function saveSecrets(secrets) {
  if (!safeStorage.isEncryptionAvailable()) return
  // Écriture ATOMIQUE (tmp + rename) : une interruption (crash/coupure/kill) pendant
  // l'écriture ne doit PAS laisser accounts.dat tronqué — sinon loadSecrets jette et
  // renvoie {} => TOUS les refresh tokens perdus d'un coup.
  const p = secretsPath()
  const tmp = `${p}.${process.pid}.tmp`
  await fsp.writeFile(tmp, safeStorage.encryptString(JSON.stringify(secrets)))
  try {
    await fsp.rename(tmp, p)
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    throw e
  }
}

// Vue publique { accounts:[{id,type,name,uuid,offline}], selected }.
async function list() {
  const cfg = await getConfig()
  return { accounts: cfg.accounts || [], selected: cfg.selectedAccount || null }
}

async function getPublic(id) {
  const cfg = await getConfig()
  return (cfg.accounts || []).find(a => a.id === id) || null
}

async function getSecret(id) {
  return (await loadSecrets())[id] || null
}

// Ajoute/actualise un compte et le sélectionne. account = { type, name, uuid,
// offline?, refreshToken? }. Renvoie { id }.
async function add(account) {
  // Dédup : même compte (uuid+type) -> on met à jour au lieu de dupliquer.
  const cfg = await getConfig()
  const existing = (cfg.accounts || []).find(a => a.uuid === account.uuid && a.type === account.type)
  const id = existing ? existing.id : genId()
  if (account.type === 'msa' && account.refreshToken) {
    const secrets = await loadSecrets(); secrets[id] = account.refreshToken; await saveSecrets(secrets)
  }
  await updateConfig(cur => {
    const accounts = [...(cur.accounts || [])]
    const pub = { id, type: account.type, name: account.name, uuid: account.uuid, offline: !!account.offline }
    const i = accounts.findIndex(a => a.id === id)
    if (i >= 0) accounts[i] = pub; else accounts.push(pub)
    return { ...cur, accounts, selectedAccount: id }
  })
  return { id }
}

// Met à jour le refresh token d'un compte (rotation après un refresh).
async function updateSecret(id, refreshToken) {
  if (!refreshToken) return
  const secrets = await loadSecrets(); secrets[id] = refreshToken; await saveSecrets(secrets)
}

async function remove(id) {
  const secrets = await loadSecrets(); delete secrets[id]; await saveSecrets(secrets)
  let selected = null
  await updateConfig(cur => {
    const accounts = (cur.accounts || []).filter(a => a.id !== id)
    selected = cur.selectedAccount === id ? (accounts[0] ? accounts[0].id : null) : cur.selectedAccount
    return { ...cur, accounts, selectedAccount: selected }
  })
  return { selected }
}

async function select(id) {
  await updateConfig(cur => ({ ...cur, selectedAccount: id }))
  return { id }
}

module.exports = { list, getPublic, getSecret, add, updateSecret, remove, select }
