# Integration Campaign — reproducible REST runbook

Every HTTP call made to the standards-extractor service during the full
end-to-end campaign, in order, copy-pasteable. Secrets are redacted as
`<API_KEY>`, `<INGRESS>`, `<WEBHOOK_SECRET>`, `<CB_SECRET>` — substitute your
own. Base URL `$API` (default `http://127.0.0.1:8749`); public tunnel `$TUNNEL`.

## Phase checklist
- [x] 0 — rig (API + worker + tunnel + callback receiver) + this runbook
- [x] 1 — build 2 features via the API (shape-spec → orchestrate)
- [x] 2 — publish both to private GitHub repos with Actions CI
- [x] 3 — full verification (inline + rubric + ci-trigger; polyrepo D5 AND gate hands-free → advanced)
- [x] 4 — bug round-trip (POST /bugs → worker → haikai fix → signed callback success)
- [x] 5 — finalize + teardown + commit

## Environment (operator-supplied, not via API)
```
ANTHROPIC_API_KEY   # Claude OAuth token (server-side; powers the agent sessions)
STANDARDS_API_KEY=<API_KEY>                 # bearer for all consumer endpoints
SX_INGRESS_TOKEN_GITHUB=<INGRESS>           # CI webhook path token
SX_WEBHOOK_SECRET_GITHUB=<WEBHOOK_SECRET>   # CI webhook HMAC secret
SX_CALLBACK_SIGNING_SECRET=<CB_SECRET>      # signs bug callbacks
SX_CALLBACK_ALLOW_INSECURE=1 SX_CALLBACK_ALLOW_PRIVATE=1   # dev: allow the local callback receiver
API_WORKSPACE_DIR / JOBS_DB_PATH / VERIFICATION_DB_PATH    # shared by API + worker
```

---

## Phase 0 — rig

Boot (operator, not REST):
- API:    `python -m uvicorn src.api:app --host 127.0.0.1 --port 8749`
- worker: `python -m src.job_queue.worker`
- tunnel: `cloudflared tunnel --url http://127.0.0.1:8749`  → `$TUNNEL`
- callback receiver: a local server on :8792 that records POSTs (for Phase 4).

### Health check
```bash
curl -s $API/health
# → {"status":"healthy","service":"standards-extractor"}
```

### Auth is enforced (every consumer endpoint)
```bash
curl -s -o /dev/null -w "%{http_code}" $API/api/v1/specs/acme/probe                       # → 401 (no bearer)
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer wrong" $API/api/v1/specs/acme/probe  # → 401
```

### Public gateway reachable (CI webhooks land here)
```bash
curl -s -X POST "$TUNNEL/api/v2/inbound/github/wrong" -d '{}'   # → 401 {"error":"unknown ingress token"}
```
Rig confirmed: API healthy · worker started · tunnel live · callback receiver up.

---

## Phase 1 — build features via the API (shape-spec → orchestrate)

Two features: `format-bytes` and `parse-duration`. Same flow each.

### 1a. Shape the spec (SSE; creates the session + planning artifacts)
```bash
curl -sN -X POST $API/api/v1/shape-spec/stream \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"company":"acme","project":"format-bytes","session_mode":"new",
       "message":"Shape a tiny feature format-bytes: format_bytes(n, precision=1) -> human-readable binary-unit string ... <full spec, do not ask questions>"}'
# SSE events: {"type":"session","session_id":"<UUID>"} ... {"type":"questions",...} {"type":"folder","folder":"<spec>"}
```
The shape-spec skill always runs a clarification round, so it emits `questions`.
Answer them with a second call (`session_mode":"resume"`) to finalize:
```bash
curl -sN -X POST $API/api/v1/shape-spec/stream \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"company":"acme","project":"format-bytes","session_mode":"resume",
       "message":"<answers to each question>; finalize the spec, no more questions"}'
# → {"type":"folder","folder":"<YYYY-MM-DD-format-bytes>"}
```
Captured:
| feature | session_id | spec folder |
|---|---|---|
| format-bytes  | 41c3894d-ce84-440a-a077-fa1ce4fb7843 | 2026-06-12-format-bytes |
| parse-duration | 2828e273-598a-4624-bf1f-3888ff3336ca | 2026-06-12-parse-duration |

### 1b. Orchestrate (synchronous: write-spec → create-tasks → implement-tasks → git-prep)
```bash
curl -s -X POST $API/api/v1/orchestrations \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"company":"acme","project":"format-bytes",
       "spec_intents":[{"spec_name":"2026-06-12-format-bytes","session_id":"<SESSION_ID>"}],
       "options":{}}'
# → {"success":true,"results":[{step:1 /write-spec success}, ... {step:3 /implement-tasks success}, ...],
#    "total_execution_time_seconds": ~397}
```
Result: both features all 4 steps `success` (fb 397s, pd 377s). The
implement step wrote real `src/<pkg>/<feature>.py` + `tests/test_*.py`.
**Local test: format-bytes 12/12 pass, parse-duration 9/9 pass** — run with
`PYTHONPATH=.` (the generated tests import `from src.<pkg>...`).

---

## Phase 2 — publish to private GitHub repos with Actions CI (operator git, not REST)

Each generated project: add `.github/workflows/verify.yml` (pip install pytest;
`compileall src` + `PYTHONPATH=. pytest`), `git init`, create a PRIVATE repo,
push. Push triggers a real Actions run.

```bash
gh repo create OzzieBelazi/sx-itest-format-bytes  --private --source=. --remote=origin
gh repo create OzzieBelazi/sx-itest-parse-duration --private --source=. --remote=origin
git push origin main
```
Result: both repos' real GitHub Actions runs = **success**.
| repo | head SHA | CI |
|---|---|---|
| sx-itest-format-bytes  | 75e4d9a1… | success |
| sx-itest-parse-duration | 8b69b2d2… | success |

---

## Phase 3 — full verification (6 cells, polyrepo D5 AND gate, hands-free)

Task group g1 spans both repos × 3 verifiers = 6 cells.

### 3a. Webhook + SHA→cell binding per repo (operator: gh + recorder)
```bash
gh api -X POST repos/OzzieBelazi/<repo>/hooks -f name=web -F active=true \
  -f "events[]=workflow_run" -f config[url]="$TUNNEL/api/v2/inbound/github/<INGRESS>" \
  -f config[content_type]=json -f config[secret]="<WEBHOOK_SECRET>"
# record the SHA→cell binding (D10.4), then empty-commit re-push so the webhook delivers live
python -m src.verification.store ... record_binding(<sha>, github, orch-camp, g1, <repo>, ci-trigger)
```

### 3b. The three verifier cells per repo
- **inline**: ran `compileall + pytest` locally → recorded via the guarded recorder.
  fb 12/12, pd 9/9 → both `pass`.
- **rubric**: a rubric-verifier AGENT scored each repo against rubrics/g1.md (5 signals)
  → both `pass` (recorded via the guarded recorder CLI).
- **ci-trigger**: real GitHub Actions → HMAC `workflow_run` webhook → inbound-gateway →
  correlate by binding → verdict `pending → pass`. Arrives at:
```
POST $TUNNEL/api/v2/inbound/github/<INGRESS>   (GitHub posts this; HMAC-signed)
```

### 3c. The gate — HANDS-FREE
Each CI webhook auto-enqueues a fresh `verify-task-group` job (D10.2); the **worker**
launches a verification-loop SESSION that reconstructs all cells, evaluates the
**D5 AND gate**, and advances — no operator dispatch.

**Result — all 6 cells pass (+ observe skipped); gate folded `pass` and the group
advanced, hands-free.**
```
gate_evaluated: {"gate":"pass", fb/inline pass, fb/ci-trigger pass, fb/rubric pass,
                 pd/inline pass, pd/ci-trigger pass, pd/rubric pass, observe skipped}
task_group_state(orch-camp,g1) = advanced
```
Read status via the API (bearer-auth):
```bash
curl -s $API/api/v2/verification/orch-camp/events -H "Authorization: Bearer <API_KEY>"
```

### Findings from the real run (genuine, tracked — not blockers)
1. **The loop session wrote the gate state directly** (`state:"terminal:pass"`, plus
   richer `gate_evaluated`/`hooks_resolved` events) instead of routing the advance
   through the guarded `recorder.advance` tool (which writes `state:"advanced"` and
   enforces the red-gate refusal). The outcome was correct (gate genuinely green),
   but the D10.1 guard is only enforced when the agent USES the tool — an agent with
   Bash can bypass it. Tighten: the loop must advance via the guarded tool, or the
   table must be writable only by it.
2. **No single-flight on re-invoke (D10.6).** Each webhook delivery
   (requested/in_progress/completed × 2 repos ≈ 6) enqueued a SEPARATE
   verify-task-group session; the worker ran them serially. One advanced the gate; the
   rest were redundant full Claude sessions. Coalesce per (orchestrate,group).

---

## Phase 4 — bug round-trip on a real repo (POST /bugs → worker → haikai → signed callback)

Introduced a REAL defect into the format-bytes feature (divisor 1024 → 1000;
5 tests went red), committed it, then submitted via the API:

```bash
curl -s -X POST $API/api/v2/bugs/ \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"bugDescription":"format_bytes divides by 1000 instead of 1024 ... see failing tests",
       "bugType":"reconciliation","callbackUrl":"http://127.0.0.1:8792/cb",
       "company":"acme","project":"format-bytes"}'
# → 202 {"bugId":"bug-3282208e5af3","jobId":"investigate-bug-3282208e5af3","status":"accepted"}
```

The worker claimed the job and launched `/haikai:debug` + `/haikai:fix` (test-gated)
against the repo. Result:
- bug FIXED: divisor restored to 1024; **tests 5-failed → 12/12 pass**.
- job `completed`, `status:success`, `haikaiVerdict:FIXED`,
  `changedFiles:["src/bytesfmt/format_bytes.py"]`.
- **SIGNED callback** POSTed to callbackUrl: `X-SX-Signature: sha256=ba1a1fdb…`,
  body `{bugId, status:"success", haikaiVerdict:"FIXED", changedFiles}`.

Poll the bug status via the API (bearer-auth):
```bash
curl -s $API/api/v2/bugs/bug-3282208e5af3 -H "Authorization: Bearer <API_KEY>"
```

### Finding from the real run (the single-process worker, live)
The bug initially sat QUEUED behind a stale 1800s verify session — the
single-process worker is head-of-line-blocking (predict C12). Restarting the
worker (or, in prod, a concurrency cap + bounded session timeout) cleared it.

---

## Phase 5 — finalize + teardown

### Endpoint summary (every consumer call uses `Authorization: Bearer <API_KEY>`)
| # | Method + path | Purpose |
|---|---|---|
| 1 | `GET  /health` | liveness |
| 2 | `POST /api/v1/shape-spec/stream` | shape a feature (SSE; new + resume) |
| 3 | `POST /api/v1/orchestrations` | write-spec → create-tasks → implement-tasks |
| 4 | `POST /api/v2/inbound/github/<INGRESS>` | CI webhook sink (GitHub posts; HMAC) — gateway |
| 5 | `GET  /api/v2/verification/<orch>/events` | verification event stream / status |
| 6 | `POST /api/v2/bugs/` | submit a bug for investigation+fix |
| 7 | `GET  /api/v2/bugs/<bug_id>` | poll bug status/result |
| 8 | `POST /api/v2/reconciliation` | findings intake (bearer; alt to /bugs) |
| 9 | `GET  /api/v2/reconciliation/<orch>/findings` | retrieve findings |

### Teardown done
Webhooks deleted (both repos); API + worker + tunnel + callback receiver stopped;
temp creds destroyed. The two PRIVATE repos remain (deletable):
`OzzieBelazi/sx-itest-format-bytes`, `OzzieBelazi/sx-itest-parse-duration`.

### Campaign result
5/5 phases. The system **built 2 features via its own API**, **published them to
real private repos with real CI**, **verified them across 6 cells with the
polyrepo D5 AND gate advanced HANDS-FREE**, and **fixed a real injected bug via
haikai with a signed success callback** — all on real infrastructure.

### Tracked findings (real, non-blocking — for a follow-up pass)
1. The verification-loop session advances the gate by writing `task_group_state`
   directly (richer events; `state:"terminal:pass"`) instead of through the
   guarded `recorder.advance` — so the red-gate guard is bypassable by an agent
   with Bash. Make the guarded tool the only writer.
2. No single-flight on webhook re-invoke (D10.6): N CI deliveries → N
   verify-task-group sessions, serialized. Coalesce per (orchestrate,group).
3. Single-process worker head-of-line blocks: a long verify session delayed the
   bug job. Needs a concurrency cap + a bounded, caller-surfaced session timeout.
