const express = require('express');
const path = require('path');
const { createPaste, getPaste, deletePaste, sweepExpired, EXPIRY_OPTIONS } = require('./store');
const { verifyPassword } = require('./password');
const { renderPastePage, renderNotFoundPage, renderPasswordPage } = require('./render');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Extracts a caller-supplied password from wherever a given route accepts
// it. Browser form submits use the body; curl/API/CLI use of the raw and
// JSON endpoints uses a header (never a query string — those end up in
// server access logs and browser history, which defeats the point of a
// password in the first place).
function suppliedPassword(req) {
  return (req.body && req.body.password) || req.get('X-Paste-Password') || null;
}

// --- API ---

app.post('/api/pastes', async (req, res) => {
  try {
    const { content, language, expiresIn, burnAfterRead, password } = req.body || {};

    if (expiresIn && !(expiresIn in EXPIRY_OPTIONS)) {
      return res.status(400).json({ error: `expiresIn must be one of: ${Object.keys(EXPIRY_OPTIONS).join(', ')}` });
    }

    const record = await createPaste({ content, language, expiresIn, burnAfterRead, password });
    const base = `${req.protocol}://${req.get('host')}`;

    res.status(201).json({
      id: record.id,
      url: `${base}/${record.id}`,
      rawUrl: `${base}/${record.id}/raw`,
      expiresAt: record.expiresAt,
      burnAfterRead: record.burnAfterRead,
      passwordProtected: Boolean(record.passwordHash),
      // Returned exactly once, here, at creation time — this is the only
      // way to delete the paste early, so hang on to it if you want that.
      deleteToken: record.deleteToken,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/pastes/:id', async (req, res) => {
  const token = (req.body && req.body.deleteToken) || req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'deleteToken is required' });
  }

  const deleted = await deletePaste(req.params.id, token);
  if (!deleted) {
    return res.status(404).json({ error: 'not found, already gone, or invalid delete token' });
  }
  res.status(204).end();
});

app.get('/api/pastes/:id', async (req, res) => {
  // Peek first (non-consuming): if this is a password-protected
  // burn-after-read paste, a wrong or missing password must not burn it —
  // the caller should get a fair shot once they actually have the password.
  const peek = await getPaste(req.params.id);
  if (!peek) return res.status(404).json({ error: 'not found or expired' });

  if (peek.passwordHash && !verifyPassword(peek, suppliedPassword(req))) {
    return res.status(401).json({ error: 'password required or incorrect' });
  }

  const record = await getPaste(req.params.id, { markAsRead: true });
  if (!record) return res.status(404).json({ error: 'not found or expired' });
  res.json({
    id: record.id,
    content: record.content,
    language: record.language,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  });
});

// --- Human-facing routes ---

app.get('/:id/raw', async (req, res) => {
  const peek = await getPaste(req.params.id);
  if (!peek) return res.status(404).type('text/plain').send('Not found or expired.');

  if (peek.passwordHash && !verifyPassword(peek, suppliedPassword(req))) {
    return res
      .status(401)
      .type('text/plain')
      .send('Password required or incorrect. Pass it via an X-Paste-Password header.');
  }

  const record = await getPaste(req.params.id, { markAsRead: true });
  if (!record) return res.status(404).type('text/plain').send('Not found or expired.');
  res.type('text/plain').send(record.content);
});

async function handlePasteView(req, res, next) {
  // Let static file requests (favicon, etc.) fall through.
  if (req.params.id.includes('.')) return next();

  const peek = await getPaste(req.params.id);
  if (!peek) return res.status(404).send(renderNotFoundPage());

  if (peek.passwordHash) {
    const provided = suppliedPassword(req);
    if (!provided || !verifyPassword(peek, provided)) {
      // provided-but-wrong gets a distinct message from never-having-tried,
      // so a wrong guess doesn't look identical to a fresh page load.
      return res.status(401).send(renderPasswordPage(req.params.id, Boolean(provided)));
    }
  }

  const record = await getPaste(req.params.id, { markAsRead: true });
  if (!record) return res.status(404).send(renderNotFoundPage());
  res.send(renderPastePage(record));
}

app.get('/:id', handlePasteView);
// The password prompt is a plain HTML form (works without JS) that POSTs
// back to the same path — passwords never appear in a URL, query string,
// browser history, or server access log this way.
app.post('/:id', handlePasteView);

if (require.main === module) {
  // Only run the standalone server (and its periodic cleanup) when this
  // file is actually run directly — not when required as a serverless
  // handler (see api/index.js). A background setInterval doesn't make
  // sense in a serverless function: the platform freezes/thaws instances
  // unpredictably, so it wouldn't fire reliably anyway. Expired pastes are
  // still refused at read time regardless (see getPaste), so skipping the
  // periodic sweep on serverless just means storage reclamation is
  // deferred rather than security being affected — set up a Vercel Cron
  // Job hitting a small cleanup endpoint if you want proactive sweeping
  // there too.
  const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    sweepExpired().catch((err) => console.error('sweep failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  app.listen(PORT, () => console.log(`snippet-share running on http://localhost:${PORT}`));
}

module.exports = app;
