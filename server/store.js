// Picks a storage backend based on STORAGE_DRIVER. Both backends implement
// the same interface (createPaste, getPaste, sweepExpired), so nothing
// else in the app needs to know or care which one is active.
//
//   STORAGE_DRIVER unset or "file"      -> server/stores/file-store.js  (default, zero setup)
//   STORAGE_DRIVER=postgres             -> server/stores/postgres-store.js  (requires DATABASE_URL)

const { EXPIRY_OPTIONS } = require('./expiry');

const driver = (process.env.STORAGE_DRIVER || 'file').toLowerCase();

let impl;
if (driver === 'postgres' || driver === 'postgresql') {
  impl = require('./stores/postgres-store');
} else if (driver === 'file') {
  impl = require('./stores/file-store');
} else {
  throw new Error(`Unknown STORAGE_DRIVER "${driver}" — expected "file" or "postgres"`);
}

module.exports = { ...impl, EXPIRY_OPTIONS, driver };
