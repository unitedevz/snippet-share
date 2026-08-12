#!/usr/bin/env node
// Usage:
//   cat file.txt | node cli/pastebin.js
//   node cli/pastebin.js file.txt
//   node cli/pastebin.js --expires 1h --burn file.txt
//   SERVER_URL=https://paste.example.com node cli/pastebin.js file.txt

const fs = require('fs');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

function parseArgs(argv) {
  const args = { expiresIn: 'never', burnAfterRead: false, language: 'text', file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--expires') args.expiresIn = argv[++i];
    else if (arg === '--burn') args.burnAfterRead = true;
    else if (arg === '--lang') args.language = argv[++i];
    else if (arg === '--server') args.server = argv[++i];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`Error: ${data.error || res.statusText}`);
    process.exit(1);
  }

  console.log(data.url);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
