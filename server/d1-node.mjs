import { DatabaseSync } from 'node:sqlite';

// Minimal D1-compatible wrapper so the Cloudflare Pages Function can also run
// under plain Node during development. Only the pieces the API uses are here:
// prepare().bind().first() / .all() / .run().

class BoundStatement {
  constructor(db, sql, params) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new BoundStatement(this.db, this.sql, params);
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    if (!row) return null;
    if (column) return row[column] ?? null;
    return row;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true, meta: { changes: 0 } };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
    };
  }
}

export class NodeD1 {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql) {
    return new BoundStatement(this.db, sql, []);
  }

  exec(sql) {
    this.db.exec(sql);
  }

  close() {
    this.db.close();
  }
}
