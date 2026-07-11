// Service de présence PipouLauncher (façon Feather) — sans dépendances.
// Chaque client PipouMod POST /presence { uuid, name, server } toutes les ~5 s ;
// on répond { online: [uuid, ...] } = les joueurs Pipou vus récemment sur CE serveur.
// Stockage en mémoire avec expiration (TTL). Aucune donnée persistée sur disque.

const http = require('http')

const PORT = process.env.PORT || 8080
const TTL_MS = 15000 // un joueur est "en ligne" s'il a pingé dans les 15 s

// Plafonds anti-abus (endpoint public non authentifié) : sans bornes, un flood de
// POST à couples (serveur, uuid) uniques ferait gonfler la mémoire jusqu'à l'OOM
// avant l'expiration TTL.
const MAX_SERVERS = 1000
const MAX_PER_SERVER = 1000
const UUID_RE = /^[0-9a-fA-F-]{32,36}$/

// server(ip) -> Map(uuid -> { name, ts })
const servers = new Map()

function prune() {
  const now = Date.now()
  for (const [srv, users] of servers) {
    for (const [uuid, rec] of users) if (now - rec.ts > TTL_MS) users.delete(uuid)
    if (users.size === 0) servers.delete(srv)
  }
}

// Lit le corps JSON. Se règle TOUJOURS (parse OK -> objet ; sinon -> null), y compris
// sur corps trop gros (destroy), erreur, ou connexion coupée — sans quoi la Promise
// pendrait à l'infini (fuite mémoire par requête sur l'endpoint public).
function readJson(req, limit = 10000) {
  return new Promise((resolve) => {
    let body = '', settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    req.on('data', (c) => { body += c; if (body.length > limit) { req.destroy(); done(null) } })
    req.on('end', () => { try { done(JSON.parse(body || '{}')) } catch (_) { done(null) } })
    req.on('error', () => done(null))
    req.on('close', () => done(null))
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/presence') {
      const data = await readJson(req)
      const badReq = (msg) => { try { if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(`{"error":"${msg}"}`) } } catch (_) {} }
      if (!data) return badReq('requête invalide') // corps trop gros / illisible / coupé
      const uuid = String(data.uuid || '')
      const srv = String(data.server || '').slice(0, 128)
      const name = String(data.name || '').slice(0, 32)
      if (!UUID_RE.test(uuid) || !srv) return badReq('uuid+server requis')
      prune()
      let users = servers.get(srv)
      if (!users) {
        if (servers.size >= MAX_SERVERS) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"trop de serveurs"}') }
        users = new Map(); servers.set(srv, users)
      }
      if (!users.has(uuid) && users.size >= MAX_PER_SERVER) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end('{"error":"serveur plein"}') }
      users.set(uuid, { name, ts: Date.now() })
      const online = [...users.keys()]
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ online }))
    }
    if (req.url === '/health' || req.url === '/') {
      prune()
      let total = 0
      for (const users of servers.values()) total += users.size
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, servers: servers.size, players: total }))
    }
    res.writeHead(404); res.end()
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"requête invalide"}')
  }
})

server.listen(PORT, () => console.log('pipou-presence écoute sur le port ' + PORT))
