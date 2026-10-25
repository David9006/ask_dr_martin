'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const db = require('./db');
const { hashPassword, verifyPassword, createToken, hashToken } = require('./auth');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_DAYS = 30;
const MAX_BODY = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

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

const loginFailures = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function fail(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413, code: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        reject(Object.assign(new Error('Body must be valid JSON'), { status: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveUsername(email) {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `reader${base}`.slice(0, 20);
}

function uniqueUsername(base) {
  if (!db.usernameTaken(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base.slice(0, 20 - String(i).length)}${i}`;
    if (!db.usernameTaken(candidate)) return candidate;
  }
  return `${base.slice(0, 12)}${Date.now().toString(36).slice(-6)}`;
}

function issueSession(userId) {
  const token = createToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.createSession({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return db.userForSession(hashToken(token));
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) {
    fail(res, 401, 'invalid_session', 'Please log in again.');
    return null;
  }
  return user;
}

function throttleKey(req, identifier) {
  const ip = req.socket.remoteAddress || 'unknown';
  return `${ip}|${String(identifier || '').toLowerCase()}`;
}

function isThrottled(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function noteFailure(key) {
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

async function handleRegister(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);

  if (!isEmail(email)) {
    return fail(res, 400, 'invalid_email', 'Enter a valid email address.');
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) {
    return fail(res, 400, 'invalid_password', 'Use a password with at least 8 characters.');
  }
  if (db.findByEmail(email)) {
    return fail(res, 409, 'email_taken', 'That email is already registered. Try logging in.');
  }

  const username = uniqueUsername(deriveUsername(email));
  const user = db.createUser({ email, username, passwordHash: hashPassword(body.password) });
  const session = issueSession(user.id);
  return json(res, 201, { token: session.token, expiresAt: session.expiresAt, user });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const identifier = String(body.identifier || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';

  if (!identifier || !password) {
    return fail(res, 400, 'missing_fields', 'Enter your email or handle and your password.');
  }

  const key = throttleKey(req, identifier);
  if (isThrottled(key)) {
    return fail(res, 429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.');
  }

  const row = db.findByIdentifier(identifier);
  if (!row || !verifyPassword(password, row.password_hash)) {
    noteFailure(key);
    return fail(res, 401, 'invalid_credentials', 'Wrong email, handle or password.');
  }

  loginFailures.delete(key);
  const user = db.publicUser(row);
  const session = issueSession(user.id);
  return json(res, 200, { token: session.token, expiresAt: session.expiresAt, user });
}

function handleLogout(req, res) {
  const token = bearerToken(req);
  if (token) db.deleteSession(hashToken(token));
  return json(res, 200, { ok: true });
}

function handleMe(req, res) {
  const user = requireUser(req, res);
  if (!user) return undefined;
  return json(res, 200, { user });
}

function handleListAnswers(req, res) {
  const user = requireUser(req, res);
  if (!user) return undefined;
  return json(res, 200, { answers: db.listAnswers(user.id) });
}

async function handleSaveAnswer(req, res) {
  const user = requireUser(req, res);
  if (!user) return undefined;

  const body = await readBody(req);
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();

  if (question.length < 3 || question.length > 500) {
    return fail(res, 400, 'invalid_question', 'A question needs 3 to 500 characters.');
  }
  if (answer.length < 1 || answer.length > 8000) {
    return fail(res, 400, 'invalid_answer', 'An answer needs 1 to 8000 characters.');
  }

  const saved = db.saveAnswer({ userId: user.id, question, answer });
  return json(res, saved.updated ? 200 : 201, { answer: saved });
}

function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/') relative = '/index.html';
  const filePath = path.join(ROOT, relative);

  if (!filePath.startsWith(ROOT + path.sep) || relative.includes('..')) {
    return fail(res, 403, 'forbidden', 'Forbidden.');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    switch (route) {
      case 'GET /api/health':
        return json(res, 200, { ok: true });
      case 'POST /api/auth/register':
        return await handleRegister(req, res);
      case 'POST /api/auth/login':
        return await handleLogin(req, res);
      case 'POST /api/auth/logout':
        return handleLogout(req, res);
      case 'GET /api/auth/me':
        return handleMe(req, res);
      case 'GET /api/answers':
        return handleListAnswers(req, res);
      case 'POST /api/answers':
        return await handleSaveAnswer(req, res);
      default:
        break;
    }
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[api]', err);
    return fail(res, status, err.code || 'server_error', status === 500 ? 'Unexpected server error.' : err.message);
  }

  if (url.pathname.startsWith('/api/')) {
    return fail(res, 404, 'not_found', 'Unknown API route.');
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, url.pathname);
  }

  return fail(res, 405, 'method_not_allowed', 'Method not allowed.');
});

db.pruneSessions();
setInterval(db.pruneSessions, 6 * 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Ask Dr. Martin running at http://${HOST}:${PORT}/`);
  console.log(`SQLite database: ${db.dbPath}`);
});
