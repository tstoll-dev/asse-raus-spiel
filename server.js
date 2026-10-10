// HTTP-Server für die statischen Dateien + WebSocket (/ws) für die Synchronisation.
// Der Server ist die einzige Quelle der Wahrheit: Clients schicken Züge, er prüft sie
// und verteilt danach jedem Spieler seine eigene Sicht auf den Tisch.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const ROOM_TTL_MS = 3 * 24 * 60 * 60 * 1000; // ungenutzte Tische nach 3 Tagen wegräumen

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

/** @type {Map<string, Game>} */
const rooms = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const sockets = new Map();

loadRooms();

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      // Immer neu laden, damit nach einem Update nie alte und neue Dateien gemischt werden.
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      send(ws, { type: 'error', message: err.message });
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    sockets.get(ws.room)?.delete(ws);
    const game = rooms.get(ws.room);
    const stillConnected = [...(sockets.get(ws.room) || [])].some((s) => s.clientId === ws.clientId);
    if (game && !stillConnected) {
      game.leave(ws.clientId);
      broadcast(ws.room);
    }
  });
});

function handle(ws, msg) {
  if (msg.type === 'join') {
    const room = String(msg.room || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
    if (!room) throw new Error('Ungültiger Tischname.');
    const clientId = String(msg.clientId || '').slice(0, 64);
    if (!clientId) throw new Error('clientId fehlt.');
    const name = String(msg.name || '').trim().slice(0, 20);

    if (!rooms.has(room)) rooms.set(room, new Game());
    rooms.get(room).join(clientId, name);

    ws.room = room;
    ws.clientId = clientId;
    if (!sockets.has(room)) sockets.set(room, new Set());
    sockets.get(room).add(ws);
    broadcast(room);
    return;
  }

  const game = ws.room && rooms.get(ws.room);
  if (!game) throw new Error('Zuerst einem Tisch beitreten.');

  switch (msg.type) {
    case 'start':
      game.start(ws.clientId, msg.options);
      break;
    case 'pick':
      game.pick(ws.clientId, Number(msg.packet), msg.to);
      break;
    case 'move':
      game.move(ws.clientId, msg.from || {}, msg.to || {});
      break;
    case 'pass':
      game.pass(ws.clientId);
      break;
    case 'leave':
      game.leave(ws.clientId);
      break;
    default:
      throw new Error(`Unbekannte Nachricht: ${msg.type}`);
  }
  broadcast(ws.room);
}

function broadcast(room) {
  const game = rooms.get(room);
  if (!game) return;
  game.updatedAt = Date.now();
  for (const ws of sockets.get(room) || []) {
    send(ws, { type: 'state', room, state: game.viewFor(ws.clientId) });
  }
  scheduleSave();
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// Tote Verbindungen (z. B. Handy im Standby) erkennen.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [room, game] of rooms) {
    if (now - game.updatedAt > ROOM_TTL_MS && !sockets.get(room)?.size) rooms.delete(room);
  }
}, 30_000);

// Zustand auf Platte sichern, damit ein Neustart des Containers kein Spiel kostet.
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = Object.fromEntries([...rooms].map(([room, game]) => [room, game.toJSON()]));
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(data), (err) => err && console.error('Speichern fehlgeschlagen:', err));
  }, 1000);
}

function loadRooms() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const [room, game] of Object.entries(data)) rooms.set(room, Game.fromJSON(game));
    console.log(`${rooms.size} Tisch(e) geladen.`);
  } catch {
    // keine gespeicherten Tische
  }
}

server.listen(PORT, () => console.log(`Ass raus läuft auf http://localhost:${PORT}`));
