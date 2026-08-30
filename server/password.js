const crypto = require('crypto');

const KEY_LENGTH = 64;

/**
 * Hashes a plaintext password for storage. Never store the plaintext
 * itself — only passwordHash/passwordSalt, which is what both storage
 * backends persist. scrypt is used (built into Node, no extra dependency)
 * with a fresh random salt per password so identical passwords across
 * different pastes don't produce identical stored hashes.
 */
function hashPassword(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const passwordHash = crypto.scryptSync(password, passwordSalt, KEY_LENGTH).toString('hex');
  return { passwordHash, passwordSalt };
}

/**
 * Verifies a candidate password against a record's stored hash/salt.
 * Returns false (rather than throwing) for any malformed input — a record
 * with no password set, an empty candidate, etc — so callers can use this
 * directly as a boolean gate without extra null-checking.
 */
function verifyPassword(record, candidatePassword) {
  if (!record || !record.passwordHash || !record.passwordSalt) return false;
  if (!candidatePassword || typeof candidatePassword !== 'string') return false;

  const candidateHash = crypto.scryptSync(candidatePassword, record.passwordSalt, KEY_LENGTH);
  const storedHash = Buffer.from(record.passwordHash, 'hex');

  if (candidateHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(candidateHash, storedHash);
}

module.exports = { hashPassword, verifyPassword };
