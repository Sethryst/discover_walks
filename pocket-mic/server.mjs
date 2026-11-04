import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index].startsWith('--')) args.set(process.argv[index], process.argv[index + 1]);
}
const host = args.get('--host') || '127.0.0.1';
const port = Number(args.get('--port') || 8787);
const keyPath = args.get('--tls-key');
const certPath = args.get('--tls-cert');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port.');
if ((keyPath && !certPath) || (!keyPath && certPath)) throw new Error('Use --tls-key and --tls-cert together.');

const rooms = new Map();
const ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 64 * 1024;

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function roomFor(id) {
  let room = rooms.get(id);
  if (!room) {
    room = { createdAt: Date.now(), touchedAt: Date.now(), nextSeq: 1, signals: [] };
    rooms.set(id, room);
  }
  room.touchedAt = Date.now();
  return room;
}

function validRoom(id) { return /^[a-z0-9][a-z0-9-]{1,31}$/.test(id); }
function validRole(role) { return role === 'phone' || role === 'receiver'; }

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) reject(new Error('Request body too large.'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('Request body must be JSON.')); }
    });
    request.on('error', reject);
  });
}

function contentType(filePath) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8' }[path.extname(filePath)] || 'application/octet-stream';
}

async function handler(request, response) {
  const url = new URL(request.url, 'http://pocket-mic.local');
  const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(signals|signal|status))?$/);
  if (match) {
    const roomId = decodeURIComponent(match[1]);
    const endpoint = match[2] || 'status';
    if (!validRoom(roomId)) return json(response, 400, { error: 'Invalid room code.' });
    const room = roomFor(roomId);
    if (request.method === 'GET' && endpoint === 'signals') {
      const receiver = url.searchParams.get('for');
      const after = Number(url.searchParams.get('after') || 0);
      if (!validRole(receiver) || !Number.isInteger(after) || after < 0) return json(response, 400, { error: 'Invalid signal cursor.' });
      const messages = room.signals.filter((item) => item.to === receiver && item.seq > after);
      return json(response, 200, { nextCursor: room.nextSeq - 1, messages });
    }
    if (request.method === 'POST' && endpoint === 'signal') {
      let body;
      try { body = await readBody(request); } catch (error) { return json(response, 400, { error: error.message }); }
      if (!validRole(body.from) || !validRole(body.to) || body.from === body.to || typeof body.type !== 'string' || body.payload == null) return json(response, 400, { error: 'Invalid signal.' });
      room.signals.push({ seq: room.nextSeq++, id: randomUUID(), from: body.from, to: body.to, type: body.type, payload: body.payload, createdAt: Date.now() });
      room.signals = room.signals.slice(-100);
      return json(response, 202, { accepted: true });
    }
    if (request.method === 'GET' && endpoint === 'status') return json(response, 200, { room: roomId, signalCount: room.signals.length, touchedAt: room.touchedAt });
    return json(response, 405, { error: 'Method not allowed.' });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' });
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return json(response, 404, { error: 'Not found.' });
  response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-cache' });
  if (request.method === 'HEAD') return response.end();
  return fs.createReadStream(filePath).pipe(response);
}

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) if (room.touchedAt < cutoff) rooms.delete(id);
}, 60_000).unref();

const server = keyPath ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, handler) : http.createServer(handler);
server.listen(port, host, () => console.log(`Pocket Mic listening on ${keyPath ? 'https' : 'http'}://${host}:${port}`));
