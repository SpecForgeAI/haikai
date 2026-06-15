/**
 * Tests for Model-Aware Discovery -- Task Group 3 (emit create/enrich/link).
 *
 * Spec: 2026-05-30 Model-Aware Discovery / Dedup Against Existing Entities.
 *
 * Scope (3.1): operation tagging on emitted candidates. Covers ONLY:
 *   (a) a normal candidate emits `operation: 'create'` (default),
 *   (b) an enrich proposal emits `operation: 'enrich'` carrying the target
 *       entity NAME + confidence in its `data` payload,
 *   (c) a logical<->physical link proposal emits `operation: 'link'` carrying
 *       BOTH target NAMES + confidence,
 *   (d) emitted enrich/link candidates carry NO resolved id and NO `*_points`
 *       reference.
 *
 * Driven end-to-end through `runLlmGapFill` with the gateway relay mocked
 * (mirrors `llmGapFillStep.test.ts`), so the assertions exercise the real
 * parse -> build path that stamps `operation` and threads the LLM-proposed
 * target names onto `data`.
 */

jest.mock('../services/gatewayClient', () => ({
  gatewayClient: {
    gapFill: jest.fn(),
  },
  GapFillGatewayError: class GapFillGatewayError extends Error {
    public readonly filePath: string;
    public readonly status: number | null;
    constructor(message: string, filePath: string, status: number | null) {
      super(message);
      this.name = 'GapFillGatewayError';
      this.filePath = filePath;
      this.status = status;
    }
  },
}));

import { gatewayClient } from '../services/gatewayClient';
import { runLlmGapFill, GapFillStepInput } from '../services/llmGapFillStep';

const gapFillMock = gatewayClient.gapFill as jest.Mock;

function makeLlmResponse(items: unknown[]): { content: string } {
  return { content: JSON.stringify(items) };
}

function baseFile(
  overrides: Partial<GapFillStepInput['files'][number]> = {},
): GapFillStepInput['files'][number] {
  return {
    filePath: 'src/main/java/Example.java',
    sourceCode: 'class Example {}',
    tier: 'B',
    language: 'java',
    frameworkPackId: null,
    packCandidates: [],
    ir: null,
    ...overrides,
  };
}

beforeEach(() => {
  gapFillMock.mockReset();
  delete process.env.GAP_FILL_SKIP_THRESHOLD;
  delete process.env.GAP_FILL_CONCURRENCY;
  delete process.env.GAP_FILL_MAX_FAILURE_RATE;
  delete process.env.GAP_FILL_SKIP_SIGNALS;
});

// ---------------------------------------------------------------------------
// (a) Default operation is 'create'.
// ---------------------------------------------------------------------------

describe('operation tagging -- create default', () => {
  it('tags a normal candidate (no operation field) as operation=create', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'logical_data_entities',
          name: 'Shipment',
          filePath: 'src/main/java/Shipment.java',
          confidence: 0.8,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-op-create',
      files: [baseFile({ filePath: 'src/main/java/Shipment.java' })],
    });

    expect(result.llmCandidates).toHaveLength(1);
    expect(result.llmCandidates[0].operation).toBe('create');
  });

  it('coerces an unrecognised operation value back to create (LLM only proposes; never load-bearing)', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'logical_data_entities',
          name: 'Carrier',
          filePath: 'src/main/java/Carrier.java',
          confidence: 0.8,
          operation: 'delete', // not a valid op -> must collapse to create
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-op-bad',
      files: [baseFile({ filePath: 'src/main/java/Carrier.java' })],
    });

    expect(result.llmCandidates[0].operation).toBe('create');
  });
});

// ---------------------------------------------------------------------------
// (b) enrich proposal carries operation + target NAME + confidence in data.
// ---------------------------------------------------------------------------

describe('operation tagging -- enrich', () => {
  it('tags operation=enrich and carries the target entity NAME + confidence on data, with NO resolved id', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'logical_data_attributes',
          name: 'Owner.email',
          filePath: 'src/main/java/Owner.java',
          confidence: 0.82,
          operation: 'enrich',
          targetEntityName: 'Owner',
          targetConfidence: 0.9,
          logicalEntityName: 'Owner',
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-op-enrich',
      files: [baseFile({ filePath: 'src/main/java/Owner.java' })],
    });

    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect(c.operation).toBe('enrich');
    // Target NAME + confidence ride on `data` (resolved LATE at save-back).
    expect(c.data.targetEntityName).toBe('Owner');
    expect(c.data.targetConfidence).toBe(0.9);
    // (d) No resolved id, no `*_points` wrapper anywhere on the candidate/data.
    expect((c as unknown as Record<string, unknown>).targetId).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('_points');
  });
});

// ---------------------------------------------------------------------------
// (c) link proposal carries operation + BOTH target NAMES + confidence.
// ---------------------------------------------------------------------------

describe('operation tagging -- link', () => {
  it('tags operation=link and carries BOTH endpoint NAMES + confidence, with NO resolved id and NO *_points', async () => {
    gapFillMock.mockResolvedValueOnce(
      makeLlmResponse([
        {
          type: 'logical_data_entity_physical_data_entities',
          name: 'Owner ↔ owners',
          filePath: 'src/main/resources/schema.sql',
          confidence: 0.85,
          operation: 'link',
          logicalEntityName: 'Owner',
          physicalEntityName: 'owners',
          targetConfidence: 0.95,
        },
      ]),
    );

    const result = await runLlmGapFill({
      runId: 'run-op-link',
      files: [
        baseFile({
          filePath: 'src/main/resources/schema.sql',
          sourceCode: 'CREATE TABLE owners (id bigint);',
          language: 'sql',
        }),
      ],
    });

    expect(result.llmCandidates).toHaveLength(1);
    const c = result.llmCandidates[0];
    expect(c.operation).toBe('link');
    // BOTH endpoint NAMES + confidence ride on `data`.
    expect(c.data.logicalEntityName).toBe('Owner');
    expect(c.data.physicalEntityName).toBe('owners');
    expect(c.data.targetConfidence).toBe(0.95);
    // (d) No resolved id; no `*_points` wrapper.
    expect((c as unknown as Record<string, unknown>).targetId).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('_points');
  });
});
