# Specification: Async Verification & Self-Repair Orchestration

> **STATUS: MECHANISM IMPLEMENTED (2026-06-10).** The irreducible-I/O layer
> is built and tested end-to-end against real repos
> (`tests/test_verification_store.py`, `test_inbound_gateway.py`,
> `test_verification_e2e.py` — 32 tests):
>
> | Spec piece | Implementation |
> |---|---|
> | D2 schema (verdicts, ci_bindings, deliveries, task_group_state, repairs, dispatched, events, checklist) | `src/verification/store.py` |
> | 5 guarded recorder tools (D10.1) + refusal guards + `count==0` write-path guard | `src/verification/recorder.py` (+ CLI per tool) |
> | inbound-gateway receipt contract (D9.1/D10.4): auth → dedup → correlate → map → record → re-invoke → 202 | `src/api/routes/inbound.py` at `/api/v2/inbound/{provider}/{ingress_token}` |
> | TTL sweeper (D10.5, timeout terminal) | `src/verification/sweeper.py` |
> | SSE/JSON projection (D6) | `/api/v2/verification/{orch}/events` |
> | D5 gate fold | `advance()`'s guard (expected cells ∈ pass\|skipped) |
> | inline verifier + CI connectors (D3, YAML-driven) | `src/verification/inline_runner.py`, `connectors/` |
> | verify-task-group runtime wiring | `JobType.VERIFY_TASK_GROUP` + worker dispatch + `~/.claude` installs (command + 4 agents) |
>
> Still agent-judgement by design (prompts, not code): the verification-loop's
> branching, rubric scoring, repair classification. The queue's
> `run_verify_task_group` dispatch to a CLI executor session is a Phase 2+
> stub like its seven siblings — today the gateway enqueues the job and the
> loop runs as a Claude session via `/verify-task-group`.

## Summary

Replace the current weak `verify-tasks` step (structural checkbox + impl
report existence only) with a real, agent-driven verification model
around `/orchestrate`. Verification becomes an **AND gate** of
deterministic runners (local tools + remote CI via connectors) and
non-deterministic rubric scoring, driven by an **`verification-loop`**
agent that evaluates the gate and feeds a **self-repair** loop which can
spawn capped fix-tasks when verdicts fail. Async verdicts from external
CI land via a runtime **inbound-gateway** (a stable webhook URL) that correlates
and delivers them to the loop — the only deterministic piece; it routes,
the loop decides.

The endpoint becomes async: `/orchestrate` returns a `job_id` and the
`verification-loop` advances the task-group DAG as verdicts arrive at an
event-sourced state store.

## Goals

| #  | Goal |
|----|------|
| G1 | Extend the spec lifecycle with `/create-rubrics` so the non-deterministic verifier scores against a deterministic checklist rather than inventing criteria at verification time. |
| G2 | Define four new subagent roles under `haikai-profiles/default/agents/`: `inline-runner` + `rubric-verifier` (verifiers), `repair-engine` (self-repair), and `verification-loop` (drives the gate + branch + repair dispatch for one task group). `ci-trigger` and `observe` are **not** subagents — they are async verifier *cells* whose verdicts the runtime inbound-gateway correlates and delivers to the loop (D9). Roles declared per subagent — not per-task in `orchestration.yml`. |
| G3 | Define a **connector contract** for remote systems where auth, async, and API surfaces demand a wrapper. CI/CD priorities: `github-actions`, `gitlab-ci`, `jenkins`, `teamcity`. Local CLI tools stay agentic (shell-out + parse, no plugin layer). |
| G4 | `/orchestrate` returns immediately with `{job_id, status: "running"}`. Inline + rubric verifiers run synchronously per task group. CI-trigger dispatches and walks away. Observer is standalone and long-lived. |
| G5 | An **AND gate** on each task group: `inline ∧ ci-trigger ∧ rubric ∧ observe` must all reach `terminal:pass` before the `verification-loop` advances dependent task groups. |
| G6 | A **self-repair** loop: failed verdicts route to `repair-engine`, which classifies (flaky / real / infra / out-of-scope) and either retries, spawns a scoped fix-task, or escalates. Attempts are capped to prevent infinite recursion. |
| G7 | Late-arriving observe failures compensate downstream: pause dependent groups, generate compensating fix-tasks where the regression already propagated. |

## Non-goals

- **Not** building a plugin abstraction for local CLI tools (`ruff`,
  `mypy`, `pytest`, `eslint`, `mvn`, etc.). Agents shell out and parse
  directly — that's their job. Plugin layer was overengineered.
- **Not** enumerating runner choice in `orchestration.yml`. YAML stays
  light (graph + standards + deps); agents *decide* what verification
  fits given standards + diff + capability discovery.
- **Not** introducing a new `verifiers:` field. Verifiers are subagents
  alongside `backend-specialist` etc.; their role is declared in their
  own definition file.
- **Not** modifying the existing `/shape-spec`, `/create-tasks`, or
  `/orchestrate` external contracts beyond adding `/create-rubrics`
  and switching `/orchestrate` to async.
- **Not** building circleci, azure-pipelines, or bitbucket-pipelines
  connectors in this spec. Listed as future extensions only.

## Architecture

> **Interactive diagram:** an interactive React Flow visualization of this
> architecture lives alongside the spec at
> [`flow-diagram.html`](./flow-diagram.html). Open the file in a browser
> (it's a single self-contained HTML, ~24 KB, pulls React + React Flow
> from `esm.sh`). It exposes five scenarios — *Overview*, *Happy path*,
> *Fail + repair*, *Observer drift*, *CI sub-path* — with a play/step/
> rewind/speed-controlled walk-through. Each step highlights the active
> node and edge so the AND-gate fan-out, repair loop, and late
> observer-drift re-entry are visible end-to-end. Source colours map to
> the four surfaces in this spec: `[A]` git hooks (orange), `[B]`
> orchestration hooks (purple), `[X]` operator CLI (blue), `[Y]` agent
> slash commands (green); runtime nodes are grey; the agentic
> `verification-loop` (gate + branch + repair dispatch) is amber.
>
> Mirror (hashed by content; old versions stay reachable so prior links
> never rot — pushed to `main` of the throwaway preview repo, served via
> GitHub Pages for direct phone/browser viewing):
> https://ozziebelazi.github.io/sx-flow-preview/flow-77de519bd2f5634213f88ff2.html
>
> **Hooks surface (`[B]`):** the nine orchestration events, payload
> schemas, blocking/advisory mode, timeouts, scoped auth tokens, and
> shipped default hooks are specified in the sibling document
> [`hooks-design.md`](./hooks-design.md). Spec.md owns the *shape* of
> orchestration; hooks-design.md owns the *contract* subscribers
> implement against.
>
> **Concrete walk-through:** a petclinic-specific lifecycle diagram
> (the real `preferred_vet` feature, end to end — discovery, git gate,
> shape→tasks→rubrics→orchestrate, the 4 verifier cells, AND gate,
> verification report) lives at [`petclinic-lifecycle.html`](./petclinic-lifecycle.html), mirrored at
> https://ozziebelazi.github.io/sx-flow-preview/petclinic-718da2a2add09d2fd7318de1.html

```
SPEC LIFECYCLE
──────────────
/shape-spec         spec.md, requirements.md
       │
       ▼
/create-tasks       tasks.md  (parent tasks → task groups)
       │
       ▼
/create-rubrics     rubrics/[task-group].md
       │
       ▼
/orchestrate-tasks  orchestration.yml  (DAG)
       │
       ▼
   orchestrate (async, returns job_id)

TASK GROUP DAG (orchestration.yml)
──────────────────────────────────
   comment-model ──► comment-api ──► moderation

INSIDE ONE TASK GROUP (e.g. comment-api with touched_repos=[backend, frontend])
─────────────────────────────────────────────────────────────────────────────
                  coordination.lock.yaml
                  (D5: pins per-repo input SHAs)
                       │
       ┌───────────────┴────────────────┐
       ▼                                ▼
  implementer[backend]            implementer[frontend]
  (backend-specialist)            (frontend-specialist)
       │                                │
       ▼ produces commit SHA            ▼ produces commit SHA
   commit[backend]                  commit[frontend]
   trailers (D1):                   trailers (D1):
   orchestrate-id, group-id,        orchestrate-id, group-id,
   repo=backend                     repo=frontend
       │                                │
       └────────────────┬───────────────┘
                        ▼ post-implement [B]
                        ▼ pre-verify     [B]
   ┌─────────────────┬──┴──┬─────────────────┬──────────────────┐
   ▼                 ▼     ▼                 ▼                  ▼
inline-runner   ci-trigger    rubric-verifier        observe-runner
× (repo, group) × (repo, group)  × (repo, group)        × (repo, group)
   │                 │                 │                       │
   │                 ▼                 ▼                       │
   │             connectors         scores diff                │
   │   {REPO_KEY}_{CONN}_TOKEN     vs rubric.md                │
   │   BACKEND_GITHUB_TOKEN                                    │
   │   FRONTEND_GITLAB_TOKEN                                   │
   │   (D3 keying)                                             │
   │                 │                                         │
   │                 ▼                                         │
   │            external CI ──webhook/poll────────────────────►│
   │           (per repo, per provider)                        │
   │                                                           │
   ▼                                                           ▼
       verdict events per (repo, verifier) cell
       ──────────────────────────────────────►
            state store (D2): jobs.db          ◄── runtime inbound-gateway writes async
            verdicts(orch_id, group_id, repo, verifier)    (ci/observe) verdicts
                        │                                  here, then delivers
                        ▼                                  them to the loop
       ┌─────────────── verification-loop agent (agentic) ───────────────┐
       │  AND gate (D5): ∀ repo ∈ touched_repos ·                        │
       │                 ∀ verifier ∈ {inline, ci-trigger, rubric, observe} · │
       │                 verdict.status = pass                           │
       │                        │                                        │
       │                        ▼  any (repo, verifier) cell red →        │
       │                        │  invoke repair-engine (D4 classify,     │
       │                        │  fix-task scoped (group, repo))         │
       │                        ▼                                        │
       │                  all cells green → advance DAG → next task group │
       └─────────────────────────────────────────────────────────────────┘
            ▲ async (ci/observe) verdict delivered as a message
            │ (resumes the loop) — see inbound-gateway above
```

## Components

### Spec lifecycle additions

- **`/create-rubrics`** — new command. Reads `spec.md` + `requirements.md`
  + task group, emits `rubrics/[task-group].md` with a structured
  checklist of pass/fail rows. Lives next to the spec so it's auditable
  and reusable when fix-tasks regenerate.

### Subagents (`haikai-profiles/default/agents/`)

All roles below operate per `(task_group, repo)` cell. The implementer
roles fan out at task-group dispatch — one per `touched_repos[repo]` —
and each verifier role produces one verdict per cell.

| Subagent | Kind | Scope | Role |
|----------|------|-------|------|
| `backend-specialist`, `frontend-specialist`, ... | implementer | per (group, repo) | Existing — N implementers fan out in parallel; each produces a commit SHA + impl report for its repo |
| `inline-runner` | verifier (det) | per (group, repo) | Shell out to local tools against the repo's diff; parse structured output; return verdict for this `(group, repo)` cell to the loop |
| `rubric-verifier` | verifier (non-det) | per (group, repo) | Score per-repo diff against `rubrics/[task-group].md` row-by-row; structured output, no free-form invention |
| `repair-engine` | meta | per failure | (D4) LLM-classify each failed verdict with `{repo, connector_kind}` in the prompt; retry / spawn fix-task scoped to `(group, repo)` / escalate; capped attempts per cell |
| `verification-loop` | driver | per task group | Collects every cell verdict, evaluates the **D5 AND gate**, branches (advance DAG on pass, dispatch `repair-engine` on fail), and resumes when the inbound-gateway delivers an async (`ci`/`observe`) verdict. The gate decision and repair dispatch live here, not in the runtime |

`ci-trigger` and `observe` are **not** subagents — they are async
verifier *cells*. The implementer triggers CI at commit time (D9); the
runtime **inbound-gateway** later correlates the CI verdict and delivers it to
the `verification-loop` as a message (see §"CI ingest").

Verifier roles are declared in each subagent's own definition — *not*
in `orchestration.yml`. Within a task group: per-repo implementers fan
out in parallel (one per `touched_repos`); after the last per-repo
commit lands, the `verification-loop` dispatches the synchronous
verifier cells (`inline`, `rubric`) across all repos in parallel and
gates on every cell (sync + async) per D5.

### Connectors (`haikai-profiles/default/connectors/`)

One definition per remote system. Same shape — capabilities flag
trigger/observe sides.

**CI/CD (priority set):**
- `github-actions`
- `gitlab-ci`
- `jenkins`
- `teamcity`

**Future / opt-in:** `circleci`, `azure-pipelines`, `bitbucket-pipelines`.

**Quality/security (later phase):** `sonarqube`, `codeql`, `snyk-cloud`,
`dependency-track`.

**A connector is a thin CLI adapter, not a REST client (D9).** The
implementer subagents are Claude Code / Kiro with a Bash tool — they
already run `git`, `gh`, `glab`, `mvn`, `npm`. So the connector does
**not** wrap a provider REST API. It is a small declarative adapter:
*(how to trigger, how to read status, how to map result → verdict)*,
where trigger/status are shell commands (`gh`/`glab`/`git`), not API
calls. `gh.exe`/`glab.exe` are real binaries — Windows-safe, unlike the
`.sh` hooks problem.

Two responsibilities, split by who can do them:

| Step | Who | Mechanism |
|---|---|---|
| **trigger** the pipeline | the **implementer agent** (D9) — it commits, then `git push` (pipeline-on-push) or `gh workflow run` | one-shot shell, agent-side |
| **ingest** the verdict (lands mins–hours later) | the **runtime inbound-gateway** — correlates by D1 trailer, records the cell verdict durably, and **starts a fresh `verification-loop` run** (D10.2). It decides nothing — the loop gates and branches | webhook receiver, or a runtime poller that *also* shells `gh run view --json` / `glab ci status` |

```yaml
# haikai-profiles/default/connectors/github-actions.yml — thin CLI adapter
name: github-actions
type: ci
detect: [".github/workflows/*.yml present"]
auth:
  via: env_var
  token_template: "{REPO_KEY}_GITHUB_TOKEN"      # D3; gh reads GH_TOKEN
trigger:                                          # run by the implementer agent
  cmd: "gh workflow run {workflow} --ref {ref}"   # or: push triggers on push
ingest:                                           # run by the runtime
  prefer: webhook                                 # else poll:
  poll_cmd: "gh run list --commit {sha} --json status,conclusion"
  correlation: { key: trailers, fields: [orchestrate-id, task-group-id, repo] }
verdict_mapping: { success: pass, failure: fail, timed_out: timeout }
```

The adapter owns only the per-provider *strings* (which command, which
status field, the verdict map) + retry/rate-limit policy for the poller.
Selection is **per repo** via product standards (a polyrepo product may
use github-actions for `backend`, gitlab-ci for `frontend`); the runtime
checks `detect:` in the repo checkout and resolves the `(repo,
connector)` token from D3. Rejected: a Python REST client per provider
(more code, needs raw API tokens in-process, and duplicates what the
agent's `gh`/`glab` already do).

#### Inbound-gateway — the external-event ingress (D9.1)

The inbound-gateway is the **single inbound endpoint** for external
events: it authenticates an event, classifies its kind, and **routes
accordingly**. CI verdicts are the first kind (GitLab **Pipeline Hook** /
**Job Hook**, GitHub `workflow_run` / `check_run`); `observe` signals and
future integrations land here too and route to their consumers — so the
gateway is provider- and event-type-agnostic, not a CI-only hook. It
lives **in standards-extractor itself** — it already hosts the v2 API, so
it's one more FastAPI route:

```
POST /api/v2/inbound/{provider}/{ingress_token}   # src/api/routes/webhooks.py
```

The `{ingress_token}` is an opaque per-`(repo, connector)` token in the path
that selects the signing secret **before** the body is trusted (D10.4).

**What lands here** — all resolve to a verdict for one cell:
- **CI runs → `ci-trigger`**: GitHub Actions (`workflow_run`/`check_run`), GitLab (Pipeline/Job Hook), Jenkins, TeamCity.
- **quality/security → `observe`**: SonarQube, Snyk, CodeQL, Dependency-Track (scan/gate complete).
- **poll fallback**: `gh run view` / `glab ci status` on a timer (no public URL) — same shape.
- **TTL sweeper (internal, D10.5)**: a synthetic `timeout` for a pending cell.
- **reserved — non-verdict kinds** (approvals, deploys, future integrations): route to their own consumer, **not** the loop.

Every inbound must yield: **head SHA** (→ cell), **kind**, **status**, **delivery id**.

It is the **inbound-gateway** — deterministic plumbing, not an agent and not a
hook. It does four mechanical things and then hands off; it makes **no
decision**:

1. **Verify** the provider signature (GitLab `X-Gitlab-Token`, GitHub
   HMAC `X-Hub-Signature-256`) and **dedup** redelivers.
2. **Correlate**: resolve the `(orchestration_id, task_group_id, repo,
   verifier)` cell from the payload's `commit.id`/`head_sha` against the
   **authenticated SHA→cell binding** recorded at trigger time (D10.4);
   reject a SHA with no binding. The D1 trailers are a redundant
   cross-check, never the authority.
3. **Map** the provider status via the connector's `verdict_mapping`
   and **record** the verdict durably in `jobs.db` (D2) so it survives
   even if no agent is up at that instant.
4. **Hand off** the verdict by starting a **fresh** `verification-loop`
   run for that `orchestration_id` (D10.2 — never a resumed session; it
   reconstructs from the db). From here a webhook verdict is indistinguishable from
   an inline one: the **loop** re-evaluates the D5 gate, the SSE frame
   streams, and on `fail` the **loop** dispatches the `repair-engine`
   (classify → fix-task). On `pass` the loop just advances the DAG. The
   gate decision and the repair dispatch are the loop's, not the
   inbound-gateway's.

So "GitLab event → trigger an agent" is precise — and literal: the
inbound-gateway normalizes the push into a verdict, records it, and routes it
to the loop, which owns every judgment. The one thing the loop can't do
is own a stable URL that stays reachable regardless of which agent is
running — that's why the inbound-gateway exists. **Poll fallback** (`gh run
view --json` on a runtime timer) is only for environments with no
publicly-reachable webhook URL (local dev). The webhook URL + secret are
registered per repo at `/projects/init` (or first orchestration) using
the D3 token.

**End-to-end after a GitLab CI event fires:**

1. GitLab POSTs the Pipeline Hook (or Job Hook) to
   `POST /api/v2/inbound/gitlab`.
2. Receiver verifies `X-Gitlab-Token`; rejects on mismatch.
3. Dedups against GitLab redelivers (process the result once).
4. Reads `commit.id` (SHA) from the payload.
5. `git log --format=%B <sha>` → greps the D1 trailers.
6. Trailers resolve the exact `(orchestration_id, task_group_id, repo,
   verifier)` cell.
7. Maps `object_attributes.status` → verdict via the connector's
   `verdict_mapping`.
8. Records the verdict in `verdicts` (D2) — durable, so it survives if
   no agent is up at this instant.
9. **Delivers** the verdict to the `verification-loop` agent for this
   `orchestration_id` (a message into the live loop; resumes it if
   parked). The SSE frame (`verdict-landed`, `cells_done/cells_total`)
   streams. Steps 1–9 are the inbound-gateway; everything below is the loop.
10. The loop re-evaluates the **D5 AND gate**: all `(repo × verifier)`
    cells `pass`/`skipped`, none `pending`?
11. **All pass** → the loop advances the DAG → `task-group-done`.
12. **This cell failed** → the loop dispatches the `repair-engine`.
13. repair-engine (LLM, D4) classifies `flaky` / `real` / `infra` /
    `out-of-scope` from `{failure_log, diff, repo, connector_kind,
    attempt_count}` and returns to the loop.
14. The loop acts: `flaky` → re-run same commit; `real` → fix-task
    scoped `(group, repo)` re-runs that repo's implementer; `infra` →
    back off a watermark; `out-of-scope` → escalate.
15. If the cell had already passed and the group moved on, the loop
    treats this as `observer-drift` — reopen just that cell, pause
    dependent downstream groups, dispatch a compensating fix-task.
16. Attempts are capped per cell (counter in the store) — on exhaustion
    the loop circuit-breaks the cell and escalates to a human; no false
    `terminal:pass`.

Nothing here is webhook-special past step 9 — once the verdict reaches
the loop, a CI verdict takes the identical path as an inline one. The
only difference is *who handed it to the loop*: an inline-runner returns
directly; a CI verdict comes via the inbound-gateway.

### `orchestration.yml` shape (extended, polyrepo-aware)

```yaml
task_groups:
  - name: comment-model
    touched_repos: [backend]                # D5; derived from tasks.md [@repo:X]
    claude_code_subagents:
      - backend-specialist                  # implementer for backend
      - inline-runner
      - ci-trigger-runner
      - observe-runner
      - rubric-verifier
    depends_on: []

  - name: comment-api
    touched_repos: [backend, frontend]      # cross-repo group
    claude_code_subagents:
      - backend-specialist                  # implementer[backend]
      - frontend-specialist                 # implementer[frontend]
      - inline-runner
      - ci-trigger-runner
      - observe-runner
      - rubric-verifier
    depends_on: [comment-model]

  - name: moderation
    touched_repos: [backend]
    claude_code_subagents: [backend-specialist, inline-runner, ci-trigger-runner, observe-runner, rubric-verifier]
    depends_on: [comment-api]
```

- Task group names come from slugified parent task headings in `tasks.md`
- `touched_repos` is derived from `[@repo:X]` annotations in each task
  group's heading at `/create-tasks` time; frozen into the group's
  state row at orchestrate-start
- Implementer subagents are matched 1:1 with `touched_repos` — N
  implementers fan out in parallel, one per repo
- Verifier roles inferred from each subagent's own definition; each
  runs once per `(group, repo)` cell, in parallel
- `depends_on` defines the inter-group DAG (topological scheduling)
- Within a group: per-repo implementers (parallel) → per-`(repo,
  verifier)` cells (parallel) → cross-repo AND gate (D5)

#### Per-repo verification config — D7

Verification can be enabled/disabled **per repo** in a polyrepo product.
A repo with `verify: false` is still implemented (its commits land) but
its `(repo, verifier)` cells are not created — those cells are recorded
as `skipped` in the verdicts table, and the D5 AND gate ignores them
(`∀ repo ∈ touched_repos WHERE verify ENABLED · ∀ verifier · pass`).

Declared in the product's repo config (the same place polyrepo already
declares per-repo git routing — `coordination.yaml` / per-repo `gm`
config):

```yaml
repos:
  backend:
    verify: true                 # default
  frontend:
    verify: true
  proto-stubs:
    verify: false                # auto-generated; nothing meaningful to verify
    verify_skip_reason: "generated protobuf client — no hand-written code to score"
```

Use cases (all human-operator decisions, set in config — never an LLM
or runtime decision):

- **Vendored / generated repo** in the product (protobuf stubs,
  OpenAPI client) — no hand-written code, no meaningful rubric.
- **CI provider outage** — temporarily disable `ci-trigger` for the
  affected repo to unblock; re-enable when the provider recovers. (Knob
  is per verifier too: `verify: {inline: true, ci-trigger: false}`.)
- **Hotfix bypass** — accept the risk on a slow `observe` verifier for
  an urgent run.

Every `skipped` cell is recorded with its reason and surfaces in the
SSE stream (`{"type":"skipped", "repo":"proto-stubs", "verifier":"*",
"reason":"..."}`) and the final `task-group-done` summary — so a skipped
verification is **visible**, never silent. This replaces the earlier
`skip-group` hook directive idea: configuration, not a runtime escape
hatch.

### Async execution model

`/orchestrate` returns immediately with:

```json
{
  "job_id": "<uuid>",
  "status": "running",
  "touched_repos_by_group": {
    "comment-model": ["backend"],
    "comment-api":   ["backend", "frontend"],
    "moderation":    ["backend"]
  }
}
```

The `touched_repos_by_group` field lets callers anticipate the AND-gate
cardinality per task group (D5). Computed from `[@repo:X]` annotations
in `tasks.md` at orchestrate-time.

- Inline + rubric verifiers run **synchronously per `(task_group, repo)`
  cell**, dispatched by the `verification-loop` (agentic shell-out /
  LLM); cells for different repos run in parallel
- CI is **triggered by the implementer agent** (D9) — `git push` or
  `gh workflow run` right after the commit lands; no separate dispatch
  step waits on it
- The **inbound-gateway** is the only deterministic-runtime piece that outlives
  an agent call: a stable webhook URL that receives per-repo CI events
  (or a poller shelling `gh`/`glab`), correlates via D1 trailers,
  records the per-cell verdict durably, and **starts a fresh
  `verification-loop` run** (D10.2). It decides nothing
- The `verification-loop` evaluates D5's AND gate and **advances the
  DAG** for the parent group when `∀ repo ∈ touched_repos · ∀ verifier ·
  pass` — on a synchronous verdict it just returned, or on an async one
  the inbound-gateway delivered

**Per-cell state machine** (one instance per `(task_group, repo)`):

```
pending → implementing → committed → verifier_dispatched → terminal{pass|fail|timeout}
```

**Group-level state machine** (one instance per `task_group`):

```
pending → implementing[*]    (all per-repo cells implementing in parallel)
       → committed[*]        (all per-repo commits landed)
       → verifying[*][*]     (∀ repo × ∀ verifier cells running)
       → gate{pass|fail}     (D5 AND across all cells)
```

`[*]` denotes "for every repo in `touched_repos`."

**Event-sourced state store (D2):** verdicts are appended, never
mutated in place. Both writers — a verifier's return value (recorded by
the loop) and an async CI verdict (recorded by the inbound-gateway) — append to
`orchestration_events`:

```
ToolVerdictRecorded {
  orchestration_id, task_group_id, repo, verifier, commit_sha, result
}
```

The `verification-loop` is a consumer that projects events into the
per-cell and group state machines to evaluate the gate. The append-only
log buys replay, audit, decoupling — and lets the loop resume from
recorded state after a pause.

**Correlation key (D1):** three commit-message trailers —
`orchestrate-id`, `task-group-id`, `repo`. The inbound-gateway parses the commit
SHA from each CI webhook and `git log --format=%B <sha>` greps the
trailers. The triple is the state-cell key and the address the inbound-gateway
delivers to.

**TTL per async cell:** watermark deadline. On expiry the inbound-gateway marks
the affected `(repo, verifier)` cell verdict `timeout` and delivers that
to the loop, which circuit-breaks the cell.

### Progress stream (SSE) — D6

`/orchestrate` returns a `job_id` immediately (async), but callers need
a **live view of everything happening**, not just gate decisions. This
is the same SSE pattern the existing `/shape-spec/stream` and
`/plan-product/stream` endpoints already use (`content`,
`skill_invoked`, `file_modified`, `questions` frames).

A companion endpoint streams progress:

```
GET /api/v2/orchestrations/{job_id}/stream     (text/event-stream)
```

**Built-in, always on, core — not a hook.** The progress stream is a
projection of the event-sourced state store (D2): every appended event
emits one SSE frame. Hooks (the `[B]` surface) remain a *separate*
extension mechanism for Slack/dashboards/custom-repair; the SSE stream
is the default live view and does not depend on any hook being
installed.

**Frame emitted on every state transition** — not only at gates:

```jsonc
// implementer started for a repo
{ "type":"implementing", "group":"comment-api", "repo":"backend" }

// a commit landed
{ "type":"committed", "group":"comment-api", "repo":"frontend", "sha":"def456" }

// each verifier verdict as it lands (the granular progress signal)
{ "type":"verdict", "group":"comment-api", "repo":"backend",
  "verifier":"inline", "status":"pass",
  "cells_done":3, "cells_total":8 }

// gate decision (terminal)
{ "type":"gate", "group":"comment-api", "result":"pass" }

// repair lifecycle
{ "type":"repair", "group":"comment-api", "repo":"backend",
  "verifier":"rubric", "attempt":2, "classification":"real" }

// late observer flip
{ "type":"drift", "group":"comment-api", "repo":"frontend",
  "verifier":"observe", "from":"pass", "to":"fail" }
```

The `cells_done` / `cells_total` counters on `verdict` frames are the
load-bearing UI signal: a polyrepo group of 2 repos × 4 verifiers
shows "3 of 8" and the UI can render per-repo lanes filling
independently. `cells_total = |touched_repos| × |verifiers|`.

**Relationship to the `gate-evaluated` hook:** the SSE `gate` frame and
the `gate-evaluated` hook both fire at the terminal gate decision, but
they're different surfaces — the frame is for the live view (always),
the hook is for policy/routing extension (only if installed). Partial
verdicts stream as `verdict` frames continuously; the gate frame is the
single terminal summary.

**Resumable:** because the stream is a projection of the event store,
a client that disconnects can reconnect with `?from_seq=<n>` and replay
missed frames. No event is lost to a dropped connection.

### Standards layering (context for every agent)

- `standards/global/*` — org-wide policy (the bar). _"Python must pass
  static type checking."_
- `standards/product/*` — product-specific (this codebase's reality,
  overrides/specializes global). _"We use mypy strict mode, config in
  pyproject.toml."_
- **Discovery** — runtime repo inspection (what's actually wired up).
  Agentic, not declared. See §"Discovery — resolving verifier commands
  from repo data" (D8).

Resolution chain: **global (what bar) → product (what shape) → discovery
(what's here).**

### Discovery — resolving verifier commands from repo data (D8)

Verifiers need concrete commands (`./mvnw -B test`), not framework
guesses. Discovery is how the runtime turns the *data physically in a
repo* (`pom.xml`, `build.gradle`, `package.json`, `.github/workflows/`,
lint configs) into those commands. It obeys the project's core
architecture rule:

| Layer | Does | Example (Spring PetClinic) |
|---|---|---|
| **Mechanical** (file scan) | pure inventory — what files exist | `pom.xml`, `build.gradle`, `mvnw`, `gradlew`, `.github/workflows/{maven-build,gradle-build,deploy}.yml`, `src/checkstyle/*.xml` |
| **Interpretation** (agentic LLM) | what that *means* for verification | "Maven is the canonical PR gate (maven-build.yml); inline-runner → `./mvnw -B test` + `./mvnw -B checkstyle:check`; ci-trigger → github-actions/maven-build.yml" |

**No framework pattern-matching in the mechanical layer** (CLAUDE.md
rule). The scan never contains `if pom.xml: build=maven`. The LLM
already knows what a pom.xml means; new ecosystems need no code change.

**Why it's agentic, not a lookup table.** PetClinic ships *both* Maven
and Gradle, and three CI workflows — a naive detector has no basis to
choose. Disambiguation reuses the existing
`hypothesis → probe → assess` loop (`src/ast/discovery_loop.py`, the
same engine behind endpoint/interaction discovery):

```
HYPOTHESIS: Java; Maven + Gradle both present; 3 CI workflows; checkstyle config
PROBE:      read pom.xml <build><plugins>; read the workflow YAMLs;
            confirm mvnw wrapper is real; which workflow gates PRs?
ASSESS:     build_tool=maven (maven-build.yml is the PR gate; gradle is
            a secondary matrix); inline commands resolved; confidence=high
```

**Discovery runs at project init, is cached, and re-runs only on change
(D8.1).** Discovery describes the project's *build/CI shape*, which
rarely changes — so it does **not** belong inside each orchestration (or
inside `/shape-spec`). It runs once at `/projects/init` (right after the
repo is cloned), writes a per-repo **discovery cache** keyed by the SHA
it ran against, and is reused verbatim until something relevant changes.

```yaml
# .standards-extractor/discovery-cache.yaml  (per repo; persists across runs)
repos:
  spring-petclinic:
    discovered_at_sha: a1b2c3d
    build_tool: maven
    inline_commands: ["./mvnw -B test", "./mvnw -B checkstyle:check"]
    ci_connector: github-actions
    ci_workflow: maven-build.yml
    confidence: high
```

**Re-validation is git-triggered, and fires before `/shape-spec`
(D8.1a).** The cache is seeded at `/projects/init`, but the repo drifts
between then and when work actually starts — someone pushes, a
dependency bumps, CI gets swapped. So the git-change gate runs at the
**entry of every SDD lifecycle, before `/shape-spec` commences** — not
only at orchestration start. That's the load-bearing checkpoint:
shape-spec is about to describe a *new change*, so the pre-change
baseline must be current, or the spec gets shaped against stale
assumptions about what's wired up. The gate checks whether any
*discovery-relevant* path changed since `discovered_at_sha`:

```bash
git diff --name-only <discovered_at_sha> HEAD -- \
  pom.xml '**/pom.xml' build.gradle settings.gradle '**/build.gradle' \
  package.json '**/package.json' go.mod Cargo.toml pyproject.toml \
  '.github/workflows/**' '.gitlab-ci.yml' Jenkinsfile \
  '**/checkstyle*.xml' .eslintrc* ruff.toml
```

- Empty diff → **reuse the cache** (no LLM call, instant).
- Non-empty → **re-run discovery**, refresh the cache + `discovered_at_sha`.

So a 50-task run that never touches build files pays the discovery cost
**zero** times after init; a PR that bumps the Maven version or swaps CI
providers re-discovers exactly once, automatically — caught at the next
`/shape-spec` entry, before that change is shaped.

**Trigger points (D8.1a), in order of the lifecycle:**

| When | What runs |
|---|---|
| `/projects/init` | First discovery — seeds the cache unconditionally |
| **before `/shape-spec`** | git-change gate — re-discover iff a relevant path drifted since `discovered_at_sha` (this is the primary checkpoint) |
| orchestration start | git-change gate again (belt-and-suspenders — catches drift between shaping and running) |

**Each orchestration pins the (possibly-reused) manifest (D8.1b).** The
manifest in effect at run-start is copied into that run's
`coordination.lock.yaml` (next to the input SHA D5 pins), so the run is
reproducible even if the cache later refreshes mid-flight. Two layers:
the **cache** persists and is git-invalidated; the **lock** is a
per-run snapshot. Every verifier cell + repair retry reads the lock —
this is the fix for the run-6 flip (`./mvnw test` then `./gradlew.bat
test` in one run): the build tool is decided once and frozen.

**Precedence — product wins, drift is surfaced (D8.2).** Discovery only
fills what the upper layers leave open. If `standards/product/*`
declares `build_tool: maven` but discovery finds only `build.gradle`
(pom.xml was deleted in a migration), **the declared value wins** — so
behaviour stays predictable — **but the mismatch is surfaced** as a
warning on the SSE stream (`{"type":"discovery-drift", "repo":"...",
"declared":"maven", "found":"gradle"}`) and in the run summary. A human
notices and fixes the stale standard. Conflict is never
authoritative-in-the-dark, and never a buried verification failure three
layers deep. Drift is *detected when discovery runs* (project init, or a
git-triggered re-discovery — D8.1a), not at verify-fail time.

This also drives the connector `detect:` clause (§Connectors):
discovery evaluates `detect:` against the mechanical inventory to pick
`github-actions` over `gitlab-ci`, then resolves *which* of PetClinic's
three workflows is canonical.

### Self-repair loop

Each failed verdict is a `(task_group, repo, verifier)` cell. Repair
operates per cell — other cells in the same group are unaffected.

1. Cell verdict lands `fail` → the `verification-loop` dispatches the
   `repair-engine`, which reads the failing cell, failure detail (CI log
   / rubric rows / test output), the **per-repo diff** for that cell,
   and the task-group spec
2. (D4) LLM classify with prompt input shape
   `{failure_log, diff_summary, task_group_spec, repo, connector_kind,
   attempt_count}`: returns one of `flaky` (retry just this cell), `real`
   (spawn fix-task scoped to `(group, repo)`), `infra` (back off on
   this `(repo, connector)` for a watermark), `out-of-scope` (escalate
   to human)
3. Fix-task: scoped mini-spec built from per-cell failure context (logs,
   per-repo diff, failing rubric rows / failing tests). Inherits the
   parent group's `touched_repos[repo]` = just `[repo]` — fix-tasks
   never expand the repo set. Fed back into `/orchestrate` as a new
   single-repo task group with the original cell's commit as context.
   Only the affected repo's implementer re-runs; other repos' verdicts
   for the parent group stay pinned in the verdicts table.
4. Capped attempts per cell (e.g. 2 retries / 2 fix-task attempts) →
   circuit-break the cell → human escalation. Other cells' attempts
   counted independently.
5. Failed non-deterministic verdicts feed back to the affected repo's
   implementer (`implementer[repo]`) as structured remediation context
   (not raw prose).

### Late-arriving failures (compensation)

- Inline says pass for `(repo, verifier)` cell, observe later says fail
  for that same cell. Observe wins per-cell.
- Task group already marked `completed` (all cells were green at gate
  time); downstream groups may have built on it.
- Repair handles regression-discovered-late: pause downstream groups
  that depend on the parent, generate compensating fix-tasks scoped to
  `(parent_group, affected_repo)` for the regressed cell. Sibling repos'
  cells in the parent group are not re-opened; only the affected
  `(repo, verifier)` cell re-verifies.

## Decisions

Open questions resolved 2026-05-28. Each carries the rationale; revisit
when the assumption breaks.

> **Polyrepo is the baseline.** Since this spec was drafted, polyrepo
> shipped — `coordination.lock.yaml`, per-repo `gm` routing in
> `_run_git_operations`, polyrepo-aware `ensure_initialized`, end-to-end
> petclinic-pair tests. Every decision below assumes a single
> orchestration run touches N repos. The cross-repo specs at
> `2026-05-24-multi-repo-product-orchestration` (discovery) and
> `2026-05-25-polyrepo-analysis` are upstream context.

- **D1 — Correlation key: three commit-message trailers.** Implementer
  writes:

  ```
  orchestrate-id: <uuid>
  task-group-id: <id>
  repo: <repo-key>
  ```

  on every commit it makes. The triple `(orchestrate-id, task-group-id,
  repo)` is the state-cell key everywhere downstream — observer event
  payloads, verdicts table, repair-engine context. `repo` is partially
  redundant with the CI webhook source attribution but explicit-and-
  grep'able beats trusting webhook attribution across N providers.
  Durable through rebases (trailers rewrite with the commit), works
  for non-PR pipelines, and doesn't depend on branch names that get
  squashed. Rejected alternatives: branch naming (lost on rebase /
  squash); PR label (PR-driven pipelines only).

- **D2 — State store: `jobs.db` extension with repo dimension.** Add to
  the existing SQLite:

  - `orchestration_events(orchestration_id, task_group_id, repo,
    event_type, payload_json, ts)`
  - `task_group_state(orchestration_id, task_group_id, repo, status,
    started_at, completed_at)` — composite PK on the first three.
  - `verdicts(orchestration_id, task_group_id, repo, verifier, status,
    detail, arrived_at)` — `verifier ∈ {inline, ci-trigger, rubric,
    observe}`.

  Single DB, single ops story, transactional with the job queue.
  Rejected alternatives: separate event-sourced substrate (doubles ops
  surface for projection management with no current scale need); JSON
  blob in `job.request_payload` (queries get awkward at any non-trivial
  volume, and the cross-repo aggregation in D5 needs real columns).

- **D3 — Connector secrets: env vars keyed `(repo, connector)`.** Match
  the existing per-repo `gm` routing pattern that polyrepo already
  ships. Convention: `{REPO_KEY}_{CONNECTOR}_TOKEN` —
  e.g. `BACKEND_GITHUB_TOKEN`, `GATEWAY_GITLAB_TOKEN`,
  `FRONTEND_JENKINS_API_KEY`. The connector definition at
  `haikai-profiles/default/connectors/<name>.yml` declares which env
  vars it needs by template; the orchestrate runtime resolves them
  per-repo at dispatch time. Process-scope; per-tenant injection
  deferred until multi-tenancy lands as a product requirement. Reuses
  the already-shipped per-repo provider routing — no new abstraction.

- **D4 — Repair classification: LLM classifier per failure, repo-
  aware.** Hand the failure log + diff + spec to a small model and ask
  it to classify `flaky` / `infra` / `real` / `out-of-scope`. Accepted
  cost: latency (~seconds) and a few cents per failed verdict. Accepted
  benefit: judgment-quality classification without maintaining a
  brittle regex allowlist of per-connector noise patterns (the pattern
  catalog explodes once connectors span 3+ CI providers across N
  repos). Rejected alternatives: string-match allowlist (cheaper but
  un-scaling); hybrid (two classification paths, marginal latency
  gain, doubles test surface).

  **Initial prompt shape:** system message describes the four classes
  with examples; user message contains `{failure_log, diff_summary,
  task_group_spec, repo, connector_kind, attempt_count}`. The `repo`
  and `connector_kind` keys let the model distinguish e.g. a frontend
  Vite-build OOM from a backend Maven dependency resolution failure
  on a different CI runner. Model returns `{class, confidence,
  rationale}`. Confidence threshold and model selection
  (`claude-haiku-4-5` initial guess) tunable; codify after 10 real
  failures.

- **D5 — Cross-repo gating: AND across `(task_group × repo)` cells.**
  A task group can touch multiple repos (see Fork 2 of the multi-repo
  spec — `## Task Group N: Backend [@repo:backend]` annotation). The
  function `touched_repos(task_group)` is derived from those
  annotations at task-creation time and frozen into the task group's
  state row. The AND gate fires:

  ```
  ∀ repo ∈ touched_repos(task_group):
      ∀ verifier ∈ {inline, ci-trigger, rubric, observe}:
          verdict[orchestration_id, task_group_id, repo, verifier] = pass
  ```

  Dependent task groups don't advance until ALL `(repo, verifier)`
  cells for the parent group reach `pass`. Late-arriving observe
  failures (see §"Late-arriving failures") apply per repo — one repo's
  observed regression pauses downstream groups that depend on the
  parent group, and the repair-engine spawns a compensating fix-task
  scoped to that repo.

  Coordination with the existing `coordination.lock.yaml` artifact:
  the lock pins cross-repo *state* at orchestrate-start (which commits
  in each repo are the inputs); the verdicts table pins cross-repo
  *outcomes* per task group. The lock is upstream of D5; D5 builds on
  it.

- **D6 — Progress is a built-in SSE stream, separate from hooks.**
  `GET /api/v2/orchestrations/{job_id}/stream` emits one SSE frame per
  state-store event — every transition, not just gates. Same pattern
  as the existing `/shape-spec/stream`. The stream is core and always
  on; it is a projection of the D2 event store, so it's resumable
  (`?from_seq=<n>` replays missed frames). The `[B]` hook surface stays
  a *separate* extension mechanism — the live view never depends on a
  hook being installed. `verdict` frames carry `cells_done/cells_total`
  so the UI renders per-repo lanes filling independently. Rejected
  alternative: reuse hook firings as the SSE source (couples the live
  view to hook-execution timing and to hooks being installed at all).

- **D7 — Verification is enable/disable-able per repo (and per
  verifier), via config.** A polyrepo product declares `verify: true|
  false` per repo (and optionally per verifier) in its repo config,
  alongside the per-repo git routing polyrepo already ships. A disabled
  repo is still implemented (commits land) but its cells are recorded
  `skipped` (with reason) and excluded from the D5 AND gate. This
  replaces the earlier `skip-group` *hook directive* — it's static
  config set by a human operator, not a runtime escape hatch an LLM or
  hook can trigger. Every skip is visible in the SSE stream and the
  `task-group-done` summary, so a skipped verification is never silent.
  Use cases: generated/vendored repos with no hand-written code, CI
  provider outages, hotfix bypass. Rejected alternative: runtime
  `skip-group` directive (gave hooks the power to silently bypass
  verification — wrong actor, wrong time).

- **D8 — Verifier commands are discovered from repo data, pinned, and
  product-overridable.** The runtime turns the data physically in each
  repo (`pom.xml`, `build.gradle`, `package.json`, `.github/workflows/`,
  lint configs) into concrete verifier commands via the agentic
  `hypothesis → probe → assess` loop already in the codebase
  (`src/ast/discovery_loop.py`). Mechanical file-inventory and LLM
  interpretation stay separate layers (CLAUDE.md rule — no framework
  pattern-matching in the scanner). Full detail in §"Discovery —
  resolving verifier commands from repo data (D8)".
  - **D8.1 — Run at init, cache, re-run only on change.** Discovery
    runs once at `/projects/init`, writes a per-repo discovery cache
    keyed by `discovered_at_sha`, and is reused until a relevant file
    changes. (D8.1a) Re-validation is git-triggered and fires **before
    `/shape-spec`** (primary checkpoint — shape-spec begins a new change,
    so the baseline must be current) and again at orchestration start:
    `git diff --name-only <sha> HEAD -- pom.xml build.gradle
    .github/workflows/…` — empty diff reuses the cache (no LLM call),
    non-empty re-discovers once. (D8.1b) Each orchestration pins the
    in-effect manifest into
    its `coordination.lock.yaml` for per-run reproducibility. Two
    layers: cache (persists, git-invalidated) + lock (per-run snapshot).
    Fixes the run-6 `mvnw`/`gradlew` flip and avoids paying discovery
    cost on runs that don't touch build files. Rejected: discover per
    orchestration (wasteful) and per cell (flaky).
  - **D8.2 — Product wins, drift is surfaced.** When declared product
    standards and discovered reality disagree (config drift — e.g.
    repo migrated Maven→Gradle but standards still say Maven), the
    *declared* value wins (predictable behaviour) but the mismatch is
    surfaced as a `discovery-drift` SSE frame + run-summary warning so a
    human fixes the stale standard. Detected at discovery time
    (orchestration start), not buried in a later verify failure.
    Rejected: discovery-wins-silently (misconfig silently changes
    behaviour) and conflict-is-hard-error (blocks runs on benign drift).

- **D9 — Connectors are thin CLI adapters; the implementer triggers CI;
  the runtime is only a inbound-gateway.**
  The implementer subagents (Claude Code / Kiro) already shell `git` /
  `gh` / `glab` / `mvn` / `npm`. So: (a) **trigger** is agent-side — the
  implementer pushes / `gh workflow run` right after committing; no
  separate dispatch runner. (b) A connector is **not** a Python REST
  client — it's a declarative adapter holding the per-provider *strings*
  (trigger cmd, status/poll cmd, verdict map) that the runtime shells
  (`gh run view --json`, `glab ci status`). (c) The **only**
  irreducibly-runtime piece is the **inbound-gateway**: a stable webhook URL
  (or a poller) that catches the async verdict, verifies/dedups it,
  correlates by D1 trailer, records it durably, and **delivers it to the
  `verification-loop` agent**. The inbound-gateway decides nothing — the gate
  and the repair dispatch are the loop's. The reason this piece can't be
  the agent isn't "an agent can't wait hours" — it can be parked and
  resumed, and the verdict reaches it as a message — it's that *a URL
  must stay reachable regardless of which agent is running*. `gh`/`glab`
  are real binaries → Windows-safe (unlike the `.sh` hooks problem).
  Rejected: per-provider Python REST clients (more code, raw API tokens
  in-process, duplicates the agent's CLI); and putting the gate /
  repair-dispatch in the runtime (judgment belongs in the agent — D5/D6
  are the loop's, the inbound-gateway just routes).

  **Knock-on for G2 / the subagent list:** `ci-trigger` and `observe`
  are **not** Claude Code subagents — they are async verifier *cells*
  whose verdicts the inbound-gateway correlates and delivers. The subagents are
  the implementer(s), `inline-runner` (shells local build tools),
  `rubric-verifier` (LLM), `repair-engine` (classifier), and
  `verification-loop` (gate + branch + repair dispatch). The
  `ci-trigger` and `observe` *cells* still exist in the D5 matrix (there
  are verdicts to gate on); they are produced by the implementer's
  trigger + the inbound-gateway's delivery, not by subagents. `orchestration.yml`
  examples below still list them for continuity but should be read as
  "cells," not "subagents." (G2 reworded to match — done.)

- **D10 — Verification is agent-followed instructions, not a Python
  `orchestrate` runtime.** The verification flow — firing hooks,
  evaluating the D5 gate, branching, dispatching repair, maintaining the
  checklist — is delivered the same way as `/orchestrate-tasks`: a
  command + the `verification-loop` agent following markdown
  instructions. There is no `orchestrate` engine that fires hooks. The
  `verification-loop` agent is the **only firer**: it reads `hooks.yaml`
  (declarative — handler ref + `mode` + order), walks it in order, and
  invokes each handler by kind (`tool:` / `agent:` / `builtin:`). Code
  shrinks to the irreducible I/O the agent cannot be: the **inbound-gateway** (a
  FastAPI webhook route with a stable URL — D9.1), the **state store**
  (`jobs.db` — D2), and the **SSE projection** (D6). **Supersedes the
  2026-05-30 substrate decision in `hooks-design.md`** (runtime fires
  events; in-process Python `@hook` registry; gate-routing / drift-reopen
  "live in `events.py` as the runtime") — none of those are runtime code
  under D10; they are the agent's instructions. Rejected: a runtime that
  fires a Python handler registry (couples verification to a code engine;
  the project's premise is that a new framework or handler needs
  instructions + yaml, not code — the same separation as AST-stays-
  mechanical / LLM-interprets in CLAUDE.md).
  - **D10.1 — Verification *judgment* is agentic; the recorder tools are
    *guarded writes* (amended 2026-05-31 after a multi-persona critique).**
    The agent owns all judgment — which cells exist, pass/fail triage,
    rubric scoring, repair classification, branch choice. But the recorder
    tools that mutate `jobs.db` enforce mechanical invariants *in the write
    itself* (a guarded SQL write in one transaction, not a blind append).
    This is bookkeeping, not verification logic, and lives in the
    irreducible-I/O layer D10 already permits:
    - `advance(orch, group)` writes `terminal:pass` only if (a) the gate is
      green — `SELECT count(*) FROM verdicts WHERE … status NOT IN
      ('pass','skipped')` returns 0 — and (b) no terminal row exists yet
      (`UNIQUE(orch, group)` makes a double-advance a constraint error, not
      a second pass).
    - `open_repair(cell)` opens + increments only if `attempts < cap`, else
      records `escalated`; `UNIQUE(cell, attempt)` stops two concurrent
      opens at the same attempt.
    - `record_verdict` dedups on the provider delivery id (`UNIQUE`); the
      gate projects last-writer per cell.

    The agent still *decides* to advance / repair; the tool refuses to
    record a state that violates the invariant — so the agent cannot
    narrate past a red gate, double-advance, or exceed the cap, and the DAG
    stays safe under D10.2 re-entry/concurrency. Hooks still never gate
    (there is no `blocking`/`advisory` split; a gating check is a verdict
    cell). **Supersedes the earlier "no code guards / the attempt cap is a
    pure instruction" stance**: the critique showed a wrong `advance` is
    *not* git-revertible in effect (it dispatches downstream implementers
    that commit and trigger CI), and that CLAUDE.md's mandated `count == 0`
    guard test is unwritable unless advancing-on-red is a refusable code
    path. The guards are a pure fold over rows already in `jobs.db` — the
    loop's own logic expressed as code so the LLM cannot drift from it.
  - **D10.2 — Async re-entry = a FRESH invocation, never a resumed
    session (decided 2026-06-01).** On any inbound event the inbound-gateway
    starts a **new** `verify-task-group` run for `(orchestrate_id,
    task_group_id)` — it does **not** resume a live session or conversation.
    The conversation carries no authority; **context is always provided by
    reading the db**, which holds the spec slice + per-cell detail + the
    recorded verdicts — so a fresh run reconstructs everything it needs.
    Rationale: async spans minutes-to-days (a session can't be held alive
    that long), state is durable (D2), and fresh-every-time is idempotent
    and always-current. Re-entry must still be **reconcile-on-entry**: read
    recorded state, never redo settled work (no re-dispatching a recorded
    verdict's verifier, no re-firing a recorded hook, no double-`advance`;
    check `task_group_state` first). Because there is no session to track,
    **D10.6's single-flight is a per-orchestration queue/lease** — events
    enqueue, one fresh run drains them one at a time against the
    then-current db state.
  - **D10.3 — `advance()` records; the loop dispatches dependents.**
    `advance(orchestrate_id, task_group_id)` only records the group
    `terminal:pass` in the state store. Launching the next groups is the
    loop's **agentic** step: on a passing gate it reads
    `orchestration.yml` (the DAG), finds the groups whose `depends_on`
    just cleared, and `Task`-dispatches their implementers — the same
    dispatch `/orchestrate-tasks` does for the first group. No runtime
    scheduler. A late-CI re-invoked run (D10.2) does this dispatch before
    it returns. Dependent dispatch is keyed off recorded state (a
    `dispatched` event per child) so a crash-mid-dispatch is re-driven on
    the next re-entry, not stranded.
  - **D10.4 — Authenticated SHA→cell binding (refines D1 / D9.1).** The
    inbound-gateway must NOT correlate a CI event to a cell by grepping
    commit-message trailers alone — trailers are attacker-controllable
    text, so a forged trailer plus a leaked `orchestrate-id` could forge a
    `pass`. At CI-trigger time (D9, when the implementer fires CI for a
    known SHA) the runtime records the binding
    `(orchestrate-id, task-group-id, repo) → commit_sha` in `jobs.db`. On
    ingest the inbound-gateway resolves the cell by the webhook's SHA against that
    pre-recorded binding and **rejects any SHA with no binding**; the D1
    trailers become a redundant cross-check, never the authority. Webhook
    auth is per-`(repo, connector)` — an opaque token in the URL path
    selects the secret *before* the payload is trusted — and ingest dedups
    on the provider delivery id (`X-GitHub-Delivery` / `X-Gitlab-Event-UUID`).
  - **D10.5 — Liveness: the inbound-gateway owns a TTL sweeper; `timeout` is
    terminal.** With no scheduler, a never-arriving async verdict (dropped
    runner, misconfigured webhook, rotated secret) would otherwise park the
    gate `pending` forever — nothing would re-invoke the loop. So the
    inbound-gateway (the durable I/O layer that legitimately holds a timer) sweeps
    watermarks: on TTL expiry for a pending async cell it records `timeout`
    *and* re-invokes the loop. `timeout` is **terminal** — it fails the gate
    (the loop routes it to `repair-engine` as `infra`), it never holds the
    gate `pending`. If a real verdict lands after a `timeout`, last-writer
    by `arrived_at` wins (so a late `pass`/`fail` supersedes a stale
    `timeout`). Closes the "verdict that never comes" liveness gap.
  - **D10.6 — Single-flight per orchestration; last-writer cell
    projection.** The inbound-gateway serializes invocation per `orchestration_id`
    (a lease / queue): events enqueue, one fresh run (D10.2) drains them one
    at a time — never two runs mutating concurrently. This makes
    reconcile-on-entry safe (no TOCTOU between two runs both folding the gate
    and both advancing) and makes drift-reopen vs advance non-interleaving. The gate projects the **latest verdict per
    cell by `arrived_at`** (append-only + last-writer), with `observe`
    precedence preserved for drift. Dependent dispatch is keyed off a
    recorded `dispatched` event per child (forward-reconcile), so a
    crash-mid-dispatch is re-driven on the next re-entry rather than
    stranding the DAG.
  - **D10.7 — Untrusted inputs (the trust boundary D10.1 omitted).** The
    "cooperative agent" premise covers the loop, *not* the inputs that steer
    it — those are untrusted: (a) `hooks.yaml` + handler refs live in the
    workspace under verification, so only **profile-shipped** `builtin:` /
    `tool:` / `agent:` names run; a workspace-supplied handler is never
    auto-executed. (b) Per-`(repo, connector)` tokens are scoped to the
    single dispatch and not left process-global for the run. (c) The
    `failure_log` fed to `repair-engine` (D4) is untrusted external text —
    delimited/escaped, never allowed to carry control directives
    (prompt-injection defense on the classifier).
  - **D11 — The extraction pipeline plugs in as an inline verifier**
    (decided 2026-06-09, `:grill` of the `pipeline-orchestration` spec —
    see `grill/260609-2340-pipeline-orchestration-spec/`). A run of the
    standards-extraction pipeline
    (`haikai/specs/2026-06-09-pipeline-orchestration/`) is a **task
    group**; its `final_gate` exit code is the cell verdict for the
    `(task_group, repo, inline)` slot — exit 0 → `pass`, exit 1 →
    `fail`. Its `blockers.jsonl` is the `failure_log` the
    `repair-engine` reads (untrusted external text per D10.7). No new
    verification machinery on either side: the pipeline self-checks
    (`post_check`, `final_gate`) *inside* the cell; this gate folds the
    cell like any other. Term ownership settled in the same pass:
    **"cell" and "hook" are verification-owned** — the pipeline spec's
    unit is a *batch* and its gating scripts are *checks* (they gate
    via exit code, the inverted contract of our side-effect-only
    hooks).

### Polyrepo sweep (complete)

The 5 sections that were drafted single-repo (`## Architecture`,
`## Components > Subagents`, `## Components > Connectors`,
`## Async execution model`, `## Self-repair loop`) were swept to
polyrepo-native in commit (this commit). Cross-references:

- Architecture ASCII diagram shows per-repo implementer fanout +
  `(repo × verifier)` cell matrix → AND gate.
- Subagent table adds a Scope column; all verifiers operate per
  `(task_group, repo)` cell.
- Connectors yaml uses `auth.token_template: "{REPO_KEY}_{CONN}_TOKEN"`
  for D3 resolution; observe correlation moved to D1 trailers.
- `/orchestrate` response includes `touched_repos_by_group`; per-cell
  + group-level state machines documented; event shape has `repo`.
- Self-repair loop scopes every operation to the failing cell; fix-
  tasks never expand `touched_repos`; per-cell attempt counters.

## Notes

- Rubrics live at `haikai/specs/[spec]/rubrics/[task-group].md`,
  committed alongside the spec so fix-tasks reuse them deterministically.
- Connector definitions live at
  `haikai-profiles/default/connectors/[name].yml`.
- Subagent definitions live at
  `haikai-profiles/default/agents/[name].md` (existing convention).
- This spec is intentionally one large document. If implementation tasks
  push past ~8 task groups it can be decomposed into parent + children
  later — not upfront.
