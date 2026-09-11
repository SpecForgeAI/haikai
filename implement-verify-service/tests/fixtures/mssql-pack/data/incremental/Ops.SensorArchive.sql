-- Incremental top-up: Ops.SensorArchive
-- Delta key: SensorArchiveID | strategy: insert_only | chosen by: identity_column
-- Parameterised by :last_high_water — the prior run's max SensorArchiveID value.
-- Phase 5 of 5: increments execute WITH foreign keys and indexes enforced.
-- DELETE propagation is OUT OF SCOPE for incremental v1: incremental scripts insert and/or update only. Rows deleted at source after the bulk load are NOT removed by increments — tables configured for full reload each increment are the mechanism that catches deletes.

-- 1) SQL Server delta extract:
SELECT
    SensorArchiveID,
    ReadingNote,
    CONVERT(varchar(27), UpdatedAt, 121) AS UpdatedAt
FROM Ops.SensorArchive
WHERE SensorArchiveID > :last_high_water;

-- 2) PostgreSQL insert-only load (identity delta keys only ever append):
INSERT INTO "Ops"."SensorArchive" ("SensorArchiveID", "ReadingNote", "UpdatedAt")
OVERRIDING SYSTEM VALUE
SELECT "SensorArchiveID", "ReadingNote", "UpdatedAt" FROM "staging_SensorArchive"
WHERE "SensorArchiveID" > :last_high_water;
