-- 234-db-pack-mssql-decision-and-translation-kinds.sql
-- Second-pair programme (SQL Server 16 -> PostgreSQL 18), Spec 5 (2026-09-11).
--
-- SQL Server carries object shapes Sybase ASE does not, and PostgreSQL has no
-- like-for-like form for any of them. Doctrine: nothing deferred, no manual
-- residue -- each one is EITHER emulated by the pack with a confirmable
-- default OR gated by a decision whose options are all actionable. The two
-- shapes the owner ruled OUT (cross-database / linked-server references and
-- indexed views) are never attempted: their decision carries the NAMED
-- untranslatable reason instead of a translate option.
--
--   * chk_dmpd_category gains the item-5 buckets:
--       temporal_table, fulltext_index, xml_method, hierarchyid_column,
--       spatial_column, sql_variant_column, clr_object, service_broker,
--       filestream, memory_optimized_table, synonym,
--       user_defined_table_type, index_predicate, columnstore_index,
--       cross_database_reference, indexed_view
--
--   * chk_dmpt_kind gains the queue kinds those objects ride:
--       table_valued_function, scalar_function, synonym,
--       user_defined_table_type, sequence, clr_object,
--       service_broker_object, temporal_history
--     clr_object / service_broker_object rows are seeded with the
--     rewrite_in_app disposition and a named untranslatable_reason
--     (changeset 233) -- queued so the workbench SHOWS them, never attempted.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. 174/220/221 are NOT edited; the constraints are dropped and
-- re-created here in a NEW changeset (the 177 idiom).

ALTER TABLE db_migration_pack_decisions
  DROP CONSTRAINT IF EXISTS chk_dmpd_category;

ALTER TABLE db_migration_pack_decisions
  ADD CONSTRAINT chk_dmpd_category CHECK (category IN
    ('type_mapping','computed_column','collation','delta_key','pk_composition','surrogate_pk',
     'temporal_table','fulltext_index','xml_method','hierarchyid_column','spatial_column',
     'sql_variant_column','clr_object','service_broker','filestream','memory_optimized_table',
     'synonym','user_defined_table_type','index_predicate','columnstore_index',
     'cross_database_reference','indexed_view','other'));

COMMENT ON COLUMN db_migration_pack_decisions.category IS
  'Discrete bucket: type_mapping | computed_column | collation | delta_key | pk_composition | surrogate_pk | temporal_table | fulltext_index | xml_method | hierarchyid_column | spatial_column | sql_variant_column | clr_object | service_broker | filestream | memory_optimized_table | synonym | user_defined_table_type | index_predicate | columnstore_index | cross_database_reference | indexed_view | other. Enforced by chk_dmpd_category (extended by changeset 234).';

ALTER TABLE db_migration_pack_translations
  DROP CONSTRAINT IF EXISTS chk_dmpt_kind;

ALTER TABLE db_migration_pack_translations
  ADD CONSTRAINT chk_dmpt_kind CHECK (kind IN
    ('stored_procedure','trigger','view','check_constraint','scheduled_job',
     'table_valued_function','scalar_function','synonym','user_defined_table_type',
     'sequence','clr_object','service_broker_object','temporal_history'));

COMMENT ON COLUMN db_migration_pack_translations.kind IS
  'Discrete bucket: stored_procedure | trigger | view | check_constraint | scheduled_job | table_valued_function | scalar_function | synonym | user_defined_table_type | sequence | clr_object | service_broker_object | temporal_history. Enforced by chk_dmpt_kind (extended by changeset 234).';
