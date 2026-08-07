-- 220-db-pack-decision-and-translation-kind-extensions.sql
-- Gold-standard campaign C4 (2026-08-07): pack completeness for the
-- sybase15 -> postgres18 pair.
--
-- Two discrete-bucket CHECKs extend for the no-manual-residue work:
--
--   * chk_dmpd_category + 'pk_composition' — a PRIMARY KEY / UNIQUE
--     constraint whose member column(s) are omitted/dropped used to be
--     dropped SILENTLY by the pack generator (uniqueness semantics vanished
--     from the target with zero signal). Every such constraint now raises a
--     pack decision; an open one blocks Migrate via the db-pack gate.
--
--   * chk_dmpt_kind + 'check_constraint' + 'scheduled_job' — non-portable
--     CHECK expressions used to die as "translate manually and ALTER TABLE
--     after review" comments, and DB-resident scheduled jobs were parked in
--     manual_recreation. Both now ride the LLM translation queue: approved
--     check constraints emit their ALTER TABLE in 050-translations; approved
--     jobs emit a PL/pgSQL function + pg_cron cron.schedule.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. 174/176 are NOT edited; the constraints are dropped and
-- re-created here in a NEW changeset (the 177 idiom).

ALTER TABLE db_migration_pack_decisions
  DROP CONSTRAINT IF EXISTS chk_dmpd_category;

ALTER TABLE db_migration_pack_decisions
  ADD CONSTRAINT chk_dmpd_category CHECK (category IN
    ('type_mapping','computed_column','collation','delta_key','pk_composition','other'));

COMMENT ON COLUMN db_migration_pack_decisions.category IS
  'Discrete bucket: type_mapping | computed_column | collation | delta_key | pk_composition | other. Enforced by chk_dmpd_category (extended by changeset 220).';

ALTER TABLE db_migration_pack_translations
  DROP CONSTRAINT IF EXISTS chk_dmpt_kind;

ALTER TABLE db_migration_pack_translations
  ADD CONSTRAINT chk_dmpt_kind CHECK (kind IN
    ('stored_procedure','trigger','view','check_constraint','scheduled_job'));

COMMENT ON COLUMN db_migration_pack_translations.kind IS
  'Discrete bucket: stored_procedure | trigger | view | check_constraint | scheduled_job. Enforced by chk_dmpt_kind (extended by changeset 220).';
