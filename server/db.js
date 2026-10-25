'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.ADM_DB
  ? path.resolve(process.env.ADM_DB)
  : path.join(__dirname, 'data', 'ask-dr-martin.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS answers (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS answers_user_question ON answers (user_id, lower(question));
  CREATE INDEX IF NOT EXISTS answers_user_created ON answers (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
`);

const statements = {
  insertUser: db.prepare('INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)'),
  userById: db.prepare('SELECT id, email, username, created_at FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT s.expires_at, u.id, u.email, u.username, u.created_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  insertAnswer: db.prepare('INSERT INTO answers (id, user_id, question, answer, created_at) VALUES (?, ?, ?, ?, ?)'),
  updateAnswer: db.prepare('UPDATE answers SET answer = ?, created_at = ? WHERE id = ?'),
  answerById: db.prepare('SELECT id, question, answer, created_at FROM answers WHERE id = ?'),
  answerByQuestion: db.prepare('SELECT id FROM answers WHERE user_id = ? AND lower(question) = lower(?)'),
  listAnswers: db.prepare('SELECT id, question, answer, created_at FROM answers WHERE user_id = ? ORDER BY created_at DESC'),
  countAnswers: db.prepare('SELECT COUNT(*) AS total FROM answers WHERE user_id = ?')
};

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, username: row.username, createdAt: row.created_at };
}

function findByEmail(email) {
  return statements.userByEmail.get(email) || null;
}

function findByUsername(username) {
  return statements.userByUsername.get(username) || null;
}

function findByIdentifier(identifier) {
  return findByEmail(identifier) || findByUsername(identifier);
}

function usernameTaken(username) {
  return Boolean(findByUsername(username));
}

function createUser({ email, username, passwordHash }) {
  const info = statements.insertUser.run(email, username, passwordHash, new Date().toISOString());
  return publicUser(statements.userById.get(Number(info.lastInsertRowid)));
}

function createSession({ tokenHash, userId, expiresAt }) {
  statements.insertSession.run(tokenHash, userId, new Date().toISOString(), expiresAt);
}

function userForSession(tokenHash) {
  const row = statements.sessionUser.get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    statements.deleteSession.run(tokenHash);
    return null;
  }
  return publicUser(row);
}

function deleteSession(tokenHash) {
  statements.deleteSession.run(tokenHash);
}

function pruneSessions() {
  statements.deleteExpiredSessions.run(new Date().toISOString());
}

function listAnswers(userId) {
  return statements.listAnswers.all(userId).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    createdAt: row.created_at
  }));
}

function saveAnswer({ userId, question, answer }) {
  const now = new Date().toISOString();
  const existing = statements.answerByQuestion.get(userId, question);
  if (existing) {
    statements.updateAnswer.run(answer, now, existing.id);
    const row = statements.answerById.get(existing.id);
    return { id: row.id, question: row.question, answer: row.answer, createdAt: row.created_at, updated: true };
  }
  const id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  statements.insertAnswer.run(id, userId, question, answer, now);
  const row = statements.answerById.get(id);
  return { id: row.id, question: row.question, answer: row.answer, createdAt: row.created_at, updated: false };
}

function countAnswers(userId) {
  const row = statements.countAnswers.get(userId);
  return row ? Number(row.total) : 0;
}

module.exports = {
  db,
  dbPath,
  publicUser,
  findByEmail,
  findByUsername,
  findByIdentifier,
  usernameTaken,
  createUser,
  createSession,
  userForSession,
  deleteSession,
  pruneSessions,
  listAnswers,
  saveAnswer,
  countAnswers
};
