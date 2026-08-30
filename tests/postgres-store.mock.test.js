// These tests fake out the `pg` module so we can verify postgres-store's
// query construction, parameter binding, and control flow (expiry,
// burn-after-read, id-collision retry) without a live database.
//
// For a real integration test against an actual Postgres instance, see
// tests/postgres-store.integration.test.js — that one runs in CI against
// a real service container and is skipped locally unless TEST_DATABASE_URL
// is set.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Intercept require('pg') before postgres-store.js loads it.
const originalResolve = Module._resolveFilename;
const fakePgPath = require.resolve('./fixtures/fake-pg.js');
Module._resolveFilename = function (request, ...rest) {
  if (request === 'pg') return fakePgPath;
  return originalResolve.call(this, request, ...rest);
};

process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
process.env.STORAGE_DRIVER = 'postgres';

const { __queries, __setNextRows, __reset } = require('./fixtures/fake-pg.js');
const store = require('../server/stores/postgres-store');

test.beforeEach(() => {
  __reset();
});

test('createPaste inserts with correct params and returns the mapped record', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'hello',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: false,
      read: false,
    },
  ]);

  const record = await store.createPaste({ content: 'hello', language: 'text' });

  assert.equal(record.content, 'hello');
  assert.equal(record.expiresAt, null);

  const insertCall = __queries.find((q) => q.sql.includes('INSERT INTO pastes'));
  assert.ok(insertCall, 'expected an INSERT query');
  assert.equal(insertCall.params[1], 'hello');
  assert.equal(insertCall.params[2], 'text');
});

test('createPaste rejects empty content before touching the database', async () => {
  await assert.rejects(() => store.createPaste({ content: '' }), /content is required/);
  assert.equal(__queries.length, 0, 'should not query the database for invalid input');
});

test('getPaste returns null and issues no DELETE for a live paste', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'still alive',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: false,
      read: false,
    },
  ]);

  const record = await store.getPaste('abc12345');
  assert.equal(record.content, 'still alive');

  const deleteCall = __queries.find((q) => q.sql.includes('DELETE'));
  assert.equal(deleteCall, undefined);
});

test('getPaste deletes and returns null for an expired paste', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'expired',
      language: 'text',
      created_at: 1000,
      expires_at: 1, // long in the past
      burn_after_read: false,
      read: false,
    },
  ]);

  const record = await store.getPaste('abc12345');
  assert.equal(record, null);

  const deleteCall = __queries.find((q) => q.sql.includes('DELETE FROM pastes WHERE id'));
  assert.ok(deleteCall, 'expected a DELETE query for the expired row');
  assert.deepEqual(deleteCall.params, ['abc12345']);
});

test('getPaste deletes a burn-after-read paste atomically on the consuming read', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'secret',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: true,
      read: false,
    },
  ]);

  const record = await store.getPaste('abc12345', { markAsRead: true });
  assert.equal(record.content, 'secret');
  assert.equal(record.read, true);

  const deleteCall = __queries.find(
    (q) => q.sql.includes('DELETE FROM pastes WHERE id') && /RETURNING/i.test(q.sql)
  );
  assert.ok(deleteCall, 'expected an atomic DELETE ... RETURNING for the consuming read');
  assert.ok(deleteCall.sql.includes('burn_after_read'), 'expected the DELETE guarded by burn_after_read = true');
  assert.deepEqual(deleteCall.params, ['abc12345']);

  // The row is deleted outright now, not just flagged — so no UPDATE
  // should be issued (that's what left content lingering in storage
  // before this fix).
  const updateCall = __queries.find((q) => q.sql.includes('UPDATE pastes SET read'));
  assert.equal(updateCall, undefined);
});

test('getPaste does not burn a paste on a non-consuming peek (markAsRead: false)', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'secret',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: true,
      read: false,
    },
  ]);

  const record = await store.getPaste('abc12345');
  assert.equal(record.content, 'secret');

  const deleteCall = __queries.find((q) => q.sql.includes('DELETE'));
  assert.equal(deleteCall, undefined, 'a non-consuming peek should not delete the paste');
});

test('getPaste returns null when the atomic delete finds the row already consumed', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'secret',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: true,
      read: false,
    },
  ]);

  // Simulate losing the race: the guarded DELETE returns zero rows because
  // a concurrent/earlier request already removed it.
  const store2 = require('../server/stores/postgres-store');
  const originalQuery = require('./fixtures/fake-pg.js').Pool.prototype.query;
  require('./fixtures/fake-pg.js').Pool.prototype.query = async function (sql, params) {
    if (sql.trim().startsWith('DELETE') && /RETURNING/i.test(sql)) {
      __queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }
    return originalQuery.call(this, sql, params);
  };

  try {
    const record = await store2.getPaste('abc12345', { markAsRead: true });
    assert.equal(record, null);
  } finally {
    require('./fixtures/fake-pg.js').Pool.prototype.query = originalQuery;
  }
});

test('getPaste deletes an already-read burn-after-read paste', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'secret',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: true,
      read: true,
    },
  ]);

  const record = await store.getPaste('abc12345');
  assert.equal(record, null);

  const deleteCall = __queries.find((q) => q.sql.includes('DELETE'));
  assert.ok(deleteCall);
});

test('getPaste rejects a malformed id without querying the database', async () => {
  const record = await store.getPaste('not-valid-hex!!');
  assert.equal(record, null);
  assert.equal(__queries.length, 0);
});

test('createPaste includes a deleteToken in the insert and the returned record', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'hello',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: false,
      read: false,
      delete_token: 'sometoken1234567890abcdef1234567890abcd',
    },
  ]);

  const record = await store.createPaste({ content: 'hello', language: 'text' });
  assert.equal(record.deleteToken, 'sometoken1234567890abcdef1234567890abcd');

  const insertCall = __queries.find((q) => q.sql.includes('INSERT INTO pastes'));
  assert.ok(insertCall.sql.includes('delete_token'));
  // id, content, language, created_at, expires_at, burn_after_read, delete_token, password_hash, password_salt
  assert.equal(insertCall.params.length, 9);
});

test('deletePaste issues an atomic guarded DELETE and returns true when it matches', async () => {
  __setNextRows([{ id: 'abc12345' }]);

  const result = await store.deletePaste('abc12345', 'the-right-token');
  assert.equal(result, true);

  const deleteCall = __queries.find(
    (q) => q.sql.includes('DELETE FROM pastes WHERE id') && /RETURNING/i.test(q.sql)
  );
  assert.ok(deleteCall, 'expected an atomic DELETE ... RETURNING');
  assert.ok(deleteCall.sql.includes('delete_token'), 'expected the DELETE guarded by delete_token');
  assert.deepEqual(deleteCall.params, ['abc12345', 'the-right-token']);
});

test('deletePaste returns false when the delete matches zero rows (wrong token or gone)', async () => {
  __setNextRows([]);

  const result = await store.deletePaste('abc12345', 'wrong-token');
  assert.equal(result, false);
});

test('deletePaste rejects a malformed id or missing token without querying', async () => {
  const r1 = await store.deletePaste('not-valid-hex!!', 'sometoken');
  assert.equal(r1, false);
  assert.equal(__queries.length, 0);

  const r2 = await store.deletePaste('abc12345', '');
  assert.equal(r2, false);
  assert.equal(__queries.length, 0);
});

test('createPaste includes password_hash/password_salt in the insert when a password is given', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'hello',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: false,
      read: false,
      delete_token: 'sometoken',
      password_hash: 'deadbeef',
      password_salt: 'cafef00d',
    },
  ]);

  const record = await store.createPaste({ content: 'hello', language: 'text', password: 'sesame' });
  assert.equal(record.passwordHash, 'deadbeef');
  assert.equal(record.passwordSalt, 'cafef00d');

  const insertCall = __queries.find((q) => q.sql.includes('INSERT INTO pastes'));
  assert.ok(insertCall.sql.includes('password_hash'));
  assert.ok(insertCall.sql.includes('password_salt'));
  // Plaintext password must never appear in the query params sent to postgres.
  assert.equal(insertCall.params.includes('sesame'), false);
});

test('createPaste leaves password_hash/password_salt null when no password is given', async () => {
  __setNextRows([
    {
      id: 'abc12345',
      content: 'hello',
      language: 'text',
      created_at: 1000,
      expires_at: null,
      burn_after_read: false,
      read: false,
      delete_token: 'sometoken',
      password_hash: null,
      password_salt: null,
    },
  ]);

  const record = await store.createPaste({ content: 'hello', language: 'text' });
  assert.equal(record.passwordHash, null);
  assert.equal(record.passwordSalt, null);

  const insertCall = __queries.find((q) => q.sql.includes('INSERT INTO pastes'));
  assert.equal(insertCall.params[insertCall.params.length - 2], null);
  assert.equal(insertCall.params[insertCall.params.length - 1], null);
});

test.after(() => {
  Module._resolveFilename = originalResolve;
  delete process.env.STORAGE_DRIVER;
});
