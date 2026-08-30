#!/usr/bin/env node
// Usage:
//   cat file.txt | node cli/pastebin.js
//   node cli/pastebin.js file.txt
//   node cli/pastebin.js --expires 1h --burn file.txt
//   node cli/pastebin.js --password hunter2 file.txt
//   SERVER_URL=https://paste.example.com node cli/pastebin.js file.txt
//   node cli/pastebin.js delete <id> <deleteToken> [--server url]

const fs = require('fs');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

function parseArgs(argv) {
  const args = { expiresIn: 'never', burnAfterRead: false, language: 'text', file: null, password: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--expires') args.expiresIn = argv[++i];
    else if (arg === '--burn') args.burnAfterRead = true;
    else if (arg === '--lang') args.language = argv[++i];
    else if (arg === '--server') args.server = argv[++i];
    else if (arg === '--password') args.password = argv[++i];
    else if (!arg.startsWith('--')) args.file = arg;
  }
  return args;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function runDelete(argv) {
  const [id, token, ...rest] = argv;
  let server = SERVER_URL;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--server') server = rest[++i];
  }

  if (!id || !token) {
    console.error('Usage: pastebin delete <id> <deleteToken> [--server url]');
    process.exit(1);
  }

  const res = await fetch(`${server}/api/pastes/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleteToken: token }),
  });

  if (res.status === 204) {
    console.log(`Deleted ${id}.`);
    return;
  }

  const data = await res.json().catch(() => ({}));
  console.error(`Error: ${data.error || res.statusText}`);
  process.exit(1);
}

async function runCreate(argv) {
  const args = parseArgs(argv);
  const server = args.server || SERVER_URL;

  let content;
  if (args.file) {
    content = fs.readFileSync(args.file, 'utf8');
  } else if (!process.stdin.isTTY) {
    content = await readStdin();
  } else {
    console.error('Usage: cat file.txt | pastebin  OR  pastebin <file> [--expires 1h] [--burn] [--lang js]');
    process.exit(1);
  }

  if (!content.trim()) {
    console.error('Nothing to paste — input was empty.');
    process.exit(1);
  }

  const res = await fetch(`${server}/api/pastes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      language: args.language,
      expiresIn: args.expiresIn,
      burnAfterRead: args.burnAfterRead,
      password: args.password || undefined,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Error: ${data.error || res.statusText}`);
    process.exit(1);
  }

  console.log(data.url);
  // Goes to stderr so `pastebin file.txt > urls.txt`-style piping of just
  // the URL still works — the delete token is there if you want it, but
  // doesn't clutter the primary stdout output.
  console.error(`Delete with: pastebin delete ${data.id} ${data.deleteToken}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'delete') {
    await runDelete(argv.slice(1));
  } else {
    await runCreate(argv);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
