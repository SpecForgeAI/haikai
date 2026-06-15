-- 171-capture-session-scenario-counts.sql
-- Fix: misleading COMPLETED capture-session status (2026-06-11)
--
-- Adds three nullable INTEGER columns to api_behaviour_capture_sessions so the
-- per-run scenario outcome tallies the capture orchestrator already computes
-- are PERSISTED (previously they were returned to the HTTP caller and thrown
-- away):
--   - `scenarios_attempted` INTEGER NULL -- scenarios the run attempted.
--   - `scenarios_completed` INTEGER NULL -- scenario loops that completed
--                           (recorded a capture).
--   - `scenarios_errored`   INTEGER NULL -- scenario loops that errored.
--
-- WHY: a session is marked `completed` whenever there is no INFRASTRUCTURE
-- error -- every individual scenario can fail (HTTP/auth errors against the
-- target API) and the session still reads COMPLETED with zero captures, which
-- looks like success. Persisting the tallies lets the dashboard render
-- "Completed -- 0 of N scenarios captured" so an all-failed run is impossible
-- to mistake for a successful one.
--
-- Mirrors the 169-discovery-run-degraded.sql advisory-field precedent:
-- nullable, no backfill (legacy rows remain valid with NULL = "counts not
-- recorded"), and NOT a new status enum value -- the session state machine is
-- untouched.

ALTER TABLE api_behaviour_capture_sessions ADD COLUMN scenarios_attempted INTEGER NULL;
ALTER TABLE api_behaviour_capture_sessions ADD COLUMN scenarios_completed INTEGER NULL;
ALTER TABLE api_behaviour_capture_sessions ADD COLUMN scenarios_errored INTEGER NULL;
