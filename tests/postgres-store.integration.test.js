// Runs against a REAL Postgres database — no mocking. Set TEST_DATABASE_URL
// to run it locally (e.g. against a throwaway Docker Postgres); it's
// skipped automatically otherwise.

const test = require('node:test');
const assert = require('node:assert/strict');

const dbUrl = process.env.TEST_DATABASE_URL;

test('postgres-store integration', { skip: !dbUrl && 'set TEST_DATABASE_URL to run this locally' }, async (t) => {
  process.env.DATABASE_URL = dbUrl;
  process.env.STORAGE_DRIVER = 'postgres';
  // Fresh require so it picks up the env vars set above.
  delete require.cache[require.resolve('../server/stores/postgres-store')];
  const store = require('../server/stores/postgres-store');

  t.after(async () => {
    const pool = store.getPool();
    await pool.query('DROP TABLE IF EXISTS pastes');
    await pool.end();
  });

  await t.test('creates and retrieves a paste', async () => {
    const created = await store.createPaste({ content: 'integration test', language: 'text' });
    assert.match(created.id, /^[a-f0-9]{8}$/);

    const fetched = await store.getPaste(created.id);
    assert.equal(fetched.content, 'integration test');
  });

  await t.test('expires a paste', async () => {
    const created = await store.createPaste({ content: 'short lived', expiresIn: '10m' });
    const pool = store.getPool();
    await pool.query('UPDATE pastes SET expires_at = $1 WHERE id = $2', [Date.now() - 1000, created.id]);

    const result = await store.getPaste(created.id);
    assert.equal(result, null);
  });

  await t.test('burns after read', async () => {
    const created = await store.createPaste({ content: 'secret', burnAfterRead: true });

    const first = await store.getPaste(created.id, { markAsRead: true });
    assert.equal(first.content, 'secret');

    // The row must be gone from the database immediately after the read
    // that consumed it — not just inaccessible via a second getPaste call.
    // Query directly so this can't pass on stale in-memory state.
    const pool = store.getPool();
    const rowCheck = await pool.query('SELECT 1 FROM pastes WHERE id = $1', [created.id]);
    assert.equal(rowCheck.rows.length, 0, 'row should be deleted from the database, not just unreadable');

    const second = await store.getPaste(created.id, { markAsRead: true });
    assert.equal(second, null);
  });

  await t.test('a non-consuming peek does not burn the paste', async () => {
    const created = await store.createPaste({ content: 'peek me', burnAfterRead: true });

    const peeked = await store.getPaste(created.id);
    assert.equal(peeked.content, 'peek me');

    const consumed = await store.getPaste(created.id, { markAsRead: true });
    assert.equal(consumed.content, 'peek me');

    const second = await store.getPaste(created.id, { markAsRead: true });
    assert.equal(second, null);
  });

  await t.test('concurrent consuming reads: only one gets the content', async () => {
    const created = await store.createPaste({ content: 'race me', burnAfterRead: true });

    const [a, b] = await Promise.all([
      store.getPaste(created.id, { markAsRead: true }),
      store.getPaste(created.id, { markAsRead: true }),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    assert.equal(winners.length, 1, 'exactly one concurrent read should get the content');
    assert.equal(winners[0].content, 'race me');
  });

  await t.test('sweepExpired removes expired rows', async () => {
    const created = await store.createPaste({ content: 'sweep me', expiresIn: '10m' });
    const pool = store.getPool();
    await pool.query('UPDATE pastes SET expires_at = $1 WHERE id = $2', [Date.now() - 1000, created.id]);

    const removed = await store.sweepExpired();
    assert.ok(removed >= 1);
  });

  await t.test('deletePaste removes a paste early given the correct deleteToken', async () => {
    const created = await store.createPaste({ content: 'delete me' });
    assert.ok(created.deleteToken);

    const wrong = await store.deletePaste(created.id, 'not-the-token');
    assert.equal(wrong, false);
    const stillThere = await store.getPaste(created.id);
    assert.ok(stillThere);

    const right = await store.deletePaste(created.id, created.deleteToken);
    assert.equal(right, true);

    const gone = await store.getPaste(created.id);
    assert.equal(gone, null);
  });
});
