# Spec Requirements: Reconcile-Time Determinism & Volatile-Value Handling

## Initial Description

Reconcile-time determinism & volatile-value handling for the oracle reconciliation
engine (`api-migration-validation-service` + AMS + gateway + frontend).

The reconcile diff engine compares responses byte-exact, so legitimate
non-determinism (timestamps, generated IDs, unordered collections) floods every
reconcile with false breaks and drowns real divergences. The
`non_deterministic_endpoint` discovery signal (built by spec
`2026-05-30-oracle-integrity-determinism`) is never consumed by the diff engine
and is Spring-only + endpoint-coarse.

The hand-authored `spec.md` and `tasks.md` in this same folder (modeled on the
`2026-05-30-oracle-integrity-determinism` spec) are the primary design input and
were used to shape these requirements.

## Requirements Discussion

This spec entered requirements-gathering with three pre-settled constraints and a
hand-authored design. The clarifying round resolved the remaining open shaping
questions. Constraints and resolved answers are recorded verbatim below; they are
the authoritative source for the specification.

### Fixed Constraints (settled — not reopened)

**C1 — Scope is the FULL fix.** Field-level volatile handling that works on ANY
target, not a thin endpoint-only slice.

**C2 — Detection is EMPIRICAL.** A `k = 3` replay-and-self-diff probe at
capture/pin time MEASURES which JSON paths vary on the current system, recorded on
the IMMUTABLE baseline item. Complemented by the existing
`non_deterministic_endpoint` signal, conservative timestamp/UUID heuristics, and
human-declared paths.

**C3 — Break policy is a NEW VISIBLE `expected_volatile` disposition.** Plain
TEXT, NO DDL, mirroring `expected_net_new` in
`MigrationReconciliationBreakStatus.java`. Auto-set but auditable and
human-overridable; never silent suppression. The oracle invariant must hold: a
deliberately-changed NON-volatile value still breaks; shape diffs (key add/remove,
type change) on a volatile path STILL break; volatility tolerates VALUES and
ORDERING only.

### Resolved Clarifying Answers

**Q1 — Probe timing and pacing.**
**Answer:** `k = 3` default (`VOLATILITY_PROBE_REPEATS`); replays run INLINE at pin
time. Add two controls: (a) a probe wall-clock budget
(`VOLATILITY_PROBE_BUDGET_MS`) — on exceed, abort and record a PARTIAL result; and
(b) a small inter-replay spacing (`VOLATILITY_PROBE_SPACING_MS`) so per-second
clock-bucket fields are caught.

**Q2 — Partial probe handling.**
**Answer:** A partial probe (e.g. 2 of 3 completed, or budget hit) records the
paths that varied across the COMPLETED replays, tags
`volatility_source: "probed_partial"`, and stores the completed-repeat count. A
`probed_partial` envelope IS trusted enough to auto-dispose to `expected_volatile`
— treated like a full probe, NOT down-ranked.

**Q3 — Human-declared volatile paths.**
**Answer:** Entered through the EXISTING break-detail / disposition UI and
persisted alongside the envelope. No config file, no new admin screen, no new API.
A newly-declared path applies RETROACTIVELY to the current run (re-dispositions
already-open breaks on that operation), not forward-only.

**Q4 — Envelope keying.**
**Answer:** Keyed to the SPECIFIC baseline item / captured scenario it was measured
on. No carry-forward or merge across captures or scenario versions.

**Q5 — `expected_volatile` count semantics.**
**Answer:** A DISPLAYED count on the reconcile run summary only. No automated
threshold, alert, or "too much tolerated" flag this iteration.

**Q6 — Frontend surfacing.**
**Answer:** Show the full normalised JSON-Pointer path list (collapsible if very
large) plus a plain label/badge for `volatility_source` using existing metadata
styling. Down-ranked-to-`info` heuristic breaks show their heuristic paths in the
same break-detail drawer. No bespoke widget.

**Q7 — Non-JSON / unparseable body at probe time.**
**Answer:** Tag `volatility_source: "non_json"`. Comparison stays strict, but the
state is distinguishable from a never-probed `null`.

**Q8 — Additional out-of-scope items.**
**Answer:** In addition to `spec.md`'s out-of-scope list, also out of scope: NO
backfill of `volatile_paths_json` for already-pinned baselines, and NO
migration/admin re-probe tooling. Older baselines stay `null` = strict forever and
gain volatility handling only on re-capture.

### Existing Code to Reference

**Similar Features Identified:**

- **JSON-Pointer / path normalisation primitive** —
  `buildPointer` in `api-migration-validation-service/src/services/jsonShapeComparator.ts`.
  Reuse for the envelope path set (do not re-author path normalisation).
- **Auto-disposition audit-note format** —
  `autoDisposeNetNewTargetOnly` in `gateway/src/services/migrationReconciliationDriver.ts`.
  The `expected_volatile` auto-rule is a sibling pass and follows this audit-note
  format.
- **Env-loading convention** —
  `api-migration-validation-service/src/config.ts`. Home of
  `VOLATILITY_PROBE_REPEATS` and the new `VOLATILITY_PROBE_BUDGET_MS` /
  `VOLATILITY_PROBE_SPACING_MS` envs.
- **Replay client + capture flow** —
  `api-migration-validation-service/src/services/targetReplayRunner.ts`. The probe
  reuses the HTTP replay path (no LLM) and writes the envelope at pin time.
- **Diff engine** —
  `jsonShapeComparator.ts` (`walk`, the `kind`-tagged `BodyDiffEntry`) and
  `diffRunner.ts` (`{ entries }` storage). Per-path tolerance is added here.
- **Disposition constants** —
  `MigrationReconciliationBreakStatus.java` (`ALL`,
  `TERMINAL_HUMAN_DISPOSITIONS`, the `EXPECTED_NET_NEW` precedent). Add
  `EXPECTED_VOLATILE`; NO DDL.
- **Endpoint signal source** — the `non_deterministic_endpoint` evidence-gap
  emission source (`discovery-service` `emissionSources.ts`), built by
  `2026-05-30-oracle-integrity-determinism`. This spec is its first consumer.
- **Baseline item DTO** —
  `api-migration-validation-service/src/services/archModelClient.ts` baseline-item
  DTO (`response_json`, `response_headers_redacted_json`,
  `source_baseline_item_id`), plus the AMS baseline-item entity/DTO/changeset where
  `volatile_paths_json` is added.
- **Auto-disposition test precedent** —
  `migrationReconciliationNetNewAutoDisposition.test.ts`. The
  `expected_volatile` auto-disposition pass gets a mirroring test.

### Follow-up Questions

No follow-up round was required; all shaping questions were resolved in the first
round.

## Visual Assets

### Files Provided:

No visual assets provided. `planning/visuals/` is empty (confirmed by directory
listing, not by assertion alone).

### Visual Insights:

None. The feature reuses the existing breaks-review surface and break-detail
drawer; no bespoke widget is built, so no mockups are needed.

## Requirements Summary

### Functional Requirements

**Empirical volatility probe (capture / pin time).**
- After a current-state scenario is captured, replay it against the current system
  `k` times (default `k = 3`, `VOLATILITY_PROBE_REPEATS`) and self-diff the
  responses using the existing `compareJsonShapes` machinery.
- HTTP-only — no LLM call. Runs inline at pin time (the only time the current
  system is authoritative and callable).
- Apply an inter-replay spacing (`VOLATILITY_PROBE_SPACING_MS`) so per-second
  clock-bucket fields surface.
- Apply a wall-clock budget (`VOLATILITY_PROBE_BUDGET_MS`); on exceed, abort and
  record a partial result.
- Any JSON path that differs across the repeats is a measured volatile path,
  recorded as a normalised JSON-Pointer list (array path flagged ⇒
  order-insensitive).

**Volatility envelope persistence (immutable baseline).**
- Store `{ paths, volatility_source, k (completed-repeat count) }` on the SOURCE
  baseline item — part of the pinned oracle, captured once and never mutated.
- New AMS column `volatile_paths_json JSONB NULL` on the source-baseline-item
  table (snake_case wire, AMS default), surfaced on the baseline-item DTO.
- New Liquibase changeset at the next free number `187`
  (`187-baseline-item-volatile-paths.sql`; confirm `186` is still highest at build
  time; include a `not.columnExists` precondition; never edit an applied
  changeset).
- Envelope keyed to the specific baseline item / captured scenario; NO
  carry-forward or merge across captures or scenario versions.
- `null` = no volatility recorded ⇒ strict comparison (backward-compatible
  default).

**`volatility_source` taxonomy (full set).**
`probed` | `probed_partial` | `endpoint_signal` | `heuristic` | `declared` |
`non_json` | `not_probed` (mutating).
- Full-probe measurement ⇒ `probed`.
- Budget-hit or incomplete probe with results from completed replays ⇒
  `probed_partial` (trusted like a full probe).
- `non_deterministic_endpoint` discovery signal present ⇒ `endpoint_signal`
  (whole-response value tolerance; presence/shape still compared).
- Conservative value-shape match (ISO-8601 timestamp, RFC-4122 UUID, epoch-millis
  in a time-named field) on an unprobed path ⇒ `heuristic`.
- Operator-entered path ⇒ `declared`.
- Non-JSON / unparseable body at probe time ⇒ `non_json` (strict comparison;
  distinguishable from `null`).
- Mutating / non-idempotent scenario (`mutating_calls_confirmed` or
  POST/PUT/DELETE) ⇒ `not_probed` (probe not run; falls back to
  endpoint_signal / heuristic / declared).

**Diff-time tolerance (per-path).**
- A VALUE difference on a volatile leaf path → not a `value_changed` entry.
- An ARRAY flagged volatile → compared order-insensitively (multiset).
- SHAPE differences (key added/removed, type changed) on a volatile path are STILL
  reported — volatility tolerates values and ordering, never shape.
- Tolerance is per-path: one volatile timestamp plus a genuine regression
  elsewhere still breaks on the regression.

**`expected_volatile` disposition + auto-rule.**
- Add `EXPECTED_VOLATILE = "expected_volatile"` to
  `MigrationReconciliationBreakStatus.java`, in both `ALL` and
  `TERMINAL_HUMAN_DISPOSITIONS`. Plain TEXT, NO DDL (mirrors `EXPECTED_NET_NEW`).
- Post-diff auto-disposition pass (sibling to `autoDisposeNetNewTargetOnly`):
  - Divergence ENTIRELY on `volatility_source ∈ {probed, probed_partial,
    endpoint_signal, declared}` paths → PATCH to `expected_volatile`,
    `needs_human = false`, audit note listing paths + source.
  - Mixed volatile + non-volatile divergence → stays `open` (the non-volatile part
    is a real break).
  - Justified only by `heuristic` paths → down-rank to `info`, stays `open` (a
    guess never auto-terminates).
  - `non_json` / `not_probed` / `null` → strict comparison, no auto-disposition.
  - Human-overridable back to `open` via the existing PATCH path.

**Human-declared paths (in-UI, retroactive).**
- Declared through the EXISTING break-detail / disposition UI, persisted alongside
  the envelope. No config file, no new admin screen/API.
- A newly-declared path applies RETROACTIVELY to the current run (re-dispositions
  already-open breaks on that operation), not forward-only.

**Visibility.**
- Break-detail surface shows the full normalised JSON-Pointer path list
  (collapsible if very large) plus a plain `volatility_source` label/badge, reusing
  existing metadata styling. Down-ranked-to-`info` heuristic breaks show their
  heuristic paths in the same drawer.
- Reconcile run summary DISPLAYS the `expected_volatile` count alongside
  `expected_net_new`. Displayed count only — no automated threshold, alert, or
  "too much tolerated" flag this iteration.

### Reusability Opportunities

- `buildPointer` (`jsonShapeComparator.ts`) — JSON-Pointer/path normalisation for
  the envelope path set.
- `autoDisposeNetNewTargetOnly` (`migrationReconciliationDriver.ts`) —
  auto-disposition pass + audit-note format.
- `config.ts` (validation-service) — env-loading convention for
  `VOLATILITY_PROBE_REPEATS`, `VOLATILITY_PROBE_BUDGET_MS`,
  `VOLATILITY_PROBE_SPACING_MS`.
- `targetReplayRunner.ts` — HTTP replay path for the probe.
- `jsonShapeComparator.ts` / `diffRunner.ts` — diff engine for per-path tolerance.
- `MigrationReconciliationBreakStatus.java` — disposition constants
  (`EXPECTED_NET_NEW` precedent).
- `archModelClient.ts` baseline-item DTO — envelope read/write surface.
- `non_deterministic_endpoint` emission source — the consumed signal.
- `migrationReconciliationNetNewAutoDisposition.test.ts` — auto-disposition test
  precedent.

### Scope Boundaries

**In Scope:**
- Full field-level volatile handling on any target.
- Empirical `k = 3` replay-and-self-diff probe at pin time with budget + spacing
  controls and partial-result handling.
- `volatile_paths_json` column (changeset `187`) on the immutable source baseline
  item, keyed per baseline item / captured scenario.
- The full `volatility_source` taxonomy, including `probed_partial` and `non_json`.
- Consumption of the existing `non_deterministic_endpoint` signal.
- Conservative timestamp/UUID heuristics (down-rank only).
- In-UI human-declared paths, applied retroactively to the current run.
- Per-path diff-time tolerance (values + ordering; shape still breaks).
- The visible, auditable, human-overridable `expected_volatile` disposition
  (no DDL) and its post-diff auto-rule.
- Break-detail path list + `volatility_source` badge and a displayed run-summary
  count.

**Out of Scope:**
- Silent suppression of breaks (every allowance is `expected_volatile` or
  down-ranked-to-`info`; nothing is dropped — the load-bearing invariant).
- Editing the pinned oracle (the envelope annotates; it never changes a captured
  value).
- Mutating-scenario probing (non-idempotent scenarios fall back to
  endpoint_signal / heuristic / declared; ties to the separate Row 9
  mutating-replay concern).
- Header / timing diff dimensions (separate item; body value/ordering only).
- Non-JSON tolerance (non-JSON bodies tagged `non_json`, kept strict).
- Changing the capture loop's scenario selection or the `temperature: 0` / caching
  determinism work (upstream, already done).
- Backfill of `volatile_paths_json` for already-pinned baselines.
- Any migration / admin re-probe tooling. Older baselines stay `null` = strict
  forever and gain volatility handling only on re-capture.
- Any automated threshold, alert, or "too much tolerated" flag on the
  `expected_volatile` count this iteration.

### Technical Considerations

**Build layering (strict order — each layer independently testable against mocked
AMS + fixtures):**

1. **AMS** — add `volatile_paths_json JSONB NULL` to the source-baseline-item
   entity + DTO (snake_case wire); Liquibase changeset `187`
   (`not.columnExists` precondition; confirm `186` highest at build time). Add
   `EXPECTED_VOLATILE` to `MigrationReconciliationBreakStatus` (`ALL` +
   `TERMINAL_HUMAN_DISPOSITIONS`), NO DDL.
2. **api-migration-validation-service** — (a) the capture-time volatility probe
   (HTTP `k`-repeat + self-diff, spacing, budget/partial handling, mutating-scenario
   guard, `non_json` tagging) writing the envelope; (b) diff-time per-path tolerance
   in `jsonShapeComparator` / `diffRunner` consuming the envelope + the
   `non_deterministic_endpoint` signal + heuristics.
3. **gateway** — the post-diff `expected_volatile` auto-disposition pass (sibling to
   `autoDisposeNetNewTargetOnly`), retroactive re-disposition on newly-declared
   paths, and the run-summary count.
4. **frontend** — show the volatile-path list + `volatility_source` badge on the
   break detail and the `expected_volatile` count on the reconcile summary; no
   bespoke widget.

**Constraints / integration points:**
- AMS wire format is snake_case by default; `volatile_paths_json` follows that
  default (no `@CamelCaseWire`).
- `EXPECTED_VOLATILE` is plain TEXT requiring NO DDL (mirrors `EXPECTED_NET_NEW` /
  `dismissed`); it must be added to `TERMINAL_HUMAN_DISPOSITIONS` so it does not
  re-loop.
- `null` envelope must yield exactly today's strict comparison (backward-compat
  guard test).
- Invariant guard: no code path makes a break disappear — every volatility outcome
  is either `expected_volatile` (visible terminal) or `info` (visible, open).
- "No override" guard: a deliberately-changed NON-volatile value still produces an
  `open` break even when the same response also has volatile paths.
- The probe is HTTP-only and reuses the replay client, not the capture loop.
- New envs live in validation-service `config.ts`: `VOLATILITY_PROBE_REPEATS`
  (default 3), `VOLATILITY_PROBE_BUDGET_MS`, `VOLATILITY_PROBE_SPACING_MS`.
