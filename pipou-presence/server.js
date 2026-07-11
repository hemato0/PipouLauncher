// Service de présence PipouLauncher (façon Feather) — sans dépendances.
// Chaque client PipouMod POST /presence { uuid, name, server } toutes les ~5 s ;
// on répond { online: [uuid, ...] } = les joueurs Pipou vus récemment sur CE serveur.
// Stockage en mémoire avec expiration (TTL). Aucune donnée persistée sur disque.

const http = require('http')

const PORT = process.env.PORT || 8080
const TTL_MS = 15000 // un joueur est "en ligne" s'il a pingé dans les 15 s

// server(ip) -> Map(uuid -> { name, ts })
const servers = new Map()

function prune() {
  const now = Date.now()
  for (const [srv, users] of servers) {
    for (const [uuid, rec] of users) if (now - rec.ts > TTL_MS) users.delete(uuid)
    if (users.size === 0) servers.delete(srv)
  }
}

function readJson(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > limit) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/presence') {
      const { uuid, name, server: srv } = await readJson(req)
      if (!uuid || !srv) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"uuid+server requis"}') }
      prune()
      if (!servers.has(srv)) servers.set(srv, new Map())
      servers.get(srv).set(String(uuid), { name: String(name || ''), ts: Date.now() })
      const online = [...servers.get(srv).keys()]
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
