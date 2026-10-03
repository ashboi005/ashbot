# Ashbot — MVP Design

**Date:** 2026-09-29
**Status:** Draft, awaiting review

## 1. What this is

Ashbot is an always-on investigation assistant for client support. A registered client reports a broken system through a web portal. Ashbot acknowledges it, investigates the right project's infrastructure and code in read-only mode, and sends Ashwath a short root-cause hypothesis with evidence over Discord.

**The problem it solves:** rebuilding context. Today a bug report means logging back into accounts, finding the right Axiom dataset, and re-learning a codebase untouched for months. Each project's profile and runbook hold that context permanently, and the agent does the digging.

**How we know it works:** for a real client bug (the first test is the one reported on 2026-09-29), Ashbot sends a Discord report whose hypothesis is correct or points to the right place, with enough evidence to confirm it in a couple of minutes.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Agent permissions (MVP) | Fully read-only. It cannot write, deploy, restart or push. |
| Changes (post-MVP) | Always through a PR sent to Ashwath on Discord. Production or AWS config changes need Ashwath's approval (a PR or a video walkthrough). |
| Client ↔ agent contact | Blocked. Clients only see "I'm looking into it." Ashwath replies to clients, or the agent sends a message on his behalf after he approves. |
| Login | Invite-only, using Better Auth. |
| Roles | `client`, `admin` (Ashwath), and `worker` (the investigation service identity). |
| Hypotheses | At most **2 bullet points**, each with evidence. |
| Evidence | The agent saves **log snapshots** (the raw lines it relied on) with the report. |
| Log retention | Axiom keeps 30 days, which is enough. |
| Notifications | A one-way Discord webhook on each new hypothesis. A two-way bot comes later. |
| Code access | A GitHub Personal Access Token. Ashwath provides the repo and project details at setup. |
| Shell access | Only commands on an allowlist. No open-ended shell. |
| LLM access | **Merge Gateway** (OpenAI-compatible, `https://api-gateway.merge.dev/v1`). Routing, provider failover and spend caps are set in the gateway, not in code. |
| Model | **GLM-5.3-Flash** (Z.ai), called through Merge Gateway. Set by config (`LLM_MODEL`), so switching models is an env change. The exact gateway model string gets verified against the gateway's `/v1/models` at build time. |
| Agent harness | **A custom, lightweight TypeScript harness** in the Bun monorepo. OpenHarness isn't used and the backend stays on Elysia. See §5. |
| AWS | The agent gets a **read-only** IAM key. Ashwath's admin keys are kept separately for approved changes and AWS config updates, and the worker never loads them. |
| Client hosting | All client databases run directly on their VPS (no RDS for now). **Each server runs its own Coolify instance.** The design will be extended when a project moves to RDS. |
| Attachments | Stored in **S3**. |
| First validation | The command-line investigator runs against the real bug reported today. No formal test set yet. |
| Stack | Better-T-Stack: Next.js (web), Elysia on Bun (server), Better Auth, Postgres, Drizzle, Bun workspaces. |

## 3. Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────────────┐
│ apps/web     │────▶│ apps/server      │────▶│ Postgres (ashbot's own)│
│ Next.js      │     │ Elysia API       │     │ tickets, projects,     │
│ client portal│     │ auth, tickets,   │     │ jobs, reports, audit   │
│ admin portal │     │ uploads, admin   │     └───────────▲────────────┘
└──────────────┘     └──────────────────┘                 │ claims jobs
                                                          │
                                              ┌───────────┴────────────┐
                                              │ apps/worker (Bun)      │
                                              │ investigation agent    │
                                              │ custom harness → Merge │
                                              └───────────┬────────────┘
                              read-only tools             │
        ┌──────────┬──────────┬──────────┬────────┬───────┴──┬──────────┐
        ▼          ▼          ▼          ▼        ▼          ▼          ▼
     Coolify     Axiom      AWS       GitHub   Postgres     SSH      Discord
     API         APL        (RO IAM)  repo     (RO role)   allowlist webhook
```

### Parts

- **`apps/web` (Next.js).** Client portal and admin portal in one app, separated by role. Clients never see agent output.
- **`apps/server` (Elysia).** Auth (already scaffolded), ticket and upload API, and admin API for projects, credentials, invites and reports. It has no agent logic.
- **`apps/worker` (new, Bun).** A long-running process that takes jobs from Postgres and runs one investigation per job. It is the only process that can decrypt a project's integration credentials. It's kept separate from the server so that long agent runs and credentials never sit in the web-facing process.
- **`packages/db`.** Drizzle schema shared by server and worker.
- **`packages/agent` (new).** The agent harness: system prompt, tool definitions, report schema, budget enforcement. The worker and the command-line investigator both import it, so the command line and production run the same code.
- **`packages/integrations` (new).** Thin read-only clients for Coolify, Axiom, AWS, GitHub, Postgres and SSH. Each client is used by one tool and knows nothing about the LLM.

### Job queue

A `jobs` table in Postgres, claimed with `SELECT … FOR UPDATE SKIP LOCKED`. No Redis. One investigation runs at a time per project. A ticket that arrives while a run is in progress is attached to it as extra context.

## 4. Data model (first pass)

- `user`, `session`, … : Better Auth tables (already scaffolded), plus a `role` column (`client` | `admin`).
- `project`: name, summary, repo (`owner/name`, default branch), runbook (markdown).
- `project_member`: user ↔ project. A client with exactly one project skips the project picker.
- `project_integration`: project, kind (`coolify` | `axiom` | `aws` | `postgres` | `ssh` | `github`), non-secret config (JSON, e.g. Coolify instance URL + app UUIDs, Axiom dataset names, AWS region and resource IDs, SSH host), and an **encrypted** secret. The secret is sealed with the worker's public key (libsodium sealed box). The server can encrypt it when the admin enters credentials but can never decrypt it. Only the worker holds the private key.
- `ticket`: project, author, description, when it started (optional, entered by the client), status (`received` | `investigating` | `reported` | `resolved`), timestamps.
- `ticket_attachment`: ticket, storage key, MIME type. Images are sent to the model as image input (GLM-5.3-Flash is natively multimodal).
- `ticket_message`: ticket, author (client or admin), body. This is the thread the client sees. There are no agent authors in the MVP.
- `investigation`: ticket, status, model, tokens used, cost, started/ended, and the final report (JSON).
- `tool_call`: investigation, tool name, input, output (redacted, truncated), duration, error. This is the complete audit trail.
- `log_snapshot`: investigation, source (Axiom, Coolify, AWS …), query, raw lines. These are referenced from the report as evidence.

Attachment storage: a private S3 bucket (`ashbot-attachments`). The server uploads with a small write-only IAM user that can only reach that bucket. This is separate from the agent's read-only key and from the admin keys. Clients and the admin portal view images through short-lived presigned URLs.

## 5. The agent

### Harness

A **custom TypeScript harness** in `packages/agent` (a few hundred lines). It calls Merge Gateway through its OpenAI-compatible Chat Completions API, using the `openai` npm client with `baseURL` pointed at the gateway.

**Why not OpenHarness:** it's a well-built Python harness, but most of what it offers is broad built-in tools: file I/O, shell, web and MCP. Those are exactly what the MVP agent must *not* have. Using it would mean running a separate Python service, or porting the backend from Elysia to Python, and duplicating the DB schema and project config in two languages, only to switch most of it off. Every tool here is custom and read-only. What we need is a loop, a tool registry, caps and hooks, and that's small. Post-MVP bash access (§9) is one more tool on this harness. It doesn't need a different framework.

**Core loop**

```
messages = [system(prompt + runbook), user(ticket + attachments)]
loop:
  check caps (tool calls, wall-clock time, tokens/cost) → if hit, ask for a partial report
  response = gateway.chat.completions.create({ model: LLM_MODEL, messages, tools })
  if response calls submit_report → validate against the report schema → done
  for each tool call (run in parallel):
    parse args → validate with zod → before hook (allowlist / scope checks)
    run → after hook (redact, truncate, write tool_call audit row)
  append the assistant message + tool results → repeat
```

- **Tool definition:** `defineTool({ name, description, input: zodSchema, run })`. The JSON Schema sent to the model is generated with `z.toJSONSchema`. Arguments that fail validation go back to the model as a tool error rather than throwing, so the model can retry.
- **Model:** `LLM_MODEL` env, default GLM-5.3-Flash. Because it goes through the gateway, pointing one investigation at a stronger model is a config change (for example, when a hard ticket comes back `inconclusive`).
- **Caps per investigation**, enforced by the harness: max tool calls (default 40), max wall-clock time (default 10 min), and max tokens (default 1M). When a cap is hit, the model gets one last turn to call `submit_report` with status `inconclusive`, so there's always a report. Spend caps are also set per project in Merge Gateway as a second limit.
- **Provider failover:** handled by Merge Gateway's routing and fallback config. The harness only retries transient HTTP errors with backoff.
- **Context size:** tool outputs are truncated (defaults: 200 rows or 20 KB per call), with a note saying so. Large log pulls are saved as `log_snapshot` rows, and the model gets a summary plus the snapshot ID.
- **Data leaving the VPS:** ticket content, logs and code snippets are sent to the model provider through the gateway. Only secrets are removed before sending; other client data is sent as-is. Choose a gateway route with zero data retention (Merge lists ZDR for GLM-5.3).

### Treating input as untrusted

Ticket text, images, log lines, database rows and repo files are all **data**. The system prompt says so explicitly. Tools can only read, so even a successful injection can at worst waste a run's budget or distort a report that Ashwath reviews anyway.

### Secrets never reach the model

Tools resolve credentials inside the harness. For example, the Postgres tool takes a project ID and a SQL query. It never takes, or returns, a connection string. When the agent looks at environment variables, it sees **names only**, and values are masked. Every tool output passes through a redaction step (known secret values, plus patterns for keys and tokens) before it reaches the model, the database or Discord.

### Investigation strategy (in the system prompt)

1. Read the ticket, attachments, when it started, and the project runbook.
2. Check the obvious things first: are the Coolify apps up, recent deployments, container logs around when it started.
3. Query Axiom for errors in that time window. **If an error clearly explains the ticket, stop and report right away.**
4. Check the related AWS services (CloudWatch logs and metrics, EC2/ECS/Lambda status, S3).
5. If the logs don't settle it, read the repo at the deployed commit: search for the failing route or function and follow the code path.
6. If needed, run read-only SQL to confirm data-state hypotheses.
7. If needed, run allowlisted SSH diagnostics (disk, memory, container state).
8. Write the report.

Reproducing the bug or probing the live backend is post-MVP (§9).

### Tools (all read-only)

| Tool | What it does | Where it's enforced |
|---|---|---|
| `coolify_list_resources` | Apps, services and databases for this project's Coolify project and environment | Token with `read` scope only |
| `coolify_app_status` | Status, domains, current commit, last deployments | same |
| `coolify_app_logs` | Container logs (with a limit on lines) | Needs `read:sensitive` because Coolify treats logs as sensitive. Still no `write` or `deploy` scope. |
| `coolify_deployment_logs` | Build and deploy logs for a deployment | same |
| `coolify_env_names` | Environment variable **names** for an app. Values are never returned. | Masked by the harness |
| `axiom_query` | Runs APL against allowlisted datasets, limited by time range and row count | Axiom API token with query-only permission |
| `aws_describe` | A fixed set of read calls: CloudWatch Logs `FilterLogEvents`, CloudWatch `GetMetricData`, EC2/RDS/ECS/Lambda `Describe*`, S3 `ListObjectsV2`/`HeadObject` | IAM user with read-only policy (see §6.3) + a list of allowed operations in the harness |
| `repo_tree` / `repo_read` / `repo_search` | Browse, read and search the repo **at the deployed commit** | Local clone made with a read-only PAT. The tool can't reach paths outside the clone. |
| `repo_log` | Recent commits and diffs ("what changed just before it broke?") | same |
| `db_query` | One SQL statement in a `READ ONLY` transaction with a `statement_timeout` and a row limit | Read-only Postgres role (see §6.2) + a read-only transaction + only one statement allowed |
| `ssh_run` | Runs a command from the project's allowlist, e.g. `docker ps`, `docker logs --tail N <container>`, `df -h`, `free -m`, `uptime`, `systemctl status <unit>` | Commands are chosen from a list and never written as free text. Arguments are checked against patterns. |
| `note_log_snapshot` | Saves the raw log lines the agent is relying on as evidence | Harness |
| `submit_report` | Ends the run with the structured report | Harness |

### Report format

```
Title:        one line
Severity:     low | medium | high | critical
Status:       confident | likely | inconclusive
Hypotheses:   max 2 bullets, each with its evidence (log snapshot IDs, file:line, query)
Next steps:   what Ashwath should check or do
Suggested fix: optional, as a diff in text (not applied)
Coverage:     which tools/sources were checked and which weren't (so gaps are visible)
```

**Discord message:** project, client, title, severity, the 2 hypothesis bullets, and a link to the full report in the admin portal. Secrets are always removed.

## 6. How it connects to Coolify, Postgres and AWS

### 6.1 Coolify

- **Deploying Ashbot itself:** Ashbot runs on Ashwath's VPS as a Coolify project with four resources: `ashbot-postgres` (a Coolify-managed Postgres, deployed **first**), `ashbot-server`, `ashbot-web`, and `ashbot-worker`. The server and worker get `DATABASE_URL` set to the Postgres container's internal URL. Coolify shows it on the database page, and it works because all four resources sit on the same Docker network.
- **Reading client projects:** One Coolify API token per Coolify instance. Scopes: `read` + `read:sensitive`, **never** `write`, `deploy` or `root`. `read:sensitive` is needed because Coolify redacts logs and environment values without it. The token is team-bound, so it only sees that team's resources.
- **One Coolify instance per server.** Each client server runs its own Coolify, so the `coolify` integration is set up **per project**: the instance URL, that instance's read token (encrypted), and the project/environment UUID and app UUIDs that belong to the Ashbot project. There's no global Coolify config. The agent can list resources to fill in UUIDs, but only on the configured instance and project.
- **The same server's SSH access** (for the database tunnel and, later, diagnostics) is recorded in the project's `ssh` integration: host, user, and Ashbot's dedicated private key (encrypted).

### 6.2 Reaching a client's Postgres

The agent never uses the app's own `DATABASE_URL` for queries, because that user can write. At setup:

1. **Find the database.** Read the app's environment variables through the Coolify API. This runs in the harness, not through the model. Parse `DATABASE_URL` (or the equivalent) to get the host, port and database name. All client databases currently run directly on their VPS. If Postgres was installed on the host itself, the host is usually the VPS's own address or `host.docker.internal`. If it's a Coolify database, the host is that database's container name. (RDS gets its own route when a project moves there.)
2. **Create a read-only role once:** `CREATE ROLE ashbot_ro LOGIN PASSWORD …; GRANT CONNECT …; GRANT USAGE ON SCHEMA public …; GRANT SELECT ON ALL TABLES IN SCHEMA public …; ALTER DEFAULT PRIVILEGES … GRANT SELECT …; ALTER ROLE ashbot_ro SET default_transaction_read_only = on; SET statement_timeout = '10s'`. Store the password encrypted in `project_integration`.
3. **Network path.** The client database usually isn't exposed publicly:
   - *Same server as Ashbot:* join the network directly (Coolify's "Connect to predefined network" or the same destination).
   - *Different server (the usual case):* the worker opens an **SSH tunnel** (local port forward only) to the client's VPS, using an SSH key dedicated to Ashbot, and connects to the database through it. This avoids opening the Postgres port to the internet.

The Postgres tool then enforces: only one statement, `BEGIN READ ONLY`, a row limit (default 200), and redacted output.

### 6.3 AWS

The agent reads text that clients and logs control, so it only ever holds a read-only key:

- An IAM user (or a role to assume) called `ashbot-readonly` with the AWS managed `ReadOnlyAccess` policy. It can be narrowed later to CloudWatch, EC2, ECS, Lambda and S3 metadata.
- The harness has its own list of allowed operations on top of that (see the tool table), so even read calls are limited to diagnostic ones.
- **Admin keys stay available for approved changes**, but they are stored outside the worker's reach: a separate secret that only the post-MVP "apply approved change" path loads, after Ashwath approves. The investigation worker never has them in its environment or its database access.

AWS still comes **early**, together with Coolify and Axiom (§8), as Ashwath requested.

### 6.4 GitHub

A fine-grained PAT with **Contents: read** and **Metadata: read**, limited to the client repos. The worker keeps a shallow clone per project in a cache directory, and runs `git fetch` then checks out the **commit Coolify reports as deployed** (not `main`). The PR phase later needs a separate token with write scopes.

## 7. Client and admin flows

**Client:** accepts an invite → sets a password → sees their projects (skipped if there's only one) → submits a ticket (description, photos, when it started) → sees "I'm looking into it." → sees status changes and Ashwath's replies in the thread.

**Admin:** invites clients → creates projects (repo, runbook, integrations with credentials, each with a "test connection" button) → gets a Discord notification → opens the report (hypotheses, log snapshots, tool-call trail, cost) → replies to the client in the thread → marks the ticket resolved → optionally adds what was learned to the runbook.

## 8. Build order

Each phase gives something usable before the next begins.

| # | Phase | Result |
|---|---|---|
| 0 | Ashbot's Postgres on Coolify + schema + env setup | The database the rest depends on |
| 1 | **Command-line investigator** with Coolify + Axiom + AWS tools, project profile from a local config file | `bun run investigate --project X "ticket text"` prints a report. **Validated on today's client bug.** |
| 2 | Repo tools (clone at the deployed commit, read, search, log) | Hypotheses that point to code |
| 3 | Postgres read-only tool + SSH tunnel | Data-state checks |
| 4 | Worker + job queue + Discord webhook + audit tables | Runs unattended. A ticket inserted into the DB leads to a Discord message. |
| 5 | Portal: invites, roles, projects, tickets, uploads, admin report view | Clients can submit tickets |
| 6 | SSH allowlisted diagnostics | Checks at the host level |

## 9. Post-MVP: bash access and reproduction

Not built in the MVP. Recorded here so the harness leaves room for it.

**Bash for probing the live backend.** The agent gets a `bash` tool so it can:
- guess from the client's description which route is failing
- send real requests to it (curl) and check the responses
- match them against the logs from the same moment
- inspect response headers and bodies the way the browser's network tab shows them

That turns "I think route X is failing" into "I called route X and got a 500, and here's the matching log line." The rules when this is built:
- The shell runs in a **throwaway container**, never on a client server. It has an egress allowlist limited to the project's own domains.
- **Requests to the live backend are real.** GET and HEAD are free to use. POST, PUT, PATCH and DELETE against production need Ashwath's approval (Discord button, item 1 in §10) or must target a test account set up in the project profile.
- Credentials for test accounts are injected by the harness as env vars the model can refer to by name, not by value.
- Every command and its output is recorded in the `tool_call` audit trail, like every other tool.

**Running the app to reproduce a bug.** Running it with its production `.env` makes it a production writer: migrations on startup, cron jobs, emails or WhatsApp messages to real users, card charges, webhooks. When this is built:
- The app runs in the same kind of throwaway container.
- `DATABASE_URL` points to the `ashbot_ro` role or a restored copy of the database.
- Keys for email, messaging, payments and webhooks are removed or replaced with dummies.
- Migrations on startup and cron jobs are turned off.
- Only the harness builds this environment.

This sandbox later becomes the place where fixes are built (§10, item 2).

## 10. After the MVP (in priority order)

1. **Two-way Discord bot:** Approve/Reject/Investigate-more buttons. The one-way webhook stays in the MVP. This is the step toward "validate, then proceed," and it's what approves the mutating requests in §9.
2. **Bash and live-backend probing** (§9).
3. **Fix workflow:** an isolated cloud instance cloned from GitHub → reproduce (§9) → fix → run tests → open a PR → Discord → Ashwath approves. Production or AWS config changes are proposed as PRs, or explained on video, and then applied with the admin keys (§6.3) only after approval.
4. **Proposal workflow:** the agent suggests a fix before doing anything, and executes only after approval.
5. **Client notifications after approval:** the agent sends the resolution message on Ashwath's behalf, as a draft he approves. It can go through the portal, email or WhatsApp.
6. **Runbook upkeep:** after a ticket is resolved, the agent suggests runbook edits for Ashwath to accept.
7. **Voice notes and multilingual input** (Deepgram transcription and translation).
8. **Autonomous small fixes** for bug types that meet agreed rules.
9. **Proactive mode** (watching Axiom and Coolify alerts before a client reports anything). **Lowest priority.**

(Model fallback isn't on this list anymore: Merge Gateway's routing handles it from day one.)

## 11. Out of scope for the MVP

Any write, deploy or restart action. Bash access and running the app (§9). Agent messages to clients. Voice and translation. PRs. Billing and SLAs. RDS support. Multiple tenants beyond Ashwath's own clients.

## 12. Open questions

None open. (The model was confirmed as GLM-5.3-Flash on 2026-09-29.)
