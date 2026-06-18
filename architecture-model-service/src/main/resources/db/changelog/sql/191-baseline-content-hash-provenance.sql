-- 191-baseline-content-hash-provenance.sql
-- Spec: Baseline Integrity & Provenance (2026-06-17) -- Task Group 1 (AMS field).
--       Spec C of the A->B->C series (A = oracle coverage scoring, changeset 189;
--       B = reconcile full-response fidelity, changeset 190).
--
-- Makes the pinned current-state API-behaviour baseline (the oracle) tamper-
-- EVIDENT and auditable by stamping it server-side AT ACTIVATION with a
-- deterministic content hash plus a provenance record (including Spec A's
-- coverage score). Adds TWO new nullable columns to the
-- api_behaviour_baselines HEADER:
--
--   api_behaviour_baselines (2 new nullable columns):
--     - content_hash    TEXT  NULL -- deterministic SHA-256 (lowercase hex) over
--       the CANONICAL form of the baseline's item set. Computed ENTIRELY in AMS
--       (Java) at the draft->active ACTIVATE transition in the same transaction
--       as the activation, over the items AS PERSISTED. The canonical form:
--       items sorted by the stable key (method, path, scenario_name); per item
--       the hashed content = method, path, scenario_name, request_json,
--       response_status, response_json, volatile_paths_json; JSON object keys
--       sorted recursively; UTF-8; tagged canonical_version: 1.
--       NULL = pre-existing / never-activated (draft) baseline -- NO backfill;
--       a null hash is "no integrity hash recorded" (NEUTRAL), NOT a mismatch.
--     - provenance_json JSONB NULL -- the audit record stamped at activate:
--       { session_id, environment_name, activated_at (server time at the
--         transition), coverage_score, coverage_summary (or compact ref),
--         accepted_capture_count, operation_count, hash_algo: "sha256",
--         canonical_version: 1 }.
--       coverage_score is Spec A's overall_score read from the linked capture
--       session's coverage_summary_json (changeset 189) via the baseline's
--       session_id; NULL when the session has no summary (legacy) -- never
--       fabricated. Map<String,Object> / @Type(JsonType) on the Java side,
--       mirroring the sibling JSONB columns on the capture-session entity.
--       Snake_case wire (AMS default -- NO @CamelCaseWire).
--
-- IMPORTANT (volatile pinning vs reconcile-time tolerance):
--   volatile_paths_json (changeset 187) IS part of the content hash because the
--   declared volatile envelope is PINNED CONTENT -- changing which paths are
--   flagged volatile changes the oracle and MUST be tamper-evident. This pinning
--   is SEPARATE from reconcile-time volatile TOLERANCE: the hash RECORDS the
--   declared paths but does NOT change how expected_volatile / the diff engine
--   tolerates volatile values at reconcile.
--
-- New nullable columns, reference types, NO backfill: existing baseline rows are
-- untouched and read back with content_hash / provenance_json null. No
-- @PrePersist defaulting -- null is the valid empty state. Stamping happens only
-- on transition INTO active and only for kind='current' baselines; drafts and
-- kind='target' baselines carry neither.
--
-- NEW changeset only -- never edit applied changesets per
-- feedback_liquibase_immutable_changesets.md. 190
-- (190-diff-item-header-classification.sql) is the highest on disk at build
-- time; this registers AFTER it in db.changelog-master.yaml. Column-only ALTERs
-- -> the not-columnExists precondition idiom (mirrors 189 / 190), one
-- precondition per column.

ALTER TABLE api_behaviour_baselines ADD COLUMN content_hash text NULL;

COMMENT ON COLUMN api_behaviour_baselines.content_hash IS
  'Deterministic SHA-256 (lowercase hex) over the CANONICAL form of the baseline''s item set, computed server-side (AMS/Java) at the draft->active ACTIVATE transition over the items as persisted. Canonical form: items sorted by (method, path, scenario_name); per item method/path/scenario_name/request_json/response_status/response_json/volatile_paths_json; JSON object keys sorted recursively; UTF-8; canonical_version 1. volatile_paths_json IS hashed (pinned content -- tamper-evidence) but this is SEPARATE from reconcile-time volatile TOLERANCE. NULL = pre-existing / never-activated baseline (NO backfill) = "no integrity hash recorded" (neutral, NOT a mismatch). Spec: Baseline Integrity & Provenance (2026-06-17).';

ALTER TABLE api_behaviour_baselines ADD COLUMN provenance_json jsonb NULL;

COMMENT ON COLUMN api_behaviour_baselines.provenance_json IS
  'Audit record stamped at the draft->active ACTIVATE transition: { session_id, environment_name, activated_at, coverage_score, coverage_summary, accepted_capture_count, operation_count, hash_algo: "sha256", canonical_version: 1 }. coverage_score is Spec A''s overall_score read from the linked capture session''s coverage_summary_json (changeset 189) via session_id; NULL when the session has no summary (never fabricated). Stamped only for kind=current baselines, only on transition INTO active. Map<String,Object> / @Type(JsonType). Snake_case wire (AMS default). NULL = pre-existing / never-activated (NO backfill). Spec: Baseline Integrity & Provenance (2026-06-17).';
