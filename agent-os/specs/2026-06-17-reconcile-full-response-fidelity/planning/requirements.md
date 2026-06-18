# Spec Requirements: Reconcile Full-Response Fidelity & Distinct Break Types

## Initial Description

(From `planning/raw-idea.md` — Spec B of a 3-spec series; A=coverage scoring, B=this, C=baseline integrity & provenance.)

Make the oracle reconciliation diff engine compare EVERY dimension of the response and classify each divergence with its own break type. Today the reconcile diff compares STATUS + BODY only. Response HEADERS are captured but never compared; timing isn't; arrays are diffed strict-positional. A migration that changes Content-Type, drops/adds a header, returns a different 4xx subtype, or reorders a collection is a real behavioural divergence the oracle SILENTLY MISSES. There is no per-dimension break TYPE, so body breaks and (future) header breaks can't be told apart in triage/UI.

**Locked decisions (fixed; do not relitigate):**
1. Diff EVERY response dimension: HTTP status (incl. status-CLASS, e.g. 2xx vs 4xx), response HEADERS, body SHAPE (key add/remove, type change), body VALUE, and array ORDERING.
2. Distinct break TYPES per dimension (Break(status) / Break(headers) / Break(body-shape) / Break(body-value) / Break(ordering)), each its own classification + severity, surfaced distinctly in findings and the frontend break list. Reuse/extend the EXISTING break-type classification rather than inventing a parallel one.
3. Header volatile-allowlist: ignore known-volatile header VALUES (Date, timestamp-ish, request/correlation IDs, etc.) by default, reusing the determinism spec's `expected_volatile` visible-disposition idiom. A header appearing/disappearing, or a NON-allowlisted header changing, must STILL break. Volatility tolerates allowlisted header VALUES only — not presence/absence.
4. Preserve the oracle invariant: NO silent suppression. The allowlist is narrow, visible, auditable (same philosophy as the determinism spec). A deliberately-changed non-volatile response detail MUST still break.

**Out of scope (raw idea):** capture-side coverage scoring (Spec A), baseline integrity/provenance (Spec C), mutating/stateful reconcile (deferred), timing diff (mentioned but not in the locked dimension set — see Q7).

## Requirements Discussion

This spec was shaped by direct codebase research against a requester who has pre-locked the key decisions; there was no interactive end-user Q&A. The questions below are posed to the orchestrator with a "Locked?" verdict each (see the final response). Answers will be filled from the locked decisions.

### Existing Code to Reference

**The reconcile diff engine (TS, `api-migration-validation-service`):**
- `src/services/jsonShapeComparator.ts` — THE comparator. `compareJsonShapes(source, target, ctx?)` (line 674). `unwrapBodyEnvelope` (line 231) DISCARDS the `headers` key — this is exactly where header comparison must be added. `walk` (line 488) does the SHAPE/VALUE/ORDERING walk; `BodyDiffEntry.kind` ∈ `key_added | key_removed | type_changed | value_changed` (line 89); volatile arrays already get multiset (order-insensitive) handling (line 553); `VolatilitySource` taxonomy (line 102); `buildPointer` (line 284) is the path-normalisation primitive to reuse.
- `src/services/diffRunner.ts` — drives the diff. Status classification at line 444 (`sStatus === tStatus ? 'status_match' : 'status_drift'`). Body via `compareJsonShapes` at line 463. Persists diff_items via `createDiffItem` (line 504). PATCH completion counts (line 559). Finding-emission tail block (line 649). Volatility envelope plumbing (lines 146-196, 458-462).
- `src/services/findingEmissionRules.ts` — the PURE classifier `classifyDiffItem` (line 210) maps a diff_item to a `DiscoveryFinding` emission (findingType/severity/title/summary). Severity ladder + wording table (lines 192-208). `statusBucket` (line 59) + `classifyStatusDriftSeverity` (line 78) ALREADY compute status CLASS (2xx/4xx/5xx) for severity, but NOT as a distinct break type. `summariseBodyShapeDiff` reads `kind` (line 91).
- `src/services/archModelClient.ts` — AMS wire client. Diff DTOs at lines 549-638. `ApiBehaviourDiffStatusClassification` (line 551) and `ApiBehaviourDiffBodyClassification` (line 557) are the existing classification enums. `BaselineItemDto.response_json` (line 488) is the only response field on the baseline item; `CaptureDto.response_headers_redacted_json` (line 332) is captured on the CAPTURE row. Diff DTO count fields at lines 570-575.
- `src/services/targetReplayRunner.ts` — line 594: target baseline item `response_json` is stored as `{ headers: capture.response_headers_redacted_json, body: capture.response_body_json }`. This is the captured-but-ignored header surface.

**The AMS persistence (Java/Spring/Postgres):**
- `model/entity/apibehaviour/ApiBehaviourDiffItemEntity.java` — the diff_item row. `statusClassification` (line 127, NOT NULL) + `bodyClassification` (line 136, nullable) are the classification columns (service-layer validated, no DB enum). `bodyDiffJson` JSONB (line 170). NO per-dimension break-type column exists.
- `model/entity/MigrationReconciliationBreakEntity.java` — the run-scoped BREAK row (changeset 183). References a diff_item via `diffItemId` (line 99); carries `dispositionStatus` (line 123) + inline `detailJson` (line 116). This is what the gateway/frontend break list reads.
- `model/entity/MigrationReconciliationBreakStatus.java` — the DISPOSITION enum (open / sent_as_bug / accepted / expected_net_new / EXPECTED_VOLATILE / info / …). NOTE: this is the break DISPOSITION, NOT the break TYPE. `EXPECTED_VOLATILE` (line 161) + `TERMINAL_HUMAN_DISPOSITIONS` (line 193) are the determinism-spec idiom to reuse for header volatility.
- DTOs: `model/dto/apibehaviour/ApiBehaviourDiffItemDto.java`, `CreateApiBehaviourDiffItemRequest.java`, `UpdateApiBehaviourDiffRequest.java`; entity `ApiBehaviourDiffEntity.java` (the count summary).
- Liquibase changelog: `src/main/resources/db/changelog/db.changelog-master.yaml` + `sql/NNN-*.sql`. Last applied = 188 (`188-capture-volatile-paths.sql`). The builder must verify next-free at build time (Spec A in the series claims 189; this spec expects ~190).

**The gateway reconciliation drivers (TS, `gateway`):**
- `src/services/migrationReconciliationDriver.ts` — `diffItemToBreak` (line 261) maps a diff_item to a break row, copying `status_classification` / `body_classification` / `body_diff_json` onto `detail_json`. `autoDisposeNetNewTargetOnly` (line 537) and `autoDisposeVolatileBreaks` (line 708) are the post-diff auto-disposition sibling passes (the idiom to extend for header volatility). `declareVolatilePaths` (line 834) + `applyDeclaredPathsToDetail` (line 937) re-tag entries retroactively.
- `src/services/migrationReconciliationVolatilityDisposition.ts` — the PURE volatility classifier (`classifyBreakVolatility` line 168; `AUTO_TERMINAL_VOLATILITY_SOURCES` line 53). The pattern for a header-volatility classifier.
- `src/services/migrationReconciliationValidationClient.ts` — `ReconciliationDiffItem` wire shape (line 41); `isDiffItemABreak` (line 489: anything not `status_match && body_match` is a break) — THIS is where new break dimensions must register as breaks; `runHeadlessReconcile` (line 285).
- `src/services/migrationReconciliationBreakClient.ts` — the break AMS client (`createReconciliationBreaks`, `patchReconciliationBreak`, etc.).

**The frontend break list (React/TS, `frontend`):**
- `src/components/ProductManager/MigrationDeliveryDashboard/MigrationDeliveryReconciliationPanel.tsx` — the run-scoped break review table. `breakDetail` (line 90) reads `detail_json`; `dispositionLabel` (line 209) / `dispositionBadgeClass` (line 247) render disposition; `BreakVolatilityDetail` (line 363) renders the volatile-path list + source badge; the table at line 865 (columns: Source operation / Drift summary / Disposition / Attempts / State). A new break TYPE needs a distinct column or badge here.
- `src/api/migrationReconciliationApi.ts` — the break DTO + client. `src/api/diffFindingsApi.ts` + `src/components/DashboardView/DiffFindingDetailDrawer.tsx` / `DiffItemDetailModal.tsx` — the diff-finding detail surface.

**Idiom reference spec (the requester named it):**
- `agent-os/specs/2026-06-16-reconcile-determinism-volatile-values/spec.md` + `tasks.md` — the determinism spec. Reuse its layer-ordering (AMS → validation-service → gateway → frontend), its `expected_volatile` disposition idiom, its `volatility_source` taxonomy, its "create-then-auto-dispose, never silent" invariant, its `not.columnExists` changeset precondition, and its auto-disposition test pattern (`migrationReconciliationNetNewAutoDisposition.test.ts` / `MigrationDeliveryReconciliationVolatile.test.tsx`).

No prior similar HEADER-diff or ORDERING-break-type feature exists; status + body are the only diffed dimensions today.

### Follow-up Questions

None asked interactively — see the orchestrator-facing question list with "Locked?" verdicts in the final response.

## Visual Assets

### Files Provided:
No visual assets provided. `ls` of `planning/visuals/` returned no image/PDF files (directory absent / empty). The feature reuses the existing break-review surface and break-detail drawer plus the reconcile run summary; no bespoke widget is expected (matching the determinism spec's "no visual assets / reuse existing surface" stance).

### Visual Insights:
- N/A (no visuals). The relevant existing UI is the `MigrationDeliveryReconciliationPanel` breaks table and `BreakVolatilityDetail` drawer.

## Requirements Summary

### Functional Requirements

**FR-1 — Diff every response dimension.** Extend the comparator so the reconcile diffs, per paired (method, path, scenario):
- HTTP status (existing) AND status CLASS (2xx/3xx/4xx/5xx bucket) as a recognised dimension. `statusBucket` already exists in `findingEmissionRules.ts`; it must inform classification, not just severity.
- Response HEADERS: presence (add/remove) and value changes. Source for the comparison is the target baseline item's `response_json.headers` (stored by `targetReplayRunner.ts:595`) vs the source side's headers (NOTE: source baseline item `response_json` is RAW body, no header wrapper today — header capture symmetry on the SOURCE side is an open gap; see Q5).
- Body SHAPE (existing: key_added / key_removed / type_changed).
- Body VALUE (existing: value_changed).
- Array ORDERING: a positional reorder of an array that is NOT volatile-flagged. Today the strict positional walk reports a reorder as a pile of `value_changed` entries; ordering must become its own recognisable dimension/break type rather than a body-value cascade.

**FR-2 — Distinct break TYPES per dimension.** Introduce a per-dimension break TYPE/category that flows: comparator → diff_item (AMS) → break row (AMS) → gateway break → frontend break list. The five types: `status` (incl. status-class), `headers`, `body-shape`, `body-value`, `ordering`. Each has its own classification and severity, surfaced distinctly in finding emission (`findingEmissionRules.ts` findingType) and the frontend break list. MUST extend the existing classification chain (`status_classification` + `body_classification` + `findingType`), not invent a parallel taxonomy. (See Q1 on where the type field physically lives.)

**FR-3 — Header volatile-allowlist (reuse determinism idiom).** A default allowlist of known-volatile header NAMES whose VALUES are tolerated (e.g. Date, timestamp-ish, request/correlation IDs). A header diff landing entirely on allowlisted header VALUE changes is auto-dispositioned to `expected_volatile` (visible, terminal, human-overridable), mirroring `autoDisposeVolatileBreaks`. A header appearing/disappearing, or a NON-allowlisted header value change, STILL breaks. Volatility tolerates allowlisted header VALUES only — never presence/absence.

**FR-4 — Oracle invariant preserved (no silent suppression).** Every header/ordering/status-class allowance is create-then-auto-dispose (the break is created and visible first, then dispositioned), never dropped. The allowlist is narrow, visible, auditable. A deliberately-changed non-volatile response detail still breaks. Mixed (one volatile header + one real change) stays open.

**FR-5 — No regression of status/body behaviour or tests.** Existing `status_drift` / `body_shape_drift` / `body_value_drift` classification, counts, finding emission, and the volatility tolerance (G1 null-envelope backward-compat) must be unchanged for inputs that exercise only those dimensions.

### Reusability Opportunities
- **Comparator extension point:** `unwrapBodyEnvelope` / `compareJsonShapes` in `jsonShapeComparator.ts` — the unwrap currently throws away `headers`; capture it for a header walk instead of discarding.
- **Path normalisation:** reuse `buildPointer` for any header/ordering pointer keys.
- **Array ordering:** the volatile-array multiset path (`isArrayVolatile` / `multisetEqual`, lines 346/448) already distinguishes reorder from content change — the ordering break type can lean on the same machinery (a non-volatile reorder = an `ordering` break instead of a value cascade).
- **Auto-disposition:** `autoDisposeVolatileBreaks` + `classifyBreakVolatility` + `buildVolatilityAuditNote` — extend (or sibling-add) for the header-value allowlist.
- **Disposition vocabulary:** `MigrationReconciliationBreakStatus.EXPECTED_VOLATILE` (plain TEXT, no DDL) already covers the volatile terminal; the header allowlist reuses it.
- **Frontend:** `BreakVolatilityDetail` + `dispositionBadgeClass` + the breaks table — extend to render the break TYPE distinctly.
- **Finding severity:** `statusBucket` + `classifyStatusDriftSeverity` already compute status class for severity.

### Scope Boundaries

**In Scope:**
- Header diff (presence + value) with a default volatile-header-name allowlist.
- Status-CLASS as a recognised dimension (not only a severity input).
- Array ORDERING as its own break type (non-volatile reorder).
- Distinct per-dimension break TYPE/category threaded comparator → AMS diff_item → AMS break → gateway → frontend.
- Reuse of the `expected_volatile` disposition + audit-note idiom for allowlisted header values.
- AMS Liquibase changeset for any new column(s) (expect ~190; builder verifies next-free; `not.columnExists` precondition).

**Out of Scope:**
- Capture-side coverage scoring (Spec A).
- Baseline integrity / provenance (Spec C).
- Mutating / stateful reconcile (deferred).
- Response TIMING/latency diff (raw idea calls it out as a gap but the locked dimension set in decision #1 does NOT include timing — see Q7; treat as out of scope unless the orchestrator says otherwise).
- Backfill of old baselines; any admin re-probe tooling.
- A configurable/admin-editable header allowlist UI (default allowlist only this iteration, unless Q3 says otherwise).
- Any automated threshold / "too many tolerated" alert.

### Technical Considerations
- **AMS wire = snake_case by default** (CLAUDE.md). New diff_item / break fields are snake_case, no `@CamelCaseWire`, boxed types for any numeric PATCH field (`project_primitive_double_dto_overwrite.md`).
- **Layer ordering** (mirror the determinism spec): AMS column/enum → validation-service comparator+diffRunner → gateway auto-disposition+driver → frontend. Each layer independently testable against mocked AMS + fixtures.
- **Changeset:** disposition values are plain TEXT (no DDL); a NEW per-dimension break-TYPE column on `api_behaviour_diff_items` (or a JSONB extension of `body_diff_json`) is the open design choice (Q1) — if a new column, it needs a changeset (~190, builder-verified, `not.columnExists`).
- **`isDiffItemABreak`** (gateway) currently keys off `status_match && body_match`; new header/ordering breaks must register here or they won't surface as breaks.
- **Source-side header capture asymmetry:** target baseline items store `{headers, body}`; source baseline items store raw body. Comparing header VALUES requires the source side to carry headers too — likely a capture/baseline-item change in scope, or a documented limitation (Q5).
- **Independence from Spec A:** must not collide with Spec A's changeset (A=189; this expects 190; builder verifies next-free).
- **Determinism precedent:** the comparator stays dimension-agnostic at break-creation time where possible; dispose/down-rank policy lives in the gateway pass (matching how `expected_volatile` body policy is split).

## Resolved Clarifications (AUTHORITATIVE — supersede the "open" verdicts above)

All shaper questions are resolved by the requirements authority. These are FIXED constraints for the spec-writer.

**R1 + R2 (break-type representation & cardinality) — ONE break per diff_item (NO cardinality change); record per-dimension classifications on the diff_item; tag the break with a derived break_type SET; surface dimensions distinctly in the UI via per-dimension badges.**
- Rationale: changing break cardinality (one→many per diff_item) would churn break identity (`diffItemId`), the bug-loop, dedup, and the existing volatile auto-dispose — out of scope for this spec.
- Extend `ApiBehaviourDiffItemEntity`: keep `status_classification` + `body_classification`; ADD `header_classification` (`header_match` / `header_value_drift` / `header_presence_drift`); represent ORDERING either as a body sub-classification value (`body_ordering_drift`) or via a small `dimension_classifications_json`. Prefer the explicit `header_classification` column (mirrors the existing two); use a JSON dimension-set only if more dimensions are needed.
- `findingEmissionRules.classifyDiffItem` derives a break_type LIST = the set of drifted dimensions (`status` / `headers` / `body-shape` / `body-value` / `ordering`). Single-dimension diffs read as exactly `Break(headers)` / `Break(body-value)`; multi-dimension diffs carry the full set.
- `isDiffItemABreak` (gateway) must register the NEW dimensions: change "not (`status_match && body_match`)" → "ANY dimension drifted" (incl. header / ordering).
- One-break-PER-dimension with independent disposition is recorded as OUT-OF-SCOPE-FUTURE; do not build it now.

**R3 (human-declarable volatile headers) — default allowlist ONLY this iteration.** Do NOT build in-UI declaration of additional volatile header names now. Record in-UI header declaration (mirroring `declareVolatilePaths`) as an explicit future follow-on.

**R4 (default volatile-header allowlist) — a NARROW default set, centrally defined as one constant, matched case-INSENSITIVELY; everything else breaks.**
- Allowlist (tolerate VALUE changes only): `Date`, `Age`, `Expires`, `Last-Modified`, `ETag`, `Set-Cookie`, `X-Request-Id`, `X-Correlation-Id`, `X-Trace-Id`, `Request-Id`, `Trace-Id`, `X-Runtime`, `X-Response-Time`, `Server-Timing`, `Keep-Alive`, `Content-Length` (derived from body; tolerating its value avoids double-counting volatile-body noise).
- **`Content-Type` is explicitly NOT allowlisted (must break).** Likewise `Cache-Control`, `Location`, `Vary`, `Content-Encoding`, `Content-Disposition`, `WWW-Authenticate`, `Allow` break.
- Document the list as narrow + extensible.

**R5 (source-side header asymmetry) — IN SCOPE but BOUNDED.** Headers are ALREADY captured + redacted on the capture row (`response_headers_redacted_json`) — NOT a new capture feature. Fix the SOURCE baseline-item construction to store `response_json` as `{ headers, body }`, symmetric with the target side (`targetReplayRunner.ts:594-597`). PRE-EXISTING baselines lacking source headers degrade gracefully — skip the header dimension (NO false break) and document the limitation; no backfill. Does not overlap Spec A/C; Spec C hashes whatever shape exists at its build time (B lands before C).

**R6 (status-class) — status-class is a SEVERITY/sub-label of the single `status` break type, NOT a 6th break type.** `200→201` (same class) vs `200→404` (class change) are both `Break(status)`, differing in severity via the existing `classifyStatusDriftSeverity`/`statusBucket`. The five break types remain: status / headers / body-shape / body-value / ordering.

**R7 (timing) — OUT of scope.** `duration_ms` stays captured but is not diffed (inherently noisy, not a behavioural contract). A tolerance-based timing dimension is a possible future spec.

**R8 (changeset) — CONFIRMED.** A=189; this spec expects 190; the builder verifies next-free (highest-on-disk +1) at build time and uses the `not.columnExists` precondition idiom. New classification column(s) need a changeset; break_type derivation is service-layer (TEXT/JSON, no new enum DDL unless trivial).

**R-volatile (auto-dispose extension, ties R2+R4) — load-bearing invariant.** Extend the determinism spec's `classifyBreakVolatility` / `autoDisposeVolatileBreaks` so a break auto-disposes to `expected_volatile` ONLY when ALL drifted dimensions are volatile-tolerated (allowlisted header VALUE changes + existing volatile body paths/ordering). ANY non-volatile drift, OR header presence/absence (appearing/disappearing), OR a non-allowlisted header change → break STAYS OPEN (MIXED-stays-open).
