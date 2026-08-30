// --- Theme toggle ---
const themeToggle = document.getElementById('themeToggle');
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// --- Char/line counter ---
const contentEl = document.getElementById('content');
const charCountEl = document.getElementById('charCount');
const lineCountEl = document.getElementById('lineCount');

function updateStats() {
  const text = contentEl.value;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  charCountEl.textContent = `${chars.toLocaleString()} character${chars === 1 ? '' : 's'}`;
  lineCountEl.textContent = `${lines.toLocaleString()} line${lines === 1 ? '' : 's'}`;
}
contentEl.addEventListener('input', updateStats);
updateStats();

// --- Drag & drop file upload ---
const dropzone = document.getElementById('dropzone');
const languageSelect = document.getElementById('language');

const EXT_TO_LANGUAGE = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
  py: 'python', go: 'go', java: 'java', kt: 'kotlin',
  rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', rb: 'ruby', sh: 'bash', bash: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown',
  sql: 'sql', html: 'html', htm: 'html', css: 'css', txt: 'text',
};

// Same set render.js recognizes server-side — keep in sync with server/render.js.
const HLJS_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'go', 'java', 'kotlin', 'rust',
  'c', 'cpp', 'csharp', 'php', 'ruby', 'bash', 'json', 'yaml',
  'markdown', 'sql', 'html', 'css',
]);

function languageFromFilename(name) {
  const ext = name.split('.').pop().toLowerCase();
  return EXT_TO_LANGUAGE[ext] || null;
}

let languageManuallySet = false;
languageSelect.addEventListener('change', () => {
  languageManuallySet = languageSelect.value !== 'auto';
});

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;

  if (file.size > 200_000) {
    alert('That file is too large (max ~200,000 characters).');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    contentEl.value = reader.result;
    updateStats();

    // Only override the dropdown if the user hasn't manually picked a
    // language and we can confidently tell from the file extension.
    if (!languageManuallySet) {
      const detected = languageFromFilename(file.name);
      if (detected && [...languageSelect.options].some((o) => o.value === detected)) {
        languageSelect.value = detected;
      }
    }
  };
  reader.onerror = () => alert('Could not read that file.');
  reader.readAsText(file);
});

// Resolves the language to actually store: uses the manual selection,
// or runs highlight.js's auto-detection against the pasted content when
// "Auto-detect" is selected (falls back to "text" if hljs isn't loaded
// yet or the guess isn't one we render specially).
function resolveLanguage(content) {
  if (languageSelect.value !== 'auto') return languageSelect.value;

  if (typeof hljs === 'undefined' || !content.trim()) return 'text';

  const guess = hljs.highlightAuto(content).language;
  return guess && HLJS_LANGUAGES.has(guess) ? guess : 'text';
}

// --- Paste creation ---
document.getElementById('pasteForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const content = contentEl.value;
  const language = resolveLanguage(content);
  const expiresIn = document.getElementById('expiresIn').value;
  const burnAfterRead = document.getElementById('burnAfterRead').checked;
  const password = document.getElementById('password').value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    const res = await fetch('/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, language, expiresIn, burnAfterRead, password: password || undefined }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    const resultBox = document.getElementById('result');
    const link = document.getElementById('resultLink');
    link.href = data.url;
    link.textContent = data.url;
    resultBox.classList.remove('hidden');
    document.getElementById('password').value = '';

    // Held only in memory for this page load — it's a one-time secret
    // returned by the server exactly once, at creation. Refreshing the
    // page or leaving it loses it (same as the server: it's never
    // re-exposed after creation), so there's nothing extra to clean up.
    currentDeleteToken = data.deleteToken;
    currentPasteId = data.id;
    const deleteBtn = document.getElementById('deleteResult');
    const deleteStatus = document.getElementById('deleteStatus');
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'Delete now';
    deleteStatus.textContent = '';
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create paste';
  }
});

let currentDeleteToken = null;
let currentPasteId = null;

document.getElementById('deleteResult').addEventListener('click', async () => {
  if (!currentDeleteToken || !currentPasteId) return;

  const deleteBtn = document.getElementById('deleteResult');
  const deleteStatus = document.getElementById('deleteStatus');

  if (!confirm('Delete this paste now? This can\'t be undone.')) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = 'Deleting…';

  try {
    const res = await fetch(`/api/pastes/${currentPasteId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteToken: currentDeleteToken }),
    });

    if (res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not delete this paste');
    }

    deleteStatus.textContent = 'Deleted.';
    deleteBtn.remove();
    currentDeleteToken = null;
    currentPasteId = null;
  } catch (err) {
    deleteStatus.textContent = err.message;
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'Delete now';
  }
});

document.getElementById('copyResult').addEventListener('click', () => {
  const link = document.getElementById('resultLink');
  navigator.clipboard.writeText(link.href);
  const btn = document.getElementById('copyResult');
  const original = btn.textContent;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = original; }, 1200);
});
