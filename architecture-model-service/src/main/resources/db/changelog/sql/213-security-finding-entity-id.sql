-- 213-security-finding-entity-id.sql
-- Spec: Security health dashboard -- service-level association (2026-07-19,
-- Spec A of 3, second wave).
--
-- Generalizes finding attribution beyond applications: `entity_id` holds the
-- resolved model-entity id for the finding's `level` (applications.id /
-- application_components.id / services.id -- all TEXT id families). Backfilled
-- from the v1 application_id column; application_id is RETAINED and still
-- populated for level='application' rows (deprecated read path -- older
-- consumers keep working), but entity_id is authoritative from this changeset
-- on. Ancestor roll-ups (service -> component -> application) are resolved at
-- READ time from the live model, never denormalized here.
--
-- Per feedback_liquibase_immutable_changesets.md: NEW changeset only
-- (212 is the highest on disk at build time); changesets <= 212 not edited.

ALTER TABLE security_findings ADD COLUMN entity_id TEXT;

UPDATE security_findings SET entity_id = application_id WHERE application_id IS NOT NULL;

CREATE INDEX idx_sec_finding_entity_id
  ON security_findings (entity_id);

COMMENT ON COLUMN security_findings.entity_id IS
  'Resolved model-entity id for this finding at its level (applications.id | application_components.id | services.id). Authoritative attribution column from changeset 213; application_id retained for level=application rows as a deprecated read path. NULL when match_status=unmatched.';

COMMENT ON COLUMN security_findings.application_id IS
  'DEPRECATED (changeset 213): populated only for level=application rows for back-compat; entity_id is the authoritative attribution column. Ancestor application resolution for deeper levels happens at read time from the model.';
