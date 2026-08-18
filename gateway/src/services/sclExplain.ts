/**
 * SCL "explain this" service (SCL pipeline spec 6 of 10, 2026-08-18 design:
 * agent-os/planning/2026-08-18-scl-pipeline-design.md, "UI placement" ruling —
 * the Structural Model tab's LLM affordance for humans investigating oddities
 * later in the pipeline).
 *
 * Given a (scan, contract_key) pair the service fetches the FULL contract
 * (body included) from AMS and asks the LLM for a plain-English explanation.
 * Unlike the annotation pass this is plain PROSE (NOT jsonMode) and the result
 * is never persisted — it is a read-only human aid, so the annotation pass's
 * verbatim-substring guards do not apply. The prompt still constrains the LLM
 * to describe ONLY what the contract shows.
 *
 * LLM calls go through the house client (`getLlmClient().sendChatRequest`)
 * via the same lazy-require default-dep idiom as sclAnnotationPass.ts; the
 * shared rate-limit cool-down (services/llmRateLimit.ts) does the pacing.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import { SclContractWire, stableStringify } from './sclAnnotationPass';

/** Thrown when AMS has no such (scan, contract_key) pair — the route maps
 * this to 404; every other failure maps to 502. */
export class SclContractNotFoundError extends Error {
  constructor(scanId: string, contractKey: string) {
    super(`SCL contract '${contractKey}' not found in scan '${scanId}'`);
    this.name = 'SclContractNotFoundError';
  }
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT =
  'Explain this Structural Contract Language (SCL) contract to a developer in ' +
  'plain English. Describe ONLY what the contract shows — never invent ' +
  'behaviour, fields, callers, or code that is not in the contract. Use short ' +
  'paragraphs. Mention verbatim conditions in backticks.';

/** The user prompt: the deterministic-JSON contract body plus, when present,
 * the gloss (the annotation pass's guarded intent / row glosses). */
export function buildExplainUserPrompt(contract: SclContractWire): string {
  const bodyString = stableStringify(contract.body_json ?? {});
  const glossPart =
    contract.gloss_json != null
      ? `\n\nExisting gloss (guarded annotation):\n${stableStringify(contract.gloss_json)}`
      : '';
  return (
    `Contract ${contract.contract_key ?? '?'} (kind=${contract.kind ?? '?'}) mined from ` +
    `${contract.source_path ?? '?'} :: ${contract.source_symbol ?? '?'}.\n\n` +
    `Body (deterministic JSON):\n${bodyString}${glossPart}`
  );
}

// ============================================================================
// Dependency seam (production defaults below; tests inject full mocks)
// ============================================================================

export interface SclExplainDeps {
  /** GET /scans/{scanId}/contracts/{contractKey} (full body). Null on 404. */
  fetchContract: (
    projectId: string,
    architectureId: string,
    scanId: string,
    contractKey: string
  ) => Promise<SclContractWire | null>;
  /** The LLM chat seam — plain prose, NOT jsonMode. */
  llm: (args: {
    systemPrompt: string;
    userPrompt: string;
    requestTag: string;
  }) => Promise<{ content: string }>;
}

function sclBase(projectId: string, architectureId: string): string {
  return (
    `${getConfig().architectureModelServiceBaseUrl}/api/model/projects/` +
    `${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

const defaultFetchContract: SclExplainDeps['fetchContract'] = async (
  projectId,
  architectureId,
  scanId,
  contractKey
) => {
  const url =
    `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}` +
    `/contracts/${encodeURIComponent(contractKey)}`;
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`AMS fetch_scl_contract failed: HTTP ${response.status}`);
  }
  return (await response.json()) as SclContractWire;
};

/** Default LLM caller — the house idiom (see sclAnnotationPass.ts): lazy
 * require keeps tests cleanly mockable; the client's own 429 machinery
 * (llmRateLimit.ts shared cool-down) does the pacing. Plain prose — no
 * jsonMode option. */
const defaultLlm: SclExplainDeps['llm'] = async ({ systemPrompt, userPrompt, requestTag }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `scl-explain-${Date.now()}`,
    requestTag
  );
  return { content: response.content ?? '' };
};

const defaultDeps: SclExplainDeps = {
  fetchContract: defaultFetchContract,
  llm: defaultLlm,
};

// ============================================================================
// The service
// ============================================================================

export interface SclExplainArgs {
  projectId: string;
  architectureId: string;
  scanId: string;
  contractKey: string;
}

/**
 * Explains one SCL contract in plain English. Throws
 * {@link SclContractNotFoundError} when AMS has no such contract (route →
 * 404); every other failure (AMS read error, LLM error, empty LLM response)
 * throws a plain Error (route → 502).
 */
export async function explainSclContract(
  args: SclExplainArgs,
  deps?: Partial<SclExplainDeps>
): Promise<string> {
  const d: SclExplainDeps = { ...defaultDeps, ...deps };
  const { projectId, architectureId, scanId, contractKey } = args;

  const contract = await d.fetchContract(projectId, architectureId, scanId, contractKey);
  if (contract === null) {
    throw new SclContractNotFoundError(scanId, contractKey);
  }

  logger.info('[diag-gateway] scl_explain requested', {
    projectId,
    architectureId,
    scanId,
    contractKey,
  });

  const { content } = await d.llm({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildExplainUserPrompt(contract),
    requestTag: `scl-explain-${projectId}`,
  });
  const explanation = (content ?? '').trim();
  if (explanation.length === 0) {
    throw new Error('LLM returned an empty explanation');
  }
  return explanation;
}
