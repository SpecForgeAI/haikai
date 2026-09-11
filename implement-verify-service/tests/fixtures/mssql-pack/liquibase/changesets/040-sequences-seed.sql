--liquibase formatted sql logicalFilePath:liquibase/changesets/040-sequences-seed.sql
--changeset db-migration-pack:sequences-seed context:post-load splitStatements:false
-- Phase 4 of 5: reseed sequences/identities AFTER the bulk load. Restart values = captured source high-water mark + seed margin (1000).
ALTER TABLE "Ledger"."Account" ALTER COLUMN "AccountID" RESTART WITH 1077;
CREATE SEQUENCE IF NOT EXISTS Ledger.PostingBatchNumber;
ALTER SEQUENCE Ledger.PostingBatchNumber RESTART WITH 3500;
SELECT setval('"Ledger"."PostingBatchNumber"', 3500, false);
-- native sequence reseeded from its captured high-water mark + the seed margin.
ALTER TABLE "Ledger"."Postings" ALTER COLUMN "PostingID" RESTART WITH 10000;
ALTER TABLE "Ops"."SensorArchive" ALTER COLUMN "SensorArchiveID" RESTART WITH 1042;
