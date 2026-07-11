# pipou-presence

Petit service de présence pour PipouLauncher : le mod **PipouMod** signale la présence
du joueur et récupère la liste des autres joueurs Pipou en ligne **sur le même serveur
Minecraft**, pour afficher un cœur 💜 dans la liste des joueurs (tab), façon Feather.

- Aucune dépendance (Node http natif). Stockage **en mémoire** avec expiration (15 s).
- Aucune donnée persistée sur disque. On ne garde que { uuid, pseudo, serveur, dernier ping }.

## Endpoints
- `POST /presence` body `{ "uuid": "...", "name": "...", "server": "ip:port" }`
  → `{ "online": ["uuid", ...] }` (joueurs Pipou vus < 15 s sur ce serveur).
- `GET /health` → `{ "ok": true, "servers": n, "players": n }`.

## Lancer en local
```bash
cd pipou-presence
node server.js          # écoute sur http://localhost:8080
```

## Déployer GRATUITEMENT (sans carte bancaire)

### Option A — Render.com (recommandé, le plus simple)
1. Crée un compte sur https://render.com (connexion GitHub, **pas de carte**).
2. **New → Web Service** → choisis ton dépôt `perf-launcher`.
3. Réglages : **Root Directory** = `pipou-presence` · Runtime **Node** · Build (laisser vide) ·
   Start **`node server.js`** · Plan **Free**.
4. Deploy → récupère l'URL, ex. `https://pipou-presence.onrender.com`.

> Le service **se met en veille** après 15 min sans trafic (gratuit) et se **réveille**
> au 1er ping quand tu joues (~30-50 s la 1re fois, puis instantané). Parfait ici :
> la présence n'est utile que quand vous jouez.

### Option B — Koyeb.com (veille aussi, sans carte en général)
New → Deploy → GitHub → dossier `pipou-presence` → instance **Free (nano)** → `node server.js`.

### Option C — jamais en veille (gratuit à vie, plus de mise en place)
Une VM **Oracle Cloud Always Free** (Ampere ARM) fait tourner `node server.js` 24/7
gratuitement — idéal si tu veux zéro temps de réveil. Demande-moi si tu veux ce chemin.

*(Fly.io reste possible via `fly.toml` mais il facture désormais — on l'évite.)*

## Brancher le mod sur le service
Le mod lit l'URL **sans recompilation**, au choix :
- variable d'environnement `PIPOU_PRESENCE_URL=https://pipou-presence.fly.dev`, ou
- propriété JVM `-Dpipou.presence.url=https://pipou-presence.fly.dev` (le launcher
  PipouLauncher peut l'ajouter aux args JVM au lancement).

Sans URL configurée, seul **ton** cœur s'affiche (tu utilises bien Pipou) ; les autres
apparaissent dès que le service est joignable.
