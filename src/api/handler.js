import { fail, json, readJson, isEmail, normalizeEmail, bearerToken, httpError } from './http.js';
import { hashPassword, verifyPassword, randomToken, sha256Hex, encryptSecret, decryptSecret } from './crypto.js';

const SESSION_DAYS = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const MAX_QUESTION = 500;
const MAX_ANSWER = 8000;

// Best-effort throttle. Each isolate keeps its own map, so this slows down
// brute force rather than guaranteeing a global limit.
const loginFailures = new Map();

export async function handleApi(request, env, options = {}) {
  if (request.method === 'OPTIONS') return preflightResponse();

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const route = `${request.method} ${path}`;

  if (route === 'GET /health') return json(200, { ok: true });

  const db = env && env.DB;
  if (!db) return fail(500, 'db_unbound', 'The D1 binding "DB" is not configured for this deployment.');

  try {
    switch (route) {
      case 'POST /auth/code':
        return await sendCode(request, db, env);
      case 'POST /auth/register':
        return await register(request, db);
      case 'POST /auth/login':
        return await login(request, db, options.ip);
      case 'POST /auth/logout':
        return await logout(request, db);
      case 'GET /auth/me':
        return await me(request, db);
      case 'GET /questions':
        return await listPublicQuestions(request, db);
      case 'GET /answers':
        return await listAnswers(request, db);
      case 'POST /answers':
        return await saveAnswer(request, db);
      case 'GET /settings':
        return await getSettings(request, db, env.SETTINGS_KEY);
      case 'POST /settings':
        return await saveSettings(request, db, env.SETTINGS_KEY);
      default:
        return fail(404, 'not_found', 'Unknown API route.');
    }
  } catch (err) {
    // A missing table almost always means schema.sql was never applied to this
    // database; say so instead of a generic 500.
    if (/no such table/i.test(String(err && err.message))) {
      console.error('[api] missing table', err.message);
      return fail(
        503,
        'schema_missing',
        'The database is missing a table. Apply the schema: npx wrangler d1 execute ask-dr-martin-db --remote --file=./schema.sql'
      );
    }

    const status = err.status || 500;
    // httpError sets both status and code: the message is meant for the client.
    if (err.status && err.code) {
      console.error('[api]', status, err.code, err.message);
      return fail(status, err.code, err.message);
    }
    if (status >= 500) console.error('[api]', err);
    return fail(status, err.code || 'server_error', status >= 500 ? 'Unexpected server error.' : err.message);
  }
}

function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '600'
    }
  });
}

/* ------------------------------------------------------------------ users */

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;

/* ------------------------------------------------ email verification codes */

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_COOLDOWN_MS = 60 * 1000;
const CODE_WINDOW_MS = 60 * 60 * 1000;
const CODE_WINDOW_MAX = 6;
const CODE_MAX_ATTEMPTS = 5;

function randomCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 1000000).padStart(6, '0');
}

function codeHash(email, code) {
  // Salted with the address so a leaked row cannot be matched against a
  // precomputed table of all one-million six-digit codes.
  return sha256Hex(`${email}:${code}`);
}

async function sendVerificationEmail(env, email, code) {
  const transport = String((env && env.MAIL_TRANSPORT) || '').toLowerCase();
  if (transport === 'console') {
    console.log(`[mail] verification code for ${email}: ${code}`);
    return;
  }

  const key = env && env.RESEND_API_KEY;
  if (!key) {
    throw httpError(
      503,
      'mail_not_configured',
      'Email delivery is not configured on this deployment. Set RESEND_API_KEY and MAIL_FROM for the Pages project.'
    );
  }

  const from = (env && env.MAIL_FROM) || 'Dr. Martin <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Ask Dr. Martin - your verification code',
      text: `Your verification code is ${code}\n\nEnter it on the sign-up form within 10 minutes. If you did not try to create an account, ignore this email.\n\nDr. Martin`,
      html:
        `<p>Your verification code is <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>` +
        '<p>Enter it on the sign-up form within 10 minutes. If you did not try to create an account, ignore this email.</p>' +
        '<p>Dr. Martin</p>'
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[mail] Resend rejected the message', response.status, detail.slice(0, 300));
    if (response.status === 403) {
      // Resend only delivers to the account owner until a domain is verified.
      throw httpError(
        502,
        'mail_domain_unverified',
        'Resend is still in test mode: verify a sending domain in Resend, then set MAIL_FROM to an address on that domain.'
      );
    }
    throw httpError(502, 'mail_failed', 'The verification email could not be sent. Try again in a moment.');
  }
}

async function sendCode(request, db, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) return fail(400, 'invalid_email', 'Enter a valid email address.');

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return fail(409, 'email_taken', 'That email is already registered. Try logging in.');

  const now = Date.now();
  const row = await db
    .prepare('SELECT sent_at, window_start, window_count FROM email_codes WHERE email = ?')
    .bind(email)
    .first();

  if (row) {
    const sinceSent = now - new Date(row.sent_at).getTime();
    if (sinceSent < CODE_COOLDOWN_MS) {
      const wait = Math.ceil((CODE_COOLDOWN_MS - sinceSent) / 1000);
      return fail(429, 'code_too_soon', `Wait ${wait} more seconds before requesting another code.`);
    }
  }

  const continuingWindow = Boolean(row) && now - new Date(row.window_start).getTime() < CODE_WINDOW_MS;
  const windowStart = continuingWindow ? row.window_start : new Date(now).toISOString();
  const windowCount = continuingWindow ? Number(row.window_count || 0) + 1 : 1;
  if (windowCount > CODE_WINDOW_MAX) {
    return fail(429, 'code_limit', 'Too many codes requested for this address. Try again in an hour.');
  }

  const code = randomCode();
  const sentAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CODE_TTL_MS).toISOString();

  await db
    .prepare(
      `INSERT INTO email_codes (email, code_hash, expires_at, attempts, sent_at, window_start, window_count)
       VALUES (?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         code_hash = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempts = 0,
         sent_at = excluded.sent_at,
         window_start = excluded.window_start,
         window_count = excluded.window_count`
    )
    .bind(email, await codeHash(email, code), expiresAt, sentAt, windowStart, windowCount)
    .run();

  try {
    await sendVerificationEmail(env, email, code);
  } catch (err) {
    // Nothing was delivered, so drop the row: the next attempt should not have
    // to wait out the cooldown.
    await db.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();
    throw err;
  }

  return json(200, { sent: true, email, expiresAt, resendAfter: CODE_COOLDOWN_MS / 1000 });
}

async function consumeCode(db, email, code) {
  const row = await db
    .prepare('SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ?')
    .bind(email)
    .first();

  if (!row) return { ok: false, response: fail(400, 'code_missing', 'Request a verification code first.') };

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();
    return { ok: false, response: fail(400, 'code_expired', 'That code has expired. Send a new one.') };
  }

  if (Number(row.attempts) >= CODE_MAX_ATTEMPTS) {
    await db.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();
    return { ok: false, response: fail(429, 'code_locked', 'Too many wrong codes. Send a new one.') };
  }

  if ((await codeHash(email, code)) !== row.code_hash) {
    await db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return { ok: false, response: fail(400, 'invalid_code', 'That code does not match. Check the email and try again.') };
  }

  // The row is removed once the account exists, so a race with the username
  // check does not force the user to request a new code.
  return { ok: true };
}

function publicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    username: row.username,
    createdAt: row.created_at || row.createdAt
  };
}

async function register(request, db) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const username = String(body.username || '').trim();
  const code = String(body.code || '').trim();

  if (!isEmail(email)) return fail(400, 'invalid_email', 'Enter a valid email address.');
  if (!USERNAME_RE.test(username)) {
    return fail(400, 'invalid_username', 'Use 3 to 20 letters, numbers, dots, dashes or underscores.');
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) {
    return fail(400, 'invalid_password', 'Use a password with at least 8 characters.');
  }
  if (!/^\d{6}$/.test(code)) return fail(400, 'invalid_code', 'Enter the 6-digit code from the email.');

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return fail(409, 'email_taken', 'That email is already registered. Try logging in.');

  const taken = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (taken) return fail(409, 'username_taken', 'That username is taken. Try another one.');

  const check = await consumeCode(db, email, code);
  if (!check.ok) return check.response;

  const passwordHash = await hashPassword(body.password);
  const createdAt = new Date().toISOString();

  let info;
  try {
    info = await db
      .prepare('INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(email, username, passwordHash, createdAt)
      .run();
  } catch (err) {
    // Someone else claimed the address or the name between the checks above.
    if (/UNIQUE/i.test(String(err && err.message))) {
      return fail(409, 'username_taken', 'That email or username is already taken. Try another one.');
    }
    throw err;
  }

  await db.prepare('DELETE FROM email_codes WHERE email = ?').bind(email).run();
  const user = { id: Number(info.meta.last_row_id), email, username, createdAt };
  return issueSession(db, user, 201);
}

async function login(request, db, ip) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return fail(400, 'missing_fields', 'Enter your email and password.');
  }

  const throttleKey = `${ip || 'unknown'}|${email}`;
  if (isThrottled(throttleKey)) {
    return fail(429, 'too_many_attempts', 'Too many failed attempts. Try again in 15 minutes.');
  }

  const row = await db
    .prepare('SELECT id, email, username, password_hash, created_at FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first();

  const valid = Boolean(row) && (await verifyPassword(password, row.password_hash));
  if (!valid) {
    noteFailure(throttleKey);
    return fail(401, 'invalid_credentials', 'Wrong email or password.');
  }

  loginFailures.delete(throttleKey);
  return issueSession(db, publicUser(row), 200);
}

async function issueSession(db, user, status) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), user.id, new Date().toISOString(), expiresAt)
    .run();
  return json(status, { token, expiresAt, user });
}

async function currentUser(request, db) {
  const token = bearerToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.expires_at, u.id, u.email, u.username, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return { ...publicUser(row), tokenHash };
}

async function logout(request, db) {
  const token = bearerToken(request);
  if (token) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  return json(200, { ok: true });
}

async function me(request, db) {
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'invalid_session', 'Please log in again.');
  return json(200, { user: { id: user.id, email: user.email, username: user.username, createdAt: user.createdAt } });
}

/* ---------------------------------------------------------------- answers */

function mapAnswer(row) {
  return { id: row.id, question: row.question, answer: row.answer, createdAt: row.created_at };
}

const FEED_DEFAULT = 50;
const FEED_MAX = 100;

// Answers open with a greeting addressed to whoever asked ("Hi Jeremy,").
// The public feed shows the author separately, so drop that line for every
// entry that is not the requester's own.
function stripGreeting(text) {
  const value = String(text || '');
  const lines = value.split('\n');
  // Only the first line, and only when it reads as a greeting on its own
  // ("Hi Jeremy,"), so "His blood pressure is high" is left alone.
  if (lines.length > 1 && /^\s*hi\b[^,\n]{0,40}[,!.?]\s*$/i.test(lines[0])) {
    return lines.slice(1).join('\n').replace(/^\s*\n+/, '').trim();
  }
  return value.trim();
}

async function listPublicQuestions(request, db) {
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), FEED_DEFAULT, 1, FEED_MAX);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

  const user = await currentUser(request, db);

  const [{ results }, count] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.question, a.answer, a.created_at, a.user_id, u.username
         FROM answers a JOIN users u ON u.id = a.user_id
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(limit, offset)
      .all(),
    db.prepare('SELECT count(*) AS total FROM answers').first()
  ]);

  const questions = (results || []).map((row) => {
    const mine = Boolean(user) && row.user_id === user.id;
    return {
      id: row.id,
      question: row.question,
      answer: mine ? row.answer : stripGreeting(row.answer),
      author: row.username,
      mine,
      createdAt: row.created_at
    };
  });

  return json(200, {
    questions,
    total: (count && count.total) || 0,
    limit,
    offset
  });
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

async function listAnswers(request, db) {
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'invalid_session', 'Please log in again.');

  const { results } = await db
    .prepare('SELECT id, question, answer, created_at FROM answers WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all();

  return json(200, { answers: (results || []).map(mapAnswer) });
}

async function saveAnswer(request, db) {
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'invalid_session', 'Please log in again.');

  const body = await readJson(request);
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();

  if (question.length < 3 || question.length > MAX_QUESTION) {
    return fail(400, 'invalid_question', `A question needs 3 to ${MAX_QUESTION} characters.`);
  }
  if (answer.length < 1 || answer.length > MAX_ANSWER) {
    return fail(400, 'invalid_answer', `An answer needs 1 to ${MAX_ANSWER} characters.`);
  }

  const now = new Date().toISOString();
  const existing = await db
    .prepare('SELECT id FROM answers WHERE user_id = ? AND lower(question) = lower(?)')
    .bind(user.id, question)
    .first();

  if (existing) {
    await db.prepare('UPDATE answers SET answer = ?, created_at = ? WHERE id = ?').bind(answer, now, existing.id).run();
    const row = await db.prepare('SELECT id, question, answer, created_at FROM answers WHERE id = ?').bind(existing.id).first();
    return json(200, { answer: { ...mapAnswer(row), updated: true } });
  }

  const id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db
    .prepare('INSERT INTO answers (id, user_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, question, answer, now)
    .run();
  const row = await db.prepare('SELECT id, question, answer, created_at FROM answers WHERE id = ?').bind(id).first();
  return json(201, { answer: { ...mapAnswer(row), updated: false } });
}

/* --------------------------------------------------------------- settings */

const MAX_BASE_URL = 300;
const MAX_MODEL = 120;
const MAX_API_KEY = 400;

async function getSettings(request, db, secret) {
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'invalid_session', 'Please log in again.');

  const row = await db
    .prepare('SELECT base_url, model, api_key FROM user_settings WHERE user_id = ?')
    .bind(user.id)
    .first();

  if (!row) return json(200, { settings: null, encrypted: Boolean(secret) });

  return json(200, {
    settings: {
      baseUrl: row.base_url,
      model: row.model,
      apiKey: await decryptSecret(row.api_key, secret)
    },
    encrypted: Boolean(secret)
  });
}

async function saveSettings(request, db, secret) {
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'invalid_session', 'Please log in again.');

  const body = await readJson(request);
  const baseUrl = String(body.baseUrl || '').trim().replace(/\/+$/, '');
  const model = String(body.model || '').trim();
  const apiKey = String(body.apiKey || '').trim();

  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl) || baseUrl.length > MAX_BASE_URL) {
    return fail(400, 'invalid_base_url', 'Enter a full endpoint URL starting with http:// or https://.');
  }
  if (!model || model.length > MAX_MODEL) {
    return fail(400, 'invalid_model', 'Enter the model name your endpoint expects.');
  }
  if (apiKey.length > MAX_API_KEY) {
    return fail(400, 'invalid_api_key', 'That API key is too long.');
  }

  const now = new Date().toISOString();
  const storedKey = await encryptSecret(apiKey, secret);

  await db
    .prepare(
      `INSERT INTO user_settings (user_id, base_url, model, api_key, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         base_url = excluded.base_url,
         model = excluded.model,
         api_key = excluded.api_key,
         updated_at = excluded.updated_at`
    )
    .bind(user.id, baseUrl, model, storedKey, now)
    .run();

  return json(200, { settings: { baseUrl, model, apiKey }, encrypted: Boolean(secret) });
}

/* ------------------------------------------------------- login throttling */

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
