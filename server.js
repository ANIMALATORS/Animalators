/**
 * ANI-MALATORS 3D — Game Server
 * Run: node server.js
 * Players connect via WebSocket to ws://yourhost:3000
 *
 * Deploy options (free):
 *   - Railway.app:  railway up
 *   - Render.com:   render deploy
 *   - Fly.io:       flyctl deploy
 * Then set WS_URL in the client to your deployed URL.
 */

const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

// ── HTTP server (for health checks on platforms like Render) ──
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end('OK');
  } else {
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('ANI-MALATORS 3D Server running');
  }
});

const wss = new WebSocketServer({ server: httpServer });

// ── State ──
// rooms[code] = { code, host, players: Map<id, {ws,id,name,avatar,animal,ready}>, mode, started, map }
const rooms = new Map();
// matchmaking queue
const mmQueue = [];

function genCode() {
  return Math.random().toString(36).slice(2,8).toUpperCase();
}

function broadcast(room, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  for (const [id, p] of room.players) {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  }
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function getRoomState(room) {
  const players = {};
  for (const [id, p] of room.players) {
    players[id] = { id, name: p.name, avatar: p.avatar, animal: p.animal, ready: p.ready, isHost: id === room.host };
  }
  return { type: 'room_state', players, host: room.host, code: room.code, mode: room.mode };
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.players.size === 0) {
    rooms.delete(code);
    console.log(`Room ${code} deleted (empty)`);
  }
}

// ── Connection handler ──
wss.on('connection', (ws) => {
  let peerId = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, payload } = msg;

    switch (type) {

      // ── Matchmaking ──
      case 'mm_search': {
        peerId = payload.id;
        const player = { ws, ...payload, ready: false };

        // Try to join an existing open room
        for (const [code, room] of rooms) {
          if (!room.started && room.mode === 'quick' && room.players.size < 10) {
            room.players.set(peerId, player);
            roomCode = code;
            player.room = code;
            sendTo(ws, { type: 'mm_joined', code, host: room.host });
            broadcast(room, getRoomState(room));
            console.log(`${payload.name} joined quick room ${code} (${room.players.size} players)`);

            // Auto-start at 4+ real players or after 8s
            if (room.players.size >= 4 && !room._startTimer) {
              room._startTimer = setTimeout(() => startRoom(room), 2000);
            }
            return;
          }
        }

        // Create new room and host it
        const code = genCode();
        const room = {
          code, host: peerId, mode: 'quick',
          players: new Map([[peerId, player]]),
          started: false, map: payload.map || 'jungle',
        };
        player.room = code;
        rooms.set(code, room);
        roomCode = code;
        sendTo(ws, { type: 'mm_hosting', code });
        console.log(`${payload.name} hosting quick room ${code}`);

        // Auto-start after 8s
        room._startTimer = setTimeout(() => {
          if (!room.started) startRoom(room);
        }, 8000);
        break;
      }

      // ── Friend rooms ──
      case 'create_room': {
        peerId = payload.id;
        const code = payload.code || genCode();
        const player = { ws, ...payload, ready: true };
        const room = {
          code, host: peerId, mode: payload.mode || 'friends',
          players: new Map([[peerId, player]]),
          started: false, map: payload.map || 'jungle',
        };
        player.room = code;
        rooms.set(code, room);
        roomCode = code;
        sendTo(ws, { type: 'room_created', code });
        broadcast(room, getRoomState(room));
        console.log(`Room ${code} created by ${payload.name} (${room.mode})`);
        break;
      }

      case 'join_room': {
        peerId = payload.id;
        const room = rooms.get(payload.code);
        if (!room) { sendTo(ws, { type: 'error', msg: 'Room not found' }); return; }
        if (room.started) { sendTo(ws, { type: 'error', msg: 'Game already started' }); return; }
        if (room.players.size >= 16) { sendTo(ws, { type: 'error', msg: 'Room full' }); return; }

        const player = { ws, ...payload, ready: false };
        room.players.set(peerId, player);
        roomCode = payload.code;
        player.room = payload.code;
        broadcast(room, getRoomState(room));
        sendTo(ws, getRoomState(room));
        console.log(`${payload.name} joined room ${payload.code} (${room.players.size} players)`);
        break;
      }

      case 'player_ready': {
        const room = rooms.get(roomCode);
        if (!room || !peerId) return;
        const p = room.players.get(peerId);
        if (p) p.ready = true;
        broadcast(room, getRoomState(room));
        break;
      }

      case 'start_game': {
        const room = rooms.get(roomCode);
        if (!room || peerId !== room.host) return;
        if (payload.map) room.map = payload.map;
        startRoom(room);
        break;
      }

      // ── In-game frames ──
      case 'player_frame': {
        const room = rooms.get(roomCode);
        if (!room) return;
        // Update stored state
        const p = room.players.get(peerId);
        if (p) Object.assign(p, payload);
        // Relay to everyone else in room
        broadcast(room, { type: 'player_frame', payload }, peerId);
        break;
      }

      case 'game_event': {
        // Kill, ability use, etc — relay to all
        const room = rooms.get(roomCode);
        if (room) broadcast(room, { type: 'game_event', payload }, peerId);
        break;
      }

      case 'duo_revive': {
        const room = rooms.get(roomCode);
        if (room) broadcast(room, { type: 'duo_revive', payload });
        break;
      }

      case 'chat': {
        const room = rooms.get(roomCode);
        if (room) broadcast(room, { type: 'chat', payload: { from: peerId, name: room.players.get(peerId)?.name, msg: String(payload.msg).slice(0,120) } }, peerId);
        break;
      }

      case 'ping': {
        sendTo(ws, { type: 'pong', t: payload.t });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!peerId || !roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(peerId);
    console.log(`${peerId} left room ${roomCode} (${room.players.size} left)`);

    if (room.players.size === 0) {
      cleanupRoom(roomCode);
      return;
    }

    // Transfer host if needed
    if (room.host === peerId) {
      room.host = room.players.keys().next().value;
      console.log(`Host transferred to ${room.host} in room ${roomCode}`);
    }

    broadcast(room, { type: 'player_left', payload: { id: peerId } });
    broadcast(room, getRoomState(room));
  });

  ws.on('error', () => {});
});

function startRoom(room) {
  if (room.started) return;
  room.started = true;
  clearTimeout(room._startTimer);
  const playerList = {};
  for (const [id, p] of room.players) {
    playerList[id] = { id, name: p.name, avatar: p.avatar, animal: p.animal };
  }
  broadcast(room, { type: 'start_game', map: room.map, mode: room.mode, players: playerList });
  console.log(`Room ${room.code} started with ${room.players.size} real players`);
}

// ── Stats endpoint ──
setInterval(() => {
  const activeRooms = [...rooms.values()].filter(r => r.players.size > 0).length;
  const totalPlayers = [...rooms.values()].reduce((s, r) => s + r.players.size, 0);
  if (totalPlayers > 0) console.log(`[${new Date().toISOString().slice(11,19)}] Rooms: ${activeRooms} | Players online: ${totalPlayers}`);
}, 30000);

httpServer.listen(PORT, () => {
  console.log(`\n🦁 ANI-MALATORS 3D Server`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log(`   Health:    http://localhost:${PORT}/health`);
  console.log(`\nDeploy to Railway/Render/Fly.io then update WS_URL in the client.\n`);
});
