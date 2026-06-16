-- 188-capture-volatile-paths.sql
-- Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16)
--       -- Task Group 2 / FU-2 (probe-at-capture wiring)
--
-- Adds the empirically-measured volatility envelope to the per-attempt CAPTURE
-- row so the envelope MEASURED at capture time (by the capture-time volatility
-- probe inside `execute_http_request`) survives to the frontend-driven
-- Save-as-baseline promotion, where it is threaded onto the source baseline
-- item's own `volatile_paths_json` column (changeset 187).
--
-- WHY a carrier column on `api_behaviour_captures` (not only on the baseline
-- item): the current-state baseline is PINNED by a frontend->AMS write
-- (`SaveAsBaselineModal` -> `createBaselineItem`), NOT by any server-side
-- validation-service route. The only moment the current system is authoritative
-- and callable -- with a live `SessionHttpExecutor` against it -- is during the
-- capture loop's `execute_http_request`. The probe therefore runs THERE and
-- records its envelope on the capture row; the promotion step copies it onto
-- the immutable baseline item. Without this carrier column the measured
-- envelope would be lost between capture and pin.
--
--   api_behaviour_captures (1 new nullable column):
--     - volatile_paths_json  JSONB NULL -- the volatility envelope shaped
--       { paths, volatility_source, k } (and optionally array_paths): the
--       differing JSON-Pointer path list, the volatility_source taxonomy tag
--       (probed | probed_partial | endpoint_signal | heuristic | declared |
--       non_json | not_probed), and the completed-repeat count k. Written ONCE
--       at capture time by the probe and carried forward verbatim onto the
--       baseline item on Save-as-baseline. Map<String,Object> /
--       @Type(JsonType) on the Java side, mirroring the sibling
--       request_*_json / response_*_json JSONB columns on this entity.
--       NULL means NO volatility recorded -> strict comparison (the
--       backward-compatible default; today's behaviour). NULL is also
--       distinguishable from a probed-but-non-JSON body (a non-null envelope
--       tagged volatility_source: "non_json").
--
-- New nullable column, boxed reference type, NO backfill: existing capture
-- rows are untouched and read back with volatile_paths_json null. No
-- @PrePersist defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 187
-- (187-baseline-item-volatile-paths.sql, this same spec) is the highest on
-- disk at build time; this registers AFTER it in db.changelog-master.yaml.
-- Column-only ALTER -> the not-columnExists precondition idiom (mirrors
-- 185 / 186 / 187).

ALTER TABLE api_behaviour_captures ADD COLUMN volatile_paths_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_captures.volatile_paths_json IS
  'Empirically-measured volatility envelope { paths, volatility_source, k } measured at capture time by the capture-time probe (in execute_http_request) and carried forward onto the source baseline item on Save-as-baseline. The differing JSON-Pointer path list, the volatility_source tag (probed | probed_partial | endpoint_signal | heuristic | declared | non_json | not_probed), and the completed-repeat count k. NULL = no volatility recorded -> strict comparison (backward-compatible default; distinguishable from a non_json envelope). Spec: Reconcile-Time Determinism & Volatile-Value Handling (2026-06-16) -- FU-2.';
