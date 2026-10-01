# Ashbot — Portal, Admin, Voice and Worker (addendum to the MVP spec)

**Date:** 2026-10-02 · **Builds on:** `2026-09-29-ashbot-mvp-design.md` (phases 4–5, plus voice moved up from post-MVP)

## What Ashwath asked for

- A proper **admin panel** for Ashwath.
- A **beautiful, minimal chat interface** for clients: text, image attachments, voice notes.
- **Voice notes** transcribed with Deepgram. Hindi or mixed speech is cleaned up and translated to English by a small LLM call. English goes straight to the harness.
- Wired end to end, so Ashwath can test with real credentials afterwards. Small commits.

## Decisions

| Area | Decision | Why |
|---|---|---|
| Accounts | Better Auth **admin plugin** (`user.role` = `admin` or `user`). Public sign-up disabled. The first admin is created with `bun run admin:create`. | Server-side `createUser` is the invite path; no hand-rolled roles. |
| Invites | Admin creates an invite (email, name, projects) and gets a link to send. The client opens `/invite/<token>` and sets a password. Links expire after 7 days. | No email service needed yet. |
| Projects | DB row with `slug`, `name`, `runbook`. **Integration credentials stay in `projects.local.json`**, keyed by the same slug, for now. | Keeps secrets out of the DB until the sealed-box encryption UI is built. The worker and the command-line tool share one source. |
| Conversations | One **ticket = one conversation**. The first message creates the ticket and queues an investigation. A system message says "Thanks — I'm looking into it." Follow-ups are added to the thread. Ashwath can re-run the investigation with the whole thread. | Matches the spec: the client never talks to the agent. |
| Client sees | Their messages, Ashwath's replies, the system acknowledgement, and a status track (Received → Looking into it → Reviewing → Resolved). **Never** the report. | Spec §1 rule. |
| Admin sees | Inbox, thread and reply box, investigation report (≤2 hypotheses, evidence snapshots expandable, tool-call trail, tokens), re-run, resolve, projects (runbook editor), clients and invites. | Spec §7. |
| Attachments | Uploaded first (`POST /api/uploads`), then attached to a message. Images and audio are stored by a `Storage` driver: **S3** (Bun's built-in S3 client) when `S3_BUCKET` is set, otherwise **local disk** (`.uploads/`). They are always served through `GET /api/attachments/:id`, which checks access, then redirects to a presigned S3 URL or streams the file. | S3 as decided. Local fallback so testing doesn't need a bucket. |
| Voice | Browser `MediaRecorder` (webm/opus). The server sends audio to Deepgram `POST /v1/listen?model=nova-3&language=multi&smart_format=true` during the upload request. If the detected languages include anything other than English, or the text has non-Latin script, one small LLM call through Merge Gateway (`CLEANUP_MODEL`, default `LLM_MODEL`) cleans and translates it to English. Both raw and English text are stored. The chat shows the English text under the voice note. | Ashwath left cleanup to my judgment. Only paying for it when needed. |
| Worker | `apps/worker`: polls `investigation` rows with `status = queued` using `FOR UPDATE SKIP LOCKED`. Builds the ticket content: thread text, voice transcripts in English, images as data URLs. Runs the same harness as the command-line tool, saves the report, tool calls and snapshots as JSON on the investigation row, sets the ticket to `reported`, and posts to the Discord webhook. | Spec phase 4. JSON columns instead of separate `tool_call`/`log_snapshot` tables until something needs to query them. |
| Live updates | Polling (every 4s while a conversation is open). | Enough for a support thread. No websocket infrastructure. |
| Tests | Services and routes run against **PGlite** (in-process Postgres) with the real migrations. External calls (Deepgram, gateway, S3, Discord) are faked at the `fetch` level. | No Docker needed. |

## Visual design

**Subject:** a direct line between a small software studio and the businesses whose systems it runs. Clients arrive anxious ("it's broken"); the page should feel calm, competent and personal, like messaging the engineer, not filing a ticket.

**Palette** (cool, not cream; one signal colour):
- Paper `#F7F8FA` (background), Surface `#FFFFFF`
- Ink `#18213A` (text, client bubbles), Slate `#5B6478` (secondary text)
- Line `#E3E6EC` (borders)
- Signal `#0F7B6C` (teal: live status, "looking into it" pulse, focus)
- Severity in admin: critical `#B42318`, high `#C2410C`, medium `#A16207`, low `#475467`
- Dark mode mirrors this: Ink becomes the background `#0E1424`, Paper becomes the text, and Signal is brightened to `#2BB39E`.

**Type:** Schibsted Grotesk (UI and headings; one family with weight contrast). JetBrains Mono only for log snapshots and tool output in admin, where monospace is functional.

**Layout:**
```
Client                                    Admin
┌────────────┬─────────────────────────┐  ┌──────┬───────────────┬──────────────────────┐
│ Project ▾  │ ● Looking into it ───── │  │ Inbox│ ticket list   │ thread  │ report      │
│ + New      │                         │  │ Proj │ status/sev    │         │ H1, H2      │
│ convo 1    │   bubbles               │  │ Users│               │ reply   │ evidence ▸  │
│ convo 2    │                         │  │      │               │         │ tool trail  │
│            │ [📎][🎙] message…  [➤] │  │      │               │         │             │
└────────────┴─────────────────────────┘  └──────┴───────────────┴──────────────────────┘
```
- Client: the conversation list collapses into a sheet on mobile. Bubbles are rounded (16px). The composer is a single rounded field with attach, record and send.
- **The one memorable element:** the status track at the top of each conversation, a thin line with four stops, where the current stop pulses in Signal teal while the investigation runs.
- Admin: denser, square-ish (6px radius), left-aligned. The hypotheses block is the visual anchor of a ticket.

**Copy:** plain and specific. The empty state says "What's going wrong? Describe it, attach a screenshot, or send a voice note." Errors say what happened and what to do.
