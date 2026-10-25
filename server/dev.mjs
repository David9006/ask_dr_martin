import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApi } from '../functions/_lib/handler.js';
import { NodeD1 } from './d1-node.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = process.env.ADM_DB
  ? path.resolve(process.env.ADM_DB)
  : path.join(here, 'data', 'ask-dr-martin.db');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new NodeD1(DB_FILE);
db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));

async function toResponse(request, ip) {
  const apiResponse = await handleApi(request, { DB: db }, { ip });
  const body = Buffer.from(await apiResponse.arrayBuffer());
  const headers = {};
  apiResponse.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: apiResponse.status, headers, body };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) {
          res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Payload too large');
          return;
        }
        chunks.push(chunk);
      }

      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks)
      });

      const result = await toResponse(request, req.socket.remoteAddress || '');
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (err) {
      console.error('[dev]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'server_error', message: 'Unexpected server error.' } }));
    }
    return;
  }

  let relative = decodeURIComponent(url.pathname);
  if (relative === '/') relative = '/index.html';
  const filePath = path.join(PUBLIC_DIR, relative);

  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ask Dr. Martin dev server: http://${HOST}:${PORT}/`);
  console.log(`Static files: ${PUBLIC_DIR}`);
  console.log(`Local database: ${DB_FILE}`);
  console.log('Deploy target: Cloudflare Pages (functions/ + D1)');
});
