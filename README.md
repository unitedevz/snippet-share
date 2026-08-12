# snippet-share

![CI](https://github.com/unitedevz/snippet-share/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

A self-hosted pastebin/snippet sharing service. Web UI to paste and share a link, a CLI to pipe text straight in from the terminal. File-based storage by default, optional Postgres for multi-instance or persistent deployments.

## Features

- Web UI — paste, set an optional expiry, optionally burn-after-read, get a shareable link
- CLI client — `cat file.txt | node cli/pastebin.js` and get a URL back
- Raw text endpoint for any paste (`/:id/raw`) — good for `curl`-ing into scripts
- Expiry options: never, 10 minutes, 1 hour, 1 day, 7 days
- Burn-after-read — paste is deleted the moment it's viewed once
- File-based storage by default, one JSON file per paste — no database required to get started
- XSS-safe rendering (content is HTML-escaped before display)

## Setup

```bash
git clone https://github.com/unitedevz/snippet-share.git
cd snippet-share
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. By default it runs with zero setup — file-based storage, no database needed.

## Storage: file (default) or Postgres (optional)

Set `STORAGE_DRIVER` in `.env`:

| `STORAGE_DRIVER` | Setup required | Notes |
|---|---|---|
| `file` (default) | None | One JSON file per paste in `data/`. Fine for personal use or a single instance. |
| `postgres` | `DATABASE_URL` | Works with any managed Postgres — Neon, Supabase, Railway, RDS, or your own. Table is created automatically on first use. |

To use Postgres:

```bash
# .env
STORAGE_DRIVER=postgres
DATABASE_URL=postgres://user:password@host:5432/dbname
```

Both backends implement the exact same interface, so nothing else about the app changes — same routes, same CLI, same behavior. Postgres is worth it once you're running more than one instance (e.g. behind a load balancer) or want pastes to survive a container being rebuilt without a volume mount.

### CLI

```bash
# from a file
node cli/pastebin.js notes.txt

# from stdin
cat error.log | node cli/pastebin.js

# with options
cat secret.txt | node cli/pastebin.js --expires 1h --burn --lang text

# pointing at a deployed instance instead of localhost
SERVER_URL=https://paste.yoursite.com node cli/pastebin.js notes.txt
```

Link it globally with `npm link` to use it as a plain `pastebin` command.

### Docker

```bash
docker build -t snippet-share .
docker run -p 3000:3000 -v $(pwd)/data:/app/data snippet-share
```

The volume mount matters — without it, all pastes vanish when the container is removed.

### Tests

```bash
npm test
```

Two layers of coverage:
- `tests/store.test.js` — file backend against real file I/O in a temp directory
- `tests/postgres-store.mock.test.js` — postgres backend's query construction and logic against a mocked `pg` client (no live database needed)
- `tests/postgres-store.integration.test.js` — the same postgres backend against a **real** Postgres. Skipped locally unless `TEST_DATABASE_URL` is set; CI always runs it against a real Postgres service container.

## How it works

- `server/store.js` — dispatcher that picks the active backend based on `STORAGE_DRIVER`
- `server/stores/file-store.js` / `server/stores/postgres-store.js` — the two storage backends, same interface
- `server/render.js` — HTML rendering with escaping (no XSS from pasted content)
- `server/index.js` — Express app: API routes (`/api/pastes`) and human-facing routes (`/:id`, `/:id/raw`)
- `public/` — the web UI (vanilla HTML/CSS/JS, no build step)
- `cli/pastebin.js` — standalone CLI client, talks to the same API

A background sweep runs every 10 minutes to remove expired pastes even if nobody visits them (both backends).

## Notes

- Max paste size is 200,000 characters — adjust the limit in `server/store.js` if needed.
- IDs are 8 hex characters (32 bits) — fine for a personal/small-team tool, not meant to resist a determined ID-guessing attacker at scale.
- No auth on paste creation by design (keeps the CLI simple). If you deploy this publicly, consider putting it behind a reverse proxy with rate limiting.

## License

MIT — see [LICENSE](LICENSE).
