-- 179-discovery-findings-capture-session-origin.sql
-- Spec: Model-Seeded Capture Inventory -- Guaranteed Operation-Capture
-- Completeness (2026-06-11) -- Task Group 1
--
-- Adds a THIRD origin for discovery_findings rows, directly following the
-- changeset-160 second-origin precedent: in addition to run_id (Discovery
-- Service-sourced) and api_behaviour_diff_id (diff-runner-sourced), rows may
-- now be sourced from a capture-session inventory reconciliation
-- (api_behaviour_capture_session_id set). Each finding row carries EXACTLY
-- ONE of the three origins; the existing two-way
-- discovery_finding_exactly_one_origin CHECK is DROPPED and re-ADDED as a
-- three-way exactly-one-of constraint (changeset 160 is APPLIED and
-- therefore immutable -- the replacement happens in this NEW changeset, per
-- feedback_liquibase_immutable_changesets.md).
--
-- Schema changes:
--   1. discovery_findings.api_behaviour_capture_session_id is ADDED as a
--      nullable UUID with an ON DELETE CASCADE FK to
--      api_behaviour_capture_sessions(id) -- mirrors the run_id / diff_id
--      cascades.
--   2. A partial index on api_behaviour_capture_session_id (only indexes
--      reconciliation-sourced findings).
--   3. DROP + re-ADD discovery_finding_exactly_one_origin as the three-way
--      exactly-one-of CHECK:
--        (run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int
--          + (api_behaviour_capture_session_id IS NOT NULL)::int = 1
--      Rejects rows with two-or-more origins AND rows with none.
--
-- Recompute semantics (LOAD-BEARING, mirrors the diffRunner Q6 precedent):
--   * The ON DELETE CASCADE only fires when the capture-session ROW ITSELF
--     is deleted. Re-running inventory reconciliation keeps the session row
--     alive, so the AMS reconciliation endpoint MUST delete all prior
--     findings for the session (DiscoveryFindingService
--     .deleteFindingsByCaptureSessionId) BEFORE re-emitting -- otherwise
--     findings would silently accumulate across reconciliation re-runs.

ALTER TABLE discovery_findings
  ADD COLUMN api_behaviour_capture_session_id UUID NULL
  REFERENCES api_behaviour_capture_sessions(id) ON DELETE CASCADE;

CREATE INDEX idx_discovery_finding_api_behaviour_capture_session_id
  ON discovery_findings (api_behaviour_capture_session_id)
  WHERE api_behaviour_capture_session_id IS NOT NULL;

ALTER TABLE discovery_findings
  DROP CONSTRAINT discovery_finding_exactly_one_origin;

ALTER TABLE discovery_findings
  ADD CONSTRAINT discovery_finding_exactly_one_origin
  CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int + (api_behaviour_capture_session_id IS NOT NULL)::int = 1);

COMMENT ON COLUMN discovery_findings.api_behaviour_capture_session_id IS
  'Origin: the api_behaviour_capture_session whose inventory reconciliation produced this finding (third origin alongside run_id / api_behaviour_diff_id). Exactly one of the three origin columns MUST be non-null (enforced by the re-created three-way discovery_finding_exactly_one_origin CHECK). CASCADE deletes findings when the session is deleted. NOTE: reconciliation re-runs keep the session row alive; the AMS reconciliation endpoint MUST call deleteFindingsByCaptureSessionId(sessionId) BEFORE re-emit to avoid accumulating duplicates (load-bearing, NOT defensive -- diffRunner Q6 precedent).';

COMMENT ON CONSTRAINT discovery_finding_exactly_one_origin ON discovery_findings IS
  'Three-way exactly-one-of origin invariant: run_id XOR api_behaviour_diff_id XOR api_behaviour_capture_session_id. Extended from the two-way changeset-160 constraint by changeset 179 (Model-Seeded Capture Inventory, 2026-06-11).';
