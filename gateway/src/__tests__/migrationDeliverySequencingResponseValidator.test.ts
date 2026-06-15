/**
 * Tests for the hand-rolled MigrationDeliverySequencingResponse validator.
 *
 * Spec: 2026-05-25 PM Tasks Captured Decisions Integration + Delivery Sequencing
 * Task Group 2.2.
 *
 * Covers (capped at 4-8 tests):
 *   1. Three response variants parse correctly: sequenced / insufficient_context / failed.
 *   2. Hard fail: initiativeId not present in supplied book of work.
 *   3. Hard fail: parallelisableWith entry not a valid initiative id.
 *   4. Hard fail: blockedBy entry not a valid initiative id.
 *   5. Hard fail: non-positive-integer `sequence` value.
 *   6. Hard fail: status='sequenced' with empty initiativeOrder.
 *   7. Warning only (no hard fail): cycle in blockedBy graph emits a structured warning.
 */

import {
  assertMigrationDeliverySequencingResponse,
  detectBlockedByCycles,
  SequencedResponseA,
} from '../services/migrationDeliverySequencingResponseValidator';

const BOOK_OF_WORK_IDS = new Set<string>(['I1', 'I2', 'I3']);

function baseSequencedPayload(): Record<string, unknown> {
  return {
    status: 'sequenced',
    confidence: 'high',
    warnings: [],
    initiativeOrder: [
      {
        initiativeId: 'I1',
        sequence: 1,
        parallelisableWith: [],
        blockedBy: [],
        rationale: '[decision:db.engine] Foundation database initiative.',
      },
      {
        initiativeId: 'I2',
        sequence: 2,
        parallelisableWith: [],
        blockedBy: ['I1'],
        rationale: 'Service-layer work depends on I1 schema being in place.',
      },
      {
        initiativeId: 'I3',
        sequence: 3,
        parallelisableWith: ['I2'],
        blockedBy: ['I1'],
        rationale: 'Frontend can land in parallel with service-layer work.',
      },
    ],
  };
}

describe('MigrationDeliverySequencingResponse validator (Spec 2026-05-25, Group 2.2)', () => {
  it('parses all three response variants when each is well-formed', () => {
    // Variant A -- sequenced
    const sequenced = assertMigrationDeliverySequencingResponse(
      baseSequencedPayload(),
      BOOK_OF_WORK_IDS
    );
    expect(sequenced.ok).toBe(true);
    if (sequenced.ok) {
      expect(sequenced.value.status).toBe('sequenced');
      const v = sequenced.value as SequencedResponseA;
      expect(v.initiativeOrder).toHaveLength(3);
      expect(v.confidence).toBe('high');
    }

    // Variant B -- insufficient_context
    const insufficient = assertMigrationDeliverySequencingResponse(
      {
        status: 'insufficient_context',
        recommendedNextAction: 'Capture more decisions first',
      },
      BOOK_OF_WORK_IDS
    );
    expect(insufficient.ok).toBe(true);
    if (insufficient.ok) {
      expect(insufficient.value.status).toBe('insufficient_context');
      if (insufficient.value.status === 'insufficient_context') {
        expect(insufficient.value.recommendedNextAction).toBe(
          'Capture more decisions first'
        );
      }
    }

    // Variant C -- failed
    const failed = assertMigrationDeliverySequencingResponse(
      {
        status: 'failed',
        errorMessage: 'Generator timed out',
      },
      BOOK_OF_WORK_IDS
    );
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.status).toBe('failed');
      if (failed.value.status === 'failed') {
        expect(failed.value.errorMessage).toBe('Generator timed out');
      }
    }
  });

  it('hard-fails when an initiativeId does not exist in the supplied book of work', () => {
    const payload = baseSequencedPayload();
    (payload.initiativeOrder as Array<Record<string, unknown>>)[1].initiativeId = 'I-unknown';

    const result = assertMigrationDeliverySequencingResponse(payload, BOOK_OF_WORK_IDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' | ')).toMatch(/I-unknown/);
      expect(result.errors.join(' | ')).toMatch(/not a valid initiative id/);
    }
  });

  it('hard-fails when a parallelisableWith entry is not a valid initiative id', () => {
    const payload = baseSequencedPayload();
    (payload.initiativeOrder as Array<Record<string, unknown>>)[2].parallelisableWith = ['I2', 'I-bogus'];

    const result = assertMigrationDeliverySequencingResponse(payload, BOOK_OF_WORK_IDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' | ')).toMatch(/parallelisableWith/);
      expect(result.errors.join(' | ')).toMatch(/I-bogus/);
    }
  });

  it('hard-fails when a blockedBy entry is not a valid initiative id', () => {
    const payload = baseSequencedPayload();
    (payload.initiativeOrder as Array<Record<string, unknown>>)[1].blockedBy = ['I-not-real'];

    const result = assertMigrationDeliverySequencingResponse(payload, BOOK_OF_WORK_IDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' | ')).toMatch(/blockedBy/);
      expect(result.errors.join(' | ')).toMatch(/I-not-real/);
    }
  });

  it('hard-fails when a sequence value is not a positive integer (zero, negative, or non-integer)', () => {
    // Zero
    const zero = baseSequencedPayload();
    (zero.initiativeOrder as Array<Record<string, unknown>>)[0].sequence = 0;
    const zeroResult = assertMigrationDeliverySequencingResponse(zero, BOOK_OF_WORK_IDS);
    expect(zeroResult.ok).toBe(false);

    // Negative
    const negative = baseSequencedPayload();
    (negative.initiativeOrder as Array<Record<string, unknown>>)[0].sequence = -1;
    const negativeResult = assertMigrationDeliverySequencingResponse(negative, BOOK_OF_WORK_IDS);
    expect(negativeResult.ok).toBe(false);

    // Decimal
    const decimal = baseSequencedPayload();
    (decimal.initiativeOrder as Array<Record<string, unknown>>)[0].sequence = 1.5;
    const decimalResult = assertMigrationDeliverySequencingResponse(decimal, BOOK_OF_WORK_IDS);
    expect(decimalResult.ok).toBe(false);
    if (!decimalResult.ok) {
      expect(decimalResult.errors.join(' | ')).toMatch(/sequence must be a positive integer/);
    }
  });

  it('hard-fails when status="sequenced" but initiativeOrder is empty', () => {
    const payload = {
      status: 'sequenced',
      confidence: 'high',
      warnings: [],
      initiativeOrder: [],
    };
    const result = assertMigrationDeliverySequencingResponse(payload, BOOK_OF_WORK_IDS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' | ')).toMatch(/initiativeOrder must be a non-empty array/);
    }
  });

  it('emits a warning (but does NOT hard-fail) when the blockedBy graph contains a cycle', () => {
    const payload = baseSequencedPayload();
    // Make I1 blocked by I3 -> cycle I1 -> I3 -> I1 (and I2 -> I1 -> I3 -> I1, etc.).
    (payload.initiativeOrder as Array<Record<string, unknown>>)[0].blockedBy = ['I3'];

    const result = assertMigrationDeliverySequencingResponse(payload, BOOK_OF_WORK_IDS);
    // The validator MUST NOT hard-fail: cycle detection is warning-only.
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === 'sequenced') {
      const warnings = result.value.warnings;
      const cycleWarnings = warnings.filter((w) => w.kind === 'sequencing_cycle');
      expect(cycleWarnings.length).toBeGreaterThan(0);
      // Status preserved.
      expect(result.value.status).toBe('sequenced');
    }

    // Also verify the standalone cycle detector finds at least one cycle.
    const cycles = detectBlockedByCycles([
      { initiativeId: 'A', sequence: 1, parallelisableWith: [], blockedBy: ['B'], rationale: 'x' },
      { initiativeId: 'B', sequence: 2, parallelisableWith: [], blockedBy: ['A'], rationale: 'x' },
    ]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});
