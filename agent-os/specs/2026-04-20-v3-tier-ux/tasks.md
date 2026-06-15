# Task Breakdown: V3 Tier UX

## Overview
Total Task Groups: 7
Total Tasks: Approximately 50 sub-tasks across Java (architecture-model-service), TypeScript (discovery-service), and React (frontend) codebases, plus documentation.

Surfaces the V3 discovery pipeline's tier model (A/B/C) through the discovery-service API and review UI. Adds a Tier C gate (`confirmLlmSolo` opt-in + 409), persists tier/warnings/confirmed-llm-solo on the `discovery_run` table, centralizes per-tag confidence midpoints, and wires a confidence filter + tier badges into the review UI.

## Task List

### Java / Architecture-Model-Service

#### Task Group 1: Schema Migrations + DiscoveryRun Plumbing (confirmed_llm_solo, warnings, derived tier)
**Dependencies:** None (foundational — unlocks DTO shape for downstream groups)

- [x] 1.0 Complete Java schema + DiscoveryRun plumbing
  - [x] 1.1 Write 2-8 focused tests for the new fields
    - Test `DiscoveryRunEntity` round-trips `confirmedLlmSolo` (default FALSE) and `warnings` (raw JSON TEXT, nullable).
    - Test `DiscoveryRunDto` serialization: `warnings` deserializes from JSON text to `List<String>`; `tier` is derived as `'A'|'B'|'C'` from the existing `mode` column.
    - Test `DiscoveryRunService.createRun` accepts and persists `confirmedLlmSolo` + `warnings` + `mode`.
    - Test `DiscoveryRunService.updateRun` accepts both new fields (proceed-after-gate flow).
    - Limit to 2-8 highly focused tests total. Skip exhaustive coverage of every getter/setter.
  - [x] 1.2 Create Liquibase migration `084-discovery-run-confirmed-llm-solo.sql`
    - SQL: `ALTER TABLE discovery_run ADD COLUMN confirmed_llm_solo BOOLEAN NOT NULL DEFAULT FALSE;`
    - Follow style and header conventions of `083-discovery-run-mode.sql`.
  - [x] 1.3 Create Liquibase migration `085-discovery-run-warnings.sql`
    - SQL: `ALTER TABLE discovery_run ADD COLUMN warnings TEXT;` (nullable, stores JSON-encoded `string[]`).
    - TEXT (not JSONB) to match existing portability pattern.
  - [x] 1.4 Register `084` and `085` in `db.changelog-master.yaml`
    - Follow the include pattern used for `083-discovery-run-mode.sql`.
  - [x] 1.5 Update `DiscoveryRunEntity.java`
    - Add `private boolean confirmedLlmSolo` (default false) mapped to `confirmed_llm_solo`.
    - Add `private String warnings` (raw JSON text) mapped to `warnings`, nullable.
    - Additive only — no breaking changes to existing fields.
  - [x] 1.6 Update `DiscoveryRunDto.java`
    - Add `confirmedLlmSolo: boolean`.
    - Add `warnings: List<String>` (serialize/deserialize from entity's JSON text; NULL or missing → empty list).
    - Add derived `tier: String` (single char `'A'|'B'|'C'`) — derive from existing `mode` column introduced by `083`.
  - [x] 1.7 Update `EntityMapper` (and any mapstruct/manual mapper used for DiscoveryRun)
    - Map `confirmedLlmSolo` and `warnings` in both directions.
    - Implement `warnings` JSON text ↔ `List<String>` conversion.
    - Derive `tier` from `mode` on DTO output.
  - [x] 1.8 Update `DiscoveryRunService.createRun` + `updateRun`
    - Accept `confirmedLlmSolo` and `warnings` inputs.
    - Persist `mode` (already present from spec 1), `confirmedLlmSolo`, and `warnings`.
    - No re-validation of the Tier C gate — archmodel trusts discovery-service.
  - [x] 1.9 Update `DiscoveryRunController` DTO surfaces
    - `GET /discovery/runs/{runId}`: return `mode`, `tier`, `warnings`, `confirmedLlmSolo`.
    - `GET /discovery/runs` (list): include `mode` + `tier` per entry (warnings excluded from list).
  - [x] 1.10 Ensure Java schema + plumbing tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Verify Liquibase migrations `084` and `085` apply cleanly on a local DB.
    - Do NOT run the entire Java test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- Liquibase `084` and `085` apply cleanly and are reversible.
- Existing `discovery_run` rows keep NULL `warnings` and FALSE `confirmed_llm_solo` (no backfill).
- `DiscoveryRunDto` exposes `mode`, `tier` (derived), `warnings`, `confirmedLlmSolo` additively.
- `GET /discovery/runs/{runId}` returns all four fields; list endpoint returns `mode` + `tier`.

---

### Discovery-Service (TypeScript) — Internals

#### Task Group 2: Centralized Confidence Module
**Dependencies:** None (independent of schema — can run in parallel with Group 3 once Group 1 DTO shape is agreed)

- [x] 2.0 Build centralized confidence module
  - [x] 2.1 Write 2-8 focused tests for `confidence.ts`
    - Test midpoint defaults: `adapter=0.9`, `llm-gap-fill=0.75`, `llm-ir-guided=0.6`, `llm-solo=0.4`.
    - Test env overrides (`CONFIDENCE_ADAPTER`, `CONFIDENCE_LLM_GAP_FILL`, `CONFIDENCE_LLM_IR_GUIDED`, `CONFIDENCE_LLM_SOLO`) take precedence.
    - Test adapter-emitted explicit `confidence` is preserved (not overwritten).
    - Test LLM-emitted `confidence` within tag range is kept; out-of-range clamps to midpoint.
    - Limit to 2-8 tests total.
  - [x] 2.2 Create `discovery-service/src/services/confidence.ts`
    - Export single-source-of-truth map of tag → midpoint.
    - Read env overrides at module init (`CONFIDENCE_<TAG>`).
    - Export helper `assignConfidence(candidate, addedBy, llmEmittedConfidence?)` that:
      - Returns existing `candidate.confidence` if already set (adapter case).
      - Clamps `llmEmittedConfidence` into the tag's valid range if present; falls back to midpoint if out of range.
      - Otherwise returns the tag midpoint.
    - Document tag ranges (e.g., `llm-gap-fill` range 0.7–0.8, `llm-ir-guided` 0.5–0.7, `llm-solo` 0.3–0.5) per raw-idea.
  - [x] 2.3 Ensure confidence module tests pass
    - Run ONLY the 2-8 tests written in 2.1.
    - Do NOT run the full discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- `confidence.ts` is the single source of truth; no other file hard-codes midpoints.
- Env overrides work; defaults match spec values.

---

#### Task Group 3: `runDiscoveryV3` Tier-As-Input Refactor + Candidate Emission Confidence
**Dependencies:** Task Group 2 (uses `confidence.ts`); independent of Task Group 1 once DTO shape is known

- [x] 3.0 Refactor pipeline to accept tier as input and assign confidence at emission
  - [x] 3.1 Write 2-8 focused tests for the pipeline refactor
    - Test `runDiscoveryV3` accepts `tier` input and does NOT re-compute via `computeTier` internally.
    - Test emitted candidates carry the correct confidence per `_addedBy` tag via `confidence.ts`.
    - Test adapter-emitted candidate with existing confidence is NOT overwritten.
    - Test dedup collision: adapter + llm-gap-fill → adapter wins (confidence 0.9, `_addedBy: '<framework>-adapter'`).
    - Limit to 2-8 tests total.
  - [x] 3.2 Refactor `discovery-service/src/services/discoveryV3Pipeline.ts`
    - Change `runDiscoveryV3` signature to accept `tier: 'A'|'B'|'C'` as input.
    - Remove internal call to `computeTier` (route now owns that).
    - Pass tier through to mode selection + prompt variants (no behavioural change for A/B).
  - [x] 3.3 Wire `confidence.ts` into candidate emission
    - At the point where candidates are emitted (adapters, llm-gap-fill, llm-ir-guided, llm-solo paths), call `assignConfidence`.
    - Preserve existing adapter `confidence` values.
    - Do NOT backfill existing candidate rows.
  - [x] 3.4 Preserve existing dedup logic
    - Verify: on adapter + llm-gap-fill collision, adapter wins unchanged.
    - No changes to dedup algorithm itself.
  - [x] 3.5 Ensure pipeline refactor tests pass
    - Run ONLY the 2-8 tests written in 3.1.
    - Do NOT run the full discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- `runDiscoveryV3` no longer re-computes tier internally.
- New candidates carry confidence at emission time per centralized module.
- Existing adapter-emitted confidences are preserved.
- Dedup behaviour unchanged.

---

#### Task Group 4: `POST /discovery/runs` Tier Computation, Gate, and Archmodel Passthrough
**Dependencies:** Task Group 1 (archmodel DTO accepts new fields), Task Group 2 (confidence — needed only by pipeline, not gate, but wave ordering prefers both complete), Task Group 3 (pipeline accepts tier as input)

- [x] 4.0 Build tier gate + archmodel passthrough at the route
  - [x] 4.1 Write 2-8 focused tests for `POST /discovery/runs`
    - Tier A run (project-scoped): no gate, no warnings, `mode='pack-supervised'`, proceeds.
    - Tier B run (service-scoped via `parseCoretech`): no gate, warnings populated with Tier B copy, `mode='language-only'`, proceeds.
    - Tier C run WITHOUT `confirmLlmSolo`: returns 409 with `{ error: { code: 'LLM_SOLO_CONFIRMATION_REQUIRED', tier: 'C', mode: 'llm-solo', warnings } }`. Verify no `archModelClient.createDiscoveryRun` call was made (no orphaned row).
    - Tier C run WITH `confirmLlmSolo: true`: proceeds; archmodel receives `confirmedLlmSolo: true`, `mode='llm-solo'`, `warnings` populated.
    - Limit to 2-8 tests total.
  - [x] 4.2 Update `discovery-service/src/routes/runs.ts` tier synthesis
    - If `serviceId` present: `archModelClient.getService(projectId, serviceId)` → `parseCoretech(service.core_tech)`.
    - Else: `archModelClient.getDiscoveryConfig(projectId)` → use its techHints.
    - Call `computeTier(techHints)` once; store result.
  - [x] 4.3 Build tier → mode + warnings mapping
    - Tier A → `mode='pack-supervised'`, `warnings=[]`.
    - Tier B → `mode='language-only'`, `warnings=[<exact Tier B copy>]`.
    - Tier C → `mode='llm-solo'`, `warnings=[<exact Tier C copy>]`.
    - Use exact strings from spec copy table.
  - [x] 4.4 Enforce Tier C gate before run creation
    - If `tier === 'C'` AND `body.confirmLlmSolo !== true`: return 409 with full error payload BEFORE any archmodel call.
    - Model the response shape after the existing 409 pattern in `runs.ts`.
  - [x] 4.5 Pass tier/mode/warnings/confirmedLlmSolo through to archmodel
    - Update `archModelClient.createDiscoveryRun` (and `updateDiscoveryRun` if used on the proceed-after-gate flow) to accept and forward the new fields.
    - Set `confirmedLlmSolo: true` only when tier C proceeded via opt-in.
    - Pass `tier` to `runDiscoveryV3` (Group 3's refactored signature).
  - [x] 4.6 Enrich `POST /discovery/runs` response body
    - Add `mode`, `tier`, `warnings` to successful-creation response.
    - Additive fields only — existing clients ignoring them continue to work.
  - [x] 4.7 Verify gate applies equally for project-scoped AND service-scoped runs
    - Same flow runs whether techHints came from `getService` or `getDiscoveryConfig`.
  - [x] 4.8 Ensure gate tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Do NOT run the full discovery-service suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- Tier C without `confirmLlmSolo` returns 409 and persists no row.
- Tier C with `confirmLlmSolo` persists `confirmed_llm_solo = TRUE` and populated `warnings`.
- Tier A and B proceed transparently.
- Gate applies equally to both project-scoped and service-scoped paths.

---

#### Task Group 5: Additive Field Surfacing on Other Endpoints
**Dependencies:** Task Group 1 (archmodel DTO), Task Group 4 (tier computation pattern established)

- [x] 5.0 Surface tier/mode/warnings additively on remaining endpoints
  - [x] 5.1 Write 2-8 focused tests for additional endpoint enrichment
    - `GET /discovery/runs/{runId}` (archmodel) returns `mode`, `tier`, `warnings`, `confirmedLlmSolo`.
    - `GET /discovery/runs` list returns `mode` + `tier` per entry (no `warnings` in list).
    - `GET /discovery/packs/applicable` (discovery-service) returns `tier` + `warnings` per the same mapping used at the gate.
    - Limit to 2-8 tests total (cover the three endpoints at minimum).
  - [x] 5.2 Verify / extend `GET /discovery/runs/{runId}` in `DiscoveryRunController`
    - Should already be covered by Task Group 1's DTO changes; confirm and patch if any field is missing from the response mapping.
  - [x] 5.3 Verify / extend `GET /discovery/runs` list endpoint
    - Ensure each entry includes `mode` and `tier`; explicitly omit `warnings` from list output.
  - [x] 5.4 Extend `GET /discovery/packs/applicable` in discovery-service
    - After the existing pack-resolution logic, synthesize `tier` via `computeTier(techHints)` and build `warnings` via the same tier→copy mapping as the gate.
    - Return `tier: 'A'|'B'|'C'` and `warnings: string[]` as additive fields.
  - [x] 5.5 Ensure additional-endpoint tests pass
    - Run ONLY the 2-8 tests written in 5.1.
    - Do NOT run the full suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- `GET /discovery/runs/{runId}` returns all four new fields.
- `GET /discovery/runs` list returns `mode` + `tier`.
- `GET /discovery/packs/applicable` returns `tier` + `warnings`, letting callers preflight before submit.

---

### Frontend (React / TypeScript / Vitest)

#### Task Group 6: Review UI — Warning Banner, Tier Column, Confidence Slider, Badges, 409 Confirm Dialog
**Dependencies:** Task Group 1 (DTO shape frozen) — can start in parallel with Groups 4/5 once DTO is agreed

- [x] 6.0 Wire tier/warnings/confidence into the review UI
  - [x] 6.1 Write 2-8 focused tests for the UI changes
    - `DiscoveryRunDetailView` renders warnings banner for tier B and C, hidden for tier A.
    - Runs list shows `tier` column/badge for each row.
    - `DiscoveryCandidateTable` confidence slider filters below-threshold candidates (default 0.7), and NULL-confidence candidates are ALWAYS visible regardless of threshold.
    - Tier C 409 from `POST /discovery/runs` triggers confirm dialog; on confirm, the same request body retries with `confirmLlmSolo: true`.
    - Limit to 2-8 tests total.
  - [x] 6.2 Audit existing CSS tokens
    - Check `DiscoveryRunDetailView.module.css` and `frontend/src/config/gridConfigs.ts` for success / warning / caution / danger tokens.
    - Map: adapter → success (green), gap-fill → warning (yellow), ir-guided → caution (orange), solo → danger (red).
    - If exactly one token is missing, introduce at most ONE new CSS variable. Do NOT introduce four new colors.
  - [x] 6.3 Add warnings banner to `DiscoveryRunDetailView`
    - Render `warnings[]` verbatim when `tier === 'B' || tier === 'C'`.
    - Hide for Tier A.
  - [x] 6.4 Add tier column to runs-list view
    - Small tier badge per row (A/B/C) so reviewers identify B/C before opening detail.
    - Use the same token mapping as candidate badges where appropriate.
  - [x] 6.5 Add confidence slider filter to `DiscoveryCandidateTable`
    - Range 0.0–1.0, step 0.05, default threshold 0.7.
    - Hide candidates with `confidence < threshold`.
    - Always show candidates with `confidence === null` (unmarked = "unknown", not "below").
  - [x] 6.6 Add tier badge per candidate in `DiscoveryCandidateTable`
    - Badge driven by `_addedBy`:
      - `*-adapter` → success
      - `llm-gap-fill` → warning
      - `llm-ir-guided` → caution
      - `llm-solo` → danger
  - [x] 6.7 Wire 409 `LLM_SOLO_CONFIRMATION_REQUIRED` confirm dialog
    - On POST /discovery/runs 409, show dialog with the `warnings` copy.
    - On confirm: retry the identical request body with `confirmLlmSolo: true` added.
    - On cancel: abort; do not retry.
  - [x] 6.8 Ensure UI tests pass
    - Run ONLY the 2-8 tests written in 6.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass.
- Warnings banner visible only for tier B/C on run detail.
- Runs list shows tier column.
- Confidence slider default 0.7; NULL-confidence candidates always visible.
- Tier badge colors reuse existing CSS tokens (at most one new variable introduced).
- Tier C 409 shows confirm dialog and retries with `confirmLlmSolo: true` on confirm.

---

### Documentation

#### Task Group 7: Documentation Updates
**Dependencies:** Task Groups 1-6 (documents the shipped behaviour)

- [x] 7.0 Update documentation
  - [x] 7.1 Update `DISCOVERY_SERVICE_EXPLAINER.md`
    - Expand tier section with Tier A / B / C examples.
    - Document exact warning copy for each tier.
    - Document Tier C gate behaviour (`confirmLlmSolo` opt-in + 409 flow).
    - Add confidence-midpoint table (adapter=0.9, gap-fill=0.75, ir-guided=0.6, solo=0.4).
    - Document env-var overrides: `CONFIDENCE_ADAPTER`, `CONFIDENCE_LLM_GAP_FILL`, `CONFIDENCE_LLM_IR_GUIDED`, `CONFIDENCE_LLM_SOLO`.
  - [x] 7.2 Update API documentation
    - `POST /discovery/runs`: new request field `confirmLlmSolo: boolean` (optional, default false); new response fields `mode`, `tier`, `warnings`.
    - `POST /discovery/runs` 409 error shape (`LLM_SOLO_CONFIRMATION_REQUIRED`).
    - `GET /discovery/runs/{runId}`: new fields `mode`, `tier`, `warnings`, `confirmedLlmSolo`.
    - `GET /discovery/runs` (list): new fields `mode`, `tier`.
    - `GET /discovery/packs/applicable`: new fields `tier`, `warnings`.
  - [x] 7.3 Cross-link and verify docs
    - Ensure explainer points at the confidence module for env-var reference.
    - Ensure API docs note that all new fields are additive and backward-compatible.

**Acceptance Criteria:**
- `DISCOVERY_SERVICE_EXPLAINER.md` contains the tier UX section, warning copy, confidence midpoint table, and env-var reference.
- API docs reflect all new request/response fields and the 409 error shape.
- No dead links; docs cross-reference the confidence module.

---

## Execution Order (Waves)

Waves group task groups that can run in parallel. Waves themselves are sequential.

**Wave 1 — Foundation:**
- Task Group 1 (Java schema + DiscoveryRun plumbing)

**Wave 2 — Discovery-service internals (parallel):**
- Task Group 2 (Confidence module)
- Task Group 3 (Pipeline tier-as-input refactor + candidate emission confidence)

**Wave 3 — Gate integration:**
- Task Group 4 (POST /discovery/runs tier computation + gate + archmodel passthrough)

**Wave 4 — Remaining endpoint surfacing:**
- Task Group 5 (GET runs/{id}, list runs, packs/applicable enrichment)

**Wave 5 — Frontend (can start alongside Waves 3/4 once DTOs freeze):**
- Task Group 6 (banner + filter + badges + 409 confirm dialog)

**Wave 6 — Documentation:**
- Task Group 7 (explainer + API docs)

## Parallelization Notes

- **Group 1 is the schema prerequisite.** Nothing persisting new fields can be tested end-to-end until the DTO + migrations are in place.
- **Groups 2 and 3 are independent of the gate.** As soon as DTO shape is agreed (Group 1), both can proceed in parallel with each other and with the frontend.
- **Group 6 (frontend) can start in parallel with Waves 3/4** once the DTO surfaces (mode, tier, warnings, confirmedLlmSolo) are frozen; it only needs the API response shape to be stable, not the gate behaviour finalized.
- **Group 7 (docs) is last** so it reflects shipped behaviour rather than intent.
