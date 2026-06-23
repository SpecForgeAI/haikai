# Task Breakdown: Semantics-aware API Behaviour Baseline coverage

## Overview
Total Tasks: 6 task groups

**Service under change:** `api-migration-validation-service` (amvs, Node/TS, Jest) — primarily `src/services/captureSessionOrchestrator.ts` (~1700+ lines) — plus frontend (React/TS, Vite, Vitest).

**The real bug:** a legacy API's non-REST responses (200-for-missing, 500-for-bad-input, 200-for-no-auth) are scored as coverage MISSes and then REJECT-AND-HIDDEN, so they never reach the baseline. Fixing the coverage % is cosmetic; stopping the data-loss is the point.

---

## CRITICAL BUILD CONSTRAINTS (read before any edit)

These apply to EVERY task group. Implementers must honour them.

1. **ANTI-CLOBBER on the big file.** `captureSessionOrchestrator.ts` must be changed with **anchored, surgical edits ONLY — never overwritten wholesale.** To keep the big-file diff thin, put NEW logic in a NEW isolated module (`src/services/responseSemantics.ts`) and have the orchestrator IMPORT and call it. The orchestrator edits should be thin call-site rewires (give the selector/scorer the body; swap the no-match reject branch; add the `auth` bucket). After every edit to the big file, re-read the touched region and run a mojibake / stray-symbol check (no `Â`, `â€`, replaced quotes, broken `--`).

2. **amvs scoped verification — do NOT rely on a green whole-repo build.** During development run SCOPED Jest for the touched suites (`npx jest <pattern>`) plus `npx tsc --noEmit` for type safety (package `build` script is `tsc`; there is no separate `typecheck` script). Working dir: `C:\Workspaces\SSD\haikai\api-migration-validation-service`.

3. **Frontend baseline is PRE-EXISTINGLY RED** (whole-repo `tsc`/lint fail on `main` in unrelated files). Verify frontend work in ISOLATION only:
   - `npx vitest run <files>` (scoped),
   - `npx eslint <new/edited files> --ext ts,tsx --max-warnings 0` must be **clean**,
   - prove **zero NEW** tsc errors via `npx tsc --noEmit 2>&1 | grep -E "<FeatureFileNames>"` returning **nothing**.
   - Anti-clobber + mojibake checks apply to any edited large frontend file (`CaptureReviewPanel.tsx`, `CoverageSummaryPanel.tsx`, `StartCaptureSessionWizard.tsx`).
   - Working dir: `C:\Workspaces\SSD\haikai\frontend`. (Shell is PowerShell; `grep` is available via the Bash tool.)

4. **Decision-8 (config persistence) is an EARLY, DISCRETE, GATING investigation (Task Group 4).** It GATES the wizard-step work (TG5) but NOT the backend semantics/coverage logic (TG1-TG3), which defaults to the built-in vocabulary and layers the per-API override on once the seam is confirmed. PREFER NO AMS schema change; only a small ADDITIVE field is acceptable as a last resort, and must be flagged explicitly. (Investigation pre-findings are recorded inside TG4 to seed it — they still need confirming, not assuming.)

5. **Forward-only.** New logic applies to new capture runs. NO migration / backfill / re-scoring of historical hidden captures. NEVER inspect live run data (capture runs are on a separate machine); verify via deterministic fixtures only.

6. **Do NOT regress fumble-deduplication**, and do NOT introduce a new hard coverage gate (coverage stays display-only; `SaveAsBaselineModal` `canSubmit` keeps ignoring the score). The baseline `accepted === true` filter (`SaveAsBaselineModal.tsx:158`) is UNCHANGED.

---

## Task List

### Backend — Semantics Engine (new isolated module)

#### Task Group 1: `responseSemantics.ts` — pure classifier + default vocabulary
**Dependencies:** None
**Files:** NEW `api-migration-validation-service/src/services/responseSemantics.ts`; NEW `api-migration-validation-service/src/__tests__/responseSemantics.test.ts`

This group is the safe place to put ALL new behavioural logic so the big-file edits stay thin. The module is pure (no I/O, no imports from the orchestrator) and exhaustively unit-tested in isolation.

- [x] 1.0 Build the response-semantics module
  - [x] 1.1 Write 2-8 focused tests in `responseSemantics.test.ts`
    - Limit to 2-8 highly focused tests maximum.
    - Cover only the critical classifier behaviours: (a) `not_found` via 404 AND via 2xx-with-empty/`null`/`[]`/`{}` body AND via a marker (`not found`); (b) `bad_request` via 4xx AND via a marker (`invalid`/`validation`); (c) `success` via 2xx non-empty non-error body; (d) the 5xx crash-vs-validation split (5xx + validation marker → covered/`bad_request`; 5xx + no recognizable body → NOT covered, anomaly = crash, as the SAFE DEFAULT); (e) case-insensitivity; (f) a per-API config override flipping a status→bucket mapping or extending the marker vocabulary.
    - Skip exhaustive enumeration of every marker and every body shape.
  - [x] 1.2 Define the default marker vocabulary as EDITABLE exported constants
    - `not_found` markers: `not[_ ]?found`, `no[_ ]?data`, `does not exist`, `no records`.
    - `bad_request` markers: `invalid`, `validation`, `parse`, `deseriali[sz]e`, `malformed`, `bad request`, `required`.
    - All matching is case-insensitive on the stringified response body.
    - Export the defaults so the frontend config step / tests can reference the same source of truth.
  - [x] 1.3 Define the per-API config shape + a resolver
    - A config type carrying BOTH an optional status→bucket mapping override AND optional marker-vocabulary overrides AND a `fiveXxIsBadInput` flag ("this API returns 5xx for bad input").
    - A resolver that merges a (possibly absent / partial) per-API config over the built-in defaults — absent config === built-in defaults (the valid empty state).
    - Include the explicit "(use built-in defaults)" sentinel semantics here so backend + frontend agree on what "untouched" vs "explicitly default" means.
  - [x] 1.4 Implement the pure `classifyObservedBehaviour(status, body, config?)`
    - Returns a semantic **bucket** (`success` | `not_found` | `bad_request` | `auth`) PLUS a signal indicating whether the behaviour was **observed/covered** and any **observation/anomaly** (e.g. `200 returned for a missing resource`, `no auth enforced`, `returns 500 for bad input`, `500 with no recognizable validation body — possible crash`).
    - Vocabulary precedence: explicit per-API status→bucket mapping first, then markers, then HTTP-status-class default.
    - 5xx / transport-failure: covered ONLY if body matches `bad_request` vocabulary OR `config.fiveXxIsBadInput`; otherwise NOT covered and emit the crash anomaly. **Crash is the safe default.**
    - Keep it a single pure function (inputs in, result out) with no dependency on `captureSessionOrchestrator.ts` — so the orchestrator imports it, not vice versa.
  - [x] 1.5 Run ONLY the new module tests + typecheck
    - `npx jest responseSemantics` and `npx tsc --noEmit` (working dir = amvs).
    - Do NOT run the whole suite. Mojibake check the new file.

**Acceptance Criteria:**
- The 2-8 tests in 1.1 pass; `npx tsc --noEmit` is clean for the new file.
- `classifyObservedBehaviour` is pure, has zero imports from the orchestrator, and exposes the four buckets + observed/anomaly signal.
- Default vocabulary is exported and editable; per-API overrides + the "(use built-in defaults)" sentinel resolve correctly; crash is the safe default for unrecognized 5xx.

---

### Backend — Canonical Selection Rewire (thin big-file edits)

#### Task Group 2: Canonical-selection precedence + stop the data loss
**Dependencies:** Task Group 1
**Files (anchored edits):** `captureSessionOrchestrator.ts` — `selectCanonicalCapture` (597-626), the `outcomesByName` snapshot (1509-1512), the canonical-pick call site (1500-1502), the reject branches (1514-1533), reusing `safeRejectNonCanonicalCapture` (1193) + `NON_CANONICAL_REVIEWER_NOTE` (575). Extend `src/__tests__/captureSessionCanonicalCapture.test.ts`.

- [x] 2.0 Rewire canonical selection to a deterministic precedence
  - [x] 2.1 Write 2-8 focused tests in `captureSessionCanonicalCapture.test.ts`
    - Limit to 2-8 highly focused tests maximum.
    - Cover only the critical paths: (a) precedence order — LLM-declared terminal attempt (pinned `actStepCapture`) wins over body-semantics, which wins over last-completed; (b) a scenario's **sole completed round-trip is NEVER dropped** (the headline data-loss fix); (c) fumble-dedup still reject-hides the NON-canonical captures when a DIFFERENT capture is chosen canonical; (d) a transport-failure-only / 5xx-only scenario is NOT rescued by the last-completed fallback (it defers to the 5xx rule from TG1/TG3).
    - Skip exhaustive permutations of capture orderings.
  - [x] 2.2 Give `selectCanonicalCapture` the response body (anchored signature edit)
    - Widen the param element type from `{ captureId, status }` (598) to also carry the body (e.g. `responseBody`/`body`), keeping it optional so existing callers/mocks that pass only id+status still typecheck.
    - Thread the body through the `outcomesByName` snapshot at 1509-1512 (today it maps to `{ captureId, status }` only and DROPS the body) — read it from `ScenarioCaptureRef.data.responseBody` (runManager.ts:48,66-70). No new storage.
  - [x] 2.3 Implement the precedence inside `selectCanonicalCapture`
    - Replace the status-class-only `switch` (616-625) with: (c) if an LLM-declared terminal attempt is supplied, use it; else (b) body-semantics pick via `classifyObservedBehaviour` (TG1) of the representative completed round-trip; else (a) the LAST COMPLETED (non-transport-failure, non-5xx-only) capture.
    - Keep the existing `actStepCapture ? actStepCapture : selectCanonicalCapture(...)` shape at 1500-1502 as the seam for precedence step (c) — reuse, do not reinvent. (Either pass the act-step hint into the selector or keep the ternary; choose whichever keeps the big-file edit thinnest.)
    - Function stays pure and exported for unit testing.
  - [x] 2.4 Replace the reject-all-on-no-match branch (the data-loss fix)
    - The `else` branch at 1524-1533 currently increments `scenariosErrored` and reject-hides EVERY capture. Change so that a capture is reject-hidden as a fumble ONLY when a DIFFERENT capture is selected canonical (the 1515-1523 path). A sole completed round-trip must survive as the canonical (pending human accept), never be dropped.
    - Preserve fumble-dedup on the canonical-chosen path: still loop and `safeRejectNonCanonicalCapture` (1193) the non-canonical captures with the `NON_CANONICAL_REVIEWER_NOTE` marker (575) — unchanged behaviour there.
    - Leave 5xx-only / transport-failure-only scenarios to the TG3 5xx rule (do not silently rescue them here).
  - [x] 2.5 Run ONLY the canonical suite + typecheck
    - `npx jest captureSessionCanonicalCapture` and `npx tsc --noEmit`.
    - Re-read the edited 1500-1533 region; mojibake check.

**Acceptance Criteria:**
- The 2-8 tests in 2.1 pass; `npx tsc --noEmit` clean for the touched file.
- `selectCanonicalCapture` receives the body and follows precedence (c)→(b)→(a); a sole completed round-trip is never discarded.
- Fumble-dedup still reject-hides non-canonical captures when a canonical is chosen; the `NON_CANONICAL_REVIEWER_NOTE` marker path is intact.
- Edits to `captureSessionOrchestrator.ts` are anchored/surgical (no wholesale rewrite); no mojibake introduced.

---

### Backend — Semantics-aware Scorer, Observations, Crash Anomaly, Auth Bucket

#### Task Group 3: Scorer rewire + observations + 5xx anomaly + `auth` bucket
**Dependencies:** Task Groups 1, 2
**Files (anchored edits):** `captureSessionOrchestrator.ts` — `ScenarioExpectedStatus` (548), `classifyExpectedFromName` (961-971, the `auth` route at 966), `coverageMissReason` (711) incl. `allNullOrServerError` (719), `scoreEndpointCoverage` (752-791), the result types `CoverageDimensionResult`/`EndpointCoverageResult`/`CoverageSummary` (640-690) and `assembleCoverageSummary` (806-825). Extend `src/__tests__/oracleCoverageScoring.test.ts` and `src/__tests__/oracleCoverageScoringIntegration.test.ts`.

- [x] 3.0 Make the scorer semantics-aware and surface observations + anomalies
  - [x] 3.1 Write 2-8 focused tests across `oracleCoverageScoring.test.ts` / `oracleCoverageScoringIntegration.test.ts`
    - Limit to 2-8 highly focused tests maximum (split across the two files as sensible).
    - Cover only the critical behaviours: (a) coverage "achieved" === behaviour observed (a 200-for-missing scenario now scores achieved, not a miss — the ~38% → ~98% reframing); (b) the new `auth` bucket — `classifyExpectedFromName` routes an auth-negative name to `auth` not `client_error`, and a "200 = no auth enforced" response is captured + surfaced as an observation, never reject-hidden; (c) the 5xx crash-vs-validation branch via `allNullOrServerError` — validation-body 5xx counts covered, unrecognized 5xx is NOT covered and emits the crash anomaly; (d) a non-scoring observation/deviation appears in the summary without changing the score.
    - Skip exhaustive coverage of every dimension type.
  - [x] 3.2 Add the `auth` bucket (anchored edits)
    - Add `'auth'` to `ScenarioExpectedStatus` (548): `'success' | 'not_found' | 'client_error' | 'auth'`.
    - In `classifyExpectedFromName` (961), route the `auth` substring (currently folded into `client_error` at 966) to the new `'auth'` bucket. Keep the other substrings on `client_error`.
    - Ensure `selectCanonicalCapture`'s precedence (TG2) handles the `auth` bucket sensibly (a completed round-trip is canonical; "no auth enforced" is an observation, not a drop).
    - Leave `runAuthNegativeProbes` (~879) and the `AuthCoverageResult`/`AuthProbeResult` types and `assembleCoverageSummary`'s +1 auth fold (816-817) UNCHANGED — this removes the per-endpoint-vs-session double-count by reclassifying the per-endpoint side, not by touching the session probe.
  - [x] 3.3 Make `scoreEndpointCoverage` + `coverageMissReason` semantics-aware
    - `scoreEndpointCoverage` (752) re-runs `selectCanonicalCapture` verbatim at 759 — keep that single-source-of-truth shape; it now inherits the body + precedence from TG2 (no second definition of coverage). "Achieved" === a canonical was selected === behaviour observed.
    - Route the 5xx crash branch through the existing `allNullOrServerError` seam in `coverageMissReason` (719-725): unrecognized all-5xx/no-response stays NOT achieved with the honest crash reason; a 5xx whose body matches `bad_request` vocabulary (or `config.fiveXxIsBadInput`) is achieved (delegate the decision to `classifyObservedBehaviour` from TG1 — do not duplicate the marker logic here).
  - [x] 3.4 Add the non-scoring observations/deviations channel
    - Extend the result types (`CoverageDimensionResult` and/or `CoverageSummary`, 640-690) with a NON-SCORING observations/deviations list (e.g. `observations: string[]` or a small typed list) carrying items like "returns 200 for missing", "no auth enforced", "returns 500 for bad input", "possible crash". Keep snake_case wire (AMS default — NO `@CamelCaseWire`), consistent with the existing `CoverageSummary` fields.
    - Populate it from `classifyObservedBehaviour`'s observation/anomaly signal during scoring; ensure it does NOT enter `overall_score` / `dimensions_achieved` arithmetic in `assembleCoverageSummary` (806). The % answers "did we capture the behaviour"; the list answers "how this API deviates from conventions".
    - Coverage stays display-only — introduce no new gate.
  - [x] 3.5 Run ONLY the two oracle suites + typecheck
    - `npx jest oracleCoverageScoring` (matches both files) and `npx tsc --noEmit`.
    - Re-read edited regions (548, 961-971, 711-735, 752-791, 640-690, 806-825); mojibake check.

**Acceptance Criteria:**
- The 2-8 tests in 3.1 pass; `npx tsc --noEmit` clean for the touched file.
- `auth` is its own bucket; auth-negative scenarios route there; "no auth enforced" is an observation, never reject-hidden; `runAuthNegativeProbes` behaviour unchanged; double-count removed.
- The scorer is body/semantics-aware via TG1 (no duplicated marker logic); 5xx crash is the safe default via the `allNullOrServerError` seam.
- A non-scoring observations list is emitted without affecting `overall_score`; coverage reframes toward "behaviour observed/captured"; no new hard gate.

---

### Backend — Config Persistence Investigation + Plumbing (GATES TG5)

#### Task Group 4: Confirm the session-config persistence seam (Decision 8) and thread per-API semantics config
**Dependencies:** Task Group 1 (consumes the config shape from 1.3). Independent of TG2/TG3 — they default to built-in vocabulary; the per-API override layers on here.
**Files:** investigation across `apiBehaviourClient.ts`, `archModelClient.ts`, `types/captureSession.ts`, AMS changelog; then anchored plumbing edits to `captureSessionOrchestrator.ts` (mirror the `dataTypeDefaultsJson` thread at 360,473).

> **Pre-findings to CONFIRM (not assume):** the Step-5 data-type-format default already persists via a complete, proven seam that this group should mirror:
> - AMS JSONB column `195-capture-data-type-defaults.sql`;
> - wire DTO field `data_type_defaults_json` on Create/Update capture-session requests (`apiBehaviourClient.ts:186,206,229`), PATCHed via `updateCaptureSession`;
> - amvs `CaptureSessionDto.data_type_defaults_json` (`archModelClient.ts:142`) hydrated to `CaptureSession.dataTypeDefaultsJson` (`archModelClient.ts:2073-2074`; type at `captureSession.ts:77`);
> - orchestrator reads `session.dataTypeDefaultsJson` (param at 360, consumed at 473).
>
> So the established precedent for a NEW per-session config is a small ADDITIVE JSONB field mirroring changeset 195. The investigation must confirm whether the new semantics config can ride the EXISTING column shape / a sibling field, and decide no-AMS-change vs additive-field explicitly.

- [x] 4.0 Resolve and implement config persistence/plumbing
  - [x] 4.1 Write 2-8 focused tests for the plumbing
    - Limit to 2-8 highly focused tests maximum.
    - Cover only: (a) the orchestrator resolves built-in defaults when the per-API semantics config is absent/null (the valid empty state — no backfill); (b) a present per-API config is threaded into `classifyObservedBehaviour` and changes a bucket/observation outcome; (c) the "(use built-in defaults)" sentinel round-trips as "explicitly default" distinct from "untouched".
    - Skip exhaustive DTO round-trip coverage.
  - [x] 4.2 INVESTIGATION (gating): confirm the persistence seam and record the decision
    - Trace the `dataTypeDefaultsJson` chain above end-to-end and confirm it is the live seam (DTO → hydration → `session.*Json` read in the orchestrator).
    - DECIDE and write the resolution into this task's notes: **(i) no AMS change** (reuse/extend an existing JSONB column shape), or **(ii) a small ADDITIVE AMS field** (new changeset mirroring 195) ONLY if the config genuinely has nowhere to live. PREFER (i). Flag (ii) explicitly if chosen — do not assume it.
    - This sub-task GATES TG5 (the wizard step cannot persist until the field/seam is fixed). It does NOT gate TG2/TG3.
  - [x] 4.3 Thread the per-API semantics config into the orchestrator
    - Mirror the `dataTypeDefaultsJson` plumbing: add the field to `CaptureSession` (`captureSession.ts`) and hydrate it in `archModelClient.ts` (mirror 2073-2074), then read it in `orchestrateCaptureSession` and pass it as the `config` arg into `classifyObservedBehaviour` (TG1) wherever the selector/scorer run.
    - If decision (ii) was taken, add the additive AMS column + DTO field with the same null-guarded, forward-only semantics as 195 (absent = built-in defaults; no backfill).
    - Keep big-file edits anchored/thin.
  - [x] 4.4 Run ONLY the plumbing tests + typecheck (both ends if AMS touched)
    - amvs: `npx jest <plumbing pattern>` and `npx tsc --noEmit`.
    - If an AMS field was added, build/verify that module's changeset + DTO in isolation per AMS conventions (snake_case wire; no `@CamelCaseWire` for this snake_case consumer).

**Acceptance Criteria:**
- The 2-8 tests in 4.1 pass; typecheck clean for touched files.
- The persistence-seam decision (no-AMS-change vs additive field) is explicitly recorded in this task's notes, with PREFER-no-AMS-change honoured.
- Absent config === built-in defaults (no backfill, forward-only); a present per-API config flows into `classifyObservedBehaviour`; the "(use built-in defaults)" sentinel round-trips intact.
- TG5 is unblocked; TG2/TG3 were never blocked on this group.

---

### Frontend — Config Step, Observations View, Reviewer Safety Net

#### Task Group 5: Capture-wizard config step + observations panel + system-hidden reveal
**Dependencies:** Task Group 4 (persistence seam confirmed) for the config step; Task Group 3 (observations data) for the observations view. The reviewer-reveal toggle depends only on existing frontend state.
**Files:** NEW config step modeled on `frontend/src/components/ApiBehaviour/DataTypeFormatsStep.tsx` (presentational; props `{ rows, value, onChange }` at 47-56), wired into `StartCaptureSessionWizard.tsx`; extend/sibling `frontend/src/components/DashboardView/CoverageSummaryPanel.tsx`; anchored edits to `frontend/src/components/DashboardView/CaptureReviewPanel.tsx` (`isAutoRejectedFumble` 315-318, `visibleCaptures` 471-472). NEW vitest files alongside.

- [x] 5.0 Build the three frontend surfaces (isolated verification only)
  - [x] 5.1 Write 2-8 focused tests (vitest) across the three surfaces
    - Limit to 2-8 highly focused tests maximum.
    - Cover only: (a) the config step renders editable defaults (datalist-style), seeded from evidence, with the explicit "(use built-in defaults)" sentinel distinct from an untouched row, and fires `onChange` (mirror `StartCaptureSessionWizard.dataTypeFormats.test.tsx`); (b) `CoverageSummaryPanel` renders the reframed "behaviour observed/captured" % AND the separate non-scoring "Observations / REST-convention deviations" list; (c) `CaptureReviewPanel`'s collapsed "Show N system-hidden captures" toggle reveals `isAutoRejectedFumble` captures and exposes a re-accept affordance, collapsed by default.
    - Skip exhaustive interaction/state coverage.
  - [x] 5.2 Build the new capture-wizard config step
    - Model on `DataTypeFormatsStep.tsx`: presentational-only (parent owns fetch/seed/persist; the step takes rows + current values + an `onChange`, owns no I/O).
    - Reuse the editable `<datalist>` autocomplete (free text accepted, no validation) seeded from evidence; surface the status→bucket mapping AND the editable marker vocabulary; fold the built-in defaults into the options.
    - Reuse the explicit-sentinel pattern: "(no default)" → here "(use built-in defaults)", distinct from an untouched row.
    - Reuse the per-row expandable transparency listing contributing evidence fields.
  - [x] 5.3 Wire the step into `StartCaptureSessionWizard.tsx` and persist
    - Persist via the seam confirmed in TG4 (mirror how Step 5 PATCHes `data_type_defaults_json` via `updateCaptureSession`).
    - Anchored edits to the wizard (large file) — do not rewrite wholesale; mojibake check after.
  - [x] 5.4 Add the observations view to `CoverageSummaryPanel.tsx`
    - Reuse the existing single-banner layout (overall + per-endpoint coverage with honest reasons; host passes banner/badge CSS via `classes`). No bespoke charting widget.
    - Reframe the displayed % to "behaviour observed/captured"; add the separate non-scoring "Observations / REST-convention deviations" list in the same panel idiom, fed by TG3's observations channel.
    - Keep it DISPLAY-ONLY (header already states no gate); keep rendering on both `CaptureSessionDetailView` and `SaveAsBaselineModal` as today.
  - [x] 5.5 Add the "Show N system-hidden captures" reveal + re-accept to `CaptureReviewPanel.tsx`
    - Anchored edits around `isAutoRejectedFumble` (315-318) and the `visibleCaptures` filter (471-472): add a collapsed toggle (collapsed/display-only by default) revealing the `isAutoRejectedFumble` captures with a re-accept affordance.
    - Do NOT alter the baseline `accepted === true` filter at `SaveAsBaselineModal.tsx:158` — leave it untouched so a re-accepted capture flows through `createBaselineItemsBatch` unchanged.
    - Mojibake check this large file after editing.
  - [x] 5.6 Verify in ISOLATION (frontend is pre-existingly red)
    - `npx vitest run <the new/edited test files>` (scoped) — pass.
    - `npx eslint <new/edited .ts/.tsx files> --ext ts,tsx --max-warnings 0` — clean.
    - `npx tsc --noEmit 2>&1 | grep -E "<the feature file names>"` returns NOTHING (zero NEW tsc errors).
    - Do NOT run the whole-repo build/lint as a gate.

**Acceptance Criteria:**
- The 2-8 tests in 5.1 pass (scoped vitest); eslint clean on touched files; zero NEW tsc errors attributable to these files.
- Config step matches the `DataTypeFormatsStep` pattern (presentational, editable datalist, evidence-seeded, "(use built-in defaults)" sentinel) and persists via the TG4 seam.
- `CoverageSummaryPanel` shows the reframed % + the non-scoring observations list, display-only, on both host surfaces.
- `CaptureReviewPanel` reveals system-hidden captures (collapsed by default) with re-accept; `SaveAsBaselineModal.tsx:158` filter unchanged.
- All edited large files are anchored/surgical with no mojibake.

---

### Testing

#### Task Group 6: Test review & gap analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review the tests written in TG1-TG5
    - `responseSemantics.test.ts` (TG1), `captureSessionCanonicalCapture.test.ts` (TG2), `oracleCoverageScoring.test.ts` + `oracleCoverageScoringIntegration.test.ts` (TG3), the plumbing tests (TG4), and the frontend vitest files (TG5).
    - Total existing focused tests: roughly 12-40.
  - [x] 6.2 Analyze coverage gaps for THIS feature only
    - Identify critical end-to-end behaviours that lack coverage: the full "non-REST response reaches the baseline instead of being reject-hidden" workflow; precedence interaction with fumble-dedup; the ~38%→~98% reframing end to end; auth double-count removal; crash-as-safe-default.
    - Focus ONLY on this spec's requirements. Do NOT assess whole-application coverage. Prioritise end-to-end workflows over unit gaps.
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Add at most 10 new tests to fill identified critical gaps (favour `oracleCoverageScoringIntegration.test.ts` for end-to-end amvs flows; a frontend integration test for the reveal→re-accept→baseline path if a gap exists).
    - Do NOT write comprehensive coverage for all scenarios; skip edge/performance/accessibility tests unless business-critical.
  - [x] 6.4 Run feature-specific tests only (scoped)
    - amvs: `npx jest "(responseSemantics|captureSessionCanonicalCapture|oracleCoverageScoring)"` + `npx tsc --noEmit`.
    - frontend: scoped `npx vitest run <feature files>`, `npx eslint <feature files> --ext ts,tsx --max-warnings 0` clean, `npx tsc --noEmit 2>&1 | grep -E "<feature files>"` returns nothing.
    - Do NOT run the entire application test suite or treat the pre-existing red frontend/whole-repo build as a gate.
    - Note for the user: final real-world validation is the user RE-RUNNING capture on the separate machine — never inspect live run data here.

**Acceptance Criteria:**
- All feature-specific tests pass under scoped runs (roughly 22-50 total).
- Critical end-to-end workflows for this feature are covered (data-loss fix, semantics-aware coverage, crash-as-default, auth bucket, reframed %, reviewer reveal→re-accept→baseline).
- No more than 10 additional tests added.
- Testing focused exclusively on this spec; no reliance on a green whole-repo build; no live-run-data inspection.

---

## Execution Order

Recommended implementation sequence:
1. **TG1 — `responseSemantics.ts`** (new isolated module; unblocks everything; keeps big-file edits thin).
2. **TG4 — config-persistence investigation** can start in PARALLEL with TG1 once 1.3's config shape exists; its 4.2 investigation must complete EARLY because it GATES TG5. TG4 does NOT gate TG2/TG3.
3. **TG2 — canonical-selection rewire** (the data-loss fix; depends on TG1).
4. **TG3 — semantics-aware scorer + observations + auth bucket** (depends on TG1, TG2).
5. **TG5 — frontend** (config step needs TG4's seam; observations view needs TG3's data; reviewer reveal is independent).
6. **TG6 — test review & gap analysis.**

Throughout: anchored/surgical edits to `captureSessionOrchestrator.ts` and large frontend files ONLY; scoped test + typecheck/lint verification per group; forward-only; no live-run-data inspection; no new hard coverage gate; fumble-dedup preserved.
