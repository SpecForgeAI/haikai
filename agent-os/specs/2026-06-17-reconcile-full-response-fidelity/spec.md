# Specification: Reconcile Full-Response Fidelity & Distinct Break Types

## Goal
Make the oracle reconciliation diff compare EVERY response dimension (status, status-class, response headers, body shape, body value, array ordering) and tag each diff_item with a derived break-type SET so header / ordering divergences the oracle silently misses today surface as breaks, are classified distinctly in findings and the UI, and auto-dispose to `expected_volatile` only when ALL drifted dimensions are volatile-tolerated.

## User Stories
- As a migration reviewer, I want a Content-Type flip, a dropped/added header, or a reordered collection to surface as its own typed break so I see the real behavioural divergence instead of a silent miss or a value-cascade.
- As a migration reviewer, I want allowlisted volatile header values (Date, request-id, etc.) tolerated automatically while header presence/absence and non-allowlisted header changes still break, so triage isn't flooded but nothing real is suppressed.
- As a triager, I want each break tagged with the set of dimensions that drifted (e.g. Break(headers) + Break(body-value)) so I can tell header breaks from body breaks at a glance.

## Specific Requirements

**One break per diff_item; per-dimension classifications (R1 + R2)**
- NO cardinality change: still exactly one break per drifting diff_item; do NOT split into one-break-per-dimension (that is OUT-OF-SCOPE-FUTURE).
- On `ApiBehaviourDiffItemEntity`/DTO keep `status_classification` + `body_classification`; ADD a `header_classification` column mirroring them: `header_match` / `header_value_drift` / `header_presence_drift`.
- Represent ORDERING as a body sub-classification value `body_ordering_drift` (preferred over a new column; ordering is body-derived). A non-volatile array reorder produces `body_ordering_drift` instead of a `value_changed` cascade.
- `findingEmissionRules.classifyDiffItem` derives a break_type LIST = the set of drifted dimensions: `status` / `headers` / `body-shape` / `body-value` / `ordering`. Single-dimension diffs read as exactly one type; multi-dimension diffs carry the full set.
- Surface the type set on the emission + the break `detail_json` so the frontend renders per-dimension badges.

**Diff response headers instead of discarding them (FR-1, R5)**
- `jsonShapeComparator.unwrapBodyEnvelope` (`jsonShapeComparator.ts:231`) currently throws away the `headers` key; add a header comparison that reads `response_json.headers` from BOTH sides before/alongside the body unwrap.
- Header comparison yields two outcomes per the new classification: `header_presence_drift` (a header appears/disappears) and `header_value_drift` (an allowlisted-or-not value changes); reuse `buildPointer` for header pointer keys.
- Header dimension contributes to the diff_item's `header_classification` and to the break_type set; presence drift always breaks (never tolerated).
- Degrade gracefully: when EITHER side lacks a `{headers, body}` wrapper (pre-existing source baselines), SKIP the header dimension entirely — emit NO header break (no false positive) — and document the limitation. No backfill.

**Carry source-side headers symmetric with target (R5)**
- Headers are ALREADY captured + redacted on the capture row (`response_headers_redacted_json`, `apiBehaviourClient.ts:281`); this is NOT a new capture feature.
- Fix SOURCE baseline-item construction so `response_json` is stored as `{ headers, body }` symmetric with the target side (`targetReplayRunner.ts:594-597`). The source side is pinned by the frontend at `SaveAsBaselineModal.tsx:156` (`response_json: cap.response_body_json`) — change it to `{ headers: cap.response_headers_redacted_json ?? null, body: cap.response_body_json }`.
- Keep `unwrapBodyEnvelope` symmetric so body comparison is unchanged once both sides wrap; the header walk reads the pre-unwrap `headers` key.

**Status-class is severity of the `status` break type, NOT a 6th type (R6)**
- The five break types remain: `status` / `headers` / `body-shape` / `body-value` / `ordering`. Status-class (2xx vs 4xx vs 5xx) is a SEVERITY/sub-label within the single `status` break type.
- `200→201` and `200→404` are both `Break(status)`, differing only in severity via the existing `classifyStatusDriftSeverity` / `statusBucket` (`findingEmissionRules.ts:59,78`). No DDL or new classification value for status-class.

**Default volatile-header allowlist — one central constant, case-insensitive (R3 + R4)**
- Define ONE central constant of allowlisted header NAMES whose VALUE changes are tolerated, matched case-insensitively: `Date, Age, Expires, Last-Modified, ETag, Set-Cookie, X-Request-Id, X-Correlation-Id, X-Trace-Id, Request-Id, Trace-Id, X-Runtime, X-Response-Time, Server-Timing, Keep-Alive, Content-Length`.
- `Content-Type` is explicitly NOT allowlisted (must break). Likewise `Cache-Control, Location, Vary, Content-Encoding, Content-Disposition, WWW-Authenticate, Allow` break.
- Tolerance applies to allowlisted header VALUE changes ONLY — never to presence/absence.
- NO in-UI declaration of additional volatile header names this iteration; record that (mirroring `declareVolatilePaths`) as an explicit future follow-on. Document the list as narrow + extensible.

**Register new dimensions as breaks (gateway, R2)**
- `isDiffItemABreak` (`migrationReconciliationValidationClient.ts:489`) currently returns "not (`status_match` && `body_match`)"; change to "ANY dimension drifted" — include `header_classification` (anything but `header_match`) and `body_ordering_drift`.
- Extend `ReconciliationDiffItem` (`migrationReconciliationValidationClient.ts:41`) and `diffItemToBreak` (`migrationReconciliationDriver.ts:261`) to copy `header_classification` + the derived break_type set onto the break `detail_json` alongside the existing `status_classification` / `body_classification` / `body_diff_json`.

**Auto-dispose only when ALL drifted dimensions are volatile-tolerated (R-volatile)**
- Extend `classifyBreakVolatility` (`migrationReconciliationVolatilityDisposition.ts:168`) + `autoDisposeVolatileBreaks` (`migrationReconciliationDriver.ts:708`) so a break auto-disposes to `expected_volatile` ONLY when ALL drifted dimensions are volatile-tolerated: allowlisted header VALUE changes + existing volatile body paths/ordering.
- MIXED-stays-open (load-bearing): ANY non-volatile drift, OR header presence/absence, OR a non-allowlisted header value change → break STAYS OPEN. This extends the existing `bodyHasSurvivingDrift` no-override guard to also consider the header dimension.
- Reuse the `EXPECTED_VOLATILE` disposition (plain TEXT, no DDL) + `buildVolatilityAuditNote`; record tolerated header names in the audit note. Create-then-auto-dispose, never silent.

**AMS persistence + changeset (R8)**
- Add `header_classification` (nullable String, service-layer validated, no DB enum) to `ApiBehaviourDiffItemEntity`, `ApiBehaviourDiffItemDto`, `CreateApiBehaviourDiffItemRequest`, and the `archModelClient.ts` TS mirror (lines 608-624). snake_case wire (AMS default), NO `@CamelCaseWire`.
- `body_ordering_drift` is a new accepted value of the existing `body_classification` field — no new column, service-layer validation only.
- New Liquibase changeset for the `header_classification` column: expect 190 (A took 189 — `189-capture-coverage-summary.sql` is on disk); the builder VERIFIES highest-on-disk +1 at build time; use the `not.columnExists` precondition idiom (mirrors 187/188) and register after the highest in `db.changelog-master.yaml`. New nullable column, no backfill. break_type derivation stays service-layer (no enum DDL).

**Finding emission + counts (FR-2, FR-5)**
- Extend `classifyDiffItem` (`findingEmissionRules.ts:210`) to emit a header finding (e.g. `api_behaviour_header_drift`) and recognise `body_ordering_drift`, threading the break_type set; reuse the existing severity ladder + wording-table pattern.
- Add header/ordering to the diff-count surface where present (`ApiBehaviourDiffDto` counts, `diffRunner.ts` count aggregation around `:482-500`) without changing existing status/body count semantics.
- No regression: inputs that exercise only status/body must yield identical classifications, counts, findings, and volatility tolerance as today (G1 null-envelope backward-compat preserved).

**Frontend per-dimension break-type badges (FR-2)**
- In `MigrationDeliveryReconciliationPanel.tsx` (breaks table at `:865`; columns Source operation / Drift summary / Disposition / Attempts / State) render the derived break_type set as distinct per-dimension badges (status / headers / body-shape / body-value / ordering) read off `detail_json`.
- Reuse `breakDetail` (`:90`), `dispositionBadgeClass` (`:247`), and the `BreakVolatilityDetail` drawer (`:363`); show tolerated header names in the volatility detail the same way volatile body paths are shown.

## Existing Code to Leverage

**`jsonShapeComparator.ts` — the comparator (`unwrapBodyEnvelope` :231, `walk` :488, `buildPointer` :284)**
- `unwrapBodyEnvelope` is the exact discard point for headers; capture the `headers` key here instead of dropping it.
- The volatile-array multiset path (`isArrayVolatile` / `multisetEqual`, around `:553`) already distinguishes a pure reorder from a content change — lean on it so a non-volatile reorder becomes a `body_ordering_drift` rather than a per-element value cascade.
- `BodyDiffEntry` / `LeafDiffKind` / `VolatilitySource` (`:89-142`) and `CompareJsonShapesResult` (`:170`) are the shapes to extend (add a header outcome + the `volatilitySource` tagging idiom for tolerated header values).

**`diffRunner.ts` — diff driver (status class `:444`, body `:463`, persist `:504`, counts `:482`)**
- Mirrors today's status + body classification + `volatile_paths_json` envelope plumbing (`:458-462`); add the header dimension and ordering classification alongside, passing `header_classification` into `createDiffItem`.

**`findingEmissionRules.ts` — pure classifier (`classifyDiffItem` :210, `statusBucket` :59, `classifyStatusDriftSeverity` :78)**
- `statusBucket` + `classifyStatusDriftSeverity` already compute status class for severity — reuse for the `status` break-type severity (R6), not a 6th type. Extend the emission branches to add the header finding + ordering + break_type set.

**`migrationReconciliationVolatilityDisposition.ts` + `migrationReconciliationDriver.ts` — auto-disposition idiom**
- `classifyBreakVolatility` (`:168`), `bodyHasSurvivingDrift` (`:67`), `AUTO_TERMINAL_VOLATILITY_SOURCES` (`:53`), and `autoDisposeVolatileBreaks` (driver `:708`) are the exact pass to extend for header-value volatility + the MIXED-stays-open invariant. `EXPECTED_VOLATILE` disposition + `buildVolatilityAuditNote` reused verbatim.

**Determinism spec idioms (`agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/`)**
- Reuse its layer ordering (AMS → validation-service → gateway → frontend), the `expected_volatile` visible-disposition + audit-note pattern, the `not.columnExists` changeset precondition (changesets 187/188), and its auto-disposition + frontend test patterns as the template for this spec's tests.

## Out of Scope
- One-break-PER-dimension with independent disposition (recorded as OUT-OF-SCOPE-FUTURE; one break per diff_item only).
- In-UI declaration of additional volatile header names (future follow-on; default allowlist only this iteration).
- Response TIMING/latency diff (R7) — `duration_ms` stays captured but is not diffed.
- Capture-side coverage scoring (Spec A) and baseline integrity/provenance (Spec C).
- Backfill of pre-existing source baselines lacking headers; any admin re-probe tooling (degrade gracefully + document instead).
- Mutating / stateful reconcile.
- Any automated "too many tolerated headers" threshold/alert.
- Status-class as a distinct (6th) break type — it is a severity within the single `status` type.
- Adding `@CamelCaseWire` to the new AMS field (AMS default snake_case applies).
