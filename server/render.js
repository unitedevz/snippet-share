function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Maps our stored `language` value to a highlight.js language class.
// Falls back to no highlighting (plain text) for anything unrecognized —
// hljs would otherwise guess wildly and sometimes get it embarrassingly wrong.
const HLJS_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'go', 'java', 'kotlin', 'rust',
  'c', 'cpp', 'csharp', 'php', 'ruby', 'bash', 'json', 'yaml',
  'markdown', 'sql', 'html', 'css', 'xml',
]);

function renderPastePage({ id, content, language, createdAt, burnAfterRead }) {
  const safeContent = escapeHtml(content);
  const created = new Date(createdAt).toISOString();
  const hljsClass = HLJS_LANGUAGES.has(language) ? `language-${language}` : 'plaintext';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paste ${escapeHtml(id)} · snippet-share</title>
<link rel="stylesheet" href="/style.css" />
<link id="hljsTheme" rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css" />
<script>
  (function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
</head>
<body>
<div class="wrap">
  <header>
    <a href="/" class="brand">snippet-share</a>
    <div class="header-actions">
      <div class="meta">
        <span>${escapeHtml(language)}</span>
        <span>${created}</span>
        ${burnAfterRead ? '<span class="burn">🔥 burned after this view</span>' : ''}
      </div>
      <button type="button" id="themeToggle" class="theme-toggle" aria-label="Toggle theme">🌓</button>
    </div>
  </header>
  <div class="toolbar">
    <button id="copyBtn">Copy</button>
    <a href="/${escapeHtml(id)}/raw" target="_blank">Raw</a>
    <a href="/">New paste</a>
  </div>
  <pre><code id="content" class="${hljsClass}">${safeContent}</code></pre>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js"></script>
<script>
  document.getElementById('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('content').textContent);
    const btn = document.getElementById('copyBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    const hljsTheme = document.getElementById('hljsTheme');
    hljsTheme.href = next === 'light'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css';
  });

  // Match the highlight.js theme to whatever theme loaded initially.
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    document.getElementById('hljsTheme').href =
      'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github.min.css';
  }

  if (typeof hljs !== 'undefined') {
    hljs.highlightElement(document.getElementById('content'));
  }
</script>
</body>
</html>`;
}

function renderPasswordPage(id, wasWrong) {
  const safeId = escapeHtml(id);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Password required · snippet-share</title>
<link rel="stylesheet" href="/style.css" />
<script>
  (function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
</head>
<body>
<div class="wrap">
  <header><a href="/" class="brand">snippet-share</a></header>
  <div class="password-gate">
    <p>🔒 This paste is password-protected.</p>
    ${wasWrong ? '<p class="password-error">Incorrect password — try again.</p>' : ''}
    <form method="POST" action="/${safeId}" class="password-form">
      <input type="password" name="password" placeholder="Password" autofocus required />
      <button type="submit">Unlock</button>
    </form>
  </div>
</div>
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
<script>
  (function () {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
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

module.exports = { escapeHtml, renderPastePage, renderNotFoundPage, renderPasswordPage };
