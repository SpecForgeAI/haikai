-- reconcile/reconciliation.sql
-- Per-run reconciliation queries. Run the PostgreSQL section on the
-- TARGET and the SQL Server section on the SOURCE; feed both CSV outputs to
-- reconcile/build-report.sh to produce the drift report.
-- v1 compares per-table ROW COUNTS plus max(delta_key) where a key
-- exists; value checksums are a manual escalation (engine hash functions
-- are not cross-comparable without a canonicalisation step).

-- ===== PostgreSQL (TARGET) — psql -qAt -F, ===== 
SELECT 'Ledger.Account', count(*)::text, NULL FROM "Ledger"."Account";
SELECT 'Ledger.AccountHistory', count(*)::text, NULL FROM "Ledger"."AccountHistory";
SELECT 'Ops.SensorArchive', count(*)::text, max("SensorArchiveID")::text FROM "Ops"."SensorArchive";
SELECT 'Ledger.Postings', count(*)::text, NULL FROM "Ledger"."Postings";

-- ===== SQL Server (SOURCE) — sqlcmd -h -1 -W -s,, same column order =====
SELECT 'Ledger.Account', CONVERT(varchar(20), COUNT_BIG(*)), NULL FROM Ledger.Account
GO
SELECT 'Ledger.AccountHistory', CONVERT(varchar(20), COUNT_BIG(*)), NULL FROM Ledger.AccountHistory
GO
SELECT 'Ops.SensorArchive', CONVERT(varchar(20), COUNT_BIG(*)), CONVERT(varchar(40), MAX(SensorArchiveID)) FROM Ops.SensorArchive
GO
SELECT 'Ledger.Postings', CONVERT(varchar(20), COUNT_BIG(*)), NULL FROM Ledger.Postings
GO
