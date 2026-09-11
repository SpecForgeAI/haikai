-- Bulk load: Ops.SensorArchive (table 3 of 4, FK-topological order)
-- Phase 2 of 5 — run AFTER the structural changesets, BEFORE foreign keys / indexes / reseed.
-- Identity columns (SensorArchiveID): source values are PRESERVED. COPY writes identity columns directly; if you load via INSERT instead, use INSERT ... OVERRIDING SYSTEM VALUE to keep the source ids (the columns are GENERATED ALWAYS AS IDENTITY on the target).
-- Generated columns (ReadingSummary): EXCLUDED from the COPY column list — Postgres computes them.
-- This pack documents the extract -> COPY pipe; it does NOT execute it.
-- Source-side extract tool: bcp (queryout, -c -t, -r\n) or sqlcmd -W -s, — bcp is the bulk path; sqlcmd is fine for small tables.

-- 1) SQL Server extract (run against the source; casts aligned to the type mapping):
SELECT
    SensorArchiveID,
    ReadingNote,
    CONVERT(varchar(27), UpdatedAt, 121) AS UpdatedAt
FROM Ops.SensorArchive;
-- cast note [ReadingNote]: nvarchar(n) -> varchar(n): UTF-16 source characters load as UTF-8 (declared width is in CHARACTERS on both sides)
-- cast note [UpdatedAt]: datetime2(3) -> timestamp(3) without time zone; extract with CONVERT(varchar(27), <col>, 121)

-- 2) PostgreSQL load (pipe the extract as CSV into):
COPY "Ops"."SensorArchive" ("SensorArchiveID", "ReadingNote", "UpdatedAt") FROM STDIN WITH (FORMAT csv, NULL '\N');
