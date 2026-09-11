# SQL Server introspection fixtures

Offline, sidecar-shaped `/introspect` responses (engine `mssql`) for the
discovery `mssql` pack tests. Spec:
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/SPEC-2-discovery-mssql-pack.md`
task 2.5. Wire shape:
`agent-os/specs/2026-09-11-sqlserver-postgres-pair-program/WIRE-CONTRACT.md` §2.

**No network, ever.** These files are read from disk by the test suite. Nothing
here is fetched at test time or at build time, and no SQL Server instance is
required to run the suite.

## Files

| file | what it is |
|---|---|
| `wwi-introspect.json` | A representative SUBSET of the WideWorldImporters schema, hand-shaped into the sidecar wire format: a temporal pair (`Sales.Customers` + `Sales.Customers_Archive`), a second temporal pair (`Application.People` + `Application.People_Archive`), a persisted computed column and a non-persisted one, a memory-optimized table with an identity column, native sequences with current values, foreign keys with referential actions and populated referenced columns, a check constraint, an index with INCLUDE columns, a `geography` column, user-defined table types, a `WITH SCHEMABINDING` inline table-valued function, a scalar function, and two TRY/CATCH procedures (one of which takes READONLY table-valued parameters and re-THROWs). |
| `wwi-proc-bodies.json` | The same routine bodies keyed by schema-qualified name, in the `LiveProcSource` shape the proc harvest returns, so the routine-profiler tests can consume them directly. |
| `hard-features-introspect.json` | **Hand-authored, NOT derived from WideWorldImporters.** The WideWorldImporters SSDT DDL contains no filtered index, no trigger, no indexed view, no columnstore index, no CLR routine, no Service Broker object, no synonym, no `sql_variant` / `hierarchyid` / `xml` column and no cross-database reference, so this second fixture supplies one small, plausible, invented example of each. Every name in it is invented. It exists so the pack's SQL-Server-only findings and the two OUT rulings are pinned by a test rather than assumed. |

## Provenance

`wwi-introspect.json` and `wwi-proc-bodies.json` are derived from Microsoft's
WideWorldImporters sample database, which is MIT-licensed. The derivation was
done offline from the sample's SSDT DDL; only the object names, column types
and routine bodies needed by the tests were carried over, reshaped by hand
into the sidecar wire contract.

## Conventions

- Values that the wire contract types as strings for bigint-safety
  (`identitySeed`, `identityIncrement`, `startValue`, `currentValue`, ...) are
  strings here too, never JSON numbers.
- `capabilities[]` deliberately OMITS `db_jobs`: the fixture models a scan
  account with `VIEW DEFINITION` on the database but no `SQLAgentReaderRole`
  in `msdb`. That resolves the `db_jobs` group to `unavailable` and is what
  pins the evidence-gap Finding. `hard-features-introspect.json` advertises it
  and carries a job, pinning the other side.
- No credential, host name or client identifier appears in any fixture.
