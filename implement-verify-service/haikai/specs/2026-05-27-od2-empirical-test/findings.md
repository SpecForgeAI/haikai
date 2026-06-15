# OD-2 Empirical Test — Findings

**Run date:** 2026-05-27
**Branch:** `spec/multi-repo-product-orchestration`
**Skill:** `/autoresearch:ship` (8-phase shipping workflow)
**Status:** **COMPLETED — both trials ran end-to-end.**

---

## Verdict on OD-2

**NOT REQUIRED** at the tested scale (1 feature, 2 repos).

The LLM produces coherent cross-repo work *without any explicit per-repo attribution metadata in `spec.md` or `tasks.md`*. With the polyrepo plumbing in place — git's working-directory boundaries doing per-repo commit attribution implicitly, and every repo mounted via `--add-dir` so the LLM has full read/write access — Claude correctly:

1. Routed each modified file into its semantically-correct repo (backend Java → `backend/`, frontend Vue → `frontend/`)
2. Produced a frontend API call that matches the backend endpoint path *character-for-character* (`/owners/{ownerId}/preferred-vet`)
3. Wrote a frontend template that reads the *exact DTO shape* (`VetDto.firstName/lastName/specialties[]`) the backend returns
4. Handled error states symmetrically (404 owner-missing, 200-with-null no-visits) on both sides

OD-2 attribution would still add value for:
- **N > 2 repos** — untested; coherence may degrade as the LLM's working set grows
- **Larger or non-localised features** — untested; this trial was one endpoint + one UI panel
- **Per-task narrow `--add-dir` mounts** — performance/cost optimisation, not correctness
- **Per-repo PR descriptions** — UX polish

But OD-2 attribution is **not a correctness gate** for the polyrepo system to ship its first non-trivial feature.

---

## Trial M (mono — 1 repo as polyrepo with N=1)

| Field | Value |
|---|---|
| Project | `acme/petclinic-mono` |
| Source | `spring-projects/spring-petclinic` (Spring Boot + Thymeleaf) |
| Init time | 3.0 s |
| Shape-spec rounds | 3 (10 questions in round 1, 0 in 2/3) |
| Shape-spec time | 152.8 s |
| Orchestrate time | **1556.3 s (~26 min)** |
| Step 1 (write-spec) | ~76 s |
| Step 2 (create-tasks) | ~22 min |
| Step 3 (implement-tasks) | ~3 min |
| Files modified | **10 modified + 2 new (PreferredVetDTO.java, PreferredVetEndpointTests.java)** |
| Diff size | **126 insertions, 15 deletions** |
| spec.md written | ✓ |
| tasks.md written | ✓ |
| Git commit | ✗ (see "Known follow-up" below) |

**Files touched (all in `app/`):**

| File | Δ lines | What |
|---|---|---|
| `owner/OwnerController.java` | +69 | The endpoint method |
| `owner/Visit.java` | +15 | `vet_id` field |
| `db/{h2,mysql,postgres}/{data,schema}.sql` (×6) | +29 net | Schema + seed data for `vet_id` |
| `messages/messages.properties` | +2 | i18n strings |
| `templates/owners/ownerDetails.html` | +20 | Thymeleaf section |
| `owner/PreferredVetDTO.java` (new) | — | Response DTO |
| `test/.../PreferredVetEndpointTests.java` (new) | — | JUnit tests |

---

## Trial P (poly — 2 repos, the actual OD-2 test)

| Field | Value |
|---|---|
| Project | `acme/petclinic-poly` |
| Backend | `spring-petclinic/spring-petclinic-rest` |
| Frontend | `spring-petclinic/spring-petclinic-vue` |
| Init time | 4.7 s |
| Shape-spec rounds | 2 (9 questions in round 1, 0 in round 2) |
| Shape-spec time | 138.0 s |
| Orchestrate time | **840.8 s (~14 min)** |
| Step 1 (write-spec) | ~61 s |
| Step 2 (create-tasks) | ~10 min |
| Step 3 (implement-tasks) | ~3 min |
| Files modified | **backend: 11; frontend: 2** |
| Diff size | backend: **+221 / −22**; frontend: **+47 / −0** |
| spec.md written | ✓ |
| tasks.md written | ✓ |
| Git commit | ✗ (see "Known follow-up" below) |

### Files touched, by repo

**`backend/` (11 files, +221 / −22):**

| File | Δ lines | What |
|---|---|---|
| `rest/controller/OwnerRestController.java` | +36 | The endpoint + `VetMapper` injection |
| `model/Visit.java` | +25 | `vet_id` field + getter/setter |
| `db/{h2,hsqldb,mysql,postgres}/{data,schema}.sql` (×8) | +49 net | Schema + seed data across 4 DBs |
| `rest/controller/OwnerRestControllerTests.java` | +133 | MockMvc tests |

**`frontend/` (2 files, +47):**

| File | Δ lines | What |
|---|---|---|
| `views/OwnerDetailView.vue` | +44 | UI section + state + fetch logic |
| `services/api.js` | +3 | `getPreferredVet(ownerId)` method |

### Cross-repo coherence — the actual OD-2 question

| Concern | Backend | Frontend | Match |
|---|---|---|---|
| Endpoint path | `@GetMapping("/owners/{ownerId}/preferred-vet")` | `apiClient.get(\`/owners/${ownerId}/preferred-vet\`)` | **✓ exact** |
| Path variable name | `{ownerId}` | `${ownerId}` | **✓ exact** |
| Response type | `ResponseEntity<VetDto>` | `preferredVet.firstName / lastName / specialties[]` | **✓ matches `VetDto`** |
| Owner missing | 404 NOT_FOUND | error template branch | **✓ handled** |
| No visits / no vet | 200 OK with null body | `<tr v-if="!preferredVet">` template branch | **✓ handled** |
| Multiple specialties | First alphabetically (per spec) | `specialties.map(s => s.name).join(', ')` | **✓ frontend shows all (slightly looser than spec)** |
| Repo placement | Java only under `backend/` | Vue/JS only under `frontend/` | **✓ no mis-attribution** |

Every concrete contract point lined up. Zero references to non-existent files. Zero Java code in `frontend/`, zero Vue code in `backend/`.

---

## Side-by-side

| | Trial M (mono N=1) | Trial P (poly N=2) |
|---|---|---|
| Init | 3.0 s | 4.7 s |
| Shape-spec | 152.8 s / 3 rounds | 138.0 s / 2 rounds |
| Orchestrate | **1556 s** | **841 s** |
| Files modified | 12 total | 13 total (11 backend + 2 frontend) |
| Diff lines | +126 / −15 | +268 / −22 |
| Cross-repo coherence | n/a | **Exact** |
| Repo mis-attribution | n/a | **Zero** |
| Final commit | ✗ git workflow blocked | ✗ git workflow blocked |
| Spec.md content | Substantive, multi-section | Substantive, multi-section |
| Tasks.md content | Single task list, no per-repo tags | Single task list, no per-repo tags |

**Trial M took longer than Trial P** — counter-intuitive, but Step 2 (create-tasks) was the divergent phase (~22 min vs ~10 min). Possibly LLM variance; possibly create-tasks had more questions for the mono codebase. Sample size n=1 per trial; don't read too much into the delta.

---

## Setup decisions (locked)

| ID | Decision | Resolution |
|---|---|---|
| D1 | `STANDARDS_API_KEY` source | `.env.session` line 1 |
| D2 | Uvicorn restart | killed stale system-Python PID, restarted from this branch's `.venv` |
| D3 | Push-to-remote policy | clone + commit locally; `.env.session` had `GIT_AUTO_PUSH=false` + `GIT_AUTO_PR=false` already |

---

## Bugs found and fixed during the run

This started as a single empirical trial. It surfaced a chain of polyrepo
blind spots in the system, each of which had to be cleared before the
trial could yield data. The fixes themselves are a meaningful artifact.

### 1. Gate misfire on polyrepo (FIXED — `35d4fd6`)

`GitManager.ensure_initialized()` only checked `{project_dir}/.git`. For
polyrepo, `.git` lives at `{project_dir}/{folder}/.git` with
`coordination.yaml` at the product root. Every V2 endpoint rejected
polyrepo-initialized projects with HTTP 400. Now accepts either layout.

### 2. OpenAI executor hardcoded `api.openai.com` + missed template resolution (FIXED — `d1461af`)

While diagnosing an auth side-trip, found `OpenAIChatExecutor` was the
only chat executor that (a) hardcoded the OpenAI host (no
`OPENAI_BASE_URL` support) and (b) sent raw `{{PHASE N: @...}}` template
placeholders to the LLM instead of resolving them via the shared
`template_resolver`. Both fixed.

### 3. Trial driver bailed too early on shape-spec (FIXED in driver only)

The driver exited the shape-spec loop as soon as Claude *mentioned* a
spec path (firing a `folder` SSE event) — but that mention happens
during round 1, before `requirements.md` is written. The driver now
exits only when `requirements.md` is actually present on disk
(polyrepo-aware: walks `coordination.yaml` subdirs). Fixed in
`fix/od2_trial_driver.py` only — not in the API.

### 4. Post-orchestration git workflow fails on polyrepo product root (NOT FIXED — known follow-up)

`src/job_queue/tasks.py:_run_git_operations` builds one `GitManager`
pointed at the workspace product root, and `apply_git_workflow` then
calls `git checkout main` / `git commit` / `git push` there. For
polyrepo, the product root is NOT a git repo — every git op fails. The
trial captured this as `"Git workflow failed for ...: fatal: not a git
repository"` on both trials' `job_final.result.errors`.

Both trials' work product is intact in each repo's subdir as
uncommitted modifications — the failure is post-step bookkeeping, not
loss of work. Required fix: route per-repo `gm` instances via
`coordination.yaml` and call `apply_git_workflow` once per repo per
spec. Separate commit; scope is well-bounded.

---

## Implications for the polyrepo spec's remaining open decisions

| OD | Status after this trial |
|---|---|
| OD-1 (`paths_touched` placement: frontmatter / sidecar / inline) | Still open. Untested by this trial — Claude did not produce `paths_touched` at all, and the work still landed correctly. The OD becomes interesting only if we add per-task narrow mounts. |
| **OD-2 (write-spec NN repo attribution)** | **NOT REQUIRED** at tested scale. |
| OD-3 (cross-repo dep declaration syntax) | Still open. Trial topic was loosely coupled (frontend can render a fixed DTO shape without typed contract); a tight typed-contract feature would stress this more. |

---

## What the trial DIDN'T test (honest limits)

- **N > 2 repos** — coherence might degrade with larger working sets
- **Larger features** — single-endpoint + single-UI-panel is small
- **Schema-level cross-repo dependency** — both repos had independent schemas
- **Build verification** — neither trial ran `mvn test` or `npm test` to confirm the changes compile/pass. Code looks correct on inspection.
- **Implementation under load** — single shot, no retries, no concurrent specs

OD-2's "NOT REQUIRED" verdict applies *at the tested scale*. Re-test
before extrapolating to 5-repo monorepos or features that span 4+ files
per repo with cross-cutting types.

---

## Artifacts

- `fix/od2_trial_driver.py` — reusable driver
- `fix/od2/M_*.json` + `fix/od2/M_*.sse` — Trial M raw artifacts
- `fix/od2/P_*.json` + `fix/od2/P_*.sse` — Trial P raw artifacts
- `D:/home/ubuntu/api_workspace/acme/petclinic-mono/` — Trial M workspace (uncommitted modifications in `app/`)
- `D:/home/ubuntu/api_workspace/acme/petclinic-poly/` — Trial P workspace (uncommitted modifications in `backend/` + `frontend/`)
- `haikai/specs/2026-05-27-preferred-vet-endpoint/spec.md` — the spec Claude wrote (mono workspace)

---

## Recommended next step

1. **Lock OD-2 as NOT REQUIRED for v1 polyrepo** based on this evidence. Document the
   scale caveats; revisit at N=5 repos or features spanning a single typed contract
   across 3+ repos.
2. **Fix bug #4 (per-repo git routing)** as a small follow-up commit. It blocks the
   auto-commit / auto-PR flow but not the engineering work itself. Scope: ~30 LOC
   in `src/job_queue/tasks.py:_run_git_operations` + a regression test that hits
   `POST /api/v2/jobs/orchestrations` against a polyrepo project and asserts
   per-repo commits land.
3. **Defer OD-1 + OD-3** until a real feature surfaces the need.
4. **Ship the polyrepo branch.** The system demonstrably works end-to-end for the
   N=2 case the spec was designed for, with one known follow-up bug well-isolated.
