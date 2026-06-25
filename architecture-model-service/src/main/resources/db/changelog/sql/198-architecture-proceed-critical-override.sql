-- 198-architecture-proceed-critical-override.sql
-- Spec: Vulnerability Reduction + Steering (2026-06-24, Spec 4 of 6) -- Task Group 4
--
-- Persists the "proceed with remaining criticals" override audit trio on the
-- target architecture row, mirroring the existing capture-session coverage
-- override trio (coverage_override_justification / coverage_override_unaccounted_count
-- / coverage_override_at on api_behaviour_capture_sessions -- changeset 178).
--
-- The architect-conversation "proceed" step HARD-GATES on any REMAINING CRITICAL
-- CVE (Spec 4 steering). The gate is overridable with a recorded justification;
-- when overridden, this trio captures the audit record ONCE PER TARGET ARCHITECTURE
-- (the proceed step is scoped to target-architectures/:targetArchitectureId), so it
-- lives on the `architecture` table (kind='target') alongside draft_state / kind /
-- last_marked_stale_at (changesets 144 / 147):
--
--   architecture:
--     - proceed_critical_override_justification TEXT NULL -- the user-supplied
--       justification persisted when Proceed is explicitly overridden while
--       remaining critical CVEs exist. NULL = no override (the common case).
--     - proceed_remaining_critical_count INTEGER NULL -- the remaining-critical
--       CVE count AT OVERRIDE TIME (audit record; boxed Integer on the Java side
--       per project_primitive_double_dto_overwrite.md -- PATCH-mutable numerics
--       must never be primitive).
--     - proceed_critical_override_at TIMESTAMPTZ NULL -- override timestamp.
--
-- All three columns NULLABLE, no backfill: every existing architecture row (current
-- AND target, active AND draft) renders normally with the new fields null. No
-- retroactive gating -- a target authored before this spec is simply un-overridden,
-- exactly as the coverage-override trio left existing capture sessions untouched.
--
-- The codebase convention is JSONB + TIMESTAMPTZ (as used by 178 / 135 / 184 / 197
-- against real PostgreSQL). The H2 @DataJpaTest datasource aliases TIMESTAMPTZ ->
-- TIMESTAMP WITH TIME ZONE, and the focused changeset test registers the same
-- domain alias, so the unmodified production DDL applies in tests too.
--
-- NEW changeset only -- never edit applied changesets (<= 197) per
-- feedback_liquibase_immutable_changesets.md. Registered AFTER 197 with the
-- not-columnExists precondition idiom so a re-run is a clean no-op.

ALTER TABLE architecture ADD COLUMN proceed_critical_override_justification TEXT NULL;
ALTER TABLE architecture ADD COLUMN proceed_remaining_critical_count INTEGER NULL;
ALTER TABLE architecture ADD COLUMN proceed_critical_override_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN architecture.proceed_critical_override_justification IS
  'Justification persisted when the architect-conversation "proceed" step is explicitly overridden while remaining critical CVEs exist (Spec 4 steering hard-gate). NULL = no override. Spec: Vulnerability Reduction + Steering (2026-06-24).';

COMMENT ON COLUMN architecture.proceed_remaining_critical_count IS
  'Remaining critical CVE count at proceed-override time (audit). NULL = no override. Boxed Integer on the Java side -- PATCH-mutable numerics must never be primitive.';

COMMENT ON COLUMN architecture.proceed_critical_override_at IS
  'Timestamp of the proceed-with-remaining-criticals override. NULL = no override.';
