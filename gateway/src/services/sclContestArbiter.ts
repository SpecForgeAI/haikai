/**
 * SCL contested-test inline arbiter (SCL pipeline spec 9 of 10, 2026-08-18
 * design: "Final rulings round 3" — contested-test protocol).
 *
 * Contest = the implementer flags a generated test with structured evidence
 * (the row + why it misreads the source). An INDEPENDENT LLM ARBITER rules
 * inline: it sees ONLY the verbatim contract row, the surrounding table body,
 * and the implementer's evidence (+ the generated test source when provided) —
 * never the implementer's production code or conversation.
 *
 *   - REJECTED → the implementer must satisfy the test (the mined row is
 *     presumed correct; uncertainty defaults to reject).
 *   - UPHELD  → the test is QUARANTINED (spec 10 writes the quarantine
 *     manifest via sclTestIntegrity) + a finding against the contract row.
 *
 * FAIL-CLOSED (oracle-preservation doctrine): strict-JSON parse with ONE
 * retry; terminal LLM failure ⇒ verdict 'rejected' with an explicit
 * "arbiter unavailable" rationale (logged warn) — a broken arbiter can never
 * silently erase a generated test. A rowIndex that does not exist in the
 * contract THROWS (caller bug, not a contest outcome).
 *
 * LLM calls follow the house idiom (getLlmClient().sendChatRequest, jsonMode,
 * lazy require) — the shared rate-limit cool-down does the pacing.
 */

import { logger } from './logger';
import { SclContractDto, symbolOf } from './sclCorpusPlanner';
import { stableStringify } from './sclAnnotationPass';

// ---------------------------------------------------------------------------
// Types + deps seam
// ---------------------------------------------------------------------------

export interface SclContestVerdict {
  verdict: 'upheld' | 'rejected';
  rationale: string;
}

export interface SclContestArbiterDeps {
  /** The LLM chat seam (house client; jsonMode + shared rate-limit pacing). */
  llm: (args: {
    systemPrompt: string;
    userPrompt: string;
    requestTag: string;
  }) => Promise<{ content: string }>;
}

/** Default LLM caller — same lazy-require idiom as sclAnnotationPass. */
const defaultLlm: SclContestArbiterDeps['llm'] = async ({ systemPrompt, userPrompt, requestTag }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `scl-contest-arbiter-${Date.now()}`,
    requestTag,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultDeps: SclContestArbiterDeps = { llm: defaultLlm };

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are an INDEPENDENT ARBITER for contested generated tests in a legacy-' +
  'migration pipeline. You see ONLY the verbatim mined contract row, its ' +
  'surrounding behaviour-table body, and the implementer’s contest evidence ' +
  '(plus the generated test source when provided). The mined row quotes the ' +
  'legacy source VERBATIM and is presumed correct. UPHOLD the contest ONLY ' +
  'when the row DEMONSTRABLY misreads the quoted source semantics. When ' +
  'uncertain, REJECT — the implementer must satisfy the test. Respond in ' +
  'strict JSON: {"verdict": "upheld"|"rejected", "rationale": "<=60 words"}.';

function buildUserPrompt(args: {
  contract: SclContractDto;
  row: unknown;
  rowIndex: number;
  evidence: string;
  testSource?: string;
}): string {
  const { contract, row, rowIndex, evidence, testSource } = args;
  return (
    `Contract ${contract.contract_key ?? '?'} (kind=${contract.kind ?? '?'}) — ` +
    `${symbolOf(contract)}.\n\n` +
    `CONTESTED ROW (index ${rowIndex}, verbatim from the mined contract):\n` +
    `${stableStringify(row)}\n\n` +
    `SURROUNDING TABLE BODY (deterministic JSON):\n` +
    `${stableStringify(contract.body_json ?? {})}\n\n` +
    `IMPLEMENTER'S CONTEST EVIDENCE:\n${evidence}\n\n` +
    (testSource ? `GENERATED TEST SOURCE:\n${testSource}\n\n` : '') +
    'Respond with JSON exactly of the form: ' +
    '{"verdict": "upheld"|"rejected", "rationale": "<=60 words"}. ' +
    'Uphold ONLY when the row demonstrably misreads the quoted source semantics.'
  );
}

// ---------------------------------------------------------------------------
// Strict parse guards
// ---------------------------------------------------------------------------

const FAIL_CLOSED_RATIONALE =
  'arbiter unavailable — contest defaults to rejected (implement the test)';

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : `${words.slice(0, maxWords).join(' ')}…`;
}

/** Strict verdict parse — throws on any violation (drives the single retry). */
function parseVerdict(content: string): SclContestVerdict {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('arbiter response contained no JSON object');
  const raw = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
  if (raw.verdict !== 'upheld' && raw.verdict !== 'rejected') {
    throw new Error(`arbiter verdict must be 'upheld' or 'rejected', got: ${String(raw.verdict)}`);
  }
  if (typeof raw.rationale !== 'string' || raw.rationale.trim().length === 0) {
    throw new Error('arbiter response missing "rationale" string');
  }
  return { verdict: raw.verdict, rationale: truncateWords(raw.rationale, 60) };
}

// ---------------------------------------------------------------------------
// The arbiter
// ---------------------------------------------------------------------------

/**
 * Rule on one contested test inline. See module doc for the protocol; the
 * verdict is final for the run — batch disposition of the quarantine list
 * happens at the existing stage-2 human gate, and reconcile is the backstop
 * for wrongly-upheld quarantines.
 *
 * @throws when `rowIndex` does not exist in the contract's rows (caller bug).
 */
export async function arbitrateContest(
  args: {
    contract: SclContractDto;
    rowIndex: number;
    evidence: string;
    testSource?: string;
  },
  deps?: Partial<SclContestArbiterDeps>
): Promise<SclContestVerdict> {
  const d: SclContestArbiterDeps = { ...defaultDeps, ...deps };
  const { contract, rowIndex } = args;
  const contractKey = contract.contract_key ?? symbolOf(contract);

  // The contested row MUST exist — a bad index is a caller bug, never a verdict.
  const rows = Array.isArray(contract.body_json?.rows) ? contract.body_json.rows : [];
  const row = rows.find(
    (r) => r !== null && typeof r === 'object' && (r as Record<string, unknown>).index === rowIndex
  );
  if (row === undefined) {
    throw new Error(
      `contested row index ${rowIndex} does not exist in contract ${contractKey}`
    );
  }

  const userPrompt = buildUserPrompt({
    contract,
    row,
    rowIndex,
    evidence: args.evidence,
    testSource: args.testSource,
  });
  const requestTag = `scl-contest-${contractKey}-row${rowIndex}`;

  // Strict JSON with ONE retry on malformed/failed; then FAIL-CLOSED reject.
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { content } = await d.llm({ systemPrompt: SYSTEM_PROMPT, userPrompt, requestTag });
      const verdict = parseVerdict(content);
      logger.info('[diag-gateway] scl_contest arbitrated', {
        contractKey,
        rowIndex,
        verdict: verdict.verdict,
        attempt,
      });
      return verdict;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('[diag-gateway] scl_contest arbiter attempt failed', {
        contractKey,
        rowIndex,
        attempt,
        error: lastError,
      });
    }
  }
  logger.warn('[diag-gateway] scl_contest arbiter unavailable — failing CLOSED (rejected)', {
    contractKey,
    rowIndex,
    error: lastError,
  });
  return { verdict: 'rejected', rationale: FAIL_CLOSED_RATIONALE };
}
