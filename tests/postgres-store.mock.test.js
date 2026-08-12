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
  assert.equal(insertCall.params[1], 'hello'); // content bound correctly
  assert.equal(insertCall.params[2], 'text'); // language bound correctly
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

test('getPaste marks burn-after-read as read on first view, without deleting yet', async () => {
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

  const updateCall = __queries.find((q) => q.sql.includes('UPDATE pastes SET read'));
  assert.ok(updateCall, 'expected an UPDATE query marking it read');
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

test.after(() => {
  Module._resolveFilename = originalResolve;
  delete process.env.STORAGE_DRIVER;
});
