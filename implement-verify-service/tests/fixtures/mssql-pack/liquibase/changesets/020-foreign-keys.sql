--liquibase formatted sql logicalFilePath:liquibase/changesets/020-foreign-keys.sql
--changeset db-migration-pack:foreign-keys context:post-load splitStatements:false
-- Phase 3 of 5: ALL foreign keys apply ONCE after the bulk load, then stay enforced through every incremental run. Referential actions are verbatim from discovery.
ALTER TABLE "Ledger"."Postings" ADD CONSTRAINT "fk_ledger_postings__ops_sensorarchive__postingid__ref__6f7fd0ae" FOREIGN KEY ("PostingID") REFERENCES "Ops"."SensorArchive" ("SensorArchiveID") ON DELETE SET DEFAULT ON UPDATE NO ACTION NOT VALID;
-- FK fk_ledger_postings__ops_sensorarchive__postingid__ref__6f7fd0ae emitted NOT VALID: the source constraint is NOT TRUSTED (created or re-enabled WITH NOCHECK), so its existing rows were never validated. New rows ARE enforced; run `ALTER TABLE "Ledger"."Postings" VALIDATE CONSTRAINT "fk_ledger_postings__ops_sensorarchive__postingid__ref__6f7fd0ae";` after the legacy rows are cleaned.
