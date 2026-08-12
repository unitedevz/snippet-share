const express = require('express');
const path = require('path');
const { createPaste, getPaste, sweepExpired, EXPIRY_OPTIONS } = require('./store');
const { renderPastePage, renderNotFoundPage } = require('./render');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- API ---

app.post('/api/pastes', async (req, res) => {
  try {
    const { content, language, expiresIn, burnAfterRead } = req.body || {};

    if (expiresIn && !(expiresIn in EXPIRY_OPTIONS)) {
      return res.status(400).json({ error: `expiresIn must be one of: ${Object.keys(EXPIRY_OPTIONS).join(', ')}` });
    }

    const record = await createPaste({ content, language, expiresIn, burnAfterRead });
    const base = `${req.protocol}://${req.get('host')}`;

    res.status(201).json({
      id: record.id,
      url: `${base}/${record.id}`,
      rawUrl: `${base}/${record.id}/raw`,
      expiresAt: record.expiresAt,
      burnAfterRead: record.burnAfterRead,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/pastes/:id', async (req, res) => {
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
  const record = await getPaste(req.params.id, { markAsRead: true });
  if (!record) return res.status(404).type('text/plain').send('Not found or expired.');
  res.type('text/plain').send(record.content);
});

app.get('/:id', async (req, res, next) => {
  // Let static file requests (favicon, etc.) fall through.
  if (req.params.id.includes('.')) return next();

  const record = await getPaste(req.params.id, { markAsRead: true });
  if (!record) return res.status(404).send(renderNotFoundPage());
  res.send(renderPastePage(record));
});

// Periodic cleanup of expired pastes, every 10 minutes.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  sweepExpired().catch((err) => console.error('sweep failed:', err.message));
}, SWEEP_INTERVAL_MS);

if (require.main === module) {
  app.listen(PORT, () => console.log(`snippet-share running on http://localhost:${PORT}`));
}

module.exports = app;
