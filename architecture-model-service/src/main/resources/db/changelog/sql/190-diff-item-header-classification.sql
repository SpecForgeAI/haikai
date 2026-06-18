-- 190-diff-item-header-classification.sql
-- Spec: Reconcile Full-Response Fidelity & Distinct Break Types (2026-06-17)
--       -- Task Group 1 (AMS field).
--
-- Adds the per-dimension HEADER classification to the diff_item row so the
-- oracle reconciliation diff can surface response-header divergences (a
-- Content-Type flip, a dropped/added header, a non-allowlisted header value
-- change) as their own typed break instead of silently discarding the
-- captured-but-never-compared headers. Mirrors the existing nullable
-- body_classification column.
--
--   api_behaviour_diff_items (1 new nullable column):
--     - header_classification  TEXT NULL -- discrete bucket validated at the
--       service layer (NO DB enum, matching the existing status_classification
--       / body_classification convention). Valid values:
--         header_match | header_value_drift | header_presence_drift.
--       NULL when statusClassification is source_only / target_only (no pair),
--       OR when either side lacks a { headers, body } response wrapper so the
--       header dimension is skipped (graceful degrade -- no false header break,
--       see Resolved Clarification R5). String / @Column on the Java side,
--       mirroring the sibling body_classification column on this entity.
--       NULL = header dimension not classified (the backward-compatible
--       default for pre-existing diff_items and source-header-less baselines).
--
-- The new accepted body_classification value body_ordering_drift (a non-volatile
-- array reorder) needs NO DDL -- it is an additional accepted value of the
-- EXISTING body_classification column, validated at the service layer only.
--
-- New nullable column, reference type, NO backfill: existing diff_item rows are
-- untouched and read back with header_classification null. No @PrePersist
-- defaulting needed -- null is the valid empty state.
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 189
-- (189-capture-coverage-summary.sql, Spec A) is the highest on disk at build
-- time; this registers AFTER it in db.changelog-master.yaml. Column-only ALTER
-- -> the not-columnExists precondition idiom (mirrors 187 / 188 / 189).

ALTER TABLE api_behaviour_diff_items ADD COLUMN header_classification text NULL;

COMMENT ON COLUMN api_behaviour_diff_items.header_classification IS
  'Per-dimension HEADER classification for the response-header diff: header_match | header_value_drift | header_presence_drift. Validated at the service layer (no DB enum, mirrors status_classification / body_classification). NULL when source_only / target_only (no pair) OR when either side lacks a { headers, body } response wrapper so the header dimension is skipped (graceful degrade -- no false header break). NULL = header dimension not classified (backward-compatible default; no backfill). Spec: Reconcile Full-Response Fidelity & Distinct Break Types (2026-06-17) -- Task Group 1.';
