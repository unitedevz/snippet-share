const crypto = require('crypto');
const { EXPIRY_OPTIONS } = require('../expiry');
const { hashPassword } = require('../password');

let pool = null;
let schemaReady = null;

function getPool() {
  if (pool) return pool;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'STORAGE_DRIVER=postgres requires DATABASE_URL to be set (e.g. postgres://user:pass@host:5432/dbname)'
    );
  }

  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch {
    throw new Error(
      "STORAGE_DRIVER=postgres requires the 'pg' package. Run: npm install pg"
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Most managed providers (Neon, Supabase, Railway, RDS) require SSL
    // and use certs that Node won't validate out of the box. Set
    // PGSSL=strict if your provider gives you a verifiable cert chain.
    ssl:
      process.env.PGSSL === 'strict'
        ? true
        : process.env.PGSSL === 'off'
        ? false
        : { rejectUnauthorized: false },
  });

  return pool;
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = getPool().query(`
    CREATE TABLE IF NOT EXISTS pastes (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'text',
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      burn_after_read BOOLEAN NOT NULL DEFAULT FALSE,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      delete_token TEXT,
      password_hash TEXT,
      password_salt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pastes_expires_at ON pastes (expires_at) WHERE expires_at IS NOT NULL;
    ALTER TABLE pastes ADD COLUMN IF NOT EXISTS delete_token TEXT;
    ALTER TABLE pastes ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE pastes ADD COLUMN IF NOT EXISTS password_salt TEXT;
  `);

  return schemaReady;
}

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function rowToRecord(row) {
  return {
    id: row.id,
    content: row.content,
    language: row.language,
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    burnAfterRead: row.burn_after_read,
    read: row.read,
    deleteToken: row.delete_token,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
  };
}

async function createPaste({ content, language, expiresIn, burnAfterRead, password }) {
  if (!content || typeof content !== 'string') {
    throw new Error('content is required');
  }
  if (content.length > 200_000) {
    throw new Error('content too large (max 200,000 characters)');
  }
  if (password !== undefined && password !== null && (typeof password !== 'string' || password.length > 200)) {
    throw new Error('password must be a string up to 200 characters');
  }

  await ensureSchema();
  const db = getPool();

  const ttl = EXPIRY_OPTIONS[expiresIn] ?? null;
  const now = Date.now();
  const expiresAt = ttl ? now + ttl : null;
  const deleteToken = crypto.randomBytes(16).toString('hex');
  const hashed = password ? hashPassword(password) : { passwordHash: null, passwordSalt: null };

  // Retry on the (very unlikely) chance of an id collision — the
  // unique constraint on `id` will reject a duplicate insert.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    try {
      const result = await db.query(
        `INSERT INTO pastes (id, content, language, created_at, expires_at, burn_after_read, read, delete_token, password_hash, password_salt)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9)
         RETURNING *`,
        [
          id,
          content,
          language || 'text',
          now,
          expiresAt,
          Boolean(burnAfterRead),
          deleteToken,
          hashed.passwordHash,
          hashed.passwordSalt,
        ]
      );
      return rowToRecord(result.rows[0]);
    } catch (err) {
      if (err.code === '23505' /* unique_violation */) continue;
      throw err;
    }
  }
  throw new Error('Failed to generate a unique paste id after several attempts');
}

async function getPaste(id, { markAsRead = false } = {}) {
  if (!/^[a-f0-9]+$/.test(id)) return null;

  await ensureSchema();
  const db = getPool();

  const result = await db.query('SELECT * FROM pastes WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;

  const record = rowToRecord(result.rows[0]);

  if (record.expiresAt && Date.now() > record.expiresAt) {
    await db.query('DELETE FROM pastes WHERE id = $1', [id]);
    return null;
  }

  if (record.burnAfterRead) {
    if (record.read) {
      // A legacy row from before this fix (which used to persist a `read`
      // flag instead of deleting immediately) — already consumed under the
      // old semantics, so clean it up now regardless of markAsRead.
      await db.query('DELETE FROM pastes WHERE id = $1', [id]);
      return null;
    }
    if (!markAsRead) {
      // A non-consuming peek (e.g. an internal check) shouldn't burn it.
      return record;
    }
    // Delete atomically in the same statement that consumes it, guarded by
    // burn_after_read = true, instead of a separate UPDATE that just flags
    // `read` (leaving the row — and its content — sitting in the database
    // until some later request happens to notice and delete it). The
    // WHERE guard also makes this safe under a concurrent request for the
    // same id: only whichever request's DELETE actually removes the row
    // gets its content back via RETURNING; the other gets zero rows.
    const burnResult = await db.query(
      'DELETE FROM pastes WHERE id = $1 AND burn_after_read = true RETURNING *',
      [id]
    );
    if (burnResult.rows.length === 0) {
      // A concurrent/earlier request already consumed it between our
      // SELECT above and this DELETE.
      return null;
    }
    record.read = true;
    return record;
  }

  return record;
}

/**
 * Deletes a paste early, before its natural expiry/read-consumption,
 * given the deleteToken returned at creation time. The match happens in
 * the WHERE clause of a single atomic statement, and returns false
 * (rather than distinguishing "wrong token" from "no such paste") for
 * both a missing paste and a bad token, so a caller can't use this
 * endpoint to probe which ids exist.
 */
async function deletePaste(id, token) {
  if (!/^[a-f0-9]+$/.test(id) || !token) return false;

  await ensureSchema();
  const db = getPool();

  const result = await db.query('DELETE FROM pastes WHERE id = $1 AND delete_token = $2 RETURNING id', [
    id,
    token,
  ]);
  return result.rows.length > 0;
}

async function sweepExpired() {
  await ensureSchema();
  const db = getPool();
  const result = await db.query('DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at < $1', [
    Date.now(),
  ]);
  return result.rowCount;
}

module.exports = { createPaste, getPaste, deletePaste, sweepExpired, getPool, ensureSchema };
