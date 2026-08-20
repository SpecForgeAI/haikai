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
  it('offers only for FAILED sessions whose error names S0', () => {
    expect(
      shouldOfferS0Restore({
        status: 'failed',
        error_message: 'the database is NO LONGER S0 — restore, then re-run.',
      }),
    ).toBe(true);
    expect(
      shouldOfferS0Restore({ status: 'completed', error_message: 'S0 fine' }),
    ).toBe(false);
    expect(
      shouldOfferS0Restore({ status: 'failed', error_message: 'timeout talking to API' }),
    ).toBe(false);
    expect(shouldOfferS0Restore({ status: 'failed', error_message: null })).toBe(false);
  });
});
