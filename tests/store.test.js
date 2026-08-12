const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Point the store at a throwaway temp directory before requiring it,
// so tests never touch the real data/ folder.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-share-test-'));
process.env.DATA_DIR = tmpDir;

const { createPaste, getPaste, sweepExpired } = require('../server/store');

test('creates a paste and reads it back', async () => {
  const created = await createPaste({ content: 'hello world', language: 'text' });
  assert.equal(created.content, 'hello world');
  assert.match(created.id, /^[a-f0-9]{8}$/);

  const fetched = await getPaste(created.id);
  assert.equal(fetched.content, 'hello world');
});

test('rejects empty content', async () => {
  await assert.rejects(() => createPaste({ content: '' }), /content is required/);
});

test('rejects oversized content', async () => {
  const huge = 'x'.repeat(200_001);
  await assert.rejects(() => createPaste({ content: huge }), /too large/);
});

test('returns null for a nonexistent id', async () => {
  const result = await getPaste('deadbeef');
  assert.equal(result, null);
});

test('expired pastes are not returned and get cleaned up', async () => {
  const created = await createPaste({ content: 'short lived', expiresIn: '10m' });
  // Manually backdate the file's expiresAt to simulate time passing.
  const filePath = path.join(tmpDir, `${created.id}.json`);
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.expiresAt = Date.now() - 1000;
  fs.writeFileSync(filePath, JSON.stringify(record));

  const result = await getPaste(created.id);
  assert.equal(result, null);
  assert.equal(fs.existsSync(filePath), false);
});

test('burn-after-read pastes disappear after one read', async () => {
  const created = await createPaste({ content: 'self destruct', burnAfterRead: true });

  const firstRead = await getPaste(created.id, { markAsRead: true });
  assert.equal(firstRead.content, 'self destruct');

  const secondRead = await getPaste(created.id, { markAsRead: true });
  assert.equal(secondRead, null);
});

test('sweepExpired removes only expired files', async () => {
  const alive = await createPaste({ content: 'still here', expiresIn: 'never' });
  const dead = await createPaste({ content: 'gone soon', expiresIn: '10m' });

  const deadPath = path.join(tmpDir, `${dead.id}.json`);
  const record = JSON.parse(fs.readFileSync(deadPath, 'utf8'));
  record.expiresAt = Date.now() - 1000;
  fs.writeFileSync(deadPath, JSON.stringify(record));

  const removed = await sweepExpired();
  assert.ok(removed >= 1);
  assert.equal(fs.existsSync(deadPath), false);
  assert.equal(fs.existsSync(path.join(tmpDir, `${alive.id}.json`)), true);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
