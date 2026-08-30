const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../server/password');

test('hashPassword never stores the plaintext, and produces a verifiable hash', () => {
  const { passwordHash, passwordSalt } = hashPassword('correct horse battery staple');
  assert.ok(passwordHash);
  assert.ok(passwordSalt);
  assert.notEqual(passwordHash, 'correct horse battery staple');
  assert.notEqual(passwordSalt, 'correct horse battery staple');

  const record = { passwordHash, passwordSalt };
  assert.equal(verifyPassword(record, 'correct horse battery staple'), true);
});

test('verifyPassword rejects a wrong password', () => {
  const record = hashPassword('the-real-password');
  assert.equal(verifyPassword(record, 'not-the-password'), false);
});

test('hashPassword uses a fresh salt each call, so identical passwords hash differently', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a.passwordSalt, b.passwordSalt);
  assert.notEqual(a.passwordHash, b.passwordHash);
  // Both still verify correctly against their own record.
  assert.equal(verifyPassword(a, 'same-password'), true);
  assert.equal(verifyPassword(b, 'same-password'), true);
});

test('verifyPassword returns false (not throws) for a record with no password set', () => {
  assert.equal(verifyPassword({ passwordHash: null, passwordSalt: null }, 'anything'), false);
  assert.equal(verifyPassword({}, 'anything'), false);
  assert.equal(verifyPassword(null, 'anything'), false);
});

test('verifyPassword returns false for an empty or missing candidate password', () => {
  const record = hashPassword('a-real-password');
  assert.equal(verifyPassword(record, ''), false);
  assert.equal(verifyPassword(record, null), false);
  assert.equal(verifyPassword(record, undefined), false);
});
