# Spec Requirements: tech-hints-llm-resolution

## Initial Description

LLM-assisted tech hints resolution for service entities. Currently the service row has a free-text `core_tech` field and separate `repo_url`/`repo_subfolder` fields. The discovery pipeline depends on `parseCoretech` heuristically splitting `core_tech` on commas to derive a language pack + framework pack — this is fragile (e.g., "Java 21 (Spring Boot 3)" fails to parse and silently forces tier C / LLM-only mode).

Goal: make language-pack + framework-pack resolution a first-class, LLM-assisted, save-time operation on the service row, stored in structured columns, so that the discovery-run tier gate becomes deterministic (reads structured columns) instead of heuristic.

## Pre-Agreed Design Decisions (from raw-idea.md, verbatim — with user revisions noted)

1. Reorder the service-entry inline row so Repo URL + Subfolder come BEFORE the free-text tech_hints field, so that by the time tech_hints blurs, the repo fields are available for cross-check.
2. Single LLM call fires on tech_hints blur. If repo fields are populated, include a small repo snapshot (top-level files like pom.xml/build.gradle/package.json/requirements.txt + first N lines) in the call. If not, LLM does best-effort tech-only resolution.
3. LLM picks from the closed set of registered language packs and framework packs (no free-form invention). Returns: `{ language: {name, version} | null, frameworks: [{name, version}], languagePack: string | null, frameworkPacks: string[], confirmationSentence: string (human-friendly), repoCrossCheck: {status: 'confirmed'|'conflict'|'partial', note} | null, confidence: 'high'|'low'|'none'|'tech-only' }`.
4. Inline preview under tech_hints shows chips + the confirmationSentence so user sees the LLM interpretation and can accept or retype.
5. On conflict between stated tech and repo contents: **REVISED — user has changed "warn, don't block" to "warn AND block".** When `repoCrossCheck.status === 'conflict'`, Save is blocked until the user resolves the conflict (re-types tech or fixes the repo pointer). `partial` remains a non-blocking warning.
6. New columns on services: `core_tech` (raw, unchanged), `core_tech_resolved` (JSON), `core_tech_language_pack`, `core_tech_framework_packs` (array), `core_tech_resolution_confidence`, `core_tech_resolved_at`.
7. Editing either tech_hints OR repo fields marks resolution stale; re-fire on next blur OR on Save. A tech-only resolution (no repo) always re-resolves when repo is later added.
8. Endpoint lives in discovery-service (repo-reading capability already there): `POST /discovery/tech-hints/resolve` with `{freeText, repoUrl?, repoSubfolder?}`. Model-service calls it during save. (NB: gateway adds a thin relay route in front — see API surface.)
9. Discovery run tier gate reads `core_tech_resolved` directly — no more parseCoretech inference at run-time. Deterministic.
10. Discovery run remains blocked when repo is absent — natural invariant ensuring any actual run has seen both inputs at least once.

## Requirements Discussion

### Answered Questions (prior shaping pass)

**Q1 — LLM provider + model:** Reuse existing gateway relay with the same model as gap-fill. No separate fast-model knob.

**Q2 — Latency budget:** < 10 seconds from blur to preview rendered. Same budget applies to Save-click re-resolve.

**Q3 — Repo snapshot shape:** Smallest possible scan that still gives an accurate answer inside the 10-second budget. Starting point: root filename list up to ~30 entries, first ~100 lines of `pom.xml`, `build.gradle(.kts)`, `package.json`, `tsconfig.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `*.csproj`, `CMakeLists.txt`. Optimize for smaller payload where possible.

**Q4 — Repo fetch strategy:** Shallow-clone-to-tmp via existing `GitCloneRepoAccess`. Accuracy over UX speed.

**Q5 — Service editor entry points:** Services grid row is the only UI path. No wizards/imports/other surfaces.

**Q6 — Save-time resolve trigger (critical nuance):**
  - Frontend-driven blur: resolve kicks off in the UI background when user tabs out of core_tech (with both repo fields now preceding it).
  - **Case A — user moves away from the screen before resolution returns:** the resolve still completes in the UI background; the result is held in frontend state ready for backend save. Preview chips render when they arrive.
  - **Case B — user hits Save before resolution returns:** Save is held until the pending resolve settles, then the whole-model PUT fires with the resolved data included. Save button shows a brief pending state.
  - **Net design:** frontend does not emit the whole-model `PUT /api/model?filename=...` while any in-flight resolve promise is unresolved. Architecture-model-service itself does not need pending-state awareness — the frontend enforces this because save is a whole-model PUT driven from the frontend.
  - **Invariant for discovery:** when a discovery run is later kicked off and the service lacks the required resolved details (either unresolved or still stale), discovery refuses to start until the service is corrected.

**Q7 — Confirmation sentence constraints:** Trust LLM judgment. No hard guardrails; the prompt may ask for a concise natural sentence.

**Q8 — Preview chip UX:** Chips are removable with an `x`. Removing a chip puts the resolution into a "manual override" state — save proceeds with the user's reduced chip set, and re-resolve is skipped on next save unless the raw text changes again.

**Q9 — Conflict warning:** **REVISED to warn AND block.** When `repoCrossCheck.status === 'conflict'`, Save is blocked. Inline warning renders under the tech_hints cell. User must re-type tech or fix the repo pointer. `partial` status is not a blocker.

**Q10 — Existing rows migration:** No migration. User will review and fix existing rows manually. New columns default to NULL for existing unresolved rows.

**Q11 — Discovery run behavior when resolved state is null/empty:**
  - If `core_tech_resolved` exists with `languagePack: null` and `frameworkPacks: []` → discovery proceeds as tier C with `confirmLlmSolo: true` required (existing V3 gate behavior). The V3 service is equipped for no language pack or framework pack.
  - If `core_tech_resolved = NULL` entirely (old unmigrated row) → discovery **rejects** the run with a "resolve tech hints before starting discovery" error. User must open the row, trigger resolve, and save first. (This follows from user's stance that existing rows are fixed manually.)

**Q12 — LLM failure fallback:** Save raw `core_tech` with `core_tech_resolved = NULL`; show a toast "resolution failed — will retry when you edit this row again". User must re-edit to retry. No silent background retry.

**Q13 — Unresolved row badge:** Yes. Grid row shows a visual indicator (warning icon / coloured row / "needs resolution" text) when `core_tech_resolved` is NULL or `confidence === 'none'`.

**Q14 — Project-level `discovery_config.techHints`:** Out of scope. Leave the JSONB `techHints` field and its heuristic path untouched. Accepted technical debt.

**Q15 — Other out-of-scope confirmations:**
  - New packs: out of scope. The closed set the LLM sees = the 9 language packs + 17 framework packs already registered in `extensionPackRegistry.ts::getRegisteredPacks()`.
  - Tier logic changes: out of scope beyond "tier gate reads resolved columns instead of `parseCoretech`".
  - `package_set_default_rules` evaluator (which also reads raw `core_tech` string): out of scope; continues to work as-is against raw `core_tech`.

### Existing Code to Reference

User-confirmed templates / reuse targets:

- **Gateway relay pattern:** `gateway/src/services/llmClient.ts` + existing `/api/v1/discovery/v3/gap-fill` route. New relay route is parallel to `discoveryGapFill.ts`.
- **Gateway client (frontend → gateway wrapper):** `gatewayClient.ts`.
- **Repo access:** `discovery-service/src/services/repoAccess.ts` (`GitCloneRepoAccess`) for shallow-clone-to-tmp snapshot pull.
- **Closed-set source of truth:** `discovery-service/src/services/extensionPackRegistry.ts::getRegisteredPacks()`.
- **Custom grid cell with inline preview:** `frontend/src/components/.../PackageSetCell.tsx` — model the new tech-hints cell after this.
- **Grid config:** `frontend/src/config/gridConfigs.ts`, `frontend/src/components/Grid/GridCell.tsx` for column ordering + cell registration.

### Follow-up Questions

None — all prior-pass answers were definitive. Open decisions that the spec-writer must pin down are listed in the "Open Decisions" section below.

## Visual Assets

### Files Provided

No visuals provided — `planning/visuals/` is empty. UX sketches to be produced during `/write-spec` if needed.

### Visual Insights

N/A.

## Requirements Summary

### User Value

Service editors get a fast, accurate, LLM-assisted interpretation of the free-text tech field, cross-checked against the repo at edit time, so that the downstream discovery pipeline receives deterministic, structured language-pack and framework-pack selections instead of guessing via fragile comma-splitting. This eliminates silent tier-C fallbacks caused by unparseable strings like "Java 21 (Spring Boot 3)" and gives the user an immediate, correctable preview of how their service will be analysed.

### In-Scope Behaviour

**Frontend grid UX (`frontend/`):**
- Reorder columns so `repo_location` and `repo_subfolder` come before the tech-hints (`core_tech`) column in the services grid.
- New custom cell for `core_tech` modeled on `PackageSetCell.tsx`:
  - On blur (and on repo-field change), fire a resolve request via gatewayClient.
  - Show pending spinner, then render chips for `language` + each `framework`, plus the `confirmationSentence`.
  - Chips have an `x` for removal; removing flips the row into "manual override" and suppresses re-resolve until raw text changes again.
  - Inline warning area renders `repoCrossCheck.note` when status is `partial` (non-blocking) or `conflict` (blocking).
  - Row-level badge when `core_tech_resolved` is NULL or `confidence === 'none'`.
- Save gating:
  - Whole-model `PUT /api/model?filename=...` is withheld while any resolve promise is in flight (Case B).
  - If any row has `repoCrossCheck.status === 'conflict'`, Save button is disabled with inline explanation.
  - On LLM failure: save still succeeds with raw `core_tech` and `core_tech_resolved = NULL`; toast surfaces the failure.

**Gateway relay (`gateway/`):**
- New route `POST /api/v1/discovery/tech-hints/resolve` (parallel to `discoveryGapFill.ts`).
- Thin pass-through to discovery-service; reuses existing LLM provider config (single global OpenAI or Azure OpenAI).
- Uses the same model as gap-fill. No separate fast-model knob.

**Discovery-service resolve endpoint (`discovery-service/`):**
- New endpoint `POST /discovery/tech-hints/resolve` with body `{freeText: string, repoUrl?: string, repoSubfolder?: string}`.
- If `repoUrl` supplied: use `GitCloneRepoAccess` (shallow clone to `os.tmpdir()`) to gather a minimal snapshot:
  - Root filename list, capped at ~30 entries.
  - First ~100 lines each of known manifests: `pom.xml`, `build.gradle`, `build.gradle.kts`, `package.json`, `tsconfig.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `composer.json`, `*.csproj`, `CMakeLists.txt`.
  - Snapshot is capped/truncated aggressively to keep round-trip < 10 s.
- Load closed-set pack list via `extensionPackRegistry.ts::getRegisteredPacks()` and include in LLM prompt.
- LLM returns the shape described in decision #3. Endpoint returns that JSON to caller.
- On clone failure / timeout: fall back to tech-only mode and set `confidence: 'tech-only'` with a warning note.

**Architecture-model-service schema (`architecture-model-service/`):**
- Add 5 new columns to `services` table (see Data Model Changes). `core_tech` remains as-is.
- `EntityMapper`, `ServiceDto`, `ServiceEntity` updated to carry the new fields through the whole-model JSON shape.
- Save flow is unchanged structurally — whole-model `PUT /api/model?filename=...` continues to overwrite; frontend simply sends the resolved fields alongside raw `core_tech`.
- No backend-side pending-state bookkeeping: frontend holds the PUT until resolves settle.

**Discovery run tier gate (`discovery-service/`):**
- Tier gate reads structured columns (`core_tech_language_pack`, `core_tech_framework_packs`) instead of calling `parseCoretech` on raw `core_tech`.
- `parseCoretech` is NOT removed in this spec — `package_set_default_rules` evaluator still uses it against raw `core_tech` (out of scope).
- Deterministic mapping: `languagePack` + `frameworkPacks` → tier A / B / C per existing V3 logic.
- Rejections:
  - `core_tech_resolved = NULL` → reject with "resolve tech hints before starting discovery".
  - `core_tech_resolved` present, `languagePack = null`, `frameworkPacks = []` → allow tier C with existing `confirmLlmSolo: true` gate.
  - Repo absent → existing block remains (decision #10).

### Out of Scope

- Project-level `discovery_config.techHints` field and its heuristic path — left untouched (accepted tech debt).
- Adding new language or framework packs — closed set stays at 9 + 17.
- Tier logic changes beyond "read resolved columns instead of `parseCoretech`".
- `package_set_default_rules` evaluator changes — continues reading raw `core_tech`.
- One-off migration of existing rows — user will fix manually.
- Alternative repo fetch strategies (shallow-clone-to-tmp is the only strategy in scope).
- Per-provider or per-call LLM model knob — single global provider config is reused as-is.
- Other service editor surfaces (wizards, bulk import, CSV) — only the services grid row.
- Silent background retry of failed resolutions — user must re-edit to retry.

### Data Model Changes

New columns on `services` (Liquibase changeset in `architecture-model-service/src/main/resources/db/changelog/`):

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `core_tech` | text | yes (existing) | Unchanged; raw free text. |
| `core_tech_resolved` | jsonb | yes | Full resolver response JSON (language, frameworks, confirmationSentence, repoCrossCheck). NULL = unresolved. |
| `core_tech_language_pack` | text | yes | Denormalized for tier-gate speed. Must match a registered language pack name or be NULL. |
| `core_tech_framework_packs` | text[] | yes | Denormalized array of registered framework pack names. Empty array allowed; NULL means unresolved. |
| `core_tech_resolution_confidence` | text | yes | One of `'high' \| 'low' \| 'none' \| 'tech-only'`. NULL means unresolved. |
| `core_tech_resolved_at` | timestamp with time zone | yes | Set when resolve persists; staleness computed by frontend comparing edited raw text / repo fields against last-resolved value. |

Existing rows: all new columns default to NULL. No data migration.

### API Surface

**Gateway → discovery-service relay**
- `POST /api/v1/discovery/tech-hints/resolve`
- Implementation: parallel to `gateway/src/routes/discoveryGapFill.ts`.
- Request body: `{ freeText: string, repoUrl?: string, repoSubfolder?: string }`
- Response: passed through from discovery-service.

**Discovery-service resolve endpoint**
- `POST /discovery/tech-hints/resolve`
- Request body: `{ freeText: string, repoUrl?: string, repoSubfolder?: string }`
- Response body (decision #3):
  ```
  {
    language: { name: string, version: string } | null,
    frameworks: Array<{ name: string, version: string }>,
    languagePack: string | null,
    frameworkPacks: string[],
    confirmationSentence: string,
    repoCrossCheck: { status: 'confirmed' | 'conflict' | 'partial', note: string } | null,
    confidence: 'high' | 'low' | 'none' | 'tech-only'
  }
  ```
- Error responses:
  - Clone failure / timeout: 200 with `confidence: 'tech-only'` and `repoCrossCheck: { status: 'partial', note: '...' }`.
  - LLM provider failure: 5xx → frontend saves raw with NULL resolved fields + toast.

**Architecture-model-service save**
- `PUT /api/model?filename=...` unchanged. Whole-model payload now carries the five new service fields.

### UX Flow Walkthrough

1. **Column reorder.** User opens services grid. Columns appear in order: `... application_component_id, name, description, service_type, repo_location, repo_subfolder, core_tech, ...`.
2. **Edit repo fields first.** User fills `repo_location` and `repo_subfolder`.
3. **Edit tech_hints.** User types into `core_tech` (e.g., "Java 21 (Spring Boot 3)") and tabs out.
4. **Blur fires resolve.** Cell goes into pending state. Request to `POST /api/v1/discovery/tech-hints/resolve` with both repo fields.
5. **Preview renders.** Chips: `[Java 21 x]` `[Spring Boot 3 x]`. Confirmation sentence below: "Detected Java 21 service using Spring Boot 3, matched against repo's pom.xml." `repoCrossCheck.status: 'confirmed'`.
6. **Chip removal (optional).** User clicks `x` on Spring Boot 3 chip → row enters manual-override state; re-resolve is suppressed until raw text changes again.
7. **Repo edit invalidates.** If user later changes `repo_location`, the row's resolution is marked stale and re-fires on next blur or Save.
8. **Case A (navigate away before resolve returns).** Resolve promise continues in background; result is stashed in frontend state. Chips render when available.
9. **Case B (Save before resolve returns).** Save button enters a brief pending state. Frontend withholds `PUT /api/model?...` until all in-flight resolves settle, then sends the full payload including resolved fields.
10. **Conflict path (blocks save).** If `repoCrossCheck.status === 'conflict'`, inline warning renders under the tech_hints cell and Save is disabled until user re-types tech or fixes the repo pointer.
11. **LLM failure path.** Toast: "resolution failed — will retry when you edit this row again." Save still succeeds with raw `core_tech` and NULL resolved fields.
12. **Row badge.** Any row with `core_tech_resolved = NULL` or `confidence === 'none'` shows a "needs resolution" badge in the grid.
13. **Discovery run start.** Tier gate reads `core_tech_language_pack` / `core_tech_framework_packs`. Rejects run if `core_tech_resolved = NULL`. Otherwise maps to tier A/B/C deterministically; tier C requires existing `confirmLlmSolo: true` gate.

### Migration Strategy

No migration. New columns are nullable and default to NULL. Existing rows will appear with the "needs resolution" badge; user opens and resaves each row to backfill. Discovery runs against unmigrated rows are rejected with the explicit error surfaced above.

### Failure Modes

| Failure | Behaviour |
|---|---|
| LLM provider error (5xx, timeout) | Frontend saves raw `core_tech` + `core_tech_resolved = NULL`; toast. User re-edits to retry. |
| Shallow clone timeout / auth failure | Endpoint returns 200 with `confidence: 'tech-only'` + `repoCrossCheck: { status: 'partial', note: '<reason>' }`. Save allowed. |
| `repoCrossCheck.status === 'conflict'` | Save blocked; inline warning. User must re-type tech or fix repo pointer. |
| `repoCrossCheck.status === 'partial'` | Non-blocking warning only. |
| `languagePack: null` + `frameworkPacks: []` (resolved but unmatched) | Save allowed. Discovery runs as tier C with existing `confirmLlmSolo: true` gate. |
| `core_tech_resolved = NULL` (unmigrated) | Save allowed. Discovery rejects the run with "resolve tech hints before starting discovery". |
| Chip removal (manual override) | Row saves with reduced chip set; re-resolve is suppressed until raw text changes again. |

### Discovery Run Integration

- Tier gate code-path switches from `parseCoretech(core_tech)` to reading `core_tech_language_pack` + `core_tech_framework_packs`.
- Explicit rejection when `core_tech_resolved IS NULL` — no heuristic fallback.
- Tier C path (`languagePack=null`, `frameworkPacks=[]`) keeps existing `confirmLlmSolo: true` requirement.
- Repo-absent block (decision #10) unchanged.
- `package_set_default_rules` evaluator continues to read raw `core_tech` — out of scope for this spec, accepted divergence.

### Reusability Opportunities

- **New gateway route** mirrors `gateway/src/routes/discoveryGapFill.ts` structurally.
- **LLM relay client** reuses `gateway/src/services/llmClient.ts` with its single global provider config.
- **Repo snapshot** reuses `GitCloneRepoAccess` from `discovery-service/src/services/repoAccess.ts`.
- **Closed pack list** from `discovery-service/src/services/extensionPackRegistry.ts::getRegisteredPacks()`.
- **Custom grid cell** modeled on `frontend/src/components/.../PackageSetCell.tsx`.
- **gatewayClient** in frontend for the new resolve call.

### Scope Boundaries

**In Scope**
- Services grid column reorder + new custom tech-hints cell with inline preview, chip removal, staleness, badges.
- New gateway relay route + new discovery-service resolve endpoint.
- New columns on `services` table + DTO/entity/mapper plumbing.
- Discovery tier gate reads resolved columns.
- Frontend save gating on in-flight resolve + on conflict status.

**Out of Scope** (full list under "Out of Scope" above)
- `discovery_config.techHints`, new packs, broader tier logic, `package_set_default_rules`, row migration, alternative fetch strategies, per-provider LLM knobs, other editor surfaces, silent retry.

### Technical Considerations

- 10-second budget is tight with clone-to-tmp: snapshot must be aggressively capped (filename list + first ~100 lines of known manifests only).
- Frontend must serialize concurrent resolves per row to avoid stale writes (debounce + abort prior in-flight).
- Whole-model PUT semantics: since the backend sees the whole model, the frontend is the only enforcement point for "don't save while resolves in flight". This is accepted.
- `parseCoretech` remains in the codebase — do not remove; `package_set_default_rules` still depends on it.
- Closed-set name stability: if a pack is renamed in `extensionPackRegistry`, existing rows with the old pack name in `core_tech_language_pack` may become orphaned. Not addressed in this spec.

## Open Decisions

These items were not definitively pinned in the prior shaping pass and should be resolved during `/write-spec`:

1. **Exact LLM prompt wording** — user said "trust LLM judgment" for the confirmation sentence, but the full system+user prompt template (including how the closed pack list is presented) is not yet drafted.
2. **Exact `core_tech_resolution_confidence` taxonomy** — raw-idea decision #3 lists `'high' | 'low' | 'none' | 'tech-only'`; the user context reconfirms `'tech-only'` is allowed. Spec-writer should confirm whether `'medium'` or similar is ever needed, or lock the 4-value enum.
3. **Re-resolve mandatoriness on `repo_location` edit** — decision #7 says editing repo fields marks resolution stale. Spec-writer should confirm whether the blur of a repo field *itself* re-fires resolve immediately, or whether staleness is only consumed on the next `core_tech` blur / Save.
4. **Badge visual treatment** — user confirmed the row shows an indicator, but style (icon vs coloured row vs text vs combo) is not fixed.
5. **Debounce / cancellation policy** — if a user rapidly re-edits `core_tech` while a resolve is in flight, spec should state whether the prior request is aborted, ignored on return, or allowed to complete and overwrite.
6. **Snapshot truncation precision** — "first ~100 lines" and "~30 filenames" are soft targets. Spec-writer should lock exact caps and document behaviour when manifests exceed them (truncate vs summarize).
7. **Frontend storage of in-flight resolve state** — whether it lives in the existing grid state store or a new dedicated slice is an implementation call the spec can pin.
8. **Error taxonomy distinction** — clone-timeout vs LLM-timeout vs LLM-malformed-response all collapse to "save raw + toast" today; spec may want to split these for telemetry.
9. **Concurrent-row resolves** — if user edits several rows in quick succession before Save, should Save wait for all in-flight resolves, or only the row being saved? (The answer is almost certainly "all", given whole-model PUT, but spec should state it.)

## Affected Files / Services

Concrete starting points for `/write-spec` to read:

**Frontend (`frontend/`)**
- `frontend/src/config/gridConfigs.ts` — column ordering for services grid.
- `frontend/src/components/Grid/GridCell.tsx` — cell registration.
- `frontend/src/components/.../PackageSetCell.tsx` — template for the new tech-hints cell.
- `frontend/src/services/gatewayClient.ts` (or equivalent) — add `resolveTechHints(...)` wrapper.

**Gateway (`gateway/`)**
- `gateway/src/routes/discoveryGapFill.ts` — structural template for the new relay route.
- `gateway/src/services/llmClient.ts` — reuse as-is.
- Gateway router index — register `POST /api/v1/discovery/tech-hints/resolve`.

**Discovery-service (`discovery-service/`)**
- `discovery-service/src/services/repoAccess.ts` — `GitCloneRepoAccess` for snapshot pull.
- `discovery-service/src/services/extensionPackRegistry.ts` — closed-set source via `getRegisteredPacks()`.
- Existing tier-gate code (V3 path) — switch from `parseCoretech` consumption to resolved-column consumption.
- New: `discovery-service/src/routes/techHintsResolve.ts` (or equivalent) + service module for prompt assembly.

**Architecture-model-service (`architecture-model-service/`)**
- `src/main/resources/db/changelog/db.changelog-master.yaml` — register new changeset.
- `src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java` — add fields.
- `src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java` — add fields.
- `src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` — map new fields.
- Discovery-run controller / service that consumes `parseCoretech` today — switch to reading resolved columns (identify via the `DiscoveryRunService` / tier-gate path).
