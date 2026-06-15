/**
 * Tests for the run-integrity `degraded` computation + `filesFailed` wiring.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 2.
 *
 * ADVISORY throughout: every trigger sets `degraded = true` and appends a
 * reason, but NEVER blocks -- a degraded run still transitions to COMPLETED.
 * These tests pin:
 *   1. a `scanner_failed` Finding (W4) present -> degraded + matching reason;
 *   2. a nonzero `filesFailed` (from `failures.length`) -> degraded + reason;
 *   3. gap-fill `stageStatus: 'failed'` -> degraded + reason;
 *   4. a behaviour-capture method/token cap-hit (Spec 2) -> degraded + reason;
 *   5. a contract pass failure -> degraded + reason;
 *   6. NO triggers -> not degraded;
 *   7. the NON-BLOCK invariant: every trigger still yields a COMPLETED
 *      transition (`validateStatusTransition('RUNNING','COMPLETED')` never
 *      throws and the transition map is unchanged).
 */

import {
  computeRunDegradedSignal,
} from '../services/discoveryV3Pipeline';
import { validateStatusTransition } from '../services/runManager';
import type { FindingEmitInput } from '../services/findings/FindingEmitter';
import { buildScannerFailedFinding } from '../services/findings/emissionSources';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** A clean (no-trigger) argument baseline; individual tests flip one trigger. */
function cleanArgs(): Parameters<typeof computeRunDegradedSignal>[0] {
  return {
    findingInputs: [],
    gapFillStageStatus: 'completed',
    gapFillFilesFailed: 0,
    behaviourCaptureCapHit: false,
    responseContractStageStatus: 'completed',
  };
}

// ============================================================================
// Test 1: scanner_failed Finding (W4) -> degraded + reason
// ============================================================================
describe('computeRunDegradedSignal — scanner_failed (W4) escalation', () => {
  it('sets degraded + names the failed scanner when a scanner_failed Finding is present', () => {
    // Build the EXACT W4 Finding (do not re-author it); the computation reads it.
    const scannerFailed: FindingEmitInput = buildScannerFailedFinding({
      scanner: 'runSpringClassicScannerWithSoap',
      phase: 'pack_finding_scanner',
      error: 'boom',
    });
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      findingInputs: [scannerFailed],
    });
    expect(degraded).toBe(true);
    expect(degradedReasons.some((r) => r.startsWith('scanner_failed:'))).toBe(true);
    expect(degradedReasons.some((r) => r.includes('runSpringClassicScannerWithSoap'))).toBe(true);
  });

  it('does NOT treat a non-scanner_failed evidence_gap Finding as a trigger', () => {
    const ordinaryGap: FindingEmitInput = {
      findingType: 'evidence_gap',
      category: 'evidence_gap',
      severity: 'medium',
      title: 'Evidence gap: Foo -- endpoint_missing_data_effect',
      detailJson: { gapType: 'endpoint_missing_data_effect' },
    };
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      findingInputs: [ordinaryGap],
    });
    expect(degraded).toBe(false);
    expect(degradedReasons).toHaveLength(0);
  });
});

// ============================================================================
// Test 2: nonzero filesFailed -> degraded + reason
// ============================================================================
describe('computeRunDegradedSignal — nonzero filesFailed', () => {
  it('sets degraded + a gap_fill_files_failed reason naming the count', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      gapFillFilesFailed: 3,
    });
    expect(degraded).toBe(true);
    const reason = degradedReasons.find((r) => r.startsWith('gap_fill_files_failed:'));
    expect(reason).toBeDefined();
    expect(reason).toContain('3 file(s)');
  });
});

// ============================================================================
// Test 3: gap-fill stageStatus failed -> degraded + reason
// ============================================================================
describe('computeRunDegradedSignal — gap-fill stage failed', () => {
  it('sets degraded + a gap_fill_stage_failed reason', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      gapFillStageStatus: 'failed',
    });
    expect(degraded).toBe(true);
    expect(degradedReasons.some((r) => r.startsWith('gap_fill_stage_failed:'))).toBe(true);
  });
});

// ============================================================================
// Test 4: method/token cap-hit (Spec 2) -> degraded + reason
// ============================================================================
describe('computeRunDegradedSignal — behaviour-capture cap-hit (Spec 2)', () => {
  it('sets degraded + a capture_cap_hit reason when a method/token cap truncated capture', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      behaviourCaptureCapHit: true,
    });
    expect(degraded).toBe(true);
    expect(degradedReasons.some((r) => r.startsWith('capture_cap_hit:'))).toBe(true);
  });
});

// ============================================================================
// Test 5: contract-pass failure -> degraded + reason
// ============================================================================
describe('computeRunDegradedSignal — contract pass failed', () => {
  it('sets degraded + a contract_pass_failed reason when the response-contract stage failed', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      ...cleanArgs(),
      responseContractStageStatus: 'failed',
    });
    expect(degraded).toBe(true);
    expect(degradedReasons.some((r) => r.startsWith('contract_pass_failed:'))).toBe(true);
  });
});

// ============================================================================
// Test 6: no triggers -> not degraded
// ============================================================================
describe('computeRunDegradedSignal — clean run', () => {
  it('is NOT degraded and has no reasons when every signal is clean', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal(cleanArgs());
    expect(degraded).toBe(false);
    expect(degradedReasons).toHaveLength(0);
  });

  it('accumulates ALL reasons when multiple triggers fire at once', () => {
    const { degraded, degradedReasons } = computeRunDegradedSignal({
      findingInputs: [
        buildScannerFailedFinding({ scanner: 'javaFindingScanner', phase: 'pack_finding_scanner', error: 'x' }),
      ],
      gapFillStageStatus: 'failed',
      gapFillFilesFailed: 2,
      behaviourCaptureCapHit: true,
      responseContractStageStatus: 'failed',
    });
    expect(degraded).toBe(true);
    // One reason per distinct trigger family.
    expect(degradedReasons).toHaveLength(5);
  });
});

// ============================================================================
// Test 7: NON-BLOCK invariant — every trigger still yields COMPLETED
// ============================================================================
describe('degraded is advisory — the run still COMPLETES for every trigger', () => {
  const triggerCases: Array<[string, Parameters<typeof computeRunDegradedSignal>[0]]> = [
    ['scanner_failed', { ...cleanArgs(), findingInputs: [buildScannerFailedFinding({ scanner: 's', phase: 'p', error: 'e' })] }],
    ['filesFailed', { ...cleanArgs(), gapFillFilesFailed: 1 }],
    ['gap_fill_stage_failed', { ...cleanArgs(), gapFillStageStatus: 'failed' }],
    ['cap_hit', { ...cleanArgs(), behaviourCaptureCapHit: true }],
    ['contract_pass_failed', { ...cleanArgs(), responseContractStageStatus: 'failed' }],
  ];

  it.each(triggerCases)(
    'trigger=%s -> degraded=true AND RUNNING->COMPLETED transition is still valid (no block)',
    (_label, args) => {
      const { degraded } = computeRunDegradedSignal(args);
      expect(degraded).toBe(true);
      // The state machine is untouched: a degraded run STILL completes.
      expect(() => validateStatusTransition('RUNNING', 'COMPLETED')).not.toThrow();
    },
  );

  it('the transition map still rejects an invented degraded-as-status value', () => {
    // Guard: degraded is NOT a status enum value -- proves we did not extend the map.
    expect(() => validateStatusTransition('RUNNING', 'DEGRADED')).toThrow();
  });
});
