/**
 * Group B-G twins for the SQL Server pack (SQL Server 16 -> PostgreSQL 18
 * pair programme, Spec 2, 2026-09-11, task 2.6).
 *
 * The Data-Layer Fidelity 2 groups (B collation, C sequence current value,
 * D default-expression hazard, E computed columns, F DB-resident jobs, G
 * fuller routine capture) are already pinned for Sybase and Postgres by
 * `dbCollationGroupB` / `dbSequenceCurrentValueGroupC` /
 * `dbDefaultExprHazardGroupD` / `dbComputedColumnGroupE` /
 * `dbScheduledJobsGroupF` / `dbProcedureCaptureGroupG`.
 *
 * This file pins ONLY the places where the SQL Server behaviour genuinely
 * DIFFERS from the Sybase resolution, head to head, so the difference is a
 * decision on the record rather than an accident:
 *
 *   B  collation      -- ASE surfaces a sort-order NAME the sidecar often
 *                        cannot read; SQL Server reports a per-column
 *                        `Latin1_General_CI_AS` every time, so the hazard is
 *                        the DEFAULT state of the estate, not an edge case.
 *   C  current value  -- ASE has NO current-value column (the cutover finding
 *                        is marked value-unavailable); SQL Server reports
 *                        `sys.sequences.current_value` and `IDENT_CURRENT()`,
 *                        so the high-water mark is genuinely present.
 *   D  defaults       -- both engines use T-SQL server built-ins, but SQL
 *                        Server's DEFAULT is a NAMED constraint, so the name
 *                        rides along with the verbatim expression.
 *   E  computed       -- ASE reports computed / not-computed; SQL Server also
 *                        reports PERSISTED, which decides whether PostgreSQL
 *                        can reproduce it as GENERATED ... STORED at all.
 *   F  jobs           -- ASE reads the Job Scheduler; SQL Server reads
 *                        `msdb` Agent jobs, which carry ORDERED STEPS and a
 *                        human schedule, and which a scan account without
 *                        SQLAgentReaderRole cannot see at all.
 *   G  routines       -- ASE reassembles a capped body from 255-char
 *                        `syscomments` segments; `sys.sql_modules` returns the
 *                        complete definition, so the body doubles as the
 *                        recreatable `fullDefinition` and the catalog
 *                        parameter rows compose a real argument signature.
 *
 * Plus the applicability inversion that is unique to this engine:
 * `index_predicate` and `native_sequence` are the two groups ASE resolves to
 * `not_applicable_for_engine`; on SQL Server they are ordinary supported
 * groups. Offline; fixtures are read from disk.
 */

import * as fs from 'fs';
import * as path from 'path';

import { transformMssqlIntrospection } from '../services/databasePacks/mssql/mssqlIntrospection';
import { buildAllMssqlFindings } from '../services/databasePacks/mssql/mssqlFindings';
import { inferMssqlRelationships } from '../services/databasePacks/mssql/mssqlRelationshipInference';
import { transformSidecarIntrospection } from '../services/databasePacks/sybase/sybaseIntrospection';
import type { SidecarIntrospectionResponse } from '../services/databasePacks/sidecarClient';
import type { FindingEmitInput } from '../services/findings/FindingEmitter';
import type { ProfileResult } from '../services/databasePacks/types';

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'mssql');

function fixture(name: string): SidecarIntrospectionResponse {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'),
  ) as SidecarIntrospectionResponse;
}

const EMPTY_PROFILE: ProfileResult = { tables: [], skippedTables: [] };

function findingsFor(name: string): FindingEmitInput[] {
  const ir = transformMssqlIntrospection(fixture(name));
  return buildAllMssqlFindings(
    ir,
    EMPTY_PROFILE,
    inferMssqlRelationships(ir, ir.mssql.indexes),
  );
}

function detail(f: FindingEmitInput): Record<string, unknown> {
  return (f.detailJson ?? {}) as Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Group B -- collation
// -----------------------------------------------------------------------------

describe('Group B twin: collation (SQL Server reports a per-column _CI_ every time)', () => {
  const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));

  it('carries the per-column collation VERBATIM and resolves the group to PRESENT', () => {
    const customerName = ir.columns.find((c) => c.columnName === 'CustomerName');
    expect(customerName?.collation).toBe('Latin1_General_CI_AS');
    expect(ir.databaseCollation).toBe('Latin1_General_100_CI_AS');
    expect(ir.metadataApplicability?.collation).toBe('present');
  });

  it('fires the hazard on every case-insensitive string column, with the DB default as context', () => {
    const hazards = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'collation_case_sensitivity_hazard',
    );
    expect(hazards.length).toBeGreaterThanOrEqual(4);
    for (const h of hazards) {
      expect(detail(h).engineKey).toBe('mssql');
      expect(detail(h).collation).toBe('Latin1_General_CI_AS');
      expect(detail(h).databaseCollation).toBe('Latin1_General_100_CI_AS');
    }
  });

  it('the Sybase mapper, given the SAME wire fields, still resolves its own way (no cross-contamination)', () => {
    // The Sybase transform is fed the same response object. It must NOT pick
    // up the SQL Server capability semantics -- ASE's `index_predicate` stays
    // a structural not-applicable no matter what the wire says.
    const syb = transformSidecarIntrospection(fixture('wwi-introspect.json'));
    expect(syb.metadataApplicability?.index_predicate).toBe('not_applicable_for_engine');
    expect(ir.metadataApplicability?.index_predicate).not.toBe(
      'not_applicable_for_engine',
    );
  });
});

// -----------------------------------------------------------------------------
// Group C -- sequence / identity current value
// -----------------------------------------------------------------------------

describe('Group C twin: the sequence high-water mark is genuinely AVAILABLE on SQL Server', () => {
  const findings = findingsFor('wwi-introspect.json');

  it('reports current_value for a native sequence AND for a synthesized identity row', () => {
    const cutovers = findings.filter((f) => f.findingType === 'sequence_cutover_hazard');
    const byName = new Map(
      cutovers.map((f) => [String(detail(f).sequenceName), detail(f)]),
    );
    expect(byName.get('CustomerID')?.currentValue).toBe('1062');
    const identity = byName.get(
      'VehicleTemperatures.VehicleTemperatureID (identity)',
    );
    expect(identity?.currentValue).toBe('65998');
    expect(identity?.ownedByTable).toBe('VehicleTemperatures');
    expect(identity?.ownedByColumn).toBe('VehicleTemperatureID');
  });

  it('keeps every value a STRING so a bigint past Number.MAX_SAFE_INTEGER is never coerced', () => {
    const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));
    for (const s of ir.sequences ?? []) {
      if (s.currentValue !== null && s.currentValue !== undefined) {
        expect(typeof s.currentValue).toBe('string');
      }
      if (s.startValue !== null && s.startValue !== undefined) {
        expect(typeof s.startValue).toBe('string');
      }
    }
  });

  it('resolves BOTH sequence groups from the capability -- native_sequence is never a structural N/A here', () => {
    const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));
    expect(ir.metadataApplicability?.sequence_current_value).toBe('present');
    expect(ir.metadataApplicability?.native_sequence).toBe('present');
  });
});

// -----------------------------------------------------------------------------
// Group D -- non-portable defaults
// -----------------------------------------------------------------------------

describe('Group D twin: SQL Server defaults are NAMED constraints', () => {
  it('flags the server built-in verbatim and keeps the constraint name on the IR extras', () => {
    const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));
    const extras = ir.mssql.columns.find((c) => c.columnName === 'LastEditedWhen');
    expect(extras?.defaultConstraintName).toBe(
      'DF_Sales_CustomerTransactions_LastEditedWhen',
    );

    const flagged = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'non_portable_default',
    );
    const lastEdited = flagged.find(
      (f) => detail(f).columnName === 'LastEditedWhen',
    );
    // VERBATIM -- never rewritten to now() or anything else.
    expect(detail(lastEdited!).columnDefault).toBe('(sysdatetime())');
  });

  it('does NOT flag a NEXT VALUE FOR default -- a sequence default is portable, it just needs the sequence', () => {
    const flagged = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'non_portable_default',
    );
    expect(flagged.map((f) => detail(f).columnName)).not.toContain('CustomerID');
  });

  it('flags newid() on the hard-features fixture', () => {
    const flagged = findingsFor('hard-features-introspect.json').filter(
      (f) => f.findingType === 'non_portable_default',
    );
    expect(flagged.map((f) => detail(f).columnName)).toContain('RowGuid');
  });
});

// -----------------------------------------------------------------------------
// Group E -- computed columns, PERSISTED or not
// -----------------------------------------------------------------------------

describe('Group E twin: PERSISTED decides whether PostgreSQL can reproduce the column at all', () => {
  const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));

  it('marks both computed columns as generated on the neutral IR', () => {
    for (const name of ['IsFinalized', 'SearchName', 'OtherLanguages']) {
      const col = ir.columns.find((c) => c.columnName === name);
      expect(col?.isGenerated).toBe(true);
      expect(col?.generationExpression).toBeTruthy();
    }
    expect(ir.metadataApplicability?.computed_columns).toBe('present');
  });

  it('separates PERSISTED from non-persisted, and flags ONLY the non-persisted one', () => {
    const persisted = ir.mssql.columns.filter((c) => c.isPersistedComputed);
    expect(persisted.map((c) => c.columnName).sort()).toEqual([
      'IsFinalized',
      'SearchName',
    ]);

    const flagged = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'computed_column_not_persisted',
    );
    expect(flagged.map((f) => detail(f).columnName)).toEqual(['OtherLanguages']);
    expect(flagged[0].summary).toMatch(/always STORED/);
  });
});

// -----------------------------------------------------------------------------
// Group F -- DB-resident scheduled jobs
// -----------------------------------------------------------------------------

describe('Group F twin: SQL Server Agent jobs carry ordered steps, and are invisible without the msdb GRANT', () => {
  it('emits a db_resident_scheduled_job whose scheduler is sql_server_agent', () => {
    const jobs = findingsFor('hard-features-introspect.json').filter(
      (f) => f.findingType === 'db_resident_scheduled_job',
    );
    expect(jobs).toHaveLength(1);
    expect(detail(jobs[0]).scheduler).toBe('sql_server_agent');
    expect(detail(jobs[0]).schedule).toBe('Occurs every day at 02:15:00');
  });

  it('keeps every step, in order, with its subsystem -- a multi-step job is not one command', () => {
    const ir = transformMssqlIntrospection(fixture('hard-features-introspect.json'));
    const steps = ir.mssql.scheduledJobs[0].steps;
    expect(steps.map((s) => s.ordinal)).toEqual([1, 2]);
    expect(steps.map((s) => s.subsystem)).toEqual(['TSQL', 'CmdExec']);
    expect(steps[0].databaseName).toBe('LedgerDemo');
  });

  it('a scan account without SQLAgentReaderRole surfaces an evidence gap, not silence', () => {
    const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));
    expect(ir.metadataApplicability?.db_jobs).toBe('unavailable');
    const gaps = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'evidence_gap',
    );
    expect(
      gaps.some((g) => /SQL Server Agent/.test(g.summary ?? '')),
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// Group G -- fuller routine capture
// -----------------------------------------------------------------------------

describe('Group G twin: sys.sql_modules returns the COMPLETE body, so there is nothing to reassemble', () => {
  const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));

  it('sets fullDefinition from the body -- no 4096-char cap, no segment join', () => {
    for (const p of ir.procedures) {
      expect(p.fullDefinition).toBe(p.body);
      expect(p.body.length).toBeGreaterThan(0);
    }
  });

  it('composes a real argument signature from the catalog parameter rows, incl. READONLY and OUTPUT', () => {
    const insertOrders = ir.procedures.find(
      (p) => p.procedureName === 'InsertCustomerOrders',
    );
    expect(insertOrders?.arguments).toBe(
      '@Orders Website.OrderList READONLY, @OrderLines Website.OrderLineList READONLY, ' +
        '@OrdersCreatedByPersonID int, @SalespersonPersonID int',
    );
    const hard = transformMssqlIntrospection(fixture('hard-features-introspect.json'));
    const sync = hard.procedures.find((p) => p.procedureName === 'SyncFromWarehouse');
    expect(sync?.arguments).toBe('@AsOf date, @RowsCopied int OUTPUT');
  });

  it('carries the return type and treats EXECUTE AS OWNER as the SECURITY DEFINER equivalent', () => {
    const scalar = ir.procedures.find(
      (p) => p.procedureName === 'CalculateCustomerPrice',
    );
    expect(scalar?.returnType).toBe('decimal(18,2)');
    expect(scalar?.securityDefiner).toBe(true);
    const tvf = ir.procedures.find(
      (p) => p.procedureName === 'DetermineCustomerAccess',
    );
    // No EXECUTE AS clause -> invoker rights, stated as false rather than left
    // undefined.
    expect(tvf?.securityDefiner).toBe(false);
  });

  it('keeps a CLR routine on the neutral IR with an EMPTY body and the assembly binding in the extras', () => {
    const hard = transformMssqlIntrospection(fixture('hard-features-introspect.json'));
    const clr = hard.procedures.find((p) => p.procedureName === 'ScoreRisk');
    expect(clr?.routineKind).toBe('procedure');
    expect(clr?.body).toBe('');
    expect(clr?.fullDefinition).toBeNull();
    const extras = hard.mssql.routines.find((r) => r.routineName === 'ScoreRisk');
    expect(extras).toMatchObject({
      isClr: true,
      assemblyName: 'LedgerRiskScoring',
      language: 'CLR',
    });
  });
});

// -----------------------------------------------------------------------------
// The applicability inversion
// -----------------------------------------------------------------------------

describe('Applicability inversion: the two ASE structural N/As are ordinary supported groups here', () => {
  it('emits an evidence gap for an UNREAD filtered predicate instead of suppressing it as a structural N/A', () => {
    // WideWorldImporters has no filtered index, and the capability IS
    // advertised -> `unavailable` -> a real read gap the reviewer sees.
    const ir = transformMssqlIntrospection(fixture('wwi-introspect.json'));
    expect(ir.metadataApplicability?.index_predicate).toBe('unavailable');
    const gaps = findingsFor('wwi-introspect.json').filter(
      (f) => f.findingType === 'evidence_gap',
    );
    expect(
      gaps.some((g) => /filtered-index predicate/.test(g.summary ?? '')),
    ).toBe(true);
    expect(
      gaps.some((g) => /sys\.indexes\.filter_definition/.test(g.summary ?? '')),
    ).toBe(true);
  });

  it('resolves the predicate to PRESENT and suppresses the gap once a filtered index IS read', () => {
    const ir = transformMssqlIntrospection(fixture('hard-features-introspect.json'));
    expect(ir.metadataApplicability?.index_predicate).toBe('present');
    const filtered = ir.keysAndIndexes.find(
      (k) => k.name === 'IX_Ledger_Postings_Active',
    );
    expect(filtered?.indexPredicate).toBe('([IsVoided]=(0))');
    const gaps = findingsFor('hard-features-introspect.json').filter(
      (f) => f.findingType === 'evidence_gap',
    );
    expect(
      gaps.some((g) => /filtered-index predicate/.test(g.summary ?? '')),
    ).toBe(false);
  });

  it('never resolves ANY group to not_applicable_for_engine on a supported SQL Server version', () => {
    for (const name of ['wwi-introspect.json', 'hard-features-introspect.json']) {
      const ir = transformMssqlIntrospection(fixture(name));
      for (const [group, state] of Object.entries(ir.metadataApplicability ?? {})) {
        expect([group, state]).not.toEqual([group, 'not_applicable_for_engine']);
      }
    }
  });
});
