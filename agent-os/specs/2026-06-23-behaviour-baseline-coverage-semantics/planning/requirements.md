# Spec Requirements: Semantics-aware API Behaviour Baseline coverage (stop discarding the legacy API's real responses)

## Overview / Problem

The capture tool decides whether a scenario was "captured" by whether the observed HTTP status matches the status CLASS the scenario's intent implies — NOT by whether the API's behaviour was actually observed. A legacy ("SampleSvc") API that violates REST conventions (returns 200 for a missing resource, 500 for malformed input, or 200 when no auth is enforced) is therefore scored as a coverage MISS, and — the real bug — its captured response is REJECT-AND-HIDDEN so it never reaches the baseline or reconcile.

This is a behaviour-baseline tool: those non-conventional responses ARE the behaviour it must record. Per the run the user analysed, of 108 "errored" scenarios, ~42 were `not_found`-via-200, ~64 were `client_error`-via-500, and only ~2 were genuine misses — i.e. coverage reported 65/173 (38%) when ~169/173 (98%) of scenarios actually exercised the API successfully.

**Service:** `api-migration-validation-service` (amvs), primarily `src/services/captureSessionOrchestrator.ts`. Touches the frontend review/coverage UI. No AMS schema change is expected (capture rows already store bodies); see the config-persistence technical note below.

**The headline:** fixing the coverage % is cosmetic; THE DATA-LOSS (real responses being reject-hidden) IS THE REAL BUG.

## Confirmed Mechanism (file:line in `captureSessionOrchestrator.ts`)

- `ScenarioExpectedStatus = 'success' | 'not_found' | 'client_error'` (line 548) — three buckets only.
- `classifyExpectedFromName(name)` (line 961): name-substring → bucket (`404`/`not_found`→not_found; `400`/`bad`/`invalid`/`auth`/`validation`/`error`→client_error; else success). So auth-negative + validation + generic "error" scenarios all share the `client_error` bucket.
- `selectCanonicalCapture(captures, expectedStatus)` (line 597): selects purely by HTTP status class — success→last 2xx; not_found→last 404 else last 4xx; client_error→last 4xx; default→null. IT IS NOT GIVEN THE RESPONSE BODY (its param type is `{ captureId, status }` only, line 598). Returns null when nothing matches the class.
- `scoreEndpointCoverage` (line 752): a dimension is `achieved` iff `selectCanonicalCapture` returns non-null; coverage score = achieved/total (line 788). `assembleCoverageSummary` folds a session-level auth dimension as +1 (lines 810-823).
- **THE DATA-LOSS BUG:** when the canonical is null (no status-class match) the orchestrator counts the scenario errored AND reject-and-hides EVERY capture for it (lines 1524-1533) via `safeRejectNonCanonicalCapture` (line 1193), which PATCHes the capture `accepted:false` + `reviewer_notes = NON_CANONICAL_REVIEWER_NOTE` (`'superseded_non_canonical'`, line 575).

**Legitimate intent to preserve (do NOT regress):** `selectCanonicalCapture` exists to DEDUPE LLM fumbles. A scenario typically yields multiple captures (the LLM sends a malformed request → 400, then corrects → 200/404); the tool keeps the ONE representative oracle and reject-hides the intermediate fumbles. The fix must keep fumble-deduplication while no longer mistaking the API's real non-REST response for a fumble (and discarding it). The fumble-vs-real distinction is the crux.

## Blast Radius (file:line; from downstream investigation)

- **Bodies are already stored** — a body/semantics-aware selector is feasible WITHOUT new storage. The full response lives in AMS `ApiBehaviourCaptureEntity.response_body_json` (lines 110-112) + `response_headers_redacted_json` (lines 106-108), and is also held in-process at selection time on `ScenarioCaptureRef.data` (`runManager.ts:40-49,66-70`). `selectCanonicalCapture` simply isn't given the body today.
- **Reviewer view HIDES system-rejected captures:** frontend `CaptureReviewPanel.tsx:315-320` (`isAutoRejectedFumble`) + `:471` (`visibleCaptures` filter); NO show-hidden / un-hide affordance exists. (A HUMAN reject stays visible; only the exact bare system marker is hidden — the distinction is deliberate.)
- **Baseline EXCLUDES them:** `SaveAsBaselineModal.tsx:157` filters `accepted === true`; items are built only from that set (`:234`), posted via `createBaselineItemsBatch` (`:296`). AMS does not re-filter.
- **Reconcile NEVER sees them:** diff + target-replay read baseline ITEMS only (`diffRunner.ts:435`, `targetReplayRunner.ts:430`).
- **Coverage summary is DISPLAY-ONLY (gates NOTHING):** persisted at `captureSessionOrchestrator.ts:1657`; rendered by `CoverageSummaryPanel.tsx` (its header explicitly states no gate); save `canSubmit` ignores the score (`SaveAsBaselineModal.tsx:364`); only stamped into provenance at activate (`ApiBehaviourBaselineService.java:378`).
- **AUTH double-count:** auth-negative scenarios are scored as per-endpoint `client_error` dimensions (any 4xx) AND as the single session-level auth probe (expects 401/403, `runAuthNegativeProbes` line 879). An API with no auth (returns 200) misses both, and the per-endpoint one hides the capture.

## Goals

1. **Stop the data loss (Change 1):** a scenario's sole completed round-trip must never be dropped. A capture is only reject-hidden as a fumble when a DIFFERENT capture is selected canonical.
2. **Make coverage semantics-aware and configurable (Change 2):** "achieved" means "we observed the API's response to the intended request" — computed body/semantics-aware by default, overridable per-API.
3. **Distinguish a genuine crash from a deliberate validation-reject** (5xx handling), with crash as the SAFE DEFAULT (not "covered").
4. **Remove the auth double-count** and capture "no auth enforced" as an observation rather than hiding it.
5. **Reframe the coverage metric** so it reads ~98% (behaviour captured) and add a separate, non-scoring observations list for REST-convention deviations.
6. **Give reviewers a safety net** to see and re-accept system-hidden captures.
7. Keep all of the above **forward-only** and verifiable by unit tests + deterministic fixtures (no live run data).

## Functional Requirements

### Change 1 — Canonical selection (the critical data-loss fix)

Replace today's "reject every capture when no status-class match" with a deterministic precedence for choosing the scenario's canonical capture:

1. **(c) LLM-DECLARED terminal attempt first** — reuse the EXISTING `actStepCapture` / `pin_sequence` seam (`captureSessionOrchestrator.ts` ~1500-1502).
2. **(b) BODY-SEMANTICS pick** of the representative completed round-trip (vocabulary per Change 2).
3. **(a) Fall back to the LAST COMPLETED** (non-transport-failure) capture.

Rules:
- NEVER drop a scenario's sole completed round-trip.
- A capture is only reject-hidden as a fumble when a DIFFERENT capture is selected canonical.
- Transport-failure-only / 5xx-only scenarios are governed by the 5xx requirement below, NOT by this fallback.
- Preserve fumble-deduplication: still reject-hide the non-canonical fumbles when a canonical IS chosen.

### Change 2 — Semantics-aware + configurable coverage

Coverage "achieved" means "we observed the API's response to the intended request", computed body/semantics-aware by default and overridable per-API via config.

`selectCanonicalCapture` (and the scorer) must be given the response BODY. Today it only receives `{captureId,status}`; the body is already available in-process on `ScenarioCaptureRef.data.responseBody` (`runManager.ts:48,66-70`) and persisted as `response_body_json`.

Default vocabulary (case-insensitive, matched on response body):
- **not_found:** HTTP 404, OR a 2xx with empty / `null` / `[]` / `{}` body, OR body markers `not[_ ]?found` / `no[_ ]?data` / `does not exist` / `no records`.
- **bad_request / client_error:** HTTP 4xx, OR body markers `invalid` / `validation` / `parse` / `deseriali[sz]e` / `malformed` / `bad request` / `required`.
- **success:** HTTP 2xx with a non-empty, non-error-marker body.

The marker lists ship as EDITABLE defaults (same UX as the date-format datalist). Both the status→bucket mapping AND the marker vocabulary are per-API configurable.

### 5xx — crash vs deliberate 500 validation-reject

A 5xx (or transport failure) counts as COVERED only when:
- the body matches the bad_request vocabulary, OR
- the per-API config declares "this API returns 5xx for bad input".

Otherwise it is NOT counted covered and is surfaced as an ANOMALY / FINDING (e.g. "500 with no recognizable validation body — possible crash"). **Crash is the SAFE DEFAULT (not "covered").** Reuse the existing `coverageMissReason` `allNullOrServerError` seam (`captureSessionOrchestrator.ts:719`) for this branch.

### Auth — own bucket, capture "no auth enforced"

- Keep the session-level auth probe (`runAuthNegativeProbes`, ~879) unchanged as the auth QUALITY check.
- Split per-endpoint auth-negative scenarios into their OWN new `auth` bucket: add `'auth'` to `ScenarioExpectedStatus` (line 548) and route auth scenarios there in `classifyExpectedFromName` (line 961) instead of `client_error`.
- A "200 = no auth enforced" response is CAPTURED as behaviour and surfaced as an OBSERVATION ("no auth enforced on this endpoint"), never reject-hidden.
- This removes the current double-count.

### Coverage metric framing + observations list

Do BOTH:
- **Redefine the coverage %** to mean "behaviour observed/captured" (so the analysed run reads ~98%, not 38%).
- **Add a separate, NON-SCORING "Observations / REST-convention deviations" list** (returns 200 for missing; no auth enforced; returns 500 for bad input; etc.).

The % answers "did we capture the behaviour"; the observations list answers "how this API deviates from conventions."

### Reviewer safety net (in-scope)

Add a collapsed "Show N system-hidden captures" toggle in `CaptureReviewPanel.tsx` (reveals `isAutoRejectedFumble` captures, lines 315-320 / 471-474) that lets a reviewer SEE and RE-ACCEPT a system-hidden capture. Collapsed / display-only by default. The baseline `accepted === true` filter (`SaveAsBaselineModal.tsx:157`) is unchanged.

### Config surface (capture-wizard step)

Add a new capture-wizard step modeled on `frontend/src/components/ApiBehaviour/DataTypeFormatsStep.tsx` (Spec 2026-06-20, Step 5):
- Evidence-pre-fillable, operator-confirmable per-API defaults: status→bucket mapping + editable marker vocabulary.
- An explicit "(use built-in defaults)" sentinel.
- Persisted via existing session-config plumbing.

## UI / UX

- **Observations view:** model on the existing `CoverageSummaryPanel` + findings UI patterns. No other body-semantic classifier exists to reuse.
- **Reviewer safety net:** collapsed "Show N system-hidden captures" toggle inside `CaptureReviewPanel.tsx`, revealing the previously hidden `isAutoRejectedFumble` captures with a re-accept affordance; collapsed by default.
- **Config step:** new capture-wizard step mirroring `DataTypeFormatsStep.tsx` — editable defaults (datalist-style), pre-fillable from evidence, with the "(use built-in defaults)" sentinel.
- No new visual assets were provided; UI follows the existing panel/wizard patterns named above.

## Backend / Integration

- Thread the response BODY through to `selectCanonicalCapture` and the scorer (available in-process at `ScenarioCaptureRef.data.responseBody`, `runManager.ts:48,66-70`; persisted as `response_body_json`).
- Implement the canonical-selection precedence and the body-semantic bucket classification in `captureSessionOrchestrator.ts`, reusing the `coverageMissReason`/`allNullOrServerError` seam (line 719) for the crash branch and the `actStepCapture`/`pin_sequence` seam (~1500-1502) for the LLM-declared terminal attempt.
- Add the `'auth'` member to `ScenarioExpectedStatus` (line 548) and route auth scenarios in `classifyExpectedFromName` (line 961).

### Config-persistence technical note (build-time investigation — NOT a user question)

PREFER NO AMS schema / Liquibase change. The build must confirm WHERE session-level capture config is already persisted and reuse it; a small ADDITIVE AMS field is acceptable ONLY as a last resort if the config genuinely has nowhere to live. Flag this during the build rather than assuming. (Bodies are already persisted, so the selector/scoring changes themselves need no new storage.)

## Reuse Targets (file:line)

- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`:
  - `selectCanonicalCapture` (597), `classifyExpectedFromName` (961), `scoreEndpointCoverage` (752), `coverageMissReason` (711) incl. `allNullOrServerError` (719), `assembleCoverageSummary` (~805), `safeRejectNonCanonicalCapture` (1193) + its two call sites (1515-1533), `runAuthNegativeProbes` (879), `CoverageSummary` / `CoverageDimensionResult` types (640-712), `NON_CANONICAL_REVIEWER_NOTE` (575), `ScenarioExpectedStatus` (548), `actStepCapture` / `pin_sequence` seam (~1500-1502).
- `runManager.ts` `ScenarioCaptureRef` / `ScenarioCaptureData` (40-49, 66-70) — response body available in-process.
- AMS `ApiBehaviourCaptureEntity` — `response_body_json` (110-112), `response_headers_redacted_json` (106-108), `accepted` — no schema change needed.
- Frontend: `CaptureReviewPanel.tsx` (`isAutoRejectedFumble` :315-320, `visibleCaptures` :471-474), `SaveAsBaselineModal.tsx` (`accepted` filter :157), `CoverageSummaryPanel.tsx` (display-only).
- Config-step precedent: `frontend/src/components/ApiBehaviour/DataTypeFormatsStep.tsx` (Spec 2026-06-20, Step 5) — date-format editable-defaults datalist UX.
- Existing tests to extend: `__tests__/captureSessionCanonicalCapture.test.ts`, `__tests__/oracleCoverageScoring.test.ts`, `__tests__/oracleCoverageScoringIntegration.test.ts`.

## Resolved Decisions (all recommended defaults accepted)

1. **Canonical selection (Change 1):** deterministic precedence — (c) LLM-declared terminal attempt (reuse `actStepCapture`/`pin_sequence` ~1500-1502) → (b) body-semantics pick → (a) last completed (non-transport-failure) capture. Never drop a scenario's sole completed round-trip; reject-hide a capture as a fumble only when a DIFFERENT capture is canonical. Transport-failure-only / 5xx-only governed by decision 3. Fumble-dedup preserved.
2. **Semantics-aware + configurable coverage (Change 2):** "achieved" = "we observed the API's response to the intended request"; body/semantics-aware by default, per-API overridable. Pass the response body into `selectCanonicalCapture`/scorer. Default vocabulary as specified (not_found / bad_request / success), case-insensitive on the body, shipped as EDITABLE defaults; both status→bucket mapping and marker vocabulary are per-API configurable.
3. **5xx crash vs deliberate 500 validation-reject:** a 5xx / transport failure counts COVERED only if the body matches bad_request vocabulary OR per-API config declares 5xx-for-bad-input; otherwise NOT covered and surfaced as an anomaly/finding. Crash is the SAFE DEFAULT. Reuse the `allNullOrServerError` seam (719).
4. **Auth:** keep the session-level probe (`runAuthNegativeProbes` ~879) unchanged; split per-endpoint auth-negative scenarios into a new `auth` bucket (add `'auth'` to `ScenarioExpectedStatus` line 548; route in `classifyExpectedFromName` line 961). "200 = no auth enforced" is captured and surfaced as an observation, never hidden. Removes the double-count.
5. **Coverage metric framing:** BOTH redefine the % to mean "behaviour observed/captured" (run reads ~98%) AND add a separate, non-scoring "Observations / REST-convention deviations" list. Model the observations view on `CoverageSummaryPanel` + findings patterns.
6. **Reviewer safety net (in-scope):** collapsed "Show N system-hidden captures" toggle in `CaptureReviewPanel.tsx` (reveals `isAutoRejectedFumble` :315-320 / :471-474) with re-accept; collapsed/display-only by default; baseline `accepted === true` filter (`SaveAsBaselineModal.tsx:157`) unchanged.
7. **Backfill:** FORWARD-ONLY — new logic applies to new capture runs; no migration / re-scoring of historical hidden captures. Validate via unit tests + deterministic fixtures (extend the three named test files) and the user re-running capture — NEVER by inspecting live run data (capture runs are on a separate machine).
8. **Config surface:** new capture-wizard step modeled on `DataTypeFormatsStep.tsx` (Spec 2026-06-20, Step 5) — evidence-pre-fillable, operator-confirmable per-API defaults (status→bucket mapping + editable marker vocabulary) with an explicit "(use built-in defaults)" sentinel; persisted via existing session-config plumbing. PREFER NO AMS schema/Liquibase change. TECHNICAL NOTE (build-time investigation, not a user question): confirm where session-level capture config is already persisted and reuse it; a small additive AMS field is acceptable ONLY as a last resort, flagged during the build.

## Non-Goals

- No change to the legacy/SampleSvc API (its design is out of scope; deviations are observations).
- No change to reconcile/diff algorithms beyond ensuring valid captures now reach the baseline.
- Coverage stays DISPLAY-ONLY — no new hard gate.
- Do not regress fumble-deduplication.
- No AMS schema/Liquibase change expected (bodies already persisted) — flag at build time only if the config genuinely has nowhere to live (decision 8 / technical note).
- Do not attempt to access live run logs / evidence (separate machine); verify via unit tests + deterministic fixtures.

## Testing Approach

- Forward-only; no migration or re-scoring of historical data.
- Extend the existing deterministic-fixture test suites:
  - `__tests__/captureSessionCanonicalCapture.test.ts`
  - `__tests__/oracleCoverageScoring.test.ts`
  - `__tests__/oracleCoverageScoringIntegration.test.ts`
- Cover: canonical-selection precedence (LLM-declared → body-semantics → last completed); never-drop-sole-completed-round-trip; fumble-dedup still reject-hides non-canonical captures when a canonical is chosen; body-semantic bucket classification (not_found/bad_request/success vocabulary, case-insensitive); 5xx crash-vs-validation branch with crash as safe default; new `auth` bucket routing and "no auth enforced" observation; coverage-% reframing; per-API config override of status→bucket mapping and marker vocabulary; "(use built-in defaults)" sentinel behaviour.
- Final validation also includes the user re-running capture on the separate machine. NEVER inspect live run data as a verification step.

## Visual Assets

No visual assets provided. (`planning/visuals/` confirmed empty.)
