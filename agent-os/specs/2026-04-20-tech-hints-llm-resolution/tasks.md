# Task Breakdown: Tech Hints LLM Resolution

## Overview
Total Tasks: 7 groups / 54 sub-tasks

Strict dependency order — each group below is sized so 1–2 adjacent groups can be batched safely into a single implementer call when dependencies permit.

## Task List

### Data Model Layer (architecture-model-service)

#### Task Group 1: Schema + Entity + DTO + Save Flow
**Dependencies:** None

- [x] 1.0 Complete architecture-model-service schema and persistence plumbing
  - [x] 1.1 Write 2–8 focused tests for the five new `services` columns
    - Add `EntityMapper` round-trip test: all 5 new fields (populated + null) round-trip unchanged between `ServiceEntity` and `ServiceDto`.
    - Add `ServiceDto` serialisation test: `coreTechResolved` jsonb map preserved as nested JSON object, `coreTechFrameworkPacks` preserved as JSON array.
    - Add a `ServiceCoreTechPersistenceTest` integration test covering save → reload of a service with all 5 fields populated (high confidence + resolved map) and a second case with all 5 fields NULL.
    - Skip exhaustive CHECK-constraint permutations; the 5-value check is verified implicitly via one invalid-value negative test.
  - [x] 1.2 Create Liquibase changeset `2026-04-20-tech-hints-resolved.sql`
    - Location: `architecture-model-service/src/main/resources/db/changelog/sql/2026-04-20-tech-hints-resolved.sql`.
    - Add columns: `core_tech_resolved JSONB`, `core_tech_language_pack VARCHAR(100)`, `core_tech_framework_packs TEXT[]`, `core_tech_resolution_confidence VARCHAR(20)` with 5-value CHECK (`'high','low','none','tech-only','manual-override'`), `core_tech_resolved_at TIMESTAMPTZ`. All nullable.
    - Include `--rollback` statements dropping the 5 columns.
  - [x] 1.3 Register changeset in `db.changelog-master.yaml`
    - Insert entry after the most recent service-related changeset.
  - [x] 1.4 Extend `ServiceEntity.java` with 5 new fields
    - `Map<String,Object> coreTechResolved` with `@Type(JsonBinaryType.class)` (match existing jsonb pattern in this entity or sibling entities).
    - `String coreTechLanguagePack` (length 100).
    - `List<String> coreTechFrameworkPacks` with `@Type(ListArrayType.class)` (`text[]`).
    - `String coreTechResolutionConfidence` (length 20).
    - `Instant coreTechResolvedAt`.
    - Lombok getters/setters match the style already used in `ServiceEntity`.
  - [x] 1.5 Extend `ServiceDto.java` with mirrored camelCase fields
    - Field names: `coreTechResolved`, `coreTechLanguagePack`, `coreTechFrameworkPacks`, `coreTechResolutionConfidence`, `coreTechResolvedAt`.
    - Match Jackson serialisation conventions of existing DTO fields in this class.
  - [x] 1.6 Update `EntityMapper.java` for bidirectional mapping
    - Add `toDto` assignments for the 5 new fields (pass jsonb map through unchanged).
    - Add `toEntity` assignments for the same 5 fields.
    - Ensure NULL values round-trip unchanged.
  - [x] 1.7 Confirm whole-model PUT flow accepts + persists new fields
    - Trace the existing `PUT /api/model?filename=...` controller/service → save path.
    - Verify that no explicit allow-list restricts which `ServiceDto` fields get mapped; if one exists, extend it to include the 5 new fields.
    - No new endpoint is introduced — the existing save pipeline must simply carry the new fields through to the DB.
  - [x] 1.8 Ensure data model layer tests pass
    - Run ONLY the 2–8 tests written in 1.1.
    - Verify Liquibase changeset applies on a Spring Boot test context.
    - Do NOT run the entire application test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 1.1 pass.
- Liquibase changeset applies cleanly against an existing DB (verified via Spring Boot integration test).
- `ServiceEntity`, `ServiceDto`, `EntityMapper` all carry the 5 new fields bidirectionally.
- Whole-model PUT round-trips the 5 new fields to/from the DB without loss.
- Existing tests for `ServiceEntity` / `EntityMapper` / save flow continue to pass (verified via the touched tests only, not the full suite).

---

### Resolve Pipeline (discovery-service + gateway)

#### Task Group 2: Discovery-Service Resolve Endpoint + LLM Classifier
**Dependencies:** None (parallel with Group 1). Group 3 depends on this.

- [x] 2.0 Complete discovery-service resolve endpoint and supporting services
  - [x] 2.1 Write 2–8 focused tests for `techHintsResolver` + route
    - Happy path tech-only: no repo fields → `confidence: 'tech-only'`, `repoCrossCheck: null`, `languagePack` + `frameworkPacks` drawn from `getRegisteredPacks()`.
    - Happy path tech + repo: `GitCloneRepoAccess` mocked to return a tmp path with a small `pom.xml` → snapshot included in prompt, `repoCrossCheck.status: 'confirmed'`.
    - Clone non-timeout failure (e.g., auth error): 200 response with `confidence: 'tech-only'`, `repoCrossCheck.status: 'partial'`, structured log line `reason: 'network_error'`.
    - LLM malformed JSON (e.g., returns a pack name not in registry, or missing required keys): 502 with `reason: 'llm_malformed'`.
    - LLM timeout: 502 with `reason: 'llm_timeout'`.
    - Snapshot cap test: stub a repo with >30 files + a >100-line manifest → assert the prompt contains exactly 30 filenames and the manifest is truncated at 100 lines with the `... [truncated]` marker.
    - Skip: exhaustive permutations of every manifest type; exhaustive payload-size edge cases beyond the one cap test.
  - [x] 2.2 Create `discovery-service/src/services/techHintsResolver.ts`
    - Export `resolveTechHints({ freeText, repoLocation, repoSubfolder })` returning the `TechHintResolution` shape from the spec.
    - Internal helpers: `buildSnapshot(tmpPath)` applying the spec caps (30 filenames alphabetical; 8 manifests max; 100 lines/manifest; total ~8 KB; recognised manifests per spec list; drop largest manifests when over total cap; append `... [truncated]` marker).
    - Internal helper: `buildPrompt(freeText, snapshot, registeredPacks)` — system prompt lists 9 language packs + 17 framework packs as `- <packId> (predicate: language|technology)` bullets, explicit "choose only from the given lists" instruction, two few-shot examples (tech-only, repo-enriched). User turn carries `freeText` and the snapshot block clearly delimited; reiterates output schema at end.
    - Schema guard (zod or equivalent) on LLM response: reject if `languagePack` is not in the registered set or any `frameworkPacks` element is not in the registered set.
    - Error taxonomy: emit structured log lines with `reason: 'clone_timeout' | 'llm_timeout' | 'llm_malformed' | 'network_error'` at the single failure path per error.
    - Cleanup: tmp clone directory removed in a `finally` block (success or failure).
  - [x] 2.3 Create `discovery-service/src/routes/techHintsResolve.ts`
    - `POST /discovery/tech-hints/resolve` registered on the existing Express app.
    - Request validation: `freeText` required non-empty; `repoLocation` + `repoSubfolder` optional strings.
    - Status codes per spec: 400 validation, 502 for LLM errors (with `reason`), 504 for clone timeout (with `reason`), 200 otherwise.
    - Register route in the discovery-service router index next to existing discovery routes.
  - [x] 2.4 Wire `GitCloneRepoAccess.shallowClone` for snapshot acquisition
    - Use `os.tmpdir()` for the clone destination.
    - Respect shallow-clone timeout; on timeout return 504 `reason: 'clone_timeout'`.
    - On non-timeout failure (auth, network), fall back to tech-only mode with `confidence: 'tech-only'` + `repoCrossCheck.status: 'partial'` and `note: '<reason>'` (200 response).
  - [x] 2.5 Wire closed pack set from `extensionPackRegistry.getRegisteredPacks()`
    - Import directly; no caching layer needed.
    - Use pack IDs + predicates verbatim in the prompt bullet list.
  - [x] 2.6 Ensure resolve pipeline tests pass
    - Run ONLY the 2–8 tests written in 2.1.
    - Verify structured log lines are emitted on failure paths (snapshot the log output in one test).
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 2.1 pass.
- `POST /discovery/tech-hints/resolve` returns the `TechHintResolution` shape per spec for valid input.
- Snapshot caps (30 files / 100 lines / 8 manifests / ~8 KB) are enforced with truncation markers.
- Error taxonomy log lines (`clone_timeout`, `llm_timeout`, `llm_malformed`, `network_error`) are emitted from the single failure path.
- Schema guard rejects LLM responses that reference packs outside the registered set.

#### Task Group 3: Gateway Relay Route
**Dependencies:** Task Group 2

- [x] 3.0 Complete gateway relay for tech-hints resolve
  - [x] 3.1 Write 2–8 focused tests for the relay route
    - Happy path pass-through: downstream 200 → gateway 200 with body unchanged.
    - Downstream 502 with `reason` body → gateway 502, `reason` preserved.
    - Downstream 504 → gateway 504.
    - Malformed request body (missing `freeText`) → 400.
    - Downstream unreachable (network error) → 502.
    - Skip: exhaustive permutations of every discovery-service error code.
  - [x] 3.2 Create `gateway/src/routes/techHintsResolve.ts`
    - Parallel structure to `gateway/src/routes/discoveryGapFill.ts`.
    - `POST /api/v1/discovery/tech-hints/resolve`.
    - Body forwarded as-is: `{ freeText, repoLocation?, repoSubfolder? }`.
    - Response passed through unchanged.
    - Error translation mirroring `discoveryGapFill.ts`: 502 if downstream unreachable, 504 on downstream timeout, passes through 4xx/5xx bodies otherwise.
    - Reuses `gateway/src/services/llmClient.ts` transport pattern (no new client; same single global provider config as gap-fill).
  - [x] 3.3 Register route in gateway router index
    - Insert registration alongside existing discovery routes.
  - [x] 3.4 Ensure gateway relay tests pass
    - Run ONLY the 2–8 tests written in 3.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 3.1 pass.
- Route is registered at `POST /api/v1/discovery/tech-hints/resolve`.
- Relay passes through success + error responses from discovery-service unchanged (including `reason` body).
- Uses the same LLM provider config as the gap-fill route (no separate fast-model knob).

---

### Discovery Run Tier Gate

#### Task Group 4: Switch Tier Gate from parseCoretech to Resolved Columns
**Dependencies:** Task Group 1 (needs the new columns to read)

- [x] 4.0 Replace `parseCoretech` call in service-scoped tier gate with resolved-column reads
  - [x] 4.1 Write 2–8 focused tier-gate matrix tests (`discovery-service/src/__tests__/discoveryV3Pipeline.techHints.test.ts`)
    - `coreTechResolved IS NULL` → rejects with HTTP 409 + code `TECH_HINTS_UNRESOLVED` + message "Resolve tech hints before starting discovery."
    - `coreTechResolved` present, `languagePack IS NULL` + `frameworkPacks = []` → tier C selected; `confirmLlmSolo: true` gate still applies.
    - `languagePack` non-null (e.g., `'java-21'`) + `frameworkPacks = ['spring-boot-3']` → tier A/B selected per existing V3 logic, reading columns directly (no hint-array reconstruction).
    - Repo absent (`repo_location` NULL or empty) → existing block still applies regardless of resolved state.
    - Skip: exhaustive permutations of every tier A/B sub-rule — existing tests cover those.
  - [x] 4.2 Trace the current call site(s) in `discoveryV3Pipeline.ts` / `runManager` / `runsRouter`
    - Identify where `parseCoretech(coreTech)` is invoked on the service-scoped path.
    - Note: `package_set_default_rules` evaluator is a SEPARATE caller — it stays untouched.
  - [x] 4.3 Replace the service-scoped `parseCoretech` call with resolved-column reads
    - Read `ServiceEntity.coreTechResolved`, `coreTechLanguagePack`, `coreTechFrameworkPacks` directly.
    - Implement the three-way matrix per spec:
      - `coreTechResolved IS NULL` → 409 `TECH_HINTS_UNRESOLVED`.
      - `coreTechResolved` present + `languagePack IS NULL` + `frameworkPacks = []` → tier C with `confirmLlmSolo: true` gate.
      - `languagePack` non-null → tier A/B per existing V3 logic, reading the two denormalised columns.
    - Preserve the existing repo-absent rejection path.
  - [x] 4.4 Keep `parseCoretech` in-repo but unused on the service-scoped path
    - Do NOT delete `parseCoretech` — `package_set_default_rules` evaluator still consumes it against raw `core_tech`.
    - Verify via grep that no other service-scoped caller remains after the switch.
  - [x] 4.5 Ensure tier-gate tests pass
    - Run ONLY the 2–8 tests written in 4.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 4.1 pass.
- Service-scoped tier gate no longer calls `parseCoretech`.
- `parseCoretech` remains available for `package_set_default_rules` (verified by grep).
- 409 `TECH_HINTS_UNRESOLVED` is emitted with the user-directing message when `coreTechResolved IS NULL`.
- Tier A/B/C selection is deterministic from the two denormalised columns.

---

### Frontend

#### Task Group 5: Grid Column Reorder + TechHintsCell
**Dependencies:** Task Group 3 (needs gateway relay to exist for the cell to call)

- [x] 5.0 Complete grid field reorder + TechHintsCell component
  - [x] 5.1 Write 2–8 focused tests for `TechHintsCell` (`frontend/src/components/Grid/__tests__/TechHintsCell.test.tsx`)
    - Blur triggers resolve after 250 ms debounce; earlier keystrokes within the debounce window don't fire.
    - Rapid re-edit cancels in-flight resolve via `AbortController` (verify `abort()` is called on the old controller).
    - Chip removal sets `confidence: 'manual-override'` in the row state and suppresses re-resolve on a subsequent blur if raw text is unchanged.
    - `repoCrossCheck.status === 'conflict'` renders red warning strip and marks row as Save-blocking.
    - `repoCrossCheck.status === 'partial'` renders amber warning strip but does NOT mark row as Save-blocking.
    - Unresolved-row state (resolved NULL OR `confidence === 'none'`) renders the amber warning icon in the row indicator column.
    - Skip: exhaustive chip-style permutations, full accessibility audit.
  - [x] 5.2 Reorder columns in `frontend/src/config/gridConfigs.ts`
    - Services grid: `repo_location` and `repo_subfolder` precede `core_tech`.
    - Target order near tech columns: `... name, description, service_type, repo_location, repo_subfolder, core_tech, ...`.
    - Tab order follows column order (left-to-right).
  - [x] 5.3 Create `frontend/src/components/Grid/TechHintsCell.tsx`
    - Model on `PackageSetCell.tsx` + `PackageSetPreview.tsx` (editable text input + inline preview container).
    - Props/state: raw `core_tech` text, resolved state, pending state, conflict state.
    - Pending state: lightweight inline spinner inside the cell.
    - Chips: language chip styled distinct from framework chips; each has an `x` remove affordance.
    - Confirmation sentence: single line, italic, muted, directly below chips.
    - Warning strip below cell: amber for `partial`, red for `conflict`.
    - Stale indicator: chips render greyed when `core_tech` or `repo_location`/`repo_subfolder` has been edited since `core_tech_resolved_at`.
    - Unresolved-row badge in the first (row indicator) cell with hover tooltip "Tech hints not resolved — edit core_tech to retry."
  - [x] 5.4 Create `frontend/src/components/Grid/TechHintsCell.module.css`
    - Follow module CSS naming + layout conventions of `PackageSetCell.module.css`.
  - [x] 5.5 Register cell in `frontend/src/components/Grid/GridCell.tsx`
    - Register `TechHintsCell` for the `core_tech` column only — no other columns change cell rendering.
  - [x] 5.6 Add `resolveTechHints` to `frontend/src/services/gatewayClient.ts`
    - Signature: `resolveTechHints({ freeText, repoLocation, repoSubfolder }, signal?: AbortSignal)`.
    - Posts to `/api/v1/discovery/tech-hints/resolve`.
    - Passes `AbortSignal` through to fetch.
  - [x] 5.7 Wire chip-removal → manual-override confidence
    - Removing the language chip nulls `languagePack`; removing a framework chip removes from `frameworkPacks`.
    - Either removal sets `confidence: 'manual-override'`.
    - Suppress re-resolve on next blur unless the raw text changes.
  - [x] 5.8 Ensure UI cell tests pass
    - Run ONLY the 2–8 tests written in 5.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 5.1 pass.
- `repo_location` + `repo_subfolder` render before `core_tech` in the services grid.
- `TechHintsCell` renders chips + confirmation sentence + warning strip correctly for all three `repoCrossCheck` statuses.
- Chip removal flips the row into `manual-override` and suppresses re-resolve on unchanged text.
- Amber warning icon appears on unresolved rows in the row indicator cell.

#### Task Group 6: Pending-Resolutions Store + Save Gating
**Dependencies:** Task Group 3 (needs the relay route); can run in parallel with Task Group 5

- [x] 6.0 Complete pending-resolutions slice + Save button integration
  - [x] 6.1 Write 2–8 focused tests for `pendingResolutionsStore` + Save gating
    - Slice correctly stores `{ promise, abort, startedAt }` keyed by service row ID.
    - Starting a new resolve for a row with an in-flight entry calls `abort()` on the old controller and replaces the entry.
    - Save click while slice is non-empty triggers `Promise.allSettled(pending)` and holds PUT until settled.
    - Save button label flips to `"Resolving N rows..."` (with correct N) while awaiting settlement.
    - Save is DISABLED (not just delayed) while any dirty row has `repoCrossCheck.status === 'conflict'`; tooltip "Resolve conflicts before saving".
    - Individual resolve rejection → row saves with NULL resolved fields + toast; Save proceeds for the rest.
    - Stale rows (edited since last resolve, no in-flight promise) trigger an implicit resolve on Save click.
    - Skip: exhaustive store-API permutations.
  - [x] 6.2 Create `frontend/src/stores/pendingResolutionsStore.ts`
    - Zustand slice keyed by service row ID.
    - Entry shape: `{ promise: Promise<TechHintResolution>, abort: AbortController, startedAt: number }`.
    - Actions: `start(rowId, promise, controller)`, `settle(rowId)`, `cancel(rowId)`, `cancelAll()`.
    - Selector: `pendingCount`, `hasPending(rowId)`.
  - [x] 6.3 Integrate TechHintsCell blur handler with the slice
    - On blur: create `AbortController`, call `gatewayClient.resolveTechHints(..., controller.signal)`, register in slice, settle on completion (success or reject).
    - Re-edit within debounce window: abort prior + replace slice entry.
  - [x] 6.4 Integrate Save button with the slice
    - Read `pendingCount` + `hasConflict` from slice/grid state.
    - If `hasConflict`: disable Save, show inline block + tooltip.
    - Else if `pendingCount > 0`: label `"Resolving N rows..."`, await `Promise.allSettled(pending)` before firing PUT.
    - Stale rows without in-flight promise: fire an implicit resolve on Save click and add to slice.
    - On any row resolve rejection: row saves with NULL resolved fields (fall-through to toast path), Save continues for the rest.
  - [x] 6.5 Ensure pending-resolutions + Save gating tests pass
    - Run ONLY the 2–8 tests written in 6.1.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- The 2–8 tests written in 6.1 pass.
- Whole-model PUT is withheld while any resolve is in-flight.
- Save button label reflects pending count in real time.
- Conflict state disables Save unambiguously with tooltip.
- Per-row resolve rejection degrades gracefully (toast + NULL resolved fields) without blocking other rows' Save.

---

### Integration Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1–6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1–6
    - Review 2–8 tests from Group 1 (data model).
    - Review 2–8 tests from Group 2 (resolver + route).
    - Review 2–8 tests from Group 3 (gateway relay).
    - Review 2–8 tests from Group 4 (tier gate).
    - Review 2–8 tests from Group 5 (TechHintsCell).
    - Review 2–8 tests from Group 6 (pending store + Save gating).
    - Total existing tests: approximately 12–48 tests.
  - [x] 7.2 Analyse test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage:
      - Frontend → gateway → discovery-service → LLM → response → grid render (full happy path integration).
      - Save-waits-for-resolve end-to-end: user types core_tech, clicks Save before resolve returns, PUT is held, completes with resolved fields.
      - Tier gate rejects a run against an unresolved row with the exact 409 `TECH_HINTS_UNRESOLVED` code.
      - Chip-removal → save → reload → chip state preserved as `manual-override`.
    - Focus ONLY on gaps related to this spec's feature requirements.
    - Do NOT assess entire application test coverage.
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Add a frontend integration test (`frontend/src/__tests__/saveWaitsForResolve.test.tsx`) covering Case B: Save held until `Promise.allSettled` completes, label shows `"Resolving N rows..."`, individual rejection falls through to toast path but Save proceeds.
    - Add a frontend integration test for chip removal → manual-override confidence round-trip via PUT (assert the PUT body carries `coreTechResolutionConfidence: 'manual-override'`).
    - Add a gateway → discovery-service contract test if not already covered in Group 3 (request body schema round-trips, `reason` preserved through error responses).
    - Add a discovery-service tier-gate integration test covering a real service with `coreTechResolved IS NULL` → 409 `TECH_HINTS_UNRESOLVED`.
    - Stop at 10 new tests total.
    - Skip: performance tests, accessibility audits, edge cases not tied to a user workflow.
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3).
    - Expected total: approximately 22–58 tests.
    - Do NOT run the entire application test suite.
    - Verify all critical workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22–58 tests total).
- Critical end-to-end workflows covered: resolve happy path, save-waits-for-resolve, tier-gate 409, chip removal round-trip.
- No more than 10 additional tests added when filling in testing gaps.
- Testing focused exclusively on this spec's feature requirements.

---

## Execution Order

Recommended implementation sequence (strict dependency order; safe batching noted):

1. **Task Group 1** — Data model layer (architecture-model-service schema + entity + DTO + save flow). Standalone.
2. **Task Group 2** — Discovery-service resolve endpoint + LLM classifier. Independent of Group 1; can be implemented in parallel if two engineers. Solo implementer: run sequentially after Group 1 or interleave.
3. **Task Group 3** — Gateway relay route. Depends on Group 2. **Safe to batch Groups 2 + 3 into one implementer call** since they're tightly coupled.
4. **Task Group 4** — Discovery run tier gate switch. Depends on Group 1 (needs the new columns). Can be done any time after Group 1; natural to do after Groups 2 + 3 so the full save→run→read path exists end-to-end.
5. **Task Group 5** — Frontend grid column reorder + TechHintsCell. Depends on Group 3 (needs relay to call).
6. **Task Group 6** — Pending-resolutions store + Save gating. Depends on Group 3. Can run in parallel with Group 5 or be batched with Group 5 in one implementer call (shared frontend surface area).
7. **Task Group 7** — Test review + gap analysis. Depends on Groups 1–6. Final pass.

**Batching hints for implementer:**
- Batch Groups 2 + 3 together (coupled relay).
- Batch Groups 5 + 6 together (shared frontend store + component wiring).
- Groups 1, 4, and 7 are each standalone enough to run in a dedicated call.
