# ANI-MALATORS 3D — Game Server

Real WebSocket multiplayer server for ANI-MALATORS 3D.

## Run Locally (for testing on same WiFi)

```bash
npm install
node server.js
```

Then in the game client (`animalators3d_v15.html`), change:
```js
const WS_URL = 'ws://YOUR_LOCAL_IP:3000';
// e.g. ws://192.168.1.5:3000
```

Find your local IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)

---

## Deploy FREE to Railway (recommended — easiest)

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Deploy: `railway up`
4. Get your URL from Railway dashboard (e.g. `your-app.up.railway.app`)
5. In the game client, change:
   ```js
   const WS_URL = 'wss://your-app.up.railway.app';
   ```

---

## Deploy FREE to Render.com

1. Push this folder to GitHub
2. Go to render.com → New Web Service → Connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Set environment variable: `PORT=3000`
6. Your URL will be `wss://your-app.onrender.com`

---

## Deploy FREE to Fly.io

```bash
npm install -g flyctl
flyctl auth login
flyctl launch
flyctl deploy
```

---

## How it works

- Players connect via WebSocket
- **Quick Match**: auto-joins open rooms, hosts if none found, auto-starts after 8s
- **Friend Lobby**: share a 6-letter code, host starts when ready
- **Duo Mode**: pair with one partner, share team, revive mechanic
- Real players replace bot slots in the game
- Position/HP/facing synced at 20Hz per player
- Handles disconnects, host migration, room cleanup

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | WebSocket server port |
