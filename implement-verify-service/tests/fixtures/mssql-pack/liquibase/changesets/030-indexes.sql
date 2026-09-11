--liquibase formatted sql logicalFilePath:liquibase/changesets/030-indexes.sql
--changeset db-migration-pack:indexes context:post-load splitStatements:false
-- Phase 3 of 5: ALL non-PK indexes apply ONCE after the bulk load, then stay in place through every incremental run.
CREATE INDEX "IX_Ledger_Postings_Active" ON "Ledger"."Postings" ("PostedBy" ASC) INCLUDE ("PostingID") WHERE IsVoided = 0;
-- PARTIAL index: the source filtered index's predicate is reproduced verbatim as a PostgreSQL partial-index WHERE clause, so coverage (and, for a UNIQUE index, the uniqueness SCOPE) is preserved exactly.
-- Filtered index Ledger.Postings.IX_Ledger_Postings_Exotic: predicate supplied by resolved decision 'index_predicate--Ledger.Postings--IX_Ledger_Postings_Exotic'. Source (verbatim): WHERE isdate(PostedOn) = 1
CREATE INDEX "IX_Ledger_Postings_Exotic" ON "Ledger"."Postings" ("PostedBy") WHERE "PostedOn" IS NOT NULL;
-- PARTIAL index: the source filtered index's predicate is reproduced verbatim as a PostgreSQL partial-index WHERE clause, so coverage (and, for a UNIQUE index, the uniqueness SCOPE) is preserved exactly.
CREATE INDEX "CCI_Ops_SensorArchive" ON "Ops"."SensorArchive" ("ReadingNote");
-- FULL-TEXT index Ops.SensorArchive.FT_Ops_SensorArchive_ReadingNote: not emitted here — it is emulated by the generated tsvector column + GIN index in liquibase/changesets/015-emulations.sql (decision fulltext_index--Ops.SensorArchive).
