-- 160-discovery-findings-api-behaviour-diff-origin.sql
-- Spec: API Test Harness — Findings Integration (2026-05-25) -- Task Group 1
--
-- Adds a second origin for discovery_findings rows: in addition to the
-- existing run_id (Discovery Service-sourced findings) we now allow rows to
-- be sourced from an api_behaviour_diff (Validation Service-sourced findings
-- produced when a diff completes). Each finding row carries EXACTLY ONE of
-- the two origins; the new CHECK constraint enforces this invariant at the
-- DB layer (fail-fast on any service-bug that tries to insert both or
-- neither).
--
-- Schema changes:
--   1. discovery_findings.run_id is RELAXED to nullable (existing rows all
--      have run_id set, so this is fully backward-compatible).
--   2. discovery_findings.api_behaviour_diff_id is ADDED as a nullable UUID
--      with an ON DELETE CASCADE FK to api_behaviour_diffs(id) -- mirrors
--      the existing run_id CASCADE on discovery_run deletion.
--   3. A partial index on api_behaviour_diff_id (only indexes diff-sourced
--      findings, keeping the index size proportional to the new origin).
--   4. The exactly-one-of-origin CHECK constraint:
--        (run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1
--      Rejects both rows-with-both-set AND rows-with-neither-set.
--
-- Recompute semantics (accepted Q6, LOAD-BEARING -- NOT defensive):
--   * The ON DELETE CASCADE here ONLY fires when the api_behaviour_diff
--     ROW ITSELF is deleted. Diff recompute keeps the diff row alive while
--     replacing its diff_items, so without an explicit
--     deleteFindingsByApiBehaviourDiffId() call BEFORE the per-item
--     create loop in diffRunner.ts, findings would silently accumulate
--     across recomputes (2x after one recompute, 3x after two, ...).
--   * Group 1 ships the AMS service method
--     DiscoveryFindingService.deleteFindingsByApiBehaviourDiffId(diffId);
--     Group 2 wires the explicit call into diffRunner.ts BEFORE re-emit.
--
-- Severity vocabulary note:
--   * This spec deliberately introduces the FIRST-EVER `critical` severity
--     in the platform (status_drift 2xx -> 5xx) -- discovery-service caps
--     at `high` today. The severity column is TEXT so this requires no
--     schema change; the deliberate product call is encoded in the
--     emission rules (Group 2) and documented in findingEmissionRules.ts.
--
-- NEW changeset only -- never edit applied changesets (<= 159) per
-- feedback_liquibase_immutable_changesets.md.

ALTER TABLE discovery_findings ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE discovery_findings
  ADD COLUMN api_behaviour_diff_id UUID NULL
  REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE;

CREATE INDEX idx_discovery_finding_api_behaviour_diff_id
  ON discovery_findings (api_behaviour_diff_id)
  WHERE api_behaviour_diff_id IS NOT NULL;

ALTER TABLE discovery_findings
  ADD CONSTRAINT discovery_finding_exactly_one_origin
  CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1);

COMMENT ON COLUMN discovery_findings.api_behaviour_diff_id IS
  'Origin: the api_behaviour_diff that produced this finding (alternative to run_id). Exactly one of run_id / api_behaviour_diff_id MUST be non-null (enforced by discovery_finding_exactly_one_origin CHECK). CASCADE deletes findings when the source diff is deleted (mirrors discovery_run cascade for discovery-sourced findings). NOTE: recompute keeps the diff row alive; diffRunner.ts MUST call deleteFindingsByApiBehaviourDiffId(diffId) BEFORE re-emit to avoid accumulating duplicates (load-bearing, NOT defensive -- accepted Q6).';

COMMENT ON COLUMN discovery_findings.run_id IS
  'Origin: the discovery_run that produced this finding. Now nullable per 2026-05-25 api-test-harness-findings-integration spec. Exactly one of run_id / api_behaviour_diff_id MUST be non-null (enforced by discovery_finding_exactly_one_origin CHECK). CASCADE intact via fk_discovery_finding_run.';
