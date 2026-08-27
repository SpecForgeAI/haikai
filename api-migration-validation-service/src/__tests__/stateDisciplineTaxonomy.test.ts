/**
 * State-discipline remediation phase 1 (2026-08-27) — taxonomy + terminal
 * status. Pins: the LLM note tool accepts the new honest labels (and only
 * those — receipts stay orchestrator-only), the shared findings tally is
 * bumped, and `resolveFinalStatus` classifies a finished-with-findings run
 * as `completed_with_findings`, never `failed`.
 */

import { recordCaptureNoteTool } from '../services/tools/record_capture_note';
import { resolveFinalStatus } from '../services/captureSessionOrchestrator';
import type { ToolExecutionContext } from '../services/tools';

function buildCtx(): { ctx: ToolExecutionContext; createDiagnostic: jest.Mock; tally: Record<string, number> } {
  const createDiagnostic = jest.fn(async () => ({ id: 'diag-1' }));
  const tally: Record<string, number> = {};
  const ctx = {
    session: { id: 'session-1', projectId: 'proj-1', architectureId: 'arch-1' },
    operationsByOasId: new Map(),
    archModelClient: {
      createDiagnostic,
      createScenario: jest.fn(),
      createCapture: jest.fn(),
    },
    currentScenarioId: 'scenario-1',
    findingsTally: tally,
  } as unknown as ToolExecutionContext;
  return { ctx, createDiagnostic, tally };
}

describe('taxonomy via record_capture_note (phase 1)', () => {
  it('captured_ok is a first-class label and bumps the findings tally', async () => {
    const { ctx, createDiagnostic, tally } = buildCtx();
    const result = (await recordCaptureNoteTool.handler(
      { message: 'clean capture', diagnosticType: 'captured_ok' },
      ctx,
    )) as { diagnosticType: string };
    expect(result.diagnosticType).toBe('captured_ok');
    expect(createDiagnostic.mock.calls[0][1]).toMatchObject({ diagnostic_type: 'captured_ok' });
    expect(tally.captured_ok).toBe(1);
  });

  it('contract_gap and manual_rec_required are accepted', async () => {
    const { ctx } = buildCtx();
    for (const t of ['contract_gap', 'manual_rec_required']) {
      const result = (await recordCaptureNoteTool.handler(
        { message: 'x', diagnosticType: t },
        ctx,
      )) as { diagnosticType: string };
      expect(result.diagnosticType).toBe(t);
    }
  });

  it('orchestrator-only receipts are NOT accepted from the LLM (fall back to default)', async () => {
    const { ctx } = buildCtx();
    for (const t of ['state_healed', 's0_restore_recorded']) {
      const result = (await recordCaptureNoteTool.handler(
        { message: 'x', diagnosticType: t },
        ctx,
      )) as { diagnosticType: string };
      expect(result.diagnosticType).toBe('endpoint_skipped');
    }
  });
});

describe('resolveFinalStatus (§6 reclassification)', () => {
  const base = {
    infraError: null,
    stateResidueError: null,
    dailyLimitHit: false,
    authExpiryHit: false,
    findingsCount: 0,
  };

  it('a finished run with findings is completed_with_findings, never failed', () => {
    expect(resolveFinalStatus({ ...base, findingsCount: 3 })).toBe('completed_with_findings');
    expect(resolveFinalStatus({ ...base })).toBe('completed');
  });

  it('hard failures and pauses keep precedence over findings', () => {
    expect(resolveFinalStatus({ ...base, findingsCount: 3, stateResidueError: 'residue' })).toBe(
      'failed',
    );
    expect(resolveFinalStatus({ ...base, findingsCount: 3, infraError: 'boom' })).toBe('failed');
    expect(resolveFinalStatus({ ...base, findingsCount: 3, dailyLimitHit: true })).toBe(
      'paused_rate_limited',
    );
    expect(resolveFinalStatus({ ...base, findingsCount: 3, authExpiryHit: true })).toBe(
      'paused_auth_expired',
    );
  });
});
