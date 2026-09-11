-- 233-translation-untranslatable-reason.sql
-- Second-pair programme (SQL Server 16 -> PostgreSQL 18), Spec 6 (2026-09-11).
--
-- A translation-queue row whose source object hits an OUT-by-ruling or
-- no-like-for-like construct (a cross-database / linked-server reference, an
-- indexed view, CLR code, Service Broker, FILESTREAM) is never attempted and
-- never parked as a silent needs_manual: the seed carries a NAMED reason and
-- proposes the rewrite_in_app disposition, and the workbench shows the reason.
-- Nullable, free of a CHECK on purpose: the vocabulary is pair data
-- (translation_profile.untranslatable_reasons in migration-pairs/*.rules.json).
ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS untranslatable_reason varchar(64);
