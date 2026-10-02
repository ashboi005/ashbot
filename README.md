# Ashbot

An always-on investigation assistant for client support. Clients report problems in a chat (text, screenshots, voice notes). Ashbot reads the project's Coolify, Axiom and AWS read-only, writes a report with at most two hypotheses, and pings Ashwath on Discord. Clients never talk to the agent; Ashwath replies.

```
apps/web           Next.js — client chat (/chat) and admin panel (/admin)
apps/server        Elysia API — auth (invite-only), tickets, uploads, voice notes, admin
apps/worker        Runs queued investigations, saves reports, posts to Discord
apps/investigator  Command-line investigator (same harness, no portal)
packages/agent     Harness: tool loop, caps, redaction, prompts, tools
packages/integrations  Read-only clients: Coolify, Axiom, AWS, Deepgram, Discord, S3
packages/db        Drizzle schema + migrations      packages/contracts  API types
```

Design docs: `docs/superpowers/specs/`.

## Setup

```bash
bun install
```

1. **Database.** Set `DATABASE_URL` in `apps/server/.env` (for local work, `docker compose up -d` gives you `postgresql://postgres:password@localhost:5432/postgres`). Then:
   ```bash
   bun run db:migrate
   bun run admin:create --email you@example.com --name "Your Name" --password "a-long-password"
   ```
2. **Fill `apps/server/.env`** (schema and descriptions in `apps/server/.env.schema`). The server and worker both read this file:
   - `MERGE_GATEWAY_API_KEY`, `LLM_MODEL` (exact GLM-5.3-Flash id from `GET https://gateway.merge.dev/v1/models`), optional `CLEANUP_MODEL`
   - `DEEPGRAM_API_KEY` for voice-note transcripts (without it, voice notes are kept but not transcribed)
   - `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` for attachments (without them, files go to `.uploads/`)
   - `DISCORD_WEBHOOK_URL` for report notifications
3. **Client infrastructure.** Copy `projects.example.json` to `projects.local.json` and fill one entry per project: Coolify URL + read-only token (`read` + `read:sensitive`) + app UUIDs, Axiom token + datasets, read-only AWS keys. The `id` must match the project id you create in the admin panel.

## Run

```bash
bun run dev          # web on :3001, API on :3000
bun run dev:worker   # investigation worker (separate terminal)
```

Then sign in at http://localhost:3001, add a project under **Projects** (same id as in `projects.local.json`), and invite a client under **Clients**: you get a link to send them.

Command-line investigation without the portal:

```bash
bun run investigate --project <id> --since "this morning" "client's message" [--image shot.png]
```

## Tests

```bash
bun test             # everything (Postgres-backed tests use in-process PGlite, no Docker needed)
bun run check-types
```
