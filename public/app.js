document.getElementById('pasteForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const content = document.getElementById('content').value;
  const language = document.getElementById('language').value.trim() || 'text';
  const expiresIn = document.getElementById('expiresIn').value;
  const burnAfterRead = document.getElementById('burnAfterRead').checked;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  try {
    const res = await fetch('/api/pastes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, language, expiresIn, burnAfterRead }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    const resultBox = document.getElementById('result');
    const link = document.getElementById('resultLink');
    link.href = data.url;
    link.textContent = data.url;
    resultBox.classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create paste';
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
