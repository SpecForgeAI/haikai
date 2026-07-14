/**
 * Spec P part 2 (Data-Tier Oracle Program) — the data-parity Migrate gate
 * (gate 4d). Pins:
 *
 *   UNVERIFIED PIN — no report, a non-clean/non-divergent status, a missing
 *                    architecture id, and a READ FAILURE all block as
 *                    data_parity_unverified (fail-closed)
 *   FAILED PIN     — divergent tables block as data_parity_failed, naming
 *                    the tables
 *   WAIVER PIN     — per-table waivers (target "data-parity:<table>" or
 *                    "data-parity:<schema>.<table>") exclude tables from the
 *                    block; ALL-waived passes the gate
 *   CLEAN PIN      — a clean latest report passes
 */
import {
  DataParityGateReads,
  LatestDataParityReport,
  evaluateDataParityReadiness,
} from '../services/migrationDataParityGate';
import { BreakFingerprintWaiver } from '../services/migrationParityVerifier';

function reads(
  report: LatestDataParityReport | null,
  waivers: BreakFingerprintWaiver[] = [],
  opts?: { reportThrows?: boolean },
): DataParityGateReads {
  return {
    async fetchLatestDataParityReport() {
      if (opts?.reportThrows) throw new Error('AMS unreachable');
      return report;
    },
    async fetchWaivers() {
      return waivers;
    },
  };
}

function waiver(target: string): BreakFingerprintWaiver {
  return { target } as BreakFingerprintWaiver;
}

const PROJECT = 'p-1';
const ARCH = 'a-1';

describe('data-parity Migrate gate (4d)', () => {
  test('no report blocks as data_parity_unverified', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads(null),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe('data_parity_unverified');
    expect(result.reasons[0].message).toContain('No data-parity report');
  });

  test('a clean latest report passes the gate', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads({ status: 'clean', report_json: { tables: [] } }),
    });
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  test('divergent tables block as data_parity_failed, naming the tables', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads({
        status: 'divergent',
        report_json: {
          tables: [
            { table: 'orders', verdict: 'divergent' },
            { table: 'audit_log', schema: 'dbo', verdict: 'divergent' },
            { table: 'customers', verdict: 'match' },
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('data_parity_failed');
    expect(result.reasons[0].message).toContain('2 table(s)');
    expect(result.reasons[0].message).toContain('orders');
    expect(result.reasons[0].message).toContain('audit_log');
  });

  test('waived tables are excluded; bare and schema-qualified targets both match', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads(
        {
          status: 'divergent',
          report_json: {
            tables: [
              { table: 'orders', verdict: 'divergent' },
              { table: 'audit_log', schema: 'dbo', verdict: 'divergent' },
              { table: 'ledger', verdict: 'divergent' },
            ],
          },
        },
        [waiver('data-parity:Orders'), waiver('data-parity:dbo.audit_log')],
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('data_parity_failed');
    expect(result.reasons[0].message).toContain('1 table(s)');
    expect(result.reasons[0].message).toContain('ledger');
    expect(result.reasons[0].message).not.toContain('orders');
  });

  test('ALL divergent tables waived passes the gate', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads(
        {
          status: 'divergent',
          report_json: { tables: [{ table: 'orders', verdict: 'divergent' }] },
        },
        [waiver('data-parity:orders')],
      ),
    });
    expect(result.ok).toBe(true);
  });

  test('a non-clean non-divergent status blocks as unverified', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads({ status: 'unverifiable', report_json: { tables: [] } }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('data_parity_unverified');
    expect(result.reasons[0].message).toContain("'unverifiable'");
  });

  test('a report read failure blocks as unverified (fail-closed)', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: ARCH,
      reads: reads(null, [], { reportThrows: true }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('data_parity_unverified');
    expect(result.reasons[0].message).toContain('fail-closed');
  });

  test('a missing architecture id blocks as unverified', async () => {
    const result = await evaluateDataParityReadiness({
      projectId: PROJECT,
      architectureId: null,
      reads: reads({ status: 'clean' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons[0].code).toBe('data_parity_unverified');
  });
});
