-- Bulk load: Ledger.Account (table 1 of 4, FK-topological order)
-- Phase 2 of 5 — run AFTER the structural changesets, BEFORE foreign keys / indexes / reseed.
-- Identity columns (AccountID): source values are PRESERVED. COPY writes identity columns directly; if you load via INSERT instead, use INSERT ... OVERRIDING SYSTEM VALUE to keep the source ids (the columns are GENERATED ALWAYS AS IDENTITY on the target).
-- This pack documents the extract -> COPY pipe; it does NOT execute it.
-- Source-side extract tool: bcp (queryout, -c -t, -r\n) or sqlcmd -W -s, — bcp is the bulk path; sqlcmd is fine for small tables.

-- 1) SQL Server extract (run against the source; casts aligned to the type mapping):
SELECT
    AccountID,
    Balance,
    CONVERT(varchar(27), ValidFrom, 121) AS ValidFrom,
    CONVERT(varchar(27), ValidTo, 121) AS ValidTo
FROM Ledger.Account;
-- cast note [ValidFrom]: datetime2(7) -> timestamp(6) without time zone; extract with CONVERT(varchar(27), <col>, 121)
-- cast note [ValidTo]: datetime2(7) -> timestamp(6) without time zone; extract with CONVERT(varchar(27), <col>, 121)

-- 2) PostgreSQL load (pipe the extract as CSV into):
COPY "Ledger"."Account" ("AccountID", "Balance", "ValidFrom", "ValidTo") FROM STDIN WITH (FORMAT csv, NULL '\N');
