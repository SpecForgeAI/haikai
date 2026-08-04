-- 215-db-structural-finding-dispositions.sql
-- Spec 2: Structural findings dispositions (2026-08-04)
--
-- Introduces `db_structural_finding_dispositions` -- ONE row per reviewed
-- structural finding that the DB migration pack generator emits (e.g.
-- "no primary keys captured"). Dispositions are keyed by PROJECT +
-- finding_key, NOT by pack: pack regeneration wholesale replaces pack rows,
-- while these rows are the DURABILITY mechanism -- a finding re-emitted by a
-- regenerated pack re-links to its existing disposition via the stable
-- finding_key identity (`kind:subject`).
--
-- Columns:
--   * project_id  -> owning project UUID (no FK by design: dispositions must
--                    outlive any pack row churn; project lifecycle is managed
--                    upstream).
--   * finding_key -> stable identity `kind:subject`; UNIQUE per project
--                    (uq_dsfd_project_finding_key) so upserts re-link instead
--                    of duplicating.
--   * kind        -> finding kind (e.g. no_primary_keys).
--   * subject     -> finding subject (e.g. all_tables).
--   * disposition -> accepted | fix_upstream | known_gap
--                    (chk_dsfd_disposition); `accepted` / `known_gap` REQUIRE
--                    a note (service-enforced).
--   * note        -> rationale; mandatory for accepted/known_gap
--                    (service-enforced, mirroring drop_reason on
--                    db_migration_pack_translations).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 214 are not edited.

CREATE TABLE db_structural_finding_dispositions (
  id          UUID PRIMARY KEY,
  project_id  UUID NOT NULL,
  finding_key TEXT NOT NULL,
  kind        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  disposition TEXT NOT NULL,
  note        TEXT NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT chk_dsfd_disposition CHECK (disposition IN
    ('accepted','fix_upstream','known_gap'))
);

CREATE UNIQUE INDEX uq_dsfd_project_finding_key
  ON db_structural_finding_dispositions (project_id, finding_key);

CREATE INDEX idx_dsfd_project
  ON db_structural_finding_dispositions (project_id);

COMMENT ON TABLE db_structural_finding_dispositions IS
  'Per-project dispositions for DB structural findings emitted by the migration pack generator. Durable across pack regeneration via finding_key (kind colon subject), unique per project. Spec: Structural findings dispositions (2026-08-04), Spec 2.';

COMMENT ON COLUMN db_structural_finding_dispositions.finding_key IS
  'Stable identity of the form kind, colon, subject (e.g. no_primary_keys:all_tables). Unique per project via uq_dsfd_project_finding_key; upserts re-link rather than duplicate.';

COMMENT ON COLUMN db_structural_finding_dispositions.disposition IS
  'accepted | fix_upstream | known_gap. Enforced by chk_dsfd_disposition. accepted and known_gap require a note (service-enforced).';
