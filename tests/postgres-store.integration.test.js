// Runs against a REAL Postgres database — no mocking. Set TEST_DATABASE_URL
// to run it locally (e.g. against a throwaway Docker Postgres); it's
// skipped automatically otherwise. CI always runs this via a service
// container — see .github/workflows/ci.yml.

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

    const second = await store.getPaste(created.id, { markAsRead: true });
    assert.equal(second, null);
  });

  await t.test('sweepExpired removes expired rows', async () => {
    const created = await store.createPaste({ content: 'sweep me', expiresIn: '10m' });
    const pool = store.getPool();
    await pool.query('UPDATE pastes SET expires_at = $1 WHERE id = $2', [Date.now() - 1000, created.id]);

    const removed = await store.sweepExpired();
    assert.ok(removed >= 1);
  });
});
