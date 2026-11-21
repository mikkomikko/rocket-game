import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { WebSocketServer } from 'ws';
import { ONLINE_MAPS } from '@rocket-duel/shared/net.js';

const ROOM_URL = new URL('./room.js', import.meta.url);
const ROOM_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';   // no 0/o or 1/l/i, so a link read aloud still works
const MAX_MESSAGE = 64 * 1024;

/* The game server: many rooms, one match in each. A browser connects to
 *   /?room=new&map=cave        to start a room (the welcome tells it the room's name, for the invite link)
 *   /?room=abc123              to join one (add &token=… to take back your seat after a dropped connection)
 * Each room runs its match in a worker thread (match.js), since the shared simulation's state lives in
 * modules. This thread only passes messages between the browsers and the rooms.
 *
 * Also: GET /health for the host's health check, and with staticDir it serves the built browser game.
 * seed: every room's map seed (tests), else a new one per room. origins: the pages allowed to connect (their Origin header), or empty for any. lag (ms): delays every
 * message each way, to try the game as if over a slow connection. */
export function startServer({ port = 8787, lag = 0, seed = null, pingEvery = 15, origins = [], staticDir = null, maxRooms = 200, idleClose = 60, log = () => {} } = {}) {
  const later = (fn) => (lag > 0 ? setTimeout(fn, lag / 2) : fn());
  const rooms = new Map();   // name → { worker, conns: Map(cid → ws), idleTimer }
  let nextCid = 1;

  function newRoomName() {
    for (;;) {
      const name = Array.from({ length: 6 }, () => ROOM_CHARS[randomInt(ROOM_CHARS.length)]).join('');
      if (!rooms.has(name)) return name;
    }
  }
  function openRoom(map) {
    const name = newRoomName();
    const worker = new Worker(ROOM_URL, { workerData: { map, seed: seed ?? randomInt(1, 1e6), room: name } });
    const room = { name, worker, conns: new Map(), idleTimer: null };
    rooms.set(name, room);
    worker.on('message', (m) => {
      if (m.k === 'send') {
        for (const cid of m.to) {
          const ws = room.conns.get(cid);
          if (ws) later(() => { if (ws.readyState === ws.OPEN) ws.send(m.data); });
        }
      } else if (m.k === 'close') {
        const ws = room.conns.get(m.cid);
        room.conns.delete(m.cid);
        if (ws) later(() => ws.close());
      } else if (m.k === 'idle') {
        // No one is playing and no seat is held: the room closes unless someone joins soon.
        clearTimeout(room.idleTimer);
        if (m.idle) room.idleTimer = setTimeout(() => closeRoom(room), idleClose * 1000);
      }
    });
    worker.on('error', (e) => { log(`room ${name} failed: ${e.stack || e}`); closeRoom(room); });
    log(`room ${name} opened (${map}), ${rooms.size} open`);
    return room;
  }
  function closeRoom(room) {
    if (rooms.get(room.name) !== room) return;
    rooms.delete(room.name);
    clearTimeout(room.idleTimer);
    for (const ws of room.conns.values()) ws.close();
    room.worker.terminate();
    log(`room ${room.name} closed, ${rooms.size} open`);
  }

  const http = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    if (staticDir && (req.method === 'GET' || req.method === 'HEAD')) { serveStatic(staticDir, url.pathname, req, res); return; }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Rocket duel game server\n');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  http.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (origins.length && !origins.includes(origin)) {
      log(`refused a connection from ${origin}`);
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws); connected(ws, new URL(req.url, 'http://x').searchParams); });
  });

  function connected(ws, q) {
    const reply = (m) => later(() => { ws.send(JSON.stringify(m)); ws.close(); });
    let room;
    if (q.get('room') === 'new') {
      const map = q.get('map') || 'cave';
      if (!ONLINE_MAPS.includes(map)) return reply({ t: 'error', text: `Online play doesn't have that map yet.` });
      if (rooms.size >= maxRooms) return reply({ t: 'error', text: 'The server is full right now. Try again in a while.' });
      room = openRoom(map);
    } else {
      room = rooms.get(q.get('room') || '');
      if (!room) return reply({ t: 'noroom' });
    }
    const cid = nextCid++;
    room.conns.set(cid, ws);
    room.worker.postMessage({ k: 'join', cid, token: q.get('token') || null });
    ws.on('message', (data) => later(() => { if (room.conns.has(cid)) room.worker.postMessage({ k: 'msg', cid, data: String(data) }); }));
    ws.on('close', () => later(() => { if (room.conns.delete(cid)) room.worker.postMessage({ k: 'leave', cid }); }));
  }

  // A dead connection (a laptop lid shut, a phone in a tunnel) is noticed by its missing pongs.
  const alive = new WeakSet();
  wss.on('connection', (ws) => { alive.add(ws); ws.on('pong', () => alive.add(ws)); });
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, pingEvery * 1000);

  http.listen(port);
  return {
    port: () => http.address().port,
    rooms: () => [...rooms.keys()],
    close: () => new Promise((done) => {
      clearInterval(pinger);
      for (const room of [...rooms.values()]) closeRoom(room);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      http.close(() => done());
    }),
  };
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
// The built browser game. Unknown paths get index.html; Vite's hashed assets can be cached for good.
function serveStatic(dir, pathname, req, res) {
  const root = resolve(dir);
  let file = join(root, normalize(decodeURIComponent(pathname)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  let st;
  try { st = statSync(file); if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); } } catch { st = null; }
  if (!st) { file = join(root, 'index.html'); try { st = statSync(file); } catch { res.writeHead(404); res.end(); return; } }
  const immutable = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}
