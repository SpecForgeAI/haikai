/**
 * Hotfix tests (2026-04-20): verify the LLM gap-fill stage persists the
 * `_addedBy` tag INSIDE `candidate.data` (not only at the top level).
 *
 * Bug context (run 735129eb-5d2c-4898-8137-f79010caa885 against project
 * fc3abaf2-19a5-466f-b3df-a6430183429e):
 *   206 LLM gap-fill candidates landed in the persisted candidate table with
 *   `_addedBy = (none)`. Investigation showed `buildDiscoveryCandidate` set
 *   `_addedBy` only at the top level of the in-process `DiscoveryCandidate`,
 *   while the persistence path (`bulkSaveCandidates` -> archModelClient ->
 *   architecture-model-service) only round-trips canonical entity fields
 *   plus whatever lives inside `data`. The top-level tag was silently
 *   stripped on the way out.
 *
 * Pack adapters (e.g. `springClassicFrameworkPack`) already follow the
 * `data._addedBy = '<tag>'` convention -- their tags survive persistence.
 * This hotfix aligns the LLM stage with the same contract.
 *
 * These tests assert the post-fix behaviour: every surviving candidate must
 * carry its tier-appropriate `_addedBy` tag inside `data`, regardless of which
 * tier prompt it was synthesised from. The top-level mirror is left in place
 * for defensive in-process callers and is asserted as a secondary check.
 */

// Mock the gateway client so the test never makes a real HTTP call.
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

function llmResponse(items: unknown[]): { content: string } {
  return { content: JSON.stringify(items) };
}

beforeEach(() => {
  gapFillMock.mockReset();
  delete process.env.GAP_FILL_SKIP_THRESHOLD;
  delete process.env.GAP_FILL_CONCURRENCY;
  delete process.env.GAP_FILL_MAX_FAILURE_RATE;
  delete process.env.GAP_FILL_SKIP_SIGNALS;
});

describe('LLM gap-fill candidate _addedBy persistence (hotfix 2026-04-20)', () => {
  it('Tier A: surviving candidate carries data._addedBy === "llm-gap-fill"', async () => {
    gapFillMock.mockResolvedValueOnce(
      llmResponse([
        {
          type: 'class',
          name: 'TierAClass',
          filePath: 'src/main/java/Foo.java',
          confidence: 0.8,
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-tierA',
      files: [
        {
          filePath: 'src/main/java/Foo.java',
          sourceCode: 'class Foo {}',
          tier: 'A',
          language: 'java',
          frameworkPackId: 'spring-classic',
          packCandidates: [],
          ir: null,
        },
      ],
    };

    const result = await runLlmGapFill(input);

    expect(result.llmCandidates).toHaveLength(1);
    const cand = result.llmCandidates[0];
    // Primary contract: data._addedBy survives persistence. This is the bug fix.
    expect((cand.data as Record<string, unknown>)._addedBy).toBe('llm-gap-fill');
    // Secondary: top-level mirror still set for in-process readers.
    expect((cand as unknown as Record<string, unknown>)._addedBy).toBe('llm-gap-fill');
  });

  it('Tier B: surviving candidate carries data._addedBy === "llm-ir-guided"', async () => {
    gapFillMock.mockResolvedValueOnce(
      llmResponse([
        {
          type: 'class',
          name: 'TierBClass',
          filePath: 'src/main/java/Bar.java',
          confidence: 0.7,
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-tierB',
      files: [
        {
          filePath: 'src/main/java/Bar.java',
          sourceCode: 'class Bar {}',
          tier: 'B',
          language: 'java',
          frameworkPackId: null,
          packCandidates: [],
          // Tier B always carries an IR payload (per V3 pipeline contract);
          // an empty one is acceptable for this assertion.
          ir: { classes: [], methods: [], imports: [] },
        },
      ],
    };

    const result = await runLlmGapFill(input);

    expect(result.llmCandidates).toHaveLength(1);
    const cand = result.llmCandidates[0];
    expect((cand.data as Record<string, unknown>)._addedBy).toBe('llm-ir-guided');
    expect((cand as unknown as Record<string, unknown>)._addedBy).toBe('llm-ir-guided');
  });

  it('Tier C: surviving candidate carries data._addedBy === "llm-solo"', async () => {
    gapFillMock.mockResolvedValueOnce(
      llmResponse([
        {
          type: 'class',
          name: 'TierCClass',
          filePath: 'src/unknown/Mystery.txt',
          confidence: 0.5,
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-tierC',
      files: [
        {
          filePath: 'src/unknown/Mystery.txt',
          sourceCode: 'unclassifiable contents',
          tier: 'C',
          language: null,
          frameworkPackId: null,
          packCandidates: [],
          ir: null,
        },
      ],
    };

    const result = await runLlmGapFill(input);

    expect(result.llmCandidates).toHaveLength(1);
    const cand = result.llmCandidates[0];
    expect((cand.data as Record<string, unknown>)._addedBy).toBe('llm-solo');
    expect((cand as unknown as Record<string, unknown>)._addedBy).toBe('llm-solo');
  });

  it('preserves any data fields emitted by the LLM alongside the injected _addedBy', async () => {
    // Regression: the bugfix appends `_addedBy` AFTER the optional-LLM-fields
    // pass-through loop. Verify the pass-through still works (description goes
    // onto data) and that _addedBy lives next to it in the same object.
    gapFillMock.mockResolvedValueOnce(
      llmResponse([
        {
          type: 'class',
          name: 'WithDescription',
          filePath: 'src/Foo.java',
          confidence: 0.6,
          description: 'A meaningful description from the LLM',
        },
      ]),
    );

    const input: GapFillStepInput = {
      runId: 'run-mixed',
      files: [
        {
          filePath: 'src/Foo.java',
          sourceCode: 'class Foo {}',
          tier: 'A',
          language: 'java',
          frameworkPackId: 'spring-classic',
          packCandidates: [],
          ir: null,
        },
      ],
    };

    const result = await runLlmGapFill(input);

    expect(result.llmCandidates).toHaveLength(1);
    const data = result.llmCandidates[0].data as Record<string, unknown>;
    expect(data._addedBy).toBe('llm-gap-fill');
    expect(data.description).toBe('A meaningful description from the LLM');
  });
});
