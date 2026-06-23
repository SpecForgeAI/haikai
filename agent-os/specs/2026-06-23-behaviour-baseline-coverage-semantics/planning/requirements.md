TITLE: Semantics-aware (not HTTP-status-literal) API Behaviour Baseline capture coverage — and stop discarding the legacy API's real responses.

SERVICE: `api-migration-validation-service` (amvs), primarily `src/services/captureSessionOrchestrator.ts`. Touches frontend review/coverage UI; NO AMS schema change expected (capture rows already store bodies).

PROBLEM (confirmed by code investigation):
The capture tool decides whether a scenario was "captured" by whether the observed HTTP status matches the status CLASS the scenario's intent implies — NOT by whether the API's behaviour was actually observed. A legacy ("HiFi") API that violates REST conventions (returns 200 for a missing resource, 500 for malformed input, or 200 when no auth is enforced) is therefore scored as a coverage MISS, and — the real bug — its captured response is REJECT-AND-HIDDEN so it never reaches the baseline or reconcile. This is a behaviour-baseline tool: those non-conventional responses ARE the behaviour it must record. Per the run the user analysed: of 108 "errored" scenarios, ~42 were not_found-via-200, ~64 were client_error-via-500, only ~2 genuine misses — i.e. coverage reported 65/173 (38%) when ~169/173 (98%) of scenarios actually exercised the API successfully.

CONFIRMED MECHANISM (file:line in `captureSessionOrchestrator.ts`):
- `ScenarioExpectedStatus = 'success' | 'not_found' | 'client_error'` (line 548). Three buckets only.
- `classifyExpectedFromName(name)` (line 961): name-substring → bucket ('404'/'not_found'→not_found; '400'/'bad'/'invalid'/'auth'/'validation'/'error'→client_error; else success). So auth-negative + validation + generic "error" scenarios all share the client_error bucket.
- `selectCanonicalCapture(captures, expectedStatus)` (line 597): selects purely by HTTP status class — success→last 2xx; not_found→last 404 else last 4xx; client_error→last 4xx; default→null. IT IS NOT GIVEN THE RESPONSE BODY (its param type is `{ captureId, status }` only, line 598). Returns null when nothing matches the class.
- `scoreEndpointCoverage` (line 752): a dimension is `achieved` iff selectCanonicalCapture returns non-null; coverage score = achieved/total (line 788). `assembleCoverageSummary` folds a session-level auth dimension as +1 (lines 810-823).
- THE DATA-LOSS BUG: when the canonical is null (no status-class match) the orchestrator counts the scenario errored AND reject-and-hides EVERY capture for it (lines 1524-1533) via `safeRejectNonCanonicalCapture` (line 1193), which PATCHes the capture `accepted:false` + `reviewer_notes = NON_CANONICAL_REVIEWER_NOTE` ('superseded_non_canonical', line 575).

BLAST RADIUS (file:line; from downstream investigation):
- Capture rows DO store the full response: AMS `ApiBehaviourCaptureEntity.response_body_json` (line 110-112) + `response_headers_redacted_json` (line 106-108); also held in-process at selection time on `ScenarioCaptureRef.data` (`runManager.ts:40-49,66-70`). So a body/semantics-aware selector is feasible WITHOUT new storage — `selectCanonicalCapture` just isn't given the body today.
- Reviewer view HIDES system-rejected captures: frontend `CaptureReviewPanel.tsx:315-320` (`isAutoRejectedFumble`) + `:471` (`visibleCaptures` filter); NO show-hidden/un-hide affordance exists. (A HUMAN reject stays visible; only the exact bare system marker is hidden — the distinction is deliberate.)
- Baseline EXCLUDES them: `SaveAsBaselineModal.tsx:157` filters `accepted === true`; items built only from that set (`:234`), posted via `createBaselineItemsBatch` (`:296`). AMS does not re-filter.
- Reconcile NEVER sees them: diff + target-replay read baseline ITEMS only (`diffRunner.ts:435`, `targetReplayRunner.ts:430`).
- Coverage summary is DISPLAY-ONLY (gates NOTHING): persisted at `captureSessionOrchestrator.ts:1657`; rendered by `CoverageSummaryPanel.tsx` (its header explicitly states no gate); save `canSubmit` ignores the score (`SaveAsBaselineModal.tsx:364`); only stamped into provenance at activate (`ApiBehaviourBaselineService.java:378`). => fixing the % is cosmetic; THE DATA-LOSS IS THE REAL BUG.
- AUTH double-count: auth-negative scenarios are scored as per-endpoint client_error dimensions (any 4xx) AND as the single session-level auth probe (expects 401/403, `runAuthNegativeProbes` line 879). An API with no auth (returns 200) misses both, and the per-endpoint one hides the capture.

LEGITIMATE INTENT TO PRESERVE (do NOT regress this):
`selectCanonicalCapture` exists to DEDUPE LLM fumbles: a scenario typically yields multiple captures (the LLM sends a malformed request → 400, then corrects → 200/404); the tool keeps the ONE representative oracle and reject-hides the intermediate fumbles. The fix must keep fumble-deduplication while no longer mistaking the API's real non-REST response for a fumble (and discarding it).

PROPOSED DIRECTION (two separable changes — the shaper should pin the exact mechanism with the user):
CHANGE 1 (CRITICAL — stop discarding real responses): the canonical for a scenario should be the representative COMPLETED round-trip for that scenario's request (the LLM's terminal/intended attempt), even when its status is "unexpected" for the intent. Do NOT reject-hide a genuine terminal response just because the status class is wrong. Candidate mechanisms to discuss: (a) treat the LAST capture as the terminal behaviour when no status-class match exists (vs the current "reject everything"); (b) body-semantics detection (a 200 whose body says NO_DATA_FOUND/empty IS the not_found behaviour; a 500 whose body is a parse/validation error IS the bad-input behaviour); (c) an explicit LLM "this was my final/representative attempt" signal (a light cousin of the existing `pin_sequence`). The fumble-vs-real distinction is the crux.
CHANGE 2 (semantics-aware + configurable coverage): coverage "achieved" for not_found/client_error should mean "we observed the API's response to a not-found / invalid-input request", not "the status was 404/4xx". Use body-semantic heuristics by DEFAULT plus per-API CONFIG (mirroring the existing date-format default precedent the user already established) for what status/body patterns mean not_found / bad_request / no-auth for THIS API. Re-cast convention deviations as OBSERVATIONS/FINDINGS ("endpoint returns 200 for a missing resource — non-standard"), not coverage misses. A genuine 500 server CRASH (not a validation reject) should still be SURFACED as an anomaly, not silently counted as covered — distinguishing crash-vs-validation likely needs body semantics.

OPEN QUESTIONS for the shaper to raise with the user:
1. Change-1 mechanism: (a) last-capture-as-terminal vs (b) body-semantics vs (c) LLM-declared canonical — or a combination? How do we tell a genuine fumble from the real non-REST behaviour so we keep dedup but stop data loss?
2. Coverage semantics: confirm body-heuristics-by-default + per-API config (option 3). What default heuristic vocabulary? (e.g. not_found: empty array/object/null body, or body contains no-data/not-found markers; client_error: body contains parse/deserialize/validation/invalid markers.)
3. Should a genuine 5xx CRASH still be surfaced as a finding/anomaly (not counted covered)? How to distinguish from a deliberate 500-validation-reject?
4. Auth: keep the session-level auth probe as the auth quality check; but should "200 = no auth enforced" be CAPTURED as behaviour (not hidden) on the per-endpoint side? Should auth scenarios stay in the client_error bucket or get their own bucket?
5. Coverage metric framing: redefine the % so it reflects behaviour-captured (38%->~98%), OR add a SEPARATE "REST-convention adherence" metric so users still see "deviates in N places" without it reading as capture failure? (Likely both: capture-coverage % + a separate observations list.)
6. Reviewer safety net: add a "show system-hidden captures" affordance so a reviewer can see/re-accept anything the selector hid (belt-and-braces regardless of the selection fix)?
7. Scope of backfill: forward-only (re-run capture on the run machine) vs any handling for already-captured/hidden runs? (NOTE: capture runs happen on a SEPARATE machine — do not attempt to fetch/inspect run data; design must be verifiable by unit tests + the user re-running.)
8. Config surface: where does the per-API not_found/bad_request config live and get set (the capture wizard, like the date-format default? a session/project setting)?

NON-GOALS:
- No change to the legacy/HiFi API (its design is out of scope; deviations are observations).
- No change to reconcile/diff algorithms beyond ensuring valid captures now reach the baseline.
- Keep coverage DISPLAY-ONLY (no new hard gate) unless the user explicitly asks.
- Do not regress fumble-deduplication.
- No AMS schema/Liquibase change expected (bodies already persisted) — flag if the chosen design needs one.
- Do not attempt to access live run logs/evidence (separate machine); verify via unit tests + deterministic fixtures.

GROUNDED REUSE TARGETS:
- `api-migration-validation-service/src/services/captureSessionOrchestrator.ts`: `selectCanonicalCapture` (597), `classifyExpectedFromName` (961), `scoreEndpointCoverage` (752), `coverageMissReason` (711), `assembleCoverageSummary` (~805), `safeRejectNonCanonicalCapture` (1193) + its two call sites (1515-1533), `runAuthNegativeProbes` (879), `CoverageSummary`/`CoverageDimensionResult` types (640-712), `NON_CANONICAL_REVIEWER_NOTE` (575). Existing tests: `__tests__/captureSessionCanonicalCapture.test.ts`, `__tests__/oracleCoverageScoring.test.ts`, `__tests__/oracleCoverageScoringIntegration.test.ts`.
- `runManager.ts` `ScenarioCaptureRef`/`ScenarioCaptureData` (40-49, 66-70) — body available in-process.
- AMS `ApiBehaviourCaptureEntity` (response_body_json/headers, accepted) — no schema change needed.
- Frontend: `CaptureReviewPanel.tsx` (isAutoRejectedFumble :315, visibleCaptures :471), `SaveAsBaselineModal.tsx` (accepted filter :157), `CoverageSummaryPanel.tsx` (display-only).
- Precedent for per-API config default: the existing capture-wizard "Data-type formats" / date-format default mechanism (Step 5).
