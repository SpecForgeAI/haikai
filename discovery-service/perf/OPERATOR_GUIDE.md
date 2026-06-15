# Discovery Performance Scoring — Operator Guide

Self-serve recipe for running discovery + auto-perf-scoring against the
test repos, interpreting the scoresheet, and recovering from the
failure modes we've seen in practice. Anyone (a fresh Claude session, a
new engineer) should be able to follow this without prior conversation
context.

---

## 1. What this system is

For every discovery run that completes, an LLM-driven scorer reads the
candidates produced and writes:

- A **per-run report** at `discovery-service/perf/runs/<date>-<runId-prefix>-<svc>.md`
- A **row in the scoresheet's "All scored runs" table**
  ([`scoresheet.md`](./scoresheet.md))
- An updated **"Best per pack combo" entry** if the run beats the
  recorded best for its `(language, framework)` combo (rows move
  between Excellent / Good / Mixed / Poor / Failed bands)
- An updated **"Last Seen"** on any matching Open issues in
  [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md)
- New rows in `KNOWN_ISSUES.md`'s "Auto-suggested leads" table from
  deterministic flags + LLM `anomalies` (for human triage)

A self-improving "golden run" file at `discovery-service/perf/golden-runs/<packKey>.md`
tracks the historical anchor per combo and is promoted automatically
when a new run beats the existing golden by > 0.1 points.

The rubric is `discovery-service/perf/RUBRIC.md`. The end-to-end
process / wiring is described in `discovery-service/perf/PROCESS.md`.

---

## 2. Service layout

| Service | Port | Tech | Start command |
|---|---|---|---|
| architecture-model-service | 8080 | Java / Spring Boot | run from IDE or `mvn spring-boot:run` |
| gateway | 8081 | Node / Express + tsx | `npm run dev` in `gateway/` |
| discovery-service | 8091 | Node / Express + tsx | `npm run dev` in `discovery-service/` |

The discovery service runs `tsx watch`, so editing
`discovery-service/src/**` triggers a hot reload — **never edit while a
discovery run is in flight**, the reload kills it. Wait for the run to
finish or mark it FAILED first.

A pre-flight health check before any run:

```bash
curl -sS http://localhost:8080/actuator/health   # arch-model
curl -sS http://localhost:8081/health            # gateway
curl -sS http://localhost:8091/health            # discovery
```

---

## 3. Where IDs and pack names live

Three companion documents in this directory mirror the spreadsheet at
`C:\Users\gazwa\OneDrive\Documents\SDD_App\discovery_packs.xlsx`. When
the spreadsheet changes, regenerate them with:

```bash
python generate-pack-mds.py
```

| File | Purpose |
|---|---|
| [`test-repos-projects.md`](./test-repos-projects.md) | Project IDs + Service IDs + canonical pack names + status for every test repo. **Look here first to find the IDs you need to start a run.** |
| [`language-packs.md`](./language-packs.md) | The planning inventory of language packs (with aspirational names + estimated coverage %). Contrasted with the canonical registered pack IDs. |
| [`framework-packs.md`](./framework-packs.md) | The planning inventory of framework packs (with aspirational names + estimated coverage %). Contrasted with the canonical registered pack IDs. |

The **canonical registered pack IDs** (what the discovery service
actually matches against) come from
`discovery-service/src/services/extensionPacks/languagePacks/*` and
`.../frameworkPacks/*` — there are 9 language packs and 19 framework
packs at the moment. The pack-name columns in `test-repos-projects.md`
already use the canonical IDs.

---

## 4. Tech-hint preconditions

A service-scoped run can only engage a pack if the service entity in
the architecture-model-service has its `core_tech_resolved` JSON column
populated **with human-readable names** (not pack IDs):

```json
{
  "language": { "name": "Java", "version": "21" },
  "frameworks": [{ "name": "Spring Boot", "version": "3" }],
  "languagePack": "java-lang",
  "frameworkPacks": ["java-spring-boot"]
}
```

Pack predicates match `{ language: 'Java', technology: 'Spring Boot' }`
(human-readable forms). Writing pack IDs (`java-lang`, `java-spring-boot`)
into the `language.name` / `frameworks[].name` slots is the bug we hit
on 2026-04-25 — the predicates don't match and the run falls back to
LLM-only with **0% adapter share**.

The seed script [`fix-test-repo-tech-hints.py`](../../fix-test-repo-tech-hints.py)
contains the human-readable mapping for the 17 test repos and can patch
all of them in one shot. A single repo can be patched with `--only NAME`.

---

## 5. End-to-end run recipe

### Manual (one service, useful for verification)

```bash
# 1. Activate the project on the architecture-model-service.
PID=b6e61465-a50e-4a97-b900-0d40c9a4a513
SID=svc-mo19xx2z-1nw9s
curl -sS -m 5 -X POST http://localhost:8080/api/projects/$PID/activate

# 2. Start the run on the discovery service. Always pass
#    `confirmLlmSolo: true` so a tier-C inference (LLM-only fallback)
#    doesn't block the start.
curl -sS -m 30 -X POST http://localhost:8091/discovery/runs \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PID\",\"serviceId\":\"$SID\",\"confirmLlmSolo\":true}"
# -> response includes `id` (the runId)

# 3. Poll until the run is COMPLETED / FAILED / CANCELLED.
RID=<runId-from-step-2>
curl -sS "http://localhost:8091/discovery/runs/$RID?projectId=$PID"

# 4. Auto-perf-scoring fires from runManager.ts when status flips to
#    COMPLETED. Check the scoresheet to see the new row land.
grep "${RID:0:8}" discovery-service/perf/scoresheet.md
```

### Batch (all 17 test repos)

```bash
# Idempotent — re-runs against everything in setup-test-repos.py's MAPPING
python run-discovery-on-test-repos.py
```

The script is sequential, polls each run, has a 25-min hard timeout
and a 10-min stall detector (no `updated_at` change for 600s -> bail).
It's known to be unreliable on Windows: `urllib.urlopen` can silently
hang past the timeout on some kernels, leaving the orchestrator stuck.
If it stops printing, kill it (`taskkill /PID <pid> /F`) and use the
manual recipe above for the remaining services.

---

## 6. Failure modes + mitigations

These are real, hit during the 2026-04-25 / 2026-04-26 batches.

| Mode | Symptom | Mitigation |
|---|---|---|
| Wrong tech-hint shape | 0% adapter, LLM-only candidates | Run `python fix-test-repo-tech-hints.py [--only NAME]` to repopulate `core_tech_resolved` with human-readable names. |
| Branch not `main` | `fatal: Remote branch main not found in upstream origin` | Already handled in `repoAccess.ts` — the clone retries without `-b` (lets git use the repo's default branch). No action needed. |
| Windows long-paths | Clone partially succeeds then `Filename too long` checkout error | Already handled in `repoAccess.ts` — `git -c core.longpaths=true clone …`. No action needed. |
| Stuck `service-scoped-llm-analysis` step | `updated_at` doesn't move for >30 min on a large repo (WordPress, eShopOnWeb, Discourse-class) | Server-side LLM hang. Mark the run FAILED via `PUT /api/model/projects/$PID/discovery/runs/$RID` with `{"status":"FAILED","errorMessage":"..."}` so subsequent runs aren't blocked. No code-level mitigation today. |
| Stale RUNNING run blocks new run start | `POST /discovery/runs` returns 409 | Same — find the stuck run via `GET /api/model/projects/$PID/discovery/runs`, PUT its status to FAILED, retry the new run. |
| `tsx watch` reloaded mid-run | Run silently dies | Don't edit `discovery-service/src/**` while a run is active. Leave it idle, then edit, then start the next run. |
| Spreadsheet "Best per pack combo" rows reference unregistered pack IDs | Phantom rows like `python-3 / django` instead of `python-lang / django` | The scoresheet's "Best per pack combo" tables must use canonical registered IDs only. The `inferPackCombo` logic in `performancePostRun.ts` reads from the service entity (`core_tech_language_pack` + `core_tech_framework_packs`) which always carries the canonical IDs, so new rows are always correct. Manual edits should match. |
| `architecture-model-service` rejects PUT-update of a run record with snake_case body | HTTP 500 | Use the camelCase shape: `{"status":"FAILED","errorMessage":"…"}` (mirrors the Java DTO in `DiscoveryRunController.updateRun`). |

---

## 7. Reading the scoresheet

[`scoresheet.md`](./scoresheet.md) has three sections:

1. **Best per pack combo** (5 score-band tables — Excellent / Good /
   Mixed / Poor / Failed — plus an "Awaiting first run" table for
   registered combos that haven't been scored yet). Auto-maintained by
   `performancePostRun.ts`: each combo lives in exactly one band; new
   runs that beat the recorded best move the row into the band that
   matches the new score. The placeholder row `_no combos in this band yet_`
   is restored when a band empties.
2. **All scored runs** — every run, append-only.
3. (Removed) Pre-existing failures section — its concerns now live in
   [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

Score bands (verbatim from `RUBRIC.md`):

- **4.5–5.0** — Excellent. Trust with light review.
- **3.5–4.4** — Good. Standard review burden.
- **2.5–3.4** — Mixed. Major type missing or noisy.
- **1.5–2.4** — Poor. Don't trust without re-scanning.
- **0–1.4** — Failed.

Score boundaries are under review — see the discussion in the
2026-04-26 conversation about whether the rubric's structural ceiling
(provenance / determinism penalties on adapter-dominant runs) keeps
`Excellent` artificially out of reach.

---

## 8. Reading `KNOWN_ISSUES.md`

[`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) is the **pack improvement
backlog**. Each issue describes a concrete bug or coverage gap in a
specific language or framework pack — *not* "run scored low" (the
scoresheet already shows that). Sections:

- **Open** — the work to do, with severity, lang/framework pack tag,
  first/last-seen run.
- **Investigating** — open work currently being looked at.
- **Resolved** — historical record of fixes. IDs are kept for life
  (one shared `ISS-###` series across Open / Resolved / Won't Fix).
- **Won't Fix** — closed without action, with reason.
- **Auto-suggested leads** — rough hints surfaced by
  `performancePostRun.ts` from deterministic flags + LLM `anomalies`.
  Promote to a real Open issue only after human analysis.

`performancePostRun.ts` updates "Last Seen" on Open issues whose
combo matches the run, appends to "Auto-suggested leads", and never
edits a manual issue's title / description / severity — those are
human-authored.

---

## 9. Helper scripts (in repo root)

| Script | Purpose |
|---|---|
| `setup-test-repos.py` | Idempotent: creates the application + app_component + service triple for every entry in its `ROWS` table. Used once on 2026-04-25 to seed the 17 test repos. |
| `update-spreadsheet.py` | Writes the seeded service IDs back into `discovery_packs.xlsx`. |
| `fix-test-repo-tech-hints.py` | Patches `core_tech_resolved` with human-readable names so pack predicates engage. `--only NAME` for one row, no flag for all 17. |
| `run-discovery-on-test-repos.py` | Sequential orchestrator that POSTs `/discovery/runs` for every test repo and polls each to completion. |
| `retry-failed-services.py` | Same shape, longer timeouts (30-min stall, 60-min hard cap), targets only the previously-failed subset. |
| `generate-pack-mds.py` | Regenerates the three pack-inventory MD files in `discovery-service/perf/` from `discovery_packs.xlsx`. Run after spreadsheet edits. |

---

## 10. Config flags worth knowing

- `DISCOVERY_PERFORMANCE_AUTO_SCORE` (gateway env, default `true`) — turns
  off the auto-trigger if you need to run discovery without scoring.
- `doPerformanceRun` (per-request body field on `POST /api/v1/discovery/runs`)
  — overrides the env default for a single run.
- The gateway always uses the same OpenAI model as everything else in
  the project (the `OPENAI_MODEL` env var). There is no separate cheap
  "scoring model" — this was tried and rejected on 2026-04-25.

---

## Quick reference: where things are

| Concern | Path |
|---|---|
| Rubric (LLM grader prompt) | `discovery-service/perf/RUBRIC.md` |
| Process / wiring | `discovery-service/perf/PROCESS.md` |
| Live scoresheet | `discovery-service/perf/scoresheet.md` |
| Pack improvement backlog | `discovery-service/perf/KNOWN_ISSUES.md` |
| Per-run reports | `discovery-service/perf/runs/*.md` |
| Self-improving golden | `discovery-service/perf/golden-runs/*.md` |
| Project / Service IDs | [`test-repos-projects.md`](./test-repos-projects.md) |
| Language pack inventory | [`language-packs.md`](./language-packs.md) |
| Framework pack inventory | [`framework-packs.md`](./framework-packs.md) |
| Scoring orchestration | `discovery-service/src/services/performancePostRun.ts` |
| Deterministic flag rules | `discovery-service/src/services/performanceHeuristics.ts` |
| Run-start route (gateway) | `gateway/src/routes/discoveryRunStart.ts` |
| Run dispatch / lifecycle | `discovery-service/src/services/runManager.ts` |
| Repo clone (branch + long-paths) | `discovery-service/src/services/repoAccess.ts` |
