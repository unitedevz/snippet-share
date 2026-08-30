const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Point the store at a throwaway temp directory before requiring it,
// so tests never touch the real data/ folder.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snippet-share-test-'));
process.env.DATA_DIR = tmpDir;

const { createPaste, getPaste, deletePaste, sweepExpired } = require('../server/store');

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
  const filePath = path.join(tmpDir, `${created.id}.json`);

  const firstRead = await getPaste(created.id, { markAsRead: true });
  assert.equal(firstRead.content, 'self destruct');

  // The file must be gone immediately after the read that consumes it —
  // not merely flagged and left on disk until some later request happens
  // to notice and clean it up. That window is exactly what "burn after
  // read" is supposed to prevent.
  assert.equal(fs.existsSync(filePath), false);

  const secondRead = await getPaste(created.id, { markAsRead: true });
  assert.equal(secondRead, null);
});

test('a non-consuming peek (markAsRead: false) does not burn the paste', async () => {
  const created = await createPaste({ content: 'peek me', burnAfterRead: true });
  const filePath = path.join(tmpDir, `${created.id}.json`);

  const peeked = await getPaste(created.id);
  assert.equal(peeked.content, 'peek me');
  assert.equal(fs.existsSync(filePath), true);

  // A real (consuming) read still works afterward and still burns it.
  const consumed = await getPaste(created.id, { markAsRead: true });
  assert.equal(consumed.content, 'peek me');
  assert.equal(fs.existsSync(filePath), false);
});

test('concurrent consuming reads of the same burn-after-read paste: only one gets the content', async () => {
  const created = await createPaste({ content: 'race me', burnAfterRead: true });

  const [a, b] = await Promise.all([
    getPaste(created.id, { markAsRead: true }),
    getPaste(created.id, { markAsRead: true }),
  ]);

  const results = [a, b];
  const winners = results.filter((r) => r !== null);
  assert.equal(winners.length, 1, 'exactly one concurrent read should get the content');
  assert.equal(winners[0].content, 'race me');
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

test('createPaste returns a deleteToken, and deletePaste consumes it correctly', async () => {
  const created = await createPaste({ content: 'delete me', expiresIn: 'never' });
  assert.ok(created.deleteToken, 'expected a deleteToken on creation');
  assert.equal(typeof created.deleteToken, 'string');

  const filePath = path.join(tmpDir, `${created.id}.json`);
  assert.equal(fs.existsSync(filePath), true);

  // Wrong token should not delete it.
  const wrongResult = await deletePaste(created.id, 'not-the-right-token');
  assert.equal(wrongResult, false);
  assert.equal(fs.existsSync(filePath), true);

  // Right token deletes it.
  const rightResult = await deletePaste(created.id, created.deleteToken);
  assert.equal(rightResult, true);
  assert.equal(fs.existsSync(filePath), false);

  // Already gone — deleting again (even with the right token) is a no-op false.
  const againResult = await deletePaste(created.id, created.deleteToken);
  assert.equal(againResult, false);
});

test('deletePaste on a nonexistent id returns false without throwing', async () => {
  const result = await deletePaste('deadbeef', 'whatever');
  assert.equal(result, false);
});

test('createPaste with a password stores only a hash/salt, never the plaintext', async () => {
  const created = await createPaste({ content: 'protected', password: 'sesame' });
  assert.ok(created.passwordHash);
  assert.ok(created.passwordSalt);
  assert.notEqual(created.passwordHash, 'sesame');

  const filePath = path.join(tmpDir, `${created.id}.json`);
  const onDisk = fs.readFileSync(filePath, 'utf8');
  assert.equal(onDisk.includes('sesame'), false, 'plaintext password must never be written to disk');
});

test('createPaste without a password leaves passwordHash/passwordSalt null', async () => {
  const created = await createPaste({ content: 'open to all' });
  assert.equal(created.passwordHash, null);
  assert.equal(created.passwordSalt, null);
});

test('a peek (markAsRead: false) on a password-protected burn-after-read paste does not burn it, even without checking the password', async () => {
  // This mirrors what the route layer actually does: peek to read the
  // stored hash/salt for a verifyPassword() check *before* deciding
  // whether to consume the (possibly burn-after-read) paste.
  const created = await createPaste({ content: 'guarded secret', password: 'sesame', burnAfterRead: true });
  const filePath = path.join(tmpDir, `${created.id}.json`);

  const peeked = await getPaste(created.id);
  assert.equal(peeked.content, 'guarded secret');
  assert.equal(fs.existsSync(filePath), true, 'peeking must not burn the paste');

  // Only a markAsRead: true call (made after a correct password check, in
  // the real route) actually consumes it.
  const consumed = await getPaste(created.id, { markAsRead: true });
  assert.equal(consumed.content, 'guarded secret');
  assert.equal(fs.existsSync(filePath), false);
});

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
