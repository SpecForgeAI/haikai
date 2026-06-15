/**
 * migrationDeliveryPlanApi — gateway error-body parsing (the "[object Object]"
 * fix, 2026-06-11).
 *
 * The generate route answers errors with the NESTED envelope
 * `{ error: { code, message, details? } }`. The old
 * `errorBody.message || errorBody.error` read picked up the nested `error`
 * OBJECT and fed it to `new Error(...)`, so the wizard rendered the literal
 * "[object Object]". These tests pin the new extraction across every gateway
 * error shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMigrationDeliveryPlan } from '../migrationDeliveryPlanApi';

function mockFetchError(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Internal Server Error',
      json: async () => body,
    }),
  );
}

const REQUEST = {
  projectId: 'proj-1',
  currentArchitectureId: 'arch-cur',
  targetArchitectureId: 'arch-tgt',
  wizardAnswers: {
    migrationIntent: ['like_for_like_replacement'],
    deliveryStreams: ['target_service_api_implementation'],
    migrationStyle: 'big_bang',
    dataAndCutoverAssumptions: {
      dataMigrationApproach: 'one_time_bulk',
      cutoverApproach: 'big_bang',
      rollbackRequired: false,
    },
    migrationTestPackExpectations: ['use_recommended_coverage'],
  },
} as Parameters<typeof generateMigrationDeliveryPlan>[0];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateMigrationDeliveryPlan — error body parsing', () => {
  it('NESTED {error:{message,details}} (the generate route shape) surfaces message + details — NEVER "[object Object]"', async () => {
    mockFetchError(500, {
      error: {
        code: 500,
        message: 'Migration book-of-work generation failed',
        details:
          'Azure OpenAI chat request failed: HTTP 504 - {"message": "Endpoint request timed out"}',
      },
    });

    await expect(generateMigrationDeliveryPlan(REQUEST)).rejects.toThrow(
      'Migration book-of-work generation failed: Azure OpenAI chat request failed: HTTP 504',
    );
    await expect(generateMigrationDeliveryPlan(REQUEST)).rejects.not.toThrow(
      '[object Object]',
    );
  });

  it('STRING {error:"..."} and top-level {message:"..."} shapes still surface verbatim', async () => {
    mockFetchError(503, { error: 'Architecture model service unavailable' });
    await expect(generateMigrationDeliveryPlan(REQUEST)).rejects.toThrow(
      'Architecture model service unavailable',
    );

    mockFetchError(400, { message: 'currentArchitectureId is required' });
    await expect(generateMigrationDeliveryPlan(REQUEST)).rejects.toThrow(
      'currentArchitectureId is required',
    );
  });

  it('an unreadable body falls through to the generic status message', async () => {
    mockFetchError(500, { unexpected: { shape: true } });
    await expect(generateMigrationDeliveryPlan(REQUEST)).rejects.toThrow(
      'Migration delivery plan generation failed: 500 Internal Server Error',
    );
  });
});
