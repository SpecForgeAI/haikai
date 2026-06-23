# Specification: Semantics-aware API Behaviour Baseline coverage

## Goal
Stop the capture tool from discarding a legacy API's real (non-REST-conventional) responses: decide "captured" by whether the API's behaviour was actually observed — not by whether the HTTP status matched the scenario's intended status class — so non-conventional responses (200-for-missing, 500-for-bad-input, 200-for-no-auth) reach the baseline and reconcile instead of being reject-hidden.

## User Stories
- As a migration operator capturing a legacy API's behaviour baseline, I want every completed round-trip the API actually returned to be recorded, so that a non-REST response (e.g. 200 for a missing resource) becomes baseline behaviour rather than a silently-dropped "miss".
- As a reviewer, I want to see and re-accept captures the system auto-hid, and read a non-scoring list of how the API deviates from REST conventions, so that I can trust the coverage number and audit what was set aside.
- As an operator who knows the target API's quirks, I want to confirm or override per-API how statuses and response bodies map to outcomes, so that "covered" reflects this API's real contract.

## Specific Requirements

**Change 1 — Canonical selection precedence (the critical data-loss fix)**
- REPLACE today's "reject every capture when no status class matches" branch (`captureSessionOrchestrator.ts:1524-1533`) with a deterministic precedence for choosing a scenario's canonical capture.
- Precedence: (c) LLM-DECLARED terminal attempt — reuse the EXISTING `actStepCapture` / `pin_sequence` seam (`captureSessionOrchestrator.ts:1500-1502`); then (b) BODY-SEMANTICS pick of the representative completed round-trip (vocabulary per Change 2); then (a) fall back to the LAST COMPLETED (non-transport-failure) capture.
- A scenario's sole completed round-trip is NEVER discarded.
- A capture is reject-hidden as a fumble ONLY when a DIFFERENT capture is selected canonical (preserves fumble-deduplication via `safeRejectNonCanonicalCapture`, line 1193, and the `NON_CANONICAL_REVIEWER_NOTE` marker, line 575).
- Transport-failure-only / 5xx-only scenarios are governed by the 5xx requirement below, NOT by the last-completed fallback.

**Change 2 — Semantics-aware, per-API-configurable coverage**
- Redefine "achieved" to mean "we observed the API's response to the intended request", computed body/semantics-aware by default and overridable per-API.
- Thread the response BODY into `selectCanonicalCapture` (today its param is `{ captureId, status }` only, line 598) and the scorer; the body is available in-process on `ScenarioCaptureRef.data.responseBody` (`runManager.ts:48,66-70`) and persisted as `response_body_json`.
- Default vocabulary, case-insensitive on the body: not_found = HTTP 404 OR 2xx with empty/`null`/`[]`/`{}` body OR markers `not[_ ]?found` / `no[_ ]?data` / `does not exist` / `no records`; bad_request = HTTP 4xx OR markers `invalid` / `validation` / `parse` / `deseriali[sz]e` / `malformed` / `bad request` / `required`; success = 2xx non-empty, non-error-marker body.
- Marker lists ship as EDITABLE defaults; BOTH the status→bucket mapping AND the marker vocabulary are per-API configurable.

**5xx — crash vs deliberate 500 validation-reject**
- A 5xx (or transport failure) counts COVERED only when the body matches the bad_request vocabulary OR per-API config declares "this API returns 5xx for bad input".
- Otherwise it is NOT counted covered and is surfaced as an anomaly/finding (e.g. "500 with no recognizable validation body — possible crash").
- Crash is the SAFE DEFAULT (never silently "covered").
- Reuse the existing `coverageMissReason` `allNullOrServerError` seam (`captureSessionOrchestrator.ts:719`) for this branch.

**Auth — own bucket, capture "no auth enforced"**
- Add `'auth'` to `ScenarioExpectedStatus` (line 548) and route auth-negative scenarios there in `classifyExpectedFromName` (line 961) instead of `client_error` (line 966 currently sends `auth` to `client_error`).
- A "200 = no auth enforced" response is CAPTURED as behaviour and surfaced as an observation, never reject-hidden.
- Keep the session-level auth probe `runAuthNegativeProbes` (~line 879) unchanged as the auth-quality check.
- This removes the current per-endpoint vs session-level double-count.

**Coverage metric framing + observations list**
- Redefine the coverage % to mean "behaviour observed/captured" (the analysed run should read ~98%, not 38%).
- ADD a separate, NON-SCORING "Observations / REST-convention deviations" list (returns 200 for missing; no auth enforced; returns 500 for bad input; possible crash; etc.).
- The % answers "did we capture the behaviour"; the observations list answers "how this API deviates from conventions".
- Coverage stays DISPLAY-ONLY — introduce no new hard gate.

**Reviewer safety net**
- Add a collapsed "Show N system-hidden captures" toggle in `CaptureReviewPanel.tsx` revealing `isAutoRejectedFumble` captures (lines 315-320 / 471-472) with a re-accept affordance.
- Collapsed / display-only by default.
- The baseline `accepted === true` filter (`SaveAsBaselineModal.tsx:158`) is UNCHANGED.

**Config surface — new capture-wizard step**
- Add a new capture-wizard step modeled on `DataTypeFormatsStep.tsx` (Spec 2026-06-20, Step 5): evidence-pre-fillable, operator-confirmable per-API defaults for the status→bucket mapping and the editable marker vocabulary.
- Provide an explicit "(use built-in defaults)" sentinel (mirroring the date-format "(no default)" choice).
- Persist via existing session-config plumbing.

**Config-persistence — build-time technical note (NOT a user question)**
- PREFER NO AMS schema / Liquibase change; the selector/scoring changes need no new storage (bodies are already persisted).
- The build MUST confirm where session-level capture config is already persisted and reuse it; a small ADDITIVE AMS field is acceptable ONLY as a last resort if config genuinely has nowhere to live — flag it during the build, do not assume.

**Testing — forward-only, deterministic fixtures**
- Forward-only: new logic applies to new capture runs; no migration / re-scoring of historical hidden captures.
- Extend `__tests__/captureSessionCanonicalCapture.test.ts`, `__tests__/oracleCoverageScoring.test.ts`, `__tests__/oracleCoverageScoringIntegration.test.ts`.
- Cover: precedence (LLM-declared → body-semantics → last completed); never-drop-sole-completed-round-trip; fumble-dedup still reject-hides non-canonical captures when a canonical is chosen; body-semantic bucket classification (case-insensitive); 5xx crash-vs-validation branch with crash as safe default; new `auth` bucket routing and "no auth enforced" observation; coverage-% reframing; per-API override of mapping + vocabulary; "(use built-in defaults)" sentinel.
- NEVER inspect live run data (capture runs are on a separate machine); final validation also includes the user re-running capture.

## Visual Design
No visual assets were provided (`planning/visuals/` confirmed empty). UI follows existing patterns:

**`frontend/src/components/DashboardView/CoverageSummaryPanel.tsx` (observations + reframed metric)**
- Reuse the existing single-banner layout that renders overall + per-endpoint coverage with honest reasons, passing in the host surface's banner/badge CSS via `classes` — no bespoke charting widget.
- Keep it DISPLAY-ONLY (its header already states there is no gate); render on both `CaptureSessionDetailView` and `SaveAsBaselineModal` as today.
- Reframe the displayed % to "behaviour observed/captured" and add the separate non-scoring "Observations / REST-convention deviations" list in the same panel idiom.

**`frontend/src/components/ApiBehaviour/DataTypeFormatsStep.tsx` (config-step precedent)**
- Reuse the presentational-only step pattern: parent owns fetch/seed/persist; the step takes rows + current values + an `onChange` and owns no I/O.
- Reuse the editable `<datalist>` autocomplete (free text accepted, no validation) seeded from evidence, plus a per-category standards list folded into the options.
- Reuse the explicit-sentinel pattern ("(no default)" → here "(use built-in defaults)") distinct from an untouched row.
- Reuse the per-row expandable transparency that lists the contributing evidence fields.

## Existing Code to Leverage

**`captureSessionOrchestrator.ts` — selection, scoring, reject seams**
- `selectCanonicalCapture` (597) and the pure scorer `scoreEndpointCoverage` (752) re-run the same selection so generation and scoring cannot drift; extend both to take the body and the new precedence rather than adding a second definition of coverage.
- `safeRejectNonCanonicalCapture` (1193) + its two call sites (1515-1533) and `NON_CANONICAL_REVIEWER_NOTE` (575) are the fumble-hide mechanism — keep for the canonical-chosen path, remove from the no-match path.
- `coverageMissReason` (711) incl. `allNullOrServerError` (719) is the seam for the 5xx crash branch; `assembleCoverageSummary` (~805) and the `CoverageSummary` / `CoverageDimensionResult` / `EndpointCoverageResult` types (640-690) carry the result.
- `actStepCapture` / `pin_sequence` seam (1500-1502) already selects the ACT-step capture for well-formed sequences — reuse as precedence step (c).

**`captureSessionOrchestrator.ts` — bucket + auth classification**
- `ScenarioExpectedStatus` (548) and `classifyExpectedFromName` (961) are the bucket vocabulary and name-to-bucket router; add `'auth'` and re-route the `auth` substring (currently line 966) off `client_error`.
- `runAuthNegativeProbes` (879) and the `AuthCoverageResult` / `AuthProbeResult` types stay as the session-level auth-quality check, unchanged.

**`runManager.ts` — in-process response body**
- `ScenarioCaptureRef` / `ScenarioCaptureData` (40-49, 66-70) already hold `responseBody` at selection time; thread it into the selector/scorer with no new storage.

**Frontend reviewer + baseline surfaces**
- `CaptureReviewPanel.tsx`: `isAutoRejectedFumble` (315-320) and the `visibleCaptures` filter (471-472) are the hide point; add the collapsed reveal/re-accept toggle there.
- `SaveAsBaselineModal.tsx`: the `accepted === true` filter (158) is the baseline gate — leave unchanged so newly-kept canonical captures flow through `createBaselineItemsBatch`.

**AMS `ApiBehaviourCaptureEntity` — bodies already persisted**
- `response_body_json` (110-112) and `response_headers_redacted_json` (106-108) already store full responses; `accepted` carries the keep/hide state — no schema change for the selector/scoring work (config-persistence handled per the build-time note).

## Out of Scope
- No change to the legacy/HiFi API — its design is fixed; deviations are observations, not defects to repair.
- No change to reconcile/diff or target-replay algorithms (`diffRunner.ts:435`, `targetReplayRunner.ts:430`) beyond valid captures now reaching the baseline.
- No new hard coverage gate — coverage stays DISPLAY-ONLY; `SaveAsBaselineModal` `canSubmit` still ignores the score.
- Do NOT regress fumble-deduplication.
- No change to the session-level auth probe `runAuthNegativeProbes` behaviour.
- No migration, backfill, or re-scoring of historical hidden captures — forward-only.
- No AMS schema / Liquibase change expected; flag at build time only if config genuinely has nowhere to live.
- Do NOT access live run logs / evidence (separate machine); verify only via unit tests + deterministic fixtures.
- No bespoke charting/visualisation widget; reuse the existing panel and wizard-step patterns.
