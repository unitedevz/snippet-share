const fs = require('fs/promises');
const fssync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EXPIRY_OPTIONS } = require('../expiry');

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

async function createPaste({ content, language, expiresIn, burnAfterRead }) {
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
  };

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

  if (record.burnAfterRead && record.read) {
    await fs.unlink(filePath).catch(() => {});
    return null;
  }

  if (markAsRead && record.burnAfterRead && !record.read) {
    record.read = true;
    await fs.writeFile(filePath, JSON.stringify(record), 'utf8');
  }

  return record;
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

module.exports = { createPaste, getPaste, sweepExpired, DATA_DIR };
