// Authentification Microsoft/Minecraft (remplaçant de Yggdrasil).
// Flux "authorization code" + PKCE avec redirection LOOPBACK : on ouvre le
// navigateur directement sur l'écran Microsoft (choix du compte), l'utilisateur
// se connecte (on ne voit jamais son mot de passe), Microsoft redirige vers un
// petit serveur local qui capture le code, puis on enchaîne Xbox Live -> XSTS
// -> Minecraft pour le token de jeu + le profil.
//
// ⚠️ CLIENT_ID : app Azure AD (compte perso / "consumers"), "Allow public client
// flows" = Yes, et une URL de redirection "http://localhost" (plateforme Mobile
// and desktop). Voir README.

const { safeStorage, app } = require('electron')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const http = require('http')

// client_id de L'APPLICATION AZURE DU LAUNCHER (enregistrée UNE fois par le
// développeur). Embarquée ici pour que les JOUEURS n'aient RIEN à configurer :
// ils cliquent « Se connecter » et c'est tout. Un client_id public (PKCE, sans
// secret) se distribue sans risque. Si vide -> on retombe sur config/env.
const BUNDLED_CLIENT_ID = 'ac86e5e9-c19c-451e-9a6b-4ba3e8e321a0'

const PLACEHOLDER_CLIENT_ID = 'REMPLACE_PAR_TON_CLIENT_ID_AZURE'
// Résolution : override (config UI, avancé) > variable d'env > embarqué > placeholder.
let overrideClientId = null
function clientId() {
  return overrideClientId || process.env.MSA_CLIENT_ID || BUNDLED_CLIENT_ID || PLACEHOLDER_CLIENT_ID
}
function setClientId(id) { overrideClientId = (id && id.trim()) ? id.trim() : null }
function hasClientId() { const c = clientId(); return !!c && c !== PLACEHOLDER_CLIENT_ID }

const SCOPE = 'XboxLive.signin offline_access'
const AUTHORIZE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

// api.minecraftservices.com (derrière Cloudflare) renvoie 403 sans User-Agent
// correct. On en met un explicite sur TOUTES les requêtes d'auth.
const AUTH_UA = 'perf-launcher/0.1.0 (Minecraft launcher)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': AUTH_UA
    },
    body: JSON.stringify(body)
  })
  return res
}
async function postForm(url, params) {
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  })
}

// ---------- 1) Microsoft OAuth (authorization code + PKCE + loopback) ----------

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function makePkce() {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// Échappe le HTML (défense en profondeur : les valeurs sont des littéraux
// aujourd'hui, mais on ne veut jamais refléter une valeur d'URL brute).
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Petite page HTML renvoyée dans l'onglet du navigateur après la redirection.
function resultPage(title, sub) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>body{background:#140a1f;color:#f7ecfb;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
.box{text-align:center}.t{font-size:22px;font-weight:800;background:linear-gradient(180deg,#ffb8e8,#a855f7);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.s{color:#b79fce;margin-top:8px}</style></head>
<body><div class="box"><div class="t">💜 ${escHtml(title)}</div><div class="s">${escHtml(sub)}</div></div></body></html>`
}

// Démarre un serveur loopback (127.0.0.1) qui attend la redirection OAuth.
// Résout avec le code d'autorisation (après validation du state anti-CSRF).
function startLoopbackServer(expectedState) {
  return new Promise((resolve, reject) => {
    let onCode, onErr
    const codePromise = new Promise((res, rej) => { onCode = res; onErr = rej })

    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return }
      const code = u.searchParams.get('code')
      const state = u.searchParams.get('state')
      const err = u.searchParams.get('error')
      // no-referrer + no-store : l'URL contient le code, on évite qu'il fuite.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
      })

      if (err) {
        res.end(resultPage('Connexion annulée', 'Tu peux fermer cet onglet.'))
        onErr(new Error(u.searchParams.get('error_description') || err))
      } else if (state !== expectedState) {
        res.end(resultPage('Erreur de sécurité', 'Jeton d\'état invalide.'))
        onErr(new Error('state OAuth invalide (CSRF ?).'))
      } else if (code) {
        res.end(resultPage('Connecté ✓', 'Reviens au launcher, tu peux fermer cet onglet.'))
        onCode(code)
      } else {
        res.end(resultPage('En attente…', ''))
      }
    })

    server.on('error', reject)
    // Port éphémère, lié UNIQUEMENT à la loopback (jamais exposé au réseau).
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, codePromise })
    })
  })
}

// Échange le code d'autorisation contre les tokens (avec le code_verifier PKCE).
async function exchangeCode(code, redirectUri, verifier) {
  const res = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: clientId(),
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  })
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new Error(b.error_description || b.error || 'Échec de l\'échange du code.')
  }
  return await res.json() // {access_token, refresh_token, expires_in}
}

async function refreshMsToken(refreshToken) {
  const res = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId(),
    refresh_token: refreshToken,
    scope: SCOPE
  })
  if (!res.ok) throw new Error('Session Microsoft expirée — reconnexion nécessaire.')
  return await res.json()
}

// ---------- 2) Xbox Live -> XSTS -> Minecraft ----------

async function authXboxLive(msAccessToken) {
  const res = await postJson(XBL_URL, {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: `d=${msAccessToken}`
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })
  if (!res.ok) throw new Error(`Xbox Live: HTTP ${res.status}`)
  const data = await res.json()
  return { token: data.Token, uhs: data.DisplayClaims.xui[0].uhs }
}

async function authXSTS(xblToken) {
  const res = await postJson(XSTS_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  })
  if (res.status === 401) {
    const err = await res.json().catch(() => ({}))
    const messages = {
      2148916233: 'Ce compte Microsoft n\'a pas de compte Xbox.',
      2148916235: 'Xbox Live n\'est pas disponible dans ta région.',
      2148916236: 'Vérification adulte requise sur le compte.',
      2148916237: 'Vérification adulte requise sur le compte.',
      2148916238: 'Compte enfant : il doit être ajouté à une famille Microsoft.'
    }
    throw new Error(messages[err.XErr] || 'Autorisation XSTS refusée.')
  }
  if (!res.ok) throw new Error(`XSTS: HTTP ${res.status}`)
  return (await res.json()).Token
}

async function loginMinecraft(uhs, xstsToken) {
  const res = await postJson(MC_LOGIN_URL, {
    identityToken: `XBL3.0 x=${uhs};${xstsToken}`
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Cause connue : l'app Azure n'est pas APPROUVÉE pour l'API Minecraft (403).
    // OAuth + Xbox + XSTS passent, mais Mojang exige que l'app ID soit soumis
    // à https://aka.ms/mce-reviewappid pour utiliser api.minecraftservices.com.
    if (res.status === 403 && /invalid app registration/i.test(body)) {
      throw new Error('Minecraft refuse cette application Azure (« Invalid app registration »). '
        + 'L\'app Azure doit être APPROUVÉE pour l\'API Minecraft : soumets l\'app ID sur '
        + 'https://aka.ms/mce-reviewappid. En attendant, joue en mode hors-ligne (solo / serveurs cracked).')
    }
    throw new Error(`Minecraft login: HTTP ${res.status} ${body.slice(0, 200)}`)
  }
  return (await res.json()).access_token
}

async function fetchProfile(mcAccessToken) {
  const res = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}`, 'User-Agent': AUTH_UA }
  })
  if (res.status === 404) {
    throw new Error('Ce compte ne possède pas Minecraft (Java Edition).')
  }
  if (!res.ok) throw new Error(`Profil: HTTP ${res.status}`)
  return await res.json() // {id (uuid sans tirets), name}
}

// Compte HORS-LIGNE (sans Microsoft) : UUID dérivé du pseudo, à l'identique de
// Minecraft vanilla (UUID v3 = MD5 de "OfflinePlayer:<pseudo>") pour rester
// compatible avec les serveurs en online-mode=false et le solo.
function offlineAccount(username) {
  const name = String(username || '').trim()
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('Pseudo invalide (3 à 16 caractères : lettres, chiffres, _).')
  }
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  md5[6] = (md5[6] & 0x0f) | 0x30 // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80 // variante IETF
  return { uuid: md5.toString('hex'), name, accessToken: '0', type: 'legacy', offline: true }
}

// Chaîne complète token Microsoft -> compte Minecraft prêt pour le lancement.
// On log CHAQUE étape (sans jamais logguer de token) pour diagnostiquer un échec :
// l'erreur renvoyée est préfixée par l'étape qui a lâché.
async function chainToMinecraft(msAccessToken) {
  let step = 'Xbox Live'
  try {
    console.log('[auth] 1/4 Xbox Live…')
    const { token: xbl, uhs } = await authXboxLive(msAccessToken)
    step = 'XSTS'
    console.log('[auth] 2/4 XSTS…')
    const xsts = await authXSTS(xbl)
    step = 'Minecraft (login_with_xbox)'
    console.log('[auth] 3/4 login Minecraft…')
    const mcToken = await loginMinecraft(uhs, xsts)
    step = 'profil Minecraft'
    console.log('[auth] 4/4 profil Minecraft…')
    const profile = await fetchProfile(mcToken)
    console.log('[auth] ✓ connecté :', profile.name)
    return { uuid: profile.id, name: profile.name, accessToken: mcToken, type: 'msa' }
  } catch (e) {
    console.error(`[auth] ✗ échec à l'étape « ${step} » :`, e.message)
    e.message = `[${step}] ${e.message}`
    throw e
  }
}

// ---------- 3) API haut niveau ----------
// (La persistance multi-comptes est gérée par accounts.js.)

// Garde d'idempotence : un 2e login pendant qu'un est en cours renvoie la même
// promesse (pas de 2e serveur ni 2e onglet). `activeCancel` permet d'annuler.
let loginInFlight = null
let activeCancel = null

// Connexion interactive. openUrl(url) ouvre le navigateur sur l'écran Microsoft.
// Le serveur loopback capture la redirection ; timeout de 5 min.
async function login({ openUrl }) {
  if (loginInFlight) return loginInFlight
  loginInFlight = doLogin({ openUrl })
  try { return await loginInFlight }
  finally { loginInFlight = null; activeCancel = null }
}

async function doLogin({ openUrl }) {
  if (!hasClientId()) {
    throw new Error('Aucun ID d\'application Azure configuré. Colle ton client_id dans l\'onglet Avancé (voir README).')
  }

  const { verifier, challenge } = makePkce()
  const state = base64url(crypto.randomBytes(16))
  const { server, port, codePromise } = await startLoopbackServer(state)
  // 127.0.0.1 (et pas "localhost") pour rester cohérent avec l'écoute IPv4.
  const redirectUri = `http://127.0.0.1:${port}`

  let timer
  let code
  try {
    const params = new URLSearchParams({
      client_id: clientId(),
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    })
    console.log('[auth] 0/4 ouverture du navigateur (redirect', redirectUri + ')…')
    openUrl(`${AUTHORIZE_URL}?${params.toString()}`)

    // Attend la redirection, ou le timeout (5 min), ou une annulation explicite.
    const timeout = new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error('Délai de connexion dépassé (5 min).')), 300000)
    })
    const cancelled = new Promise((_, rej) => { activeCancel = () => rej(new Error('Connexion annulée.')) })

    code = await Promise.race([codePromise, timeout, cancelled])
  } finally {
    clearTimeout(timer)
    server.close() // fermé quoi qu'il arrive (succès, timeout, annulation, erreur)
  }

  console.log('[auth] code reçu, échange contre les tokens…')
  let tok
  try {
    tok = await exchangeCode(code, redirectUri, verifier)
  } catch (e) {
    console.error('[auth] ✗ échange du code échoué :', e.message)
    e.message = `[échange du code] ${e.message}`
    throw e
  }
  const acc = await chainToMinecraft(tok.access_token)
  // Le refresh token (chiffré ensuite par le store multi-comptes) permet de rester
  // connecté après fermeture du launcher.
  return { ...acc, refreshToken: tok.refresh_token }
}

// Rafraîchit un compte Microsoft depuis son refresh token (reconnexion après
// redémarrage / changement de compte). Renvoie le compte + un refresh token à jour.
async function refreshAccount(refreshToken) {
  const tok = await refreshMsToken(refreshToken)
  const acc = await chainToMinecraft(tok.access_token)
  return { ...acc, refreshToken: tok.refresh_token || refreshToken }
}

// Annule une connexion en cours (ex. l'utilisateur a fermé le navigateur).
function cancelLogin() {
  if (activeCancel) activeCancel()
}

module.exports = { login, cancelLogin, refreshAccount, chainToMinecraft, offlineAccount, setClientId, hasClientId }
