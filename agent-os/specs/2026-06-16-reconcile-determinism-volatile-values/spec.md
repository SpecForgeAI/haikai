# Specification: Reconcile-Time Determinism & Volatile-Value Handling

## Goal
Make the reconciliation diff engine honest about legitimate non-determinism (server timestamps, generated IDs, unordered collections) so a clean current-state to target reconcile produces signal not noise, while preserving the load-bearing oracle invariant: the oracle is current-state, there is no silent override, and a deliberately-changed value still breaks. Volatility is measured empirically on the current system, recorded on the immutable baseline, and a break landing only on volatile paths is auto-dispositioned to a new, human-visible, human-overridable `expected_volatile` state.

## User Stories
- As a migration analyst, I want responses that legitimately vary on the current system (timestamps, fresh IDs, unordered collections) to not flood the reconcile with false breaks, so a real behavioural divergence is not drowned in noise.
- As the platform owner, I want every volatility allowance to be visible and auditable, never a silent suppression, so the "oracle always breaks on a real divergence" invariant holds and an over-broad judgment can be caught and reversed.
- As a reviewer, I want to see why a break was classed volatile (which JSON paths, and whether measured / endpoint-flagged / heuristic / declared) and to move it back to `open` with one action.

## Specific Requirements

**Empirical volatility probe at capture / pin time**
- After the capture loop records a current-state scenario, replay it against the current system `k` times (default `k = 3`, `VOLATILITY_PROBE_REPEATS`) and self-diff the responses using the existing `compareJsonShapes` machinery.
- HTTP-only, no LLM call; reuses the replay client, runs inline at pin time (the only time the current system is authoritative and callable).
- Apply an inter-replay spacing (`VOLATILITY_PROBE_SPACING_MS`) so per-second clock-bucket fields surface across repeats.
- Apply a wall-clock budget (`VOLATILITY_PROBE_BUDGET_MS`); on exceed, abort and record a partial result from the completed replays.
- Any JSON path differing across repeats is a measured volatile path, recorded as a normalised JSON-Pointer list; an array path flagged means order-insensitive.
- Mutating / non-idempotent scenarios (`mutating_calls_confirmed` or POST/PUT/DELETE) are NOT probed (replay changes state); they fall back to endpoint_signal / heuristic / declared and are tagged `not_probed`.

**Volatility envelope persistence on the immutable baseline**
- Store `{ paths, volatility_source, k (completed-repeat count) }` on the SOURCE baseline item, captured once and never mutated thereafter (consistent with baseline immutability).
- Add AMS column `volatile_paths_json JSONB NULL` on the source-baseline-item table, surfaced on the baseline-item DTO (snake_case wire, AMS default, NO `@CamelCaseWire`).
- New Liquibase changeset at the next free number `187` (`187-baseline-item-volatile-paths.sql`; `186-work-item-provenance.sql` confirmed highest; include a `not.columnExists` precondition; never edit an applied changeset).
- Envelope keyed to the specific baseline item / captured scenario; NO carry-forward or merge across captures or scenario versions.
- `null` means no volatility recorded and yields strict comparison (backward-compatible default; today's behaviour).

**`volatility_source` taxonomy (full set)**
- `probed` — a full `k`-repeat measurement.
- `probed_partial` — budget-hit or incomplete probe with results from completed replays; trusted like a full probe (NOT down-ranked), stores the completed-repeat count.
- `endpoint_signal` — `non_deterministic_endpoint` discovery signal present; whole-response value tolerance, presence/shape still compared.
- `heuristic` — conservative value-shape match on an unprobed path; down-rank only, never auto-terminal.
- `declared` — operator-entered path; highest-trust.
- `non_json` — non-JSON / unparseable body at probe time; strict comparison, distinguishable from `null`.
- `not_probed` — mutating / non-idempotent scenario; probe not run, falls back to endpoint_signal / heuristic / declared.

**Consume the existing `non_deterministic_endpoint` signal**
- At diff time, if the operation's discovery findings include a `non_deterministic_endpoint` evidence-gap (Spring-only, built by `2026-05-30-oracle-integrity-determinism`), treat the whole response as value-tolerant (presence/shape still compared) even if the probe recorded nothing.
- This is the coarse fallback for low-frequency variance the `k`-repeat probe may miss; this spec is the signal's first consumer.
- Tag such allowances `volatility_source: "endpoint_signal"`.

**Conservative pattern-heuristic fallback (lower-confidence)**
- For fields the probe could not measure (mutating / unreplayable), apply a narrow heuristic: ISO-8601 timestamps, RFC-4122 UUIDs, epoch-millis integers in obviously time-named fields.
- Heuristic-classed paths are tagged `volatility_source: "heuristic"` and are never sufficient on their own to auto-dispose a break to terminal; they only down-rank it, because a guess must not silently absorb a real break.

**Human-declared volatile paths (in-UI, retroactive)**
- Declared through the EXISTING break-detail / disposition UI, persisted alongside the envelope, tagged `volatility_source: "declared"`. No config file, no new admin screen, no new API.
- A newly-declared path applies RETROACTIVELY to the current run (re-dispositions already-open breaks on that operation), not forward-only.
- This annotates variance; it does not change the captured oracle value.

**Diff-time per-path tolerance**
- In `jsonShapeComparator` / `diffRunner`, before classifying a diff entry, consult the operation's volatile-path set:
  - a VALUE difference on a volatile leaf path is not a `value_changed` entry;
  - an ARRAY flagged volatile is compared order-insensitively (multiset);
  - SHAPE differences (key added/removed, type changed) on a volatile path are STILL reported.
- Volatility tolerates VALUES and ORDERING only, never shape.
- Tolerance is per-path: one volatile timestamp plus a genuine value regression elsewhere still breaks on the regression.
- A `null` envelope must yield exactly today's strict comparison (backward-compat guard test).

**`expected_volatile` disposition + auto-rule**
- Add `EXPECTED_VOLATILE = "expected_volatile"` to `MigrationReconciliationBreakStatus.java`, in both `ALL` and `TERMINAL_HUMAN_DISPOSITIONS` (so it does not re-loop). Plain TEXT, NO DDL (mirrors `EXPECTED_NET_NEW` / `dismissed`).
- Post-diff auto-disposition pass (sibling to `autoDisposeNetNewTargetOnly`), running AFTER breaks are created so the diff engine stays volatility-agnostic:
  - divergence entirely on `volatility_source ∈ {probed, probed_partial, endpoint_signal, declared}` paths → PATCH to `expected_volatile`, `needs_human = false`, audit note listing paths + source;
  - mixed volatile + non-volatile divergence → stays `open` (the non-volatile part is a real break);
  - justified only by `heuristic` paths → down-rank to `info`, stays `open`;
  - `non_json` / `not_probed` / `null` → strict comparison, no auto-disposition;
  - human-overridable back to `open` via the existing PATCH path.

**Visibility**
- The break-detail surface shows the full normalised JSON-Pointer path list (collapsible if very large) plus a plain `volatility_source` label/badge, reusing existing metadata styling. Down-ranked-to-`info` heuristic breaks show their heuristic paths in the same drawer.
- The reconcile run summary DISPLAYS the `expected_volatile` count alongside `expected_net_new`. Displayed count only; no automated threshold, alert, or "too much tolerated" flag this iteration.

**Invariant guards (must-have tests)**
- No code path makes a break disappear: every volatility outcome is either `expected_volatile` (visible terminal) or `info` (visible, open).
- No-override guard: a deliberately-changed NON-volatile value still produces an `open` break even when the same response also has volatile paths.

## Visual Design
No visual assets provided (`planning/visuals/` confirmed empty). The feature reuses the existing breaks-review surface and break-detail drawer plus the reconcile run summary; no bespoke widget is built. The volatile-path list and `volatility_source` badge are added to the existing break-detail metadata the same way `expected_net_new` is shown.

## Existing Code to Leverage

**`buildPointer` — `api-migration-validation-service/src/services/jsonShapeComparator.ts`**
- JSON-Pointer / path normalisation primitive; reuse for the envelope path set. Do not re-author path normalisation.

**Diff engine — `jsonShapeComparator.ts` (`walk`, `kind`-tagged `BodyDiffEntry`) + `diffRunner.ts` (`{ entries }`)**
- The diff walk and entry storage; add the per-path tolerance here (value-skip on volatile leaves, multiset on volatile arrays, shape-still-breaks).

**`autoDisposeNetNewTargetOnly` — `gateway/src/services/migrationReconciliationDriver.ts`**
- Post-diff auto-disposition pass: PATCH to terminal + audit-note format, ambiguous stays open. The `expected_volatile` auto-rule is a sibling pass following this format; also hosts the retroactive re-disposition and the run-summary count.

**`MigrationReconciliationBreakStatus.java` (`ALL`, `TERMINAL_HUMAN_DISPOSITIONS`, `EXPECTED_NET_NEW`)**
- Disposition constants with the `EXPECTED_NET_NEW` precedent; add `EXPECTED_VOLATILE` to both sets, plain TEXT, NO DDL.

**`targetReplayRunner.ts` + `config.ts` — `api-migration-validation-service/src/...`**
- `targetReplayRunner.ts` is the HTTP replay path the probe reuses (no LLM), writing the envelope at pin time. `config.ts` is the env-loading home for `VOLATILITY_PROBE_REPEATS`, `VOLATILITY_PROBE_BUDGET_MS`, `VOLATILITY_PROBE_SPACING_MS`.

**`archModelClient.ts` baseline-item DTO + `non_deterministic_endpoint` source + auto-disposition test precedent**
- `archModelClient.ts` baseline-item DTO (`response_json`, `response_headers_redacted_json`, `source_baseline_item_id`) is the envelope read/write surface, plus the AMS entity/DTO/changeset where `volatile_paths_json` is added. The `non_deterministic_endpoint` emission source (`discovery-service` `emissionSources.ts`) is the consumed signal. `migrationReconciliationNetNewAutoDisposition.test.ts` is the pattern the new auto-disposition test mirrors.

## Out of Scope
- Silent suppression of breaks — every allowance is `expected_volatile` or down-ranked-to-`info`; nothing is dropped (the load-bearing invariant).
- Editing the pinned oracle — the envelope annotates the baseline; it never changes a captured value.
- Mutating-scenario probing — non-idempotent scenarios fall back to endpoint_signal / heuristic / declared (ties to the separate Row 9 mutating-replay concern).
- Header / timing diff dimensions — separate item; body value/ordering only.
- Non-JSON tolerance — non-JSON bodies tagged `non_json` and kept strict.
- Changing the capture loop's scenario selection or the `temperature: 0` / caching determinism work (upstream, already done).
- Backfill of `volatile_paths_json` for already-pinned baselines.
- Any migration / admin re-probe tooling; older baselines stay `null` = strict forever and gain volatility handling only on re-capture.
- Any automated threshold, alert, or "too much tolerated" flag on the `expected_volatile` count this iteration.

## Build Ordering

Strict order; each layer independently testable against mocked AMS + fixtures.

1. **AMS** — add `volatile_paths_json JSONB NULL` to the source-baseline-item entity + DTO (snake_case wire); Liquibase changeset `187` (`not.columnExists` precondition; confirm `186` highest at build time). Add `EXPECTED_VOLATILE` to `MigrationReconciliationBreakStatus` (`ALL` + `TERMINAL_HUMAN_DISPOSITIONS`), NO DDL.
2. **api-migration-validation-service** — (a) the capture-time volatility probe (HTTP `k`-repeat + self-diff, spacing, budget/partial handling, mutating-scenario guard, `non_json` tagging) writing the envelope; (b) diff-time per-path tolerance in `jsonShapeComparator` / `diffRunner` consuming the envelope + the `non_deterministic_endpoint` signal + heuristics.
3. **gateway** — the post-diff `expected_volatile` auto-disposition pass (sibling to `autoDisposeNetNewTargetOnly`), retroactive re-disposition on newly-declared paths, and the run-summary count.
4. **frontend** — show the volatile-path list + `volatility_source` badge on the break detail and the `expected_volatile` count on the reconcile summary; no bespoke widget.

The probe and tolerance get unit coverage with synthetic multi-capture responses; the auto-disposition pass gets a test mirroring `migrationReconciliationNetNewAutoDisposition.test.ts`; the `null`-envelope backward-compat guard and the no-override guard are explicit tests.
