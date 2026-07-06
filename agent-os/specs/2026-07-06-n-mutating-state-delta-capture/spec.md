# Spec N — Mutating-Endpoint State-Delta Capture & Reconciliation

**Program:** Code-Tier Oracle. Added 2026-07-06 after the focused review of the API
Behaviour Baseline capture scans (gap analysis §9) — the capture scans are PRODUCERS of
spec input and reconciliation truth, and for write endpoints today they produce only half
the truth.

## Goal

For mutating endpoints, the oracle is **response parity AND state parity**: a captured
scenario records not just the HTTP response but the database delta it caused on the current
system; target replay computes the same delta on the target database and the diff proves
both match. A target implementation that returns the right response but writes the wrong
rows (or none) is caught mechanically.

## Evidence / current behaviour (verified 2026-07-06)

- Captures record request + response only; `sample_db_values` results land in
  `business_notes` (audit-only, never diffed). No pre/post state exists anywhere in AMVS
  (all "delta" code is Postman scenario top-up, unrelated).
- Volatility probing is GET-only; mutating scenarios are `volatility_source: 'not_probed'`.
- Diff runner compares status/body/headers only.
- The pieces needed all exist: committed `endpoint_data_effects` name exactly which tables
  an endpoint writes (with verbatim `query_text` often revealing key predicates); Sybase
  and Postgres `DbAdapter`s with `sqlGuard` read-only enforcement; per-invocation DB creds
  pattern (Persistence Spec E); mutating-calls confirmation gate.

## Scope

### 1. Effect-scoped state snapshots at capture time (current system, Sybase adapter)

For each scenario on an endpoint whose committed data effects include `write`/`read-write`
(and the session has `mutating_calls_confirmed`):

- **Snapshot scope** = the endpoint's effect tables (from committed data effects). An
  endpoint with a mutating verb but NO committed write effects → scenario proceeds but
  emits `state_delta_unscoped` finding (nothing silent).
- **Bounded snapshot strategy per table** (deterministic ladder):
  1. Row count (always).
  2. **Keyed-row capture** when a key predicate is derivable — from the edge's verbatim
     `query_text` and/or the scenario's request/response values (e.g. returned id) —
     SELECT the affected rows pre and post (values redacted via the existing redactor).
  3. Fallback when no key derivable: adapter-provided table checksum, guarded by
     `STATE_DELTA_MAX_TABLE_ROWS` (default 500k); above the guard → counts-only +
     `state_delta_bounded` finding.
- All snapshot SQL is SELECT-only through the existing adapters + `sqlGuard`; DB creds
  remain per-invocation, never persisted.
- **Persisted:** `state_delta_json` on the capture/baseline item: per table — pre/post
  counts, keyed rows written/updated/deleted (post-redaction), strategy used, and
  volatile-column markers (identity/sequence + timestamp columns auto-marked from schema
  metadata via the adapter). AMS `api_behaviour` schema gains the column via a NEW
  Liquibase changeset.

### 2. State-delta replay + comparison (target system, Postgres adapter)

- Target replay (Spec I scoped runs included) performs the same effect-scoped snapshots
  around each mutating scenario on the TARGET database and computes `state_delta_json`.
- **Comparison** (new module alongside `jsonShapeComparator`): deltas match iff same
  per-table row-count deltas AND keyed rows equal modulo (a) volatile columns
  (identity/timestamp), (b) **type-mapping-aware equivalence** — value comparison consults
  the DB pack's v1 type mapping for declared representation differences (e.g. Sybase
  datetime precision vs PG `timestamp`), the same single-source mapping module Spec F
  reuses. Anything outside declared equivalence → drift.
- New classifications `state_match | state_drift | state_unverified` alongside the body/
  header classes; finding emission extended; `state_unverified` (snapshot failed, scope
  missing, creds absent) is NOT a pass — FAIL CLOSED.
- Spec I's parity verdict incorporates state results for mutating scenarios (I amendment).

### 3. Mutating volatility, properly

`not_probed` for mutating scenarios is replaced by delta-based semantics: response-body
volatility for mutating scenarios may additionally be inferred from identity/timestamp
schema knowledge (e.g. returned generated id marked volatile) — declared on the envelope
with `volatility_source: 'schema_derived'`, visible like every other source.

### 4. Sequences

Sequence replay (setup→act→cleanup, existing) snapshots around the ACT step only;
setup/cleanup steps are explicitly out of delta scope (marked in `state_delta_json`).

## Non-goals

- Diffing unbounded tables (guarded + finding). Non-DB side effects of endpoints (files,
  MQ) — recorded residual; Spec M's oracle covers them for internal jobs. Distributed/
  multi-DB transactions. Automatic repair of state drift (Spec I's loop consumes the
  verdict; the fix is the implementer's job).

## Acceptance criteria

1. **WRITE PIN:** POST scenario on an endpoint with a write effect on `orders` →
   `state_delta_json` shows count +1 and the keyed inserted row (redacted), strategy
   `keyed`.
2. **REPLAY PIN:** target replay computes the target delta; identity column difference
   tolerated (volatile), a differing business column → `state_drift` with table/column
   detail.
3. **SCOPE PIN:** snapshot tables = exactly the committed effect tables; mutating endpoint
   without write effects → `state_delta_unscoped` finding, scenario still captured.
4. **GUARD PIN:** table above `STATE_DELTA_MAX_TABLE_ROWS` with no derivable key →
   counts-only + `state_delta_bounded` finding; count drift still detected.
5. **FAIL-CLOSED PIN:** snapshot failure on either side → `state_unverified`, never
   `state_match`; Spec I verdict treats it as unclean.
6. **TYPE-MAP PIN:** Sybase datetime vs PG timestamp representation difference within the
   pack's declared mapping → match; outside it → drift. Mapping imported from the DB pack
   module (single source, asserted by import).
7. **SAFETY PIN:** `mutating_calls_confirmed=false` → no mutating execution, no snapshots
   (existing gate preserved); all snapshot SQL passes `sqlGuard`.

## Test plan

Snapshot-strategy unit tests per ladder rung (pins 1,3,4) with adapter mocks; delta
comparator suite (pins 2,6); replay integration with mocked adapters (pin 5); sequence
scoping test; AMS changeset test (NEW changeset only); redaction assertions on persisted
rows. Baseline-red discipline as per program.

## Dependencies & sizing

Depends on: committed data effects (exist), DB adapters (exist), DB pack type-mapping
module (exists; shared with F). Feeds: H amendment (expected deltas embedded in spec text),
I amendment (verdict). Size: **M/L**. Build slot: with J/K, before I.
