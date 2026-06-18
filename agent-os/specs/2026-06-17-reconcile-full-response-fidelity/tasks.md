# Task Breakdown: Reconcile Full-Response Fidelity & Distinct Break Types

## Overview
Total Tasks: 5 task groups

Layer ordering mirrors the 2026-06-16 determinism spec: AMS (Java/Spring/Postgres) -> validation-service (Node/TS) -> gateway (Node/TS) -> frontend (React/TS) -> cross-layer test review. Each group is independently verifiable and ends with an explicit "no regression of existing status/body break behaviour" check.

Authoritative decisions: `planning/requirements.md` "Resolved Clarifications" R1-R8 + R-volatile. Primary narrative: `spec.md`.

## Task List

### AMS Layer (Java / Spring / Postgres)

#### Task Group 1: `header_classification` column, `body_ordering_drift` value, DTO + service plumbing, Liquibase changeset
**Dependencies:** None

Adds the per-dimension header classification persistence mirroring the existing `status_classification` / `body_classification`, accepts `body_ordering_drift` as a new value of the existing `body_classification` (service-layer validated only), and lands the new column changeset. snake_case wire (AMS default), NO `@CamelCaseWire` (R8).

- [x] 1.0 Complete AMS persistence layer
  - [x] 1.1 Write 2-8 focused tests for the new column + classification values
    - Limit to 2-8 highly focused tests maximum
    - Test only: round-trip persist/read of `header_classification` (`header_match` / `header_value_drift` / `header_presence_drift`); service-layer acceptance of `body_ordering_drift` as a `body_classification` value; service-layer rejection of an invalid `header_classification` value
    - Mirror the determinism spec's `BaselineItemVolatilePathsTest` / `CaptureVolatilePathsTest` style
    - Skip exhaustive coverage of every classification permutation
  - [x] 1.2 Add `header_classification` to `ApiBehaviourDiffItemEntity.java`
    - Nullable `String` column `header_classification` (mirrors the nullable `bodyClassification` at line 136); valid values `header_match` / `header_value_drift` / `header_presence_drift`; NULL when `source_only` / `target_only` (no header pair)
    - Service-layer validated, no DB enum (matches existing AMS convention); update the class javadoc taxonomy block (the `Classification taxonomy` section around lines 30-41)
  - [x] 1.3 Thread `header_classification` through the DTO + request shapes
    - `ApiBehaviourDiffItemDto.java`: add `header_classification` (snake_case, NO `@CamelCaseWire`)
    - `CreateApiBehaviourDiffItemRequest.java`: add the field
    - `UpdateApiBehaviourDiffRequest.java`: add the field if it carries per-item classifications (boxed/nullable; PATCH-safe per `project_primitive_double_dto_overwrite.md`)
  - [x] 1.4 Extend service-layer validation + mapper
    - Validate `header_classification` against the allowed set (mirror the existing `status_classification` / `body_classification` validators)
    - Add `body_ordering_drift` to the accepted set of `body_classification` values (NO DDL for this; existing column, service-layer validation only)
    - Map `header_classification` entity <-> DTO in the diff-item mapper alongside the existing two classifications
  - [x] 1.5 Add the Liquibase changeset for `header_classification`
    - VERIFY next-free number at build time = highest-on-disk + 1; expect `190` (189 `189-capture-coverage-summary.sql` is on disk from Spec A)
    - Create `sql/190-diff-item-header-classification.sql`: nullable `header_classification` column on `api_behaviour_diff_items`, no backfill
    - Register in `db.changelog-master.yaml` AFTER 189, using the `not.columnExists` precondition idiom (mirrors 187/188/189): `onFail: MARK_RAN`, `onError: HALT`, `not.columnExists{ tableName: api_behaviour_diff_items, columnName: header_classification }`
    - Do NOT add an enum/DDL for `body_ordering_drift` (service-layer only) and do NOT edit any applied changeset
  - [x] 1.6 Ensure AMS layer tests pass + no regression
    - Run ONLY the 2-8 tests from 1.1 plus the existing api-behaviour diff-item suite for this entity
    - Verify AMS compiles (`mvn -q -o compile` or module build) and the changeset applies (`not.columnExists` no-ops on a re-run)
    - No regression: existing `status_classification` / `body_classification` round-trips and validators behave exactly as before
    - Do NOT run the entire AMS test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 1.1 pass; AMS compiles
- `header_classification` persists/reads round-trip with the three valid values; invalid values rejected at the service layer
- `body_ordering_drift` accepted as a `body_classification` value with no schema change
- Changeset `190` registered with `not.columnExists`; new column nullable, no backfill
- No regression of existing status/body classification persistence or validation

### Validation-Service Layer (Node / TypeScript)

#### Task Group 2: Header capture + diff, ordering as its own dimension, break_type derivation
**Dependencies:** Task Group 1

Capture and diff response HEADERS in `jsonShapeComparator` (instead of discarding them), promote a non-volatile array reorder to `body_ordering_drift`, wire both into diff_item creation in `diffRunner`, and derive the break_type LIST in `findingEmissionRules.classifyDiffItem`. Status-class stays a severity sub-label of `status`, not a 6th type (R6).

- [x] 2.0 Complete validation-service comparator + classifier
  - [x] 2.1 Write 2-8 focused tests for the comparator + classifier
    - Limit to 2-8 highly focused tests maximum
    - Test only the load-bearing behaviours: header value drift on an allowlisted name yields `header_value_drift` (tolerable); header presence/absence yields `header_presence_drift` (always breaks); `Content-Type` change yields `header_value_drift` and is NOT in the allowlist; a non-volatile array reorder yields `body_ordering_drift` (not a `value_changed` cascade); `classifyDiffItem` returns the correct break_type set for a single-dimension and a multi-dimension diff; an input with NO `{headers, body}` wrapper emits NO header break (graceful degrade)
    - Skip exhaustive header-name and ordering permutations
  - [x] 2.2 Capture + diff response HEADERS in `jsonShapeComparator.ts`
    - At `unwrapBodyEnvelope` (`:231`), CAPTURE the `headers` key from BOTH sides instead of discarding it; keep the body unwrap symmetric so body comparison is unchanged once both sides wrap
    - Add a header walk producing two outcomes: `header_presence_drift` (a header appears/disappears) and `header_value_drift` (a value changes); reuse `buildPointer` (`:284`) for header pointer keys
    - Define ONE central constant of allowlisted volatile header NAMES, matched case-INSENSITIVELY (R4): `Date, Age, Expires, Last-Modified, ETag, Set-Cookie, X-Request-Id, X-Correlation-Id, X-Trace-Id, Request-Id, Trace-Id, X-Runtime, X-Response-Time, Server-Timing, Keep-Alive, Content-Length`. `Content-Type` and `Cache-Control, Location, Vary, Content-Encoding, Content-Disposition, WWW-Authenticate, Allow` are NOT allowlisted (must break). Tolerance applies to allowlisted VALUE changes ONLY, never presence/absence
    - Tag tolerated header values with the `volatilitySource` idiom (extend `VolatilitySource` `:102` / `BodyDiffEntry` `:89` / `CompareJsonShapesResult` `:170` to carry a header outcome)
    - Graceful degrade: when EITHER side lacks a `{headers, body}` wrapper, SKIP the header dimension entirely (emit NO header break); document the limitation in a code comment; no backfill (R5)
  - [x] 2.3 Promote non-volatile array reorder to `body_ordering_drift` in `jsonShapeComparator.ts`
    - Reuse the volatile-array multiset path (`isArrayVolatile` / `multisetEqual`, around `:553`) which already distinguishes a pure reorder from a content change
    - A NON-volatile array reorder produces a single `body_ordering_drift` body sub-classification instead of a per-element `value_changed` cascade (R1); a volatile-flagged array stays order-insensitive as today
  - [x] 2.4 Wire header + ordering into diff_item creation in `diffRunner.ts`
    - Mirror the existing status (`:444`) + body (`:463`) + `volatile_paths_json` envelope plumbing (`:458-462`); compute `header_classification` and pass it into `createDiffItem` (`:504`) alongside `status_classification` / `body_classification`
    - Set `body_classification = body_ordering_drift` when the comparator reports an ordering drift
    - Add header + ordering to the diff-count aggregation around `:482-500` WITHOUT changing existing status/body count semantics; extend `ApiBehaviourDiffDto` counts where present
  - [x] 2.5 Derive the break_type LIST in `findingEmissionRules.classifyDiffItem`
    - In `classifyDiffItem` (`:210`) derive a break_type LIST = the set of drifted dimensions: `status` / `headers` / `body-shape` / `body-value` / `ordering`. Single-dimension diffs read as exactly one type; multi-dimension diffs carry the full set
    - Status-class (2xx/4xx/5xx) stays a SEVERITY sub-label WITHIN the single `status` type via the existing `statusBucket` (`:59`) / `classifyStatusDriftSeverity` (`:78`) — NOT a 6th type (R6). `200->201` and `200->404` are both `Break(status)`, differing only in severity
    - Emit a header finding (e.g. `api_behaviour_header_drift`) and recognise `body_ordering_drift`, reusing the existing severity ladder + wording-table pattern (`:192-208`); surface the break_type set on the emission
    - Add the `archModelClient.ts` TS mirror for `header_classification` (lines 608-624 diff DTOs); add `header_value_drift` / `header_presence_drift` / `header_match` to the classification type and `body_ordering_drift` to the body classification type (snake_case)
  - [x] 2.6 Ensure validation-service tests pass + no regression
    - Run `npx tsc --noEmit` (clean) and the 2-8 targeted tests from 2.1
    - Run the FULL `npx jest` suite — must stay green (currently 296 pass / 1 skip after Spec A)
    - No regression: inputs that exercise ONLY status/body yield identical classifications, counts, findings, and volatility tolerance as today; the G1 null-envelope backward-compat path is preserved

**Acceptance Criteria:**
- The 2-8 tests from 2.1 pass; `npx tsc --noEmit` clean
- FULL `npx jest` stays green (296 pass / 1 skip baseline maintained)
- Headers diffed into `header_value_drift` / `header_presence_drift`; allowlist central + case-insensitive; `Content-Type` breaks
- Non-volatile reorder yields `body_ordering_drift`, not a value cascade
- `classifyDiffItem` returns the correct break_type set (single + multi-dimension); status-class is a `status` severity, not a 6th type
- Missing-wrapper inputs emit NO header break (graceful degrade)
- No regression of existing status/body classification, counts, findings, or volatility behaviour

### Gateway Layer (Node / TypeScript)

#### Task Group 3: Register new dimensions as breaks, carry break_type set, header-value volatility auto-disposition with MIXED-stays-open
**Dependencies:** Task Group 2

Make any drifted dimension register as a break, carry the break_type set onto the break `detail_json`, and extend the auto-disposition pass so a break auto-disposes to `expected_volatile` ONLY when ALL drifted dimensions are volatile-tolerated (R-volatile).

- [x] 3.0 Complete gateway break + auto-disposition layer
  - [x] 3.1 Write 2-8 focused tests for break registration + auto-disposition
    - Limit to 2-8 highly focused tests maximum
    - Test only: a header-only `header_presence_drift` registers as a break (presence/absence ALWAYS breaks, never tolerated); an allowlisted header VALUE drift alone auto-disposes to `expected_volatile`; MIXED (volatile header value + a real non-volatile body change) STAYS OPEN; a non-allowlisted header value change STAYS OPEN; an ordering drift registers as a break; `detail_json` carries the break_type set
    - Mirror the determinism spec's `migrationReconciliationNetNewAutoDisposition.test.ts` pattern
    - Skip exhaustive disposition permutations
  - [x] 3.2 Register new dimensions as breaks in `migrationReconciliationValidationClient.ts`
    - `isDiffItemABreak` (`:489`): change "not (`status_match && body_match`)" -> "ANY dimension drifted" — include `header_classification` (anything but `header_match`) and `body_classification === body_ordering_drift`
    - Extend `ReconciliationDiffItem` (`:41`) to carry `header_classification` + the derived break_type set
  - [x] 3.3 Carry the break_type set + header classification onto `detail_json` in `migrationReconciliationDriver.ts`
    - `diffItemToBreak` (`:261`): copy `header_classification` + the derived break_type set onto the break `detail_json` alongside the existing `status_classification` / `body_classification` / `body_diff_json`
  - [x] 3.4 Extend volatility classification for header-value volatility in `migrationReconciliationVolatilityDisposition.ts`
    - `classifyBreakVolatility` (`:168`): treat an allowlisted header VALUE change as volatile-tolerated; extend the `bodyHasSurvivingDrift` no-override guard (`:67`) to ALSO consider the header dimension; reuse `AUTO_TERMINAL_VOLATILITY_SOURCES` (`:53`)
    - Header presence/absence (`header_presence_drift`) and a non-allowlisted header value change are NEVER tolerated (treated as surviving drift)
  - [x] 3.5 Extend `autoDisposeVolatileBreaks` for MIXED-stays-open in `migrationReconciliationDriver.ts`
    - `autoDisposeVolatileBreaks` (`:708`): auto-dispose to `expected_volatile` ONLY when ALL drifted dimensions are volatile-tolerated (allowlisted header VALUE changes + existing volatile body paths/ordering)
    - MIXED-stays-open (load-bearing, R-volatile): ANY non-volatile drift, OR header presence/absence, OR a non-allowlisted header value change -> break STAYS OPEN
    - Reuse the `EXPECTED_VOLATILE` disposition (plain TEXT, no DDL) + `buildVolatilityAuditNote`; record the tolerated header names in the audit note; create-then-auto-dispose, never silent
  - [x] 3.6 Ensure gateway tests pass + no regression
    - Run gateway `npx tsc --noEmit` (clean) and the 2-8 targeted tests from 3.1
    - No regression: body-only and status-only volatile auto-disposition behave exactly as today (existing `expected_volatile` body policy unchanged); non-volatile body/status breaks still STAY OPEN
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 3.1 pass; gateway `npx tsc --noEmit` clean
- `isDiffItemABreak` registers header + ordering dimensions as breaks
- `detail_json` carries `header_classification` + the break_type set
- Allowlisted-header-value-only drift auto-disposes to `expected_volatile`; MIXED / presence-absence / non-allowlisted -> STAYS OPEN
- Audit note records tolerated header names; create-then-auto-dispose preserved
- No regression of existing status/body break registration or volatile disposition

### Frontend Layer (React / TypeScript)

#### Task Group 4: Per-dimension break-type badges + source-baseline-item header carry
**Dependencies:** Task Group 3

Render the derived break_type set as distinct per-dimension badges in the reconciliation panel, surface tolerated header names in the volatility detail, and fix the SOURCE baseline-item construction so it stores `{ headers, body }` symmetric with the target side (R5).

- [x] 4.0 Complete frontend rendering + source header carry
  - [x] 4.1 Write 2-8 focused tests for the panel + header carry
    - Limit to 2-8 highly focused tests maximum
    - Test only: a break with a multi-dimension break_type set renders distinct per-dimension badges (status / headers / body-shape / body-value / ordering) off `detail_json`; a volatile-disposed header break shows the tolerated header names in the volatility detail; an OLD break lacking a break_type set degrades gracefully (no crash, falls back to existing rendering)
    - Use focused vitest; mirror the determinism spec's `MigrationDeliveryReconciliationVolatile.test.tsx` pattern
    - Skip exhaustive badge/state permutations
  - [x] 4.2 Render per-dimension break-type badges in `MigrationDeliveryReconciliationPanel.tsx`
    - In the breaks table (`:865`; columns Source operation / Drift summary / Disposition / Attempts / State) render the derived break_type set as distinct per-dimension badges read off `detail_json`
    - Reuse `breakDetail` (`:90`) and `dispositionBadgeClass` (`:247`)
    - In the `BreakVolatilityDetail` drawer (`:363`) show tolerated header names the same way volatile body paths are shown
    - Graceful degrade: breaks lacking a break_type set fall back to existing drift-summary rendering (no crash)
  - [x] 4.3 Fix SOURCE baseline-item header carry at `SaveAsBaselineModal.tsx:156`
    - Change `response_json: cap.response_body_json` -> `response_json: { headers: cap.response_headers_redacted_json ?? null, body: cap.response_body_json }`, symmetric with the target side (`targetReplayRunner.ts:594-597`)
    - Headers are ALREADY captured + redacted on the capture row (`response_headers_redacted_json`, `apiBehaviourClient.ts:281`) — this is NOT a new capture feature
    - Graceful degrade for OLD baselines lacking source headers: the comparator already skips the header dimension when a wrapper is absent (Task 2.2); no backfill, no admin re-probe tooling
  - [x] 4.4 Ensure frontend checks pass + no regression
    - Run frontend typecheck on the CHANGED files only (the repo has ~515 pre-existing unrelated tsc errors; do not gate on the full-repo typecheck)
    - Run the 2-8 focused vitest tests from 4.1
    - No regression: the existing breaks table, disposition badges, and `BreakVolatilityDetail` body-path rendering are unchanged for breaks without header/ordering dimensions
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests from 4.1 pass; changed-file frontend typecheck clean
- Per-dimension break-type badges render distinctly off `detail_json`
- Tolerated header names shown in the volatility detail
- Source baseline item stored as `{ headers, body }`; old baselines degrade gracefully (no false breaks, no crash)
- No regression of existing breaks-table / disposition / volatility-detail rendering

### Cross-Layer Testing

#### Task Group 5: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-4

Review the focused tests from Groups 1-4 and fill ONLY the load-bearing cross-layer invariant gaps. Max 10 additional tests.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-8 AMS tests (Task 1.1), the 2-8 comparator/classifier tests (Task 2.1), the 2-8 gateway tests (Task 3.1), and the 2-8 frontend tests (Task 4.1)
    - Total existing focused tests: approximately 8-32
  - [x] 5.2 Analyze cross-layer coverage gaps for THIS feature only
    - Identify load-bearing invariants spanning layers that lack end-to-end coverage; focus ONLY on this spec's requirements
    - Do NOT assess whole-application coverage; prioritise end-to-end invariants over unit gaps
  - [x] 5.3 Write up to 10 additional strategic tests maximum, covering the load-bearing invariants
    - MIXED-stays-open: a volatile (allowlisted) header value change + a real non-volatile body change -> break STAYS OPEN (not auto-disposed)
    - Header presence/absence ALWAYS breaks (never tolerated)
    - `Content-Type` change breaks (not in the allowlist)
    - A non-volatile array reorder -> `body_ordering_drift` ordering break (not a value cascade)
    - No regression of existing status/body classification, counts, findings, and volatile disposition
    - Add a MAXIMUM of 10 new tests; skip edge cases, performance, and accessibility unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY this spec's tests (from 1.1, 2.1, 3.1, 4.1, and 5.3) per layer; expected total approximately 18-42 tests
    - Re-run the FULL validation-service `npx jest` once to confirm the 296-pass / 1-skip baseline (plus this spec's additions) stays green
    - Do NOT run the entire application test suite across all modules
    - Explicit no-regression check: status-only and body-only inputs yield identical classifications, counts, findings, and volatility tolerance as before this spec

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 18-42 total)
- The load-bearing invariants are covered: MIXED-stays-open, presence/absence always breaks, Content-Type breaks, non-volatile reorder -> ordering break
- No more than 10 additional tests added
- Demonstrated no regression of existing status/body break behaviour
- Testing focused exclusively on this spec's requirements

## Execution Order

Recommended implementation sequence (bottom-up, dependency-ordered, mirroring the 2026-06-16 determinism spec):
1. AMS Layer (Task Group 1) — column, value, DTO/service plumbing, changeset 190
2. Validation-Service Layer (Task Group 2) — header + ordering comparator, diffRunner, break_type derivation
3. Gateway Layer (Task Group 3) — break registration, detail_json carry, header-value auto-disposition with MIXED-stays-open
4. Frontend Layer (Task Group 4) — per-dimension badges + source-baseline-item header carry
5. Cross-Layer Test Review (Task Group 5) — load-bearing invariants, max 10 added tests
