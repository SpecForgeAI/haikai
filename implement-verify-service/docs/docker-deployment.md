# Docker Deployment — Instructions for an LLM Agent

> **Audience: an LLM coding agent** (Claude Code, Kiro, Cursor agent, etc.)
> tasked with deploying this app in a Docker environment for a user.
>
> **Style:** describes WHAT must be true, not exactly HOW. Figure out the
> OS-specific path quoting, the right `docker` vs `docker compose` syntax
> for the user's installation, whether to use bind-mounts vs named volumes
> based on the user's platform, etc. The user shouldn't need to babysit
> these details.

---

## Goal

Stand up a working containerized instance of the Standards Extractor API
so the user can:
1. Reach `http://<host>:<port>/docs` and see the Swagger UI list every
   route.
2. POST to `/api/discovery/endpoints` and have V1 LLM-driven endpoint
   discovery actually run.
3. POST to `/api/v1/structural/analyze` and have the structural pipeline
   produce snapshots.
4. (Optional) Run any of `/api/refactor/*`, `/api/dep/*`,
   `/api/v1/structural/*` routes against analyzed repos.

---

## What this app needs (the contract)

### Runtime image

A Linux container with **Python 3.11**, **universal-ctags**, **Node.js 20**,
**git**, **build-essential**, and the **Claude Code CLI** (`@anthropic-ai/claude-code`).
The repo's `Dockerfile` already installs all of this — prefer building from
that rather than improvising your own image.

### Persistent state

The app writes to one workspace directory inside the container (default:
`/app/workspace`, override via `API_WORKSPACE_DIR`). It contains:
- `jobs.db` — SQLite job-queue state
- `logs/` — request and orchestration logs
- workspaces per `(company, project)` for source-code analysis

**Mount this directory** as a Docker volume (named or bind-mount) so it
survives container restarts. The default `docker-compose.yml` bind-mounts
`~/.haikai` on the host. Use whatever idiom is appropriate for the user's
platform (named volume on Windows/Mac for performance, bind-mount on Linux).

### Network exposure

One port: `8000` inside the container, mapped to whatever the user wants
externally. The `Dockerfile` `EXPOSE 8000` and the default compose file
maps `8000:8000`.

### Healthcheck

`GET /health` returns 200 when the app is up. Use this for `HEALTHCHECK`
in the Dockerfile (already configured) and for orchestrator readiness
gates (compose `condition: service_healthy`, k8s `livenessProbe`).

---

## Required configuration (env vars the user MUST supply)

The app deliberately has **no code-level defaults** for LLM configuration —
missing values fail fast with HTTP 400. You need to gather these from the
user before starting the container:

| Var | What to ask the user | Example |
|---|---|---|
| `LLM_PROVIDER` | "Which LLM provider routes your traffic?" | `custom` (local proxy), `openai`, `anthropic`, `azure`, `google` |
| `LLM_MODEL` | "Which model identifier?" — don't guess; the answer evolves | a Claude model id, an OpenAI model id, etc. |
| `LLM_BASE_URL` | Required when `LLM_PROVIDER=custom`. The OpenAI-compatible HTTP endpoint | `http://localhost:3456/v1` (local proxy on the host) |
| `STANDARDS_API_KEY` | Bearer token clients use to call the API. **Generate a strong random one** if user doesn't have one | a long random string |

### Provider-specific keys (only the one matching `LLM_PROVIDER`)

| Var | When |
|---|---|
| `ANTHROPIC_API_KEY` | `LLM_PROVIDER=anthropic` |
| `OPENAI_API_KEY` | `LLM_PROVIDER=openai` |
| (none) | `LLM_PROVIDER=custom` — auth is the proxy's job |

### Optional (don't prompt unless the user mentions the feature)

| Var | Purpose |
|---|---|
| `API_WORKSPACE_DIR` | Override `/app/workspace` |
| `JOBS_DB_PATH`, `LOG_DIR`, `ORCHESTRATION_LOG_DIR` | Override storage subpaths |
| `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` | For private-repo analysis via `repo_url` |
| `CTAGS_TIMEOUT_SEC` | Default 600. Raise for very large repos |
| `STANDARD_EXTRACTION_MAX_FILES` | Cap on file count per analysis |

Write these into a `.env` file at the repo root before `docker compose up`,
or pass them with `-e` / `--env-file` for plain `docker run`. The compose
file already wires `env_file: .env`.

---

## "Custom" provider note (very common for this project)

If the user routes LLM traffic through a **local proxy on the host** (the
common setup in this project — see `feedback_llm_proxy` memory if present),
the proxy is reachable from outside the container at `http://localhost:3456/v1`
but **NOT inside the container** at the same address. From a container,
`localhost` is the container itself.

Resolve based on platform:
- **Docker Desktop (Mac, Windows, recent Linux)**: use
  `http://host.docker.internal:3456/v1` — Docker Desktop wires this
  hostname automatically.
- **Plain Linux Docker without Desktop**: add
  `--add-host=host.docker.internal:host-gateway` to `docker run`, or in
  compose:
  ```yaml
  extra_hosts:
    - "host.docker.internal:host-gateway"
  ```
  Then use `http://host.docker.internal:3456/v1`.
- **User runs the proxy in a separate container on the same Docker
  network**: use the proxy's container name as the hostname,
  e.g. `http://claude-proxy:3456/v1`.

Pick the right form silently based on what `docker info` and the user's
platform reveal. Don't ask which one — figure it out.

---

## Build + run (high level)

The repo provides `Dockerfile` (production), `Dockerfile.dev`, and three
compose files (`docker-compose.yml`, `docker-compose.dev.yml`,
`docker-compose.test.yml`). For the production deployment a user is
asking for:

1. Confirm a `.env` file exists at the repo root with at minimum
   `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL` (when custom),
   `STANDARDS_API_KEY`. Create it if missing — never invent the LLM model
   identifier; if the user hasn't given it, ask once.
2. Build the image (use compose if available; fall back to plain
   `docker build`).
3. Start the service. Stream the first ~50 lines of logs to confirm it
   bound to the port and didn't crash on import.
4. Wait for the healthcheck to be green (poll `/health`, time out after
   ~60 seconds).
5. Run the verification block below.

---

## Verification (run AFTER the container is up)

Each of these must succeed on a fresh deploy. If any fails, surface the
output to the user and stop — do not paper over it.

```
# 1. Server is reachable
curl -fsS http://<host>:<port>/health

# 2. Routes are mounted (expect ≥ 50 paths in the OpenAPI doc)
curl -fsS http://<host>:<port>/openapi.json | <count "paths" entries>

# 3. Auth is wired (expect 401 without bearer)
curl -i http://<host>:<port>/api/v1/structural/analyze

# 4. With bearer, the LLM endpoint validates input rather than proxying
#    to a missing snapshot (expect 404 with a clear "snapshot_path not
#    found" message)
curl -fsS -X POST http://<host>:<port>/api/discovery/endpoints \
  -H "Content-Type: application/json" \
  -d '{"project_root":"/nope","snapshot_path":"/nope","provider":"<from env>","model":"<from env>"}'
```

Optional smoke test if the user has a small repo handy:
```
# Inside the container (or via the API), analyze a small repo first to
# create a snapshot, then call /api/discovery/endpoints with the snapshot
# path. Expect a non-zero `count` in the response.
```

---

## Common quirks for the LLM to handle silently

- **CRLF line endings on Windows-checked-out repos.** The Dockerfile runs
  `dos2unix` on shell scripts already; the user shouldn't need to do
  anything. If the build fails with `/bin/bash^M: bad interpreter`, the
  fix is more `dos2unix` invocations.
- **`.env` files exposing secrets in image layers.** Never `COPY .env`
  into the image; always pass it at runtime via `--env-file` or compose
  `env_file:`. The compose file already does this correctly.
- **Workspace volume permissions.** The container runs as `appuser`
  (UID created at build time). On Linux bind-mounts, the host directory
  must be readable/writable by that UID. Use a named volume to sidestep
  this if the user hits permission errors.
- **LLM proxy reachability** — see "Custom provider note" above.
- **`src/api.py` package shadow** — fixed as of merge `6a5f2d4`. If the
  user is on an older base image / older code, `uvicorn src.api:app` will
  ImportError because of a package-vs-module conflict. Pull latest before
  building.
- **Ctags timeout on huge repos.** Default 600s. If analyzing very large
  codebases (Kibana-scale), set `CTAGS_TIMEOUT_SEC=1800` or higher.

---

## Stopping / cleanup

- Stop the container: `docker compose down` (production) or
  `docker stop <container>`.
- Remove the volume only if the user explicitly wants to wipe their
  analysis history. Confirm before doing this.

---

## What this doc deliberately does NOT specify

- The exact `docker compose` v1 vs v2 syntax — pick what's installed.
- Whether to use named volumes or bind-mounts — pick based on the user's
  OS and stated preference.
- Reverse-proxy / TLS termination in front of the API — out of scope
  unless the user asks.
- Multi-replica scaling — single-replica only; the SQLite job DB and
  filesystem workspace assume one writer.
- Which secrets manager to use — if the user has Vault / AWS SM / 1Password
  CLI / etc., wire it up; otherwise plain `.env` is fine for a local box.

---

## Hand-off checklist

Before reporting "done" to the user, confirm:

- [ ] All four verification curl commands pass.
- [ ] `docker ps` shows the container as `(healthy)`.
- [ ] The user knows the URL + port to reach the API.
- [ ] The user knows the bearer token (`STANDARDS_API_KEY`) value.
- [ ] The `.env` is in the user's `.gitignore` if this is a repo.
- [ ] You've documented (in chat) which compose file you used and where
      the persistent volume lives.
