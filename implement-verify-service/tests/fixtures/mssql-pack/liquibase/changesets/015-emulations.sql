--liquibase formatted sql logicalFilePath:liquibase/changesets/015-emulations.sql
--changeset db-migration-pack:emulations context:structural splitStatements:false
-- Source object shapes with NO like-for-like PostgreSQL form, EMULATED by the pack.
-- Each emulation honours a pack decision (named per statement below); nothing here is
-- manual residue and nothing here is silent.

-- ===== System-versioned (temporal) tables — MSPG.TEMPORAL.001 =====
-- The source engine maintains SYSTEM_VERSIONING itself. PostgreSQL has no such clause,
-- so versioning is reproduced by two triggers over an ordinary history table:
--   haikai_temporal_row_start()  BEFORE INSERT OR UPDATE — stamps the period columns
--   haikai_temporal_versioning() AFTER  UPDATE OR DELETE — copies the OLD row to history
-- Both are generic (the table, history table and period columns arrive as trigger
-- arguments), so one pair of functions serves every versioned table in the pack.

CREATE OR REPLACE FUNCTION "haikai_temporal_row_start"() RETURNS trigger LANGUAGE plpgsql AS $haikai$
DECLARE
  v_start text := TG_ARGV[0];
  v_end   text := TG_ARGV[1];
BEGIN
  -- A row that is CURRENT runs from now until the end of time, exactly like
  -- GENERATED ALWAYS AS ROW START / ROW END on the source.
  NEW := jsonb_populate_record(
    NEW,
    jsonb_build_object(
      v_start, to_jsonb(clock_timestamp()),
      v_end,   to_jsonb('infinity'::timestamptz)
    )
  );
  RETURN NEW;
END;
$haikai$;

CREATE OR REPLACE FUNCTION "haikai_temporal_versioning"() RETURNS trigger LANGUAGE plpgsql AS $haikai$
DECLARE
  v_history text := TG_ARGV[0];
  v_end     text := TG_ARGV[1];
BEGIN
  -- The superseded version is closed at clock_timestamp() and archived. The
  -- jsonb round-trip makes this generic over ANY table shape: the history
  -- table carries the same columns as its base table.
  EXECUTE format(
    'INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s, $1)).*',
    v_history, v_history
  )
  USING to_jsonb(OLD) || jsonb_build_object(v_end, to_jsonb(clock_timestamp()));
  RETURN NULL;
END;
$haikai$;

-- Ledger.Account: SYSTEM_VERSIONED at source; emulated per resolved decision 'temporal_table--Ledger.Account'.
-- History rows land in Ledger.AccountHistory, the source history table, which migrates as an ordinary table (its rows are loaded, never re-derived).
CREATE INDEX "AccountHistory_period_idx" ON "Ledger"."AccountHistory" ("ValidTo", "ValidFrom");
CREATE TRIGGER "Account_row_start" BEFORE INSERT OR UPDATE ON "Ledger"."Account" FOR EACH ROW EXECUTE FUNCTION "haikai_temporal_row_start"('ValidFrom', 'ValidTo');
CREATE TRIGGER "Account_versioning" AFTER UPDATE OR DELETE ON "Ledger"."Account" FOR EACH ROW EXECUTE FUNCTION "haikai_temporal_versioning"('Ledger.AccountHistory', 'ValidTo');
-- FOR SYSTEM_TIME rewrite for Ledger.Account: AS OF <t> becomes SELECT ... FROM Ledger.Account WHERE ValidFrom <= <t> AND ValidTo > <t> UNION ALL SELECT ... FROM Ledger.AccountHistory WHERE ValidFrom <= <t> AND ValidTo > <t>; ALL becomes the base UNION ALL the history table. See MSPG.TEMPORAL.001.

-- ===== Full-text indexes — MSPG.FULLTEXT.001 =====
-- A generated tsvector column + GIN index reproduces the access shape; CONTAINS /
-- FREETEXT predicates become @@ to_tsquery / plainto_tsquery. Ranking and stemming
-- differ between the engines, so result ORDER is advisory, never a parity failure.

-- Ops.SensorArchive.FT_Ops_SensorArchive_ReadingNote: FULL-TEXT at source; emulated per resolved decision 'fulltext_index--Ops.SensorArchive' over ReadingNote, ReadingSummary.
ALTER TABLE "Ops"."SensorArchive" ADD COLUMN "FT_Ops_SensorArchive_ReadingNote_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("ReadingNote", '') || ' ' || coalesce("ReadingSummary", ''))) STORED;
CREATE INDEX "FT_Ops_SensorArchive_ReadingNote_gin" ON "Ops"."SensorArchive" USING gin ("FT_Ops_SensorArchive_ReadingNote_tsv");
-- Rewrite: CONTAINS(<col>, 'a AND b') becomes FT_Ops_SensorArchive_ReadingNote_tsv @@ to_tsquery('english', 'a & b'); FREETEXT becomes plainto_tsquery / websearch_to_tsquery; CONTAINSTABLE/FREETEXTTABLE rank becomes ts_rank.
