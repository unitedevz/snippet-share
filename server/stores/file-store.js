const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPIRY_OPTIONS } = require('../expiry');
const { hashPassword } = require('../password');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

if (!fssync.existsSync(DATA_DIR)) {
  fssync.mkdirSync(DATA_DIR, { recursive: true });
}

function generateId() {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
}

function pastePath(id) {
  if (!/^[a-f0-9]+$/.test(id)) return null;
  return path.join(DATA_DIR, `${id}.json`);
}

async function createPaste({ content, language, expiresIn, burnAfterRead, password }) {
  if (!content || typeof content !== 'string') {
    throw new Error('content is required');
  }
  if (content.length > 200_000) {
    throw new Error('content too large (max 200,000 characters)');
  }

  let id = generateId();
  while (fssync.existsSync(pastePath(id))) {
    id = generateId();
  }

  const ttl = EXPIRY_OPTIONS[expiresIn] ?? null;
  const now = Date.now();

  const record = {
    id,
    content,
    language: language || 'text',
    createdAt: now,
    expiresAt: ttl ? now + ttl : null,
    burnAfterRead: Boolean(burnAfterRead),
    read: false,
    // Returned to the creator exactly once (in the creation response) and
    // never re-exposed by getPaste's public-facing fields — this is the
    // only way to delete the paste early, so it acts as a capability token
    // rather than requiring any actual user accounts.
    deleteToken: crypto.randomBytes(16).toString('hex'),
    passwordHash: null,
    passwordSalt: null,
  };

  if (password) {
    if (typeof password !== 'string' || password.length > 200) {
      throw new Error('password must be a string up to 200 characters');
    }
    const hashed = hashPassword(password);
    record.passwordHash = hashed.passwordHash;
    record.passwordSalt = hashed.passwordSalt;
  }

  await fs.writeFile(pastePath(id), JSON.stringify(record), 'utf8');
  return record;
}

async function getPaste(id, { markAsRead = false } = {}) {
  const filePath = pastePath(id);
  if (!filePath || !fssync.existsSync(filePath)) return null;

  const raw = await fs.readFile(filePath, 'utf8');
  const record = JSON.parse(raw);

  if (record.expiresAt && Date.now() > record.expiresAt) {
    await fs.unlink(filePath).catch(() => {});
    return null;
  }

  if (record.burnAfterRead) {
    if (record.read) {
      // A legacy file from before this fix (which used to persist a `read`
      // flag instead of deleting immediately) — already consumed under the
      // old semantics, so clean it up now regardless of markAsRead.
      await fs.unlink(filePath).catch(() => {});
      return null;
    }
    if (!markAsRead) {
      // A non-consuming peek (e.g. an internal check) shouldn't burn it.
      return record;
    }
    // Delete immediately on the read that actually consumes it, instead of
    // just flagging `read` and waiting for some future request to notice
    // and clean up — that leaves the content sitting in storage for as
    // long as nobody happens to hit the link again, which defeats the
    // point of "burn after read". unlink() is atomic at the OS level, so
    // under a concurrent request for the same id, only one caller's
    // unlink actually succeeds; the other gets ENOENT and correctly
    // reports the paste as already gone rather than also serving it.
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    record.read = true;
    return record;
  }

  return record;
}

function safeTokenEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and length itself isn't sensitive here (tokens are a fixed,
  // known size), so just short-circuit instead of catching.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Deletes a paste early, before its natural expiry/read-consumption,
 * given the deleteToken returned at creation time. Returns false (rather
 * than distinguishing "wrong token" from "no such paste") for both a
 * missing paste and a bad token, so a caller can't use this endpoint to
 * probe which ids exist.
 */
async function deletePaste(id, token) {
  const filePath = pastePath(id);
  if (!filePath || !fssync.existsSync(filePath) || !token) return false;

  let record;
  try {
    record = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return false;
  }

  if (!record.deleteToken || !safeTokenEqual(record.deleteToken, token)) {
    return false;
  }

  await fs.unlink(filePath).catch(() => {});
  return true;
}

async function sweepExpired() {
  const files = await fs.readdir(DATA_DIR).catch(() => []);
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(DATA_DIR, file);
    try {
      const record = JSON.parse(await fs.readFile(full, 'utf8'));
      if (record.expiresAt && Date.now() > record.expiresAt) {
        await fs.unlink(full);
        removed++;
      }
    } catch {
      // Corrupt/partial file — skip it.
    }
  }
  return removed;
}

module.exports = { createPaste, getPaste, deletePaste, sweepExpired, DATA_DIR };
