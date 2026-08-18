/**
 * SCL contested-test inline arbiter — verdict pins (SCL pipeline spec 9):
 * upheld / rejected paths, malformed-then-valid retry, terminal LLM failure
 * fails CLOSED to 'rejected', and an unknown row index throws.
 */

jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { SclContractDto } from '../sclCorpusPlanner';
import { arbitrateContest } from '../sclContestArbiter';

function contract(): SclContractDto {
  return {
    contract_key: 'T-CONTEST',
    kind: 'behaviour_table',
    source_symbol: 'com.app.OrdersController#getOrder(String)',
    body_json: {
      symbol: 'com.app.OrdersController#getOrder(String)',
      rows: [
        {
          index: 0,
          kind: 'branch',
          conditionVerbatim: 'id == null',
          conditionRef: { path: 'src/A.java', line: 10 },
          outcome: { type: 'terminal', verbatim: 'throw new BadRequestException("id")' },
        },
        {
          index: 1,
          kind: 'terminal',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: { type: 'terminal', verbatim: 'return order' },
        },
      ],
    },
  };
}

const UPHELD = JSON.stringify({ verdict: 'upheld', rationale: 'row inverts the null guard' });
const REJECTED = JSON.stringify({ verdict: 'rejected', rationale: 'row matches the source' });

describe('arbitrateContest', () => {
  it('returns upheld when the arbiter upholds', async () => {
    const llm = jest.fn().mockResolvedValue({ content: UPHELD });
    const result = await arbitrateContest(
      { contract: contract(), rowIndex: 0, evidence: 'the guard is actually id != null' },
      { llm }
    );
    expect(result).toEqual({ verdict: 'upheld', rationale: 'row inverts the null guard' });
    expect(llm).toHaveBeenCalledTimes(1);
    // The arbiter sees ONLY the row + surrounding body + evidence (+ test src).
    const userPrompt: string = llm.mock.calls[0][0].userPrompt;
    expect(userPrompt).toContain('CONTESTED ROW (index 0');
    expect(userPrompt).toContain('id == null');
    expect(userPrompt).toContain('the guard is actually id != null');
  });

  it('returns rejected when the arbiter rejects, threading the test source', async () => {
    const llm = jest.fn().mockResolvedValue({ content: REJECTED });
    const result = await arbitrateContest(
      {
        contract: contract(),
        rowIndex: 1,
        evidence: 'weak evidence',
        testSource: 'class RowTest { }',
      },
      { llm }
    );
    expect(result.verdict).toBe('rejected');
    expect(llm.mock.calls[0][0].userPrompt).toContain('class RowTest { }');
  });

  it('retries once on a malformed response, then uses the valid verdict', async () => {
    const llm = jest
      .fn()
      .mockResolvedValueOnce({ content: 'not json at all' })
      .mockResolvedValueOnce({ content: UPHELD });
    const result = await arbitrateContest(
      { contract: contract(), rowIndex: 0, evidence: 'evidence' },
      { llm }
    );
    expect(result.verdict).toBe('upheld');
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it('rejects an out-of-vocabulary verdict as malformed (retry engages)', async () => {
    const llm = jest
      .fn()
      .mockResolvedValueOnce({ content: '{"verdict": "maybe", "rationale": "hmm"}' })
      .mockResolvedValueOnce({ content: REJECTED });
    const result = await arbitrateContest(
      { contract: contract(), rowIndex: 0, evidence: 'evidence' },
      { llm }
    );
    expect(result.verdict).toBe('rejected');
    expect(result.rationale).toBe('row matches the source');
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it('fails CLOSED to rejected on terminal arbiter failure', async () => {
    const llm = jest.fn().mockRejectedValue(new Error('LLM down'));
    const result = await arbitrateContest(
      { contract: contract(), rowIndex: 0, evidence: 'evidence' },
      { llm }
    );
    expect(result).toEqual({
      verdict: 'rejected',
      rationale: 'arbiter unavailable — contest defaults to rejected (implement the test)',
    });
    expect(llm).toHaveBeenCalledTimes(2); // one retry, then fail-closed
  });

  it('throws (never a verdict) when the contested row does not exist', async () => {
    const llm = jest.fn();
    await expect(
      arbitrateContest({ contract: contract(), rowIndex: 99, evidence: 'evidence' }, { llm })
    ).rejects.toThrow(/row index 99 does not exist in contract T-CONTEST/);
    expect(llm).not.toHaveBeenCalled();
  });
});
