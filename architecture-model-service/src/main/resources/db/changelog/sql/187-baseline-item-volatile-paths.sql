-- 187-baseline-item-volatile-paths.sql
-- Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16)
--       -- Task Group 1
--
-- Adds the empirically-measured volatility envelope to the immutable source
-- baseline item so the reconcile diff engine can tell legitimate
-- non-determinism (server timestamps, generated IDs, unordered collections)
-- apart from a real behavioural divergence -- without ever narrowing or
-- mutating the pinned current-state oracle.
--
--   api_behaviour_baseline_items (1 new nullable column):
--     - volatile_paths_json  JSONB NULL -- the volatility envelope shaped
--       { paths, volatility_source, k }: the differing JSON-Pointer path list,
--       the volatility_source taxonomy tag (probed | probed_partial |
--       endpoint_signal | heuristic | declared | non_json | not_probed), and
--       the completed-repeat count k. Written ONCE by the capture-time
--       volatility probe at pin time and NEVER mutated thereafter, consistent
--       with baseline immutability -- it ANNOTATES the pinned oracle, it never
--       changes a captured value. Keyed to this specific baseline item /
--       captured scenario; NO carry-forward or merge across captures.
--       Map<String,Object> / @Type(JsonType) on the Java side, mirroring the
--       sibling request_json / response_json JSONB columns on this entity.
--       NULL means NO volatility recorded -> strict comparison (the
--       backward-compatible default; today's behaviour). NULL is also
--       distinguishable from a probed-but-non-JSON body (a non-null envelope
--       tagged volatility_source: "non_json").
--
-- New nullable column, boxed reference type, NO backfill: existing
-- baseline-item rows are untouched and read back with volatile_paths_json
-- null. Already-pinned baselines stay null = strict forever and gain
-- volatility handling only on re-capture (Out of Scope: backfill). No
-- @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets (<= 186) per
-- feedback_liquibase_immutable_changesets.md. 186 (186-work-item-provenance.sql,
-- D5) is the highest on disk at build time; this registers AFTER it in
-- db.changelog-master.yaml. Column-only ALTER -> the not-columnExists
-- precondition idiom (mirrors 185 / 186 / 181-implementation-ready-spec-fields).

ALTER TABLE api_behaviour_baseline_items ADD COLUMN volatile_paths_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_baseline_items.volatile_paths_json IS
  'Empirically-measured volatility envelope { paths, volatility_source, k } for this captured scenario: the differing JSON-Pointer path list, the volatility_source tag (probed | probed_partial | endpoint_signal | heuristic | declared | non_json | not_probed), and the completed-repeat count k. Written once by the capture-time probe at pin time, never mutated (baseline immutability) -- it annotates the oracle, never changes a captured value. NULL = no volatility recorded -> strict comparison (backward-compatible default; distinguishable from a non_json envelope). No backfill of already-pinned baselines. Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16).';
