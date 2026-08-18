/**
 * SCL "explain this" service (SCL pipeline spec 6, 2026-08-18) — fully mocked
 * deps. Pins:
 *
 *  1. happy path: the full contract is fetched, the LLM gets the deterministic
 *     body string (+ the gloss when present) and the trimmed prose comes back;
 *  2. unknown contract (AMS 404 → fetchContract null) throws the typed
 *     SclContractNotFoundError (the route's 404 branch);
 *  3. LLM failure propagates as a plain Error (the route's 502 branch), as
 *     does an empty LLM response.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  explainSclContract,
  SclContractNotFoundError,
  SclExplainDeps,
} from '../sclExplain';
import { SclContractWire, stableStringify } from '../sclAnnotationPass';

const CONTRACT: SclContractWire = {
  contract_key: 'T-abc123def456',
  kind: 'behaviour_table',
  source_path: 'src/main/java/Legacy.java',
  source_symbol: 'LegacyResource#getView',
  fan_in: 2,
  roots_json: { roots: ['LegacyResource#getView'] },
  body_json: {
    annotations: ['@GET', '@Path("/views/{viewId}")'],
    rows: [{ index: 0, kind: 'branch', conditionVerbatim: 'view == null' }],
  },
  gloss_json: { intent: 'Returns the requested view.' },
};

const ARGS = {
  projectId: 'p1',
  architectureId: 'arch-1',
  scanId: 'scan-1',
  contractKey: 'T-abc123def456',
};

function makeDeps(overrides?: Partial<SclExplainDeps>): {
  fetchContract: jest.Mock;
  llm: jest.Mock;
} {
  return {
    fetchContract: jest.fn().mockResolvedValue(CONTRACT),
    llm: jest.fn().mockResolvedValue({
      content: '  This method returns a view when `view == null` is false.  ',
    }),
    ...overrides,
  } as { fetchContract: jest.Mock; llm: jest.Mock };
}

describe('explainSclContract — happy path', () => {
  it('fetches the full contract and returns the trimmed LLM prose', async () => {
    const deps = makeDeps();

    const explanation = await explainSclContract(ARGS, deps);

    expect(explanation).toBe(
      'This method returns a view when `view == null` is false.'
    );
    expect(deps.fetchContract).toHaveBeenCalledTimes(1);
    expect(deps.fetchContract).toHaveBeenCalledWith(
      'p1',
      'arch-1',
      'scan-1',
      'T-abc123def456'
    );

    // ONE plain-prose LLM call carrying the deterministic body string AND the
    // gloss (present on this contract).
    expect(deps.llm).toHaveBeenCalledTimes(1);
    const llmArgs = deps.llm.mock.calls[0][0];
    expect(llmArgs.systemPrompt).toContain('plain English');
    expect(llmArgs.systemPrompt).toContain('ONLY what the contract shows');
    expect(llmArgs.systemPrompt).toContain('backticks');
    expect(llmArgs.userPrompt).toContain(stableStringify(CONTRACT.body_json));
    expect(llmArgs.userPrompt).toContain(stableStringify(CONTRACT.gloss_json));
    expect(llmArgs.userPrompt).toContain('T-abc123def456');
  });

  it('omits the gloss section when the contract has no gloss', async () => {
    const deps = makeDeps({
      fetchContract: jest.fn().mockResolvedValue({ ...CONTRACT, gloss_json: null }),
    });

    await explainSclContract(ARGS, deps);

    const llmArgs = (deps.llm as jest.Mock).mock.calls[0][0];
    expect(llmArgs.userPrompt).not.toContain('Existing gloss');
  });
});

describe('explainSclContract — unknown contract', () => {
  it('throws the typed not-found error when AMS returns 404 (fetch → null)', async () => {
    const deps = makeDeps({ fetchContract: jest.fn().mockResolvedValue(null) });

    await expect(explainSclContract(ARGS, deps)).rejects.toBeInstanceOf(
      SclContractNotFoundError
    );
    expect(deps.llm).not.toHaveBeenCalled();
  });
});

describe('explainSclContract — LLM failure', () => {
  it('propagates an LLM rejection as a plain Error (route 502)', async () => {
    const deps = makeDeps({
      llm: jest.fn().mockRejectedValue(new Error('LLM unavailable')),
    });

    await expect(explainSclContract(ARGS, deps)).rejects.toThrow('LLM unavailable');
    const err = await explainSclContract(ARGS, deps).catch((e) => e);
    expect(err).not.toBeInstanceOf(SclContractNotFoundError);
  });

  it('treats an empty LLM response as a failure', async () => {
    const deps = makeDeps({ llm: jest.fn().mockResolvedValue({ content: '   ' }) });

    await expect(explainSclContract(ARGS, deps)).rejects.toThrow(
      'LLM returned an empty explanation'
    );
  });
});
