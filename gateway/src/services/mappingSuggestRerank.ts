/**
 * Mapping-suggest LLM rerank.
 *
 * Direct build 2026-06-11 (oracle weaknesses #7 cherry-pick): the
 * `maybeRerankCandidatesViaLlm` hook in `routes/targetArchitectures.ts` was a
 * deliberate v1 no-op; this is the real implementation.
 *
 * AMS returns up to three current-architecture candidates ranked by a simple
 * name-similarity heuristic (substring + token overlap). That heuristic
 * cannot see semantics — "OrderSvc" vs "Order Management Service", or a
 * description that says the element was renamed. One small LLM call reorders
 * the candidates using the target element's name/type/description and each
 * candidate's name/type/score, and may refine confidence + rationale (the
 * AMS DTO explicitly reserves that right for the gateway).
 *
 * Hard rules:
 *  - ADVISORY ONLY, FAIL-SOFT: any LLM error, timeout, or malformed reply
 *    returns the deterministic AMS order with `llmReranked: false`. The
 *    suggest endpoint never fails or slows indefinitely because of the
 *    rerank (bounded by a race timeout).
 *  - COVERAGE: the reranked list is a permutation of the AMS list — ids the
 *    LLM invents are dropped, ids it omits are appended in deterministic
 *    order. Candidates are never lost or duplicated.
 *  - Enabled by default; set `TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK=0` to
 *    opt out (the flag previously gated the dormant hook ON; the polarity
 *    flips now that the feature is real).
 */

import { logger } from './logger';

// Wire shape of one AMS candidate (camelCase — the target-state architecture
// DTOs are @CamelCaseWire; see MappingSuggestCandidate.java).
export interface MappingSuggestWireCandidate {
  elementId: string;
  elementType?: string | null;
  name?: string | null;
  confidence?: number | null;
  rationale?: string | null;
}

export interface MappingSuggestWireResponse {
  candidates: MappingSuggestWireCandidate[];
  /** True if the gateway rewrote the order via the LLM rerank. */
  llmReranked?: boolean;
}

interface TargetElementSnapshot {
  name?: string | null;
  elementType?: string | null;
  description?: string | null;
}

export interface MappingSuggestRerankDeps {
  /** Returns the raw LLM text reply for (systemPrompt, userPrompt). */
  callLlm: (systemPrompt: string, userPrompt: string) => Promise<string>;
  /** Milliseconds before the rerank gives up and keeps the AMS order. */
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const defaultCallLlm = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string> => {
  // Lazy-import to keep tests cleanly mockable (mirrors the translation and
  // expansion handlers).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `mapping-suggest-rerank-${Date.now()}`,
    'mapping-suggest-rerank',
    { jsonMode: true }
  );
  return response.content ?? '';
};

export function defaultMappingSuggestRerankDeps(): MappingSuggestRerankDeps {
  return { callLlm: defaultCallLlm, timeoutMs: DEFAULT_TIMEOUT_MS };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You rank candidate mappings between a TARGET-state architecture element ' +
  'and CURRENT-state elements in a like-for-like system migration. The best ' +
  'candidate is the current element this target element replaces or evolves ' +
  'from — judge by meaning (renames, abbreviations, described purpose), not ' +
  'just string similarity. Respond with JSON ONLY in the shape ' +
  '{"ranking":[{"elementId":"...","confidence":0.0,"rationale":"one short sentence"}]} ' +
  'listing EVERY candidate exactly once, best first. confidence is your own ' +
  '0..1 judgement of the match; rationale is one user-facing sentence.';

function clip(value: string | null | undefined, max: number): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function buildUserPrompt(
  snapshot: TargetElementSnapshot,
  candidates: MappingSuggestWireCandidate[]
): string {
  const lines: string[] = [];
  lines.push('TARGET ELEMENT:');
  lines.push(`  name: ${clip(snapshot.name, 200) || '(unnamed)'}`);
  if (snapshot.elementType) lines.push(`  type: ${clip(snapshot.elementType, 80)}`);
  if (snapshot.description) {
    lines.push(`  description: ${clip(snapshot.description, 500)}`);
  }
  lines.push('');
  lines.push('CURRENT-STATE CANDIDATES (deterministic name-similarity order):');
  for (const candidate of candidates) {
    lines.push(`  - elementId: ${candidate.elementId}`);
    lines.push(`    name: ${clip(candidate.name, 200) || '(unnamed)'}`);
    if (candidate.elementType) {
      lines.push(`    type: ${clip(candidate.elementType, 80)}`);
    }
    if (typeof candidate.confidence === 'number') {
      lines.push(`    similarityScore: ${candidate.confidence}`);
    }
    if (candidate.rationale) {
      lines.push(`    heuristicRationale: ${clip(candidate.rationale, 200)}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reply parsing + permutation guarantee
// ---------------------------------------------------------------------------

interface RankingEntry {
  elementId: string;
  confidence?: number;
  rationale?: string;
}

function parseRanking(reply: string): RankingEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    // Tolerate a fenced code block around the JSON.
    const match = /\{[\s\S]*\}/.exec(reply);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const ranking = (parsed as { ranking?: unknown }).ranking;
  if (!Array.isArray(ranking)) return null;
  const entries: RankingEntry[] = [];
  for (const row of ranking) {
    if (!row || typeof row !== 'object') continue;
    const elementId = (row as { elementId?: unknown }).elementId;
    if (typeof elementId !== 'string' || !elementId) continue;
    const confidence = (row as { confidence?: unknown }).confidence;
    const rationale = (row as { rationale?: unknown }).rationale;
    entries.push({
      elementId,
      confidence:
        typeof confidence === 'number' && Number.isFinite(confidence)
          ? Math.min(1, Math.max(0, confidence))
          : undefined,
      rationale:
        typeof rationale === 'string' && rationale.trim() !== ''
          ? rationale.trim()
          : undefined,
    });
  }
  return entries.length > 0 ? entries : null;
}

/**
 * Apply the LLM ranking as a strict permutation of the AMS candidates:
 * invented ids are dropped, duplicate ids keep their first position, omitted
 * candidates are appended in their original deterministic order.
 */
function applyRanking(
  candidates: MappingSuggestWireCandidate[],
  ranking: RankingEntry[]
): MappingSuggestWireCandidate[] {
  const byId = new Map(candidates.map((c) => [c.elementId, c]));
  const ordered: MappingSuggestWireCandidate[] = [];
  const used = new Set<string>();
  for (const entry of ranking) {
    const candidate = byId.get(entry.elementId);
    if (!candidate || used.has(entry.elementId)) continue;
    used.add(entry.elementId);
    ordered.push({
      ...candidate,
      confidence: entry.confidence ?? candidate.confidence,
      rationale: entry.rationale ?? candidate.rationale,
    });
  }
  for (const candidate of candidates) {
    if (!used.has(candidate.elementId)) ordered.push(candidate);
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function isMappingSuggestRerankEnabled(): boolean {
  return process.env.TARGET_ARCH_MAPPING_SUGGEST_LLM_RERANK !== '0';
}

export async function rerankMappingSuggestCandidates(
  amsResponse: MappingSuggestWireResponse,
  requestBody: Record<string, unknown>,
  deps: MappingSuggestRerankDeps = defaultMappingSuggestRerankDeps()
): Promise<MappingSuggestWireResponse> {
  const candidates = Array.isArray(amsResponse.candidates)
    ? amsResponse.candidates
    : [];
  const snapshot = (requestBody.targetElementSnapshot ?? null) as
    | TargetElementSnapshot
    | null;

  // Nothing to rerank with 0-1 candidates; no comparison basis without the
  // target snapshot. Same preconditions the v1 stub documented.
  if (
    !isMappingSuggestRerankEnabled() ||
    candidates.length < 2 ||
    !snapshot ||
    !snapshot.name
  ) {
    return { ...amsResponse, llmReranked: false };
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      deps.callLlm(SYSTEM_PROMPT, buildUserPrompt(snapshot, candidates)),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`rerank timed out after ${deps.timeoutMs}ms`)),
          deps.timeoutMs
        );
      }),
    ]);
    const ranking = parseRanking(reply);
    if (!ranking) {
      logger.warn('mapping-suggest rerank: unparseable LLM reply; keeping AMS order');
      return { ...amsResponse, llmReranked: false };
    }
    const ordered = applyRanking(candidates, ranking);
    return { ...amsResponse, candidates: ordered, llmReranked: true };
  } catch (error) {
    logger.warn('mapping-suggest rerank failed; keeping AMS order', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...amsResponse, llmReranked: false };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
