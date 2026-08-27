/**
 * Capture-diagnostics grouping helpers (2026-08-20). Pins the severity
 * taxonomy (halt/warning/info), the group ordering (halt first, then count,
 * then name), the humanized labels, and the S0-restore offer gate.
 */

import { describe, it, expect } from 'vitest';
import type { ApiBehaviourDiagnosticDto } from '../../api/apiBehaviourClient';
import {
  groupDiagnostics,
  labelFor,
  severityFor,
  shouldOfferS0Restore,
} from './captureDiagnosticsSupport';

function diag(type: string | null, message = 'm'): ApiBehaviourDiagnosticDto {
  return {
    id: `d-${Math.abs(
      [...(type ?? 'x')].reduce((h, c) => h + c.charCodeAt(0), 0),
    )}-${message}`,
    session_id: 's-1',
    operation_id: null,
    scenario_id: null,
    diagnostic_type: type,
    message,
    detail_json: null,
    created_at: '2026-08-20T10:00:00Z',
  };
}

describe('severityFor', () => {
  it('classifies residue + fingerprint mismatch as halt', () => {
    expect(severityFor('compensation_residue')).toBe('halt');
    expect(severityFor('state_residue')).toBe('halt');
    expect(severityFor('s0_fingerprint_mismatch')).toBe('halt');
  });
  it('classifies refusals + S0 advisories as warning', () => {
    expect(severityFor('compensation_refused')).toBe('warning');
    expect(severityFor('compensation_no_effect_map')).toBe('warning');
    expect(severityFor('compensation_inactive')).toBe('warning');
    expect(severityFor('s0_snapshot_missing')).toBe('warning');
  });
  it('classifies unknown / null / sequence_pinned as info', () => {
    expect(severityFor('sequence_pinned')).toBe('info');
    expect(severityFor(null)).toBe('info');
    expect(severityFor('never_heard_of_it')).toBe('info');
  });
});

describe('groupDiagnostics', () => {
  it('orders halt -> warning -> info, then by count desc', () => {
    const groups = groupDiagnostics([
      diag('sequence_pinned', 'a'),
      diag('compensation_refused', 'b'),
      diag('compensation_refused', 'c'),
      diag('compensation_residue', 'd'),
      diag('s0_snapshot_missing', 'e'),
    ]);
    expect(groups.map((g) => g.type)).toEqual([
      'compensation_residue',
      'compensation_refused',
      's0_snapshot_missing',
      'sequence_pinned',
    ]);
    expect(groups[1].items).toHaveLength(2);
  });

  it('buckets null types under "other" (info)', () => {
    const groups = groupDiagnostics([diag(null, 'x')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('other');
    expect(groups[0].severity).toBe('info');
  });
});

describe('labelFor', () => {
  it('humanizes underscores', () => {
    expect(labelFor('compensation_no_effect_map')).toBe('compensation no effect map');
    expect(labelFor(null)).toBe('other');
  });
});

describe('shouldOfferS0Restore', () => {
  it('offers for S0-halted failures AND (Item #6 gate, 2026-08-27) for successful completions', () => {
    expect(
      shouldOfferS0Restore({
        status: 'failed',
        error_message: 'the database is NO LONGER S0 — restore, then re-run.',
      }),
    ).toBe(true);
    // The post-capture restore is a GATE, not a courtesy: completed runs
    // get the prominent restore CTA (the receipt unlocks migrate/reconcile).
    expect(
      shouldOfferS0Restore({ status: 'completed', error_message: null }),
    ).toBe(true);
    expect(
      shouldOfferS0Restore({ status: 'completed_with_findings', error_message: null }),
    ).toBe(true);
    // Non-S0 failures and running sessions still get no restore panel.
    expect(
      shouldOfferS0Restore({ status: 'failed', error_message: 'timeout talking to API' }),
    ).toBe(false);
    expect(shouldOfferS0Restore({ status: 'failed', error_message: null })).toBe(false);
    expect(shouldOfferS0Restore({ status: 'running', error_message: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spec 0 (2026-08-22): identical-message grouping — display-only collapse of
// per-scenario repeat walls into xN lines.
// ---------------------------------------------------------------------------

import { groupIdenticalMessages } from './captureDiagnosticsSupport';

function refusal(id: string, message: string | null): ApiBehaviourDiagnosticDto {
  return { ...diag('compensation_refused', message ?? 'm'), id, message };
}

describe('groupIdenticalMessages', () => {
  it('collapses identical messages with a count, preserving first-seen order', () => {
    const grouped = groupIdenticalMessages([
      refusal('a', 'table x: missing_pk'),
      refusal('b', 'table y: missing_pk'),
      refusal('c', 'table x: missing_pk'),
      refusal('d', 'table x: missing_pk'),
    ]);
    expect(grouped).toEqual([
      { message: 'table x: missing_pk', count: 3, id: 'a' },
      { message: 'table y: missing_pk', count: 1, id: 'b' },
    ]);
  });

  it('null messages group under the placeholder', () => {
    const grouped = groupIdenticalMessages([refusal('a', null), refusal('b', null)]);
    expect(grouped).toEqual([{ message: '(no message)', count: 2, id: 'a' }]);
  });
});

// ---------------------------------------------------------------------------
// serializeDiagnosticsReport (2026-08-25 — diagnostics header Copy/Download)
// ---------------------------------------------------------------------------
import { serializeDiagnosticsReport } from './captureDiagnosticsSupport';

describe('serializeDiagnosticsReport', () => {
  it('emits every row untruncated with context + full detail_json, ordered halt -> warning -> info', () => {
    const diag = (
      id: string,
      type: string,
      message: string,
      extra: Partial<{ operation_id: string; scenario_id: string; detail_json: Record<string, unknown> }> = {},
    ) => ({
      id,
      session_id: 's-1',
      operation_id: extra.operation_id ?? null,
      scenario_id: extra.scenario_id ?? null,
      diagnostic_type: type,
      message,
      detail_json: extra.detail_json ?? null,
      created_at: '2026-08-25T00:00:00Z',
    });
    const report = serializeDiagnosticsReport('Capture diagnostics — session s-1', [
      diag('d1', 'endpoint_skipped', 'skipped: no effect map', {
        operation_id: 'op-9',
        detail_json: { endpoint: 'POST /api/x', reason: 'no_effect_map' },
      }),
      diag('d2', 'compensation_residue', 'residue on deal_book', { scenario_id: 'sc-3' }),
      // Identical messages stay SEPARATE rows (no xN collapsing — the
      // export is the complete artefact, unlike the screen).
      diag('d3', 'endpoint_skipped', 'skipped: no effect map'),
    ]);
    const lines = report.split('\n');
    expect(lines[0]).toBe('Capture diagnostics — session s-1');
    // Halt group first even though the warning group has more rows.
    expect(report.indexOf('== compensation residue [halt] (1) ==')).toBeLessThan(
      report.indexOf('== endpoint skipped [warning] (2) =='),
    );
    expect(report).toContain('- residue on deal_book [scenario=sc-3]');
    expect(report).toContain('- skipped: no effect map [operation=op-9]');
    expect(report).toContain('detail: {"endpoint":"POST /api/x","reason":"no_effect_map"}');
    // Both identical-message rows present.
    expect(report.match(/- skipped: no effect map/g)).toHaveLength(2);
  });
});
