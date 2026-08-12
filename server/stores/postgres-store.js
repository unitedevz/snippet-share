const crypto = require('crypto');
const { EXPIRY_OPTIONS } = require('../expiry');

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
      read BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_pastes_expires_at ON pastes (expires_at) WHERE expires_at IS NOT NULL;
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
  };
}

async function createPaste({ content, language, expiresIn, burnAfterRead }) {
  if (!content || typeof content !== 'string') {
    throw new Error('content is required');
  }
  if (content.length > 200_000) {
    throw new Error('content too large (max 200,000 characters)');
  }

  await ensureSchema();
  const db = getPool();

  const ttl = EXPIRY_OPTIONS[expiresIn] ?? null;
  const now = Date.now();
  const expiresAt = ttl ? now + ttl : null;

  // Retry on the (very unlikely) chance of an id collision — the
  // unique constraint on `id` will reject a duplicate insert.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    try {
      const result = await db.query(
        `INSERT INTO pastes (id, content, language, created_at, expires_at, burn_after_read, read)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         RETURNING *`,
        [id, content, language || 'text', now, expiresAt, Boolean(burnAfterRead)]
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

  if (record.burnAfterRead && record.read) {
    await db.query('DELETE FROM pastes WHERE id = $1', [id]);
    return null;
  }

  if (markAsRead && record.burnAfterRead && !record.read) {
    await db.query('UPDATE pastes SET read = true WHERE id = $1', [id]);
    record.read = true;
  }

  return record;
}

async function sweepExpired() {
  await ensureSchema();
  const db = getPool();
  const result = await db.query('DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at < $1', [
    Date.now(),
  ]);
  return result.rowCount;
}

module.exports = { createPaste, getPaste, sweepExpired, getPool, ensureSchema };
