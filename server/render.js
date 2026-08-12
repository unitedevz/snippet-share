function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPastePage({ id, content, language, createdAt, burnAfterRead }) {
  const safeContent = escapeHtml(content);
  const created = new Date(createdAt).toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paste ${escapeHtml(id)} · snippet-share</title>
<link rel="stylesheet" href="/style.css" />
</head>
<body>
<div class="wrap">
  <header>
    <a href="/" class="brand">snippet-share</a>
    <div class="meta">
      <span>${escapeHtml(language)}</span>
      <span>${created}</span>
      ${burnAfterRead ? '<span class="burn">🔥 burned after this view</span>' : ''}
    </div>
  </header>
  <div class="toolbar">
    <button id="copyBtn">Copy</button>
    <a href="/${escapeHtml(id)}/raw" target="_blank">Raw</a>
    <a href="/">New paste</a>
  </div>
  <pre id="content">${safeContent}</pre>
</div>
<script>
  document.getElementById('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('content').textContent);
    const btn = document.getElementById('copyBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });
</script>
</body>
</html>`;
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Not found · snippet-share</title>
<link rel="stylesheet" href="/style.css" />
</head>
<body>
<div class="wrap">
  <header><a href="/" class="brand">snippet-share</a></header>
  <p class="notfound">This paste doesn't exist, has expired, or was already burned after reading.</p>
  <a href="/">Create a new one</a>
</div>
</body>
</html>`;
}

module.exports = { escapeHtml, renderPastePage, renderNotFoundPage };
