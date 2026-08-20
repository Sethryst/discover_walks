#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.pmtiles': 'application/octet-stream' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, requested);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Path outside project');
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(await readFile(file));
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found'); }
});
const selfTest = process.argv.includes('--self-test');
server.listen(selfTest ? 0 : 8080, '127.0.0.1', async () => {
  const address = server.address(); const url = `http://127.0.0.1:${address.port}/?city=dc`;
  if (!selfTest) { console.log(`DC region server: ${url}`); return; }
  try {
    const response = await fetch(url); const html = await response.text();
    if (!response.ok || !html.includes('Walk &amp; Wildlife')) throw new Error('app shell response was invalid');
    console.log(`✓ DC development server self-test passed (${response.status})`);
  } finally { server.close(); }
});
