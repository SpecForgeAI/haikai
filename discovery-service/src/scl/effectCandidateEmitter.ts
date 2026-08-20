/**
 * Effect-candidate emission from the SCL corpus (2026-08-20 user ruling:
 * "truly one scan, one review, one save" — the code scan itself emits the
 * `endpoint_data_effects` candidates that close the compensation preflight's
 * effect-map gaps; the gateway backfill button remains the recovery path).
 *
 * Phase 1 — DETERMINISTIC (free): http-rooted behaviour tables (method +
 * path fragment from their verbatim annotations — the same derivation the
 * gateway annotation pass uses) are matched to THIS RUN's `endpoints`
 * candidates (longest-fragment discipline kills the /lookup vs
 * /lookupFavourite substring trap); the resolved call graph is walked to
 * boundary contracts; their verbatim SQL yields write tables. Emitted as
 * normal candidates (the `mintProcCallEdgeCandidates` precedent) — the
 * candidate review is the human gate and save-back resolves names to ids,
 * skipping honestly when a name has no committed entity.
 *
 * Phase 2 — LLM, GUARDED: write-verb endpoint candidates still uncovered
 * (no discovery-mined AND no corpus-derived effect candidate) get batched
 * strict-JSON proposals via the gateway gap-fill relay, guarded by the
 * committed physical-table vocabulary (a proposal naming an uncommitted
 * table is rejected and recorded). Proposals land as LOWER-CONFIDENCE
 * candidates, clearly marked — approve/reject happens in the normal review.
 */

import { v4 as uuidv4 } from 'uuid';
import { ARCHITECTURE_MODEL_SERVICE_BASE_URL } from '../config';
import { DiscoveryCandidate } from '../types/candidate';
import {
  readMethod,
  readPathTemplate,
} from '../services/runtimeEvidence/endpointRuntimeMatcher';
import type { SclCorpus } from './corpusAssembler';
import type { SclBehaviourTable, SclBoundaryContract, SclContract } from './sclTypes';

// ---------------------------------------------------------------------------
// Pure helpers — mirrors of the gateway's annotation-pass / backfill helpers
// (producer/consumer mirroring is the established SCL convention).
// ---------------------------------------------------------------------------

const MUTATING_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function annotationText(annotations: string[] | undefined): string {
  return (annotations ?? []).join('\n');
}

/** The HTTP method a table's own annotations declare, or null. */
export function deriveHttpMethod(annotations: string[] | undefined): string | null {
  const text = annotationText(annotations);
  const jaxRs = text.match(/@(GET|POST|PUT|DELETE|PATCH)\b/);
  if (jaxRs) return jaxRs[1];
  const requestMethod = text.match(/RequestMethod\.(GET|POST|PUT|DELETE|PATCH)\b/);
  if (requestMethod) return requestMethod[1];
  const mapping = text.match(/@(Get|Post|Put|Delete|Patch)Mapping\b/);
  if (mapping) return mapping[1].toUpperCase();
  return null;
}

/** Method-level @Path / @RequestMapping-family value, or null (best-effort). */
export function derivePathFragment(annotations: string[] | undefined): string | null {
  const text = annotationText(annotations);
  const m = text.match(
    /@(?:Path|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/,
  );
  return m ? m[1] : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Path CONTAINS the fragment", template-aware ({param} matches a segment). */
export function pathContainsFragment(fragment: string, path: string): boolean {
  const pattern = fragment.split(/\{[^}]*\}/).map(escapeRegExp).join('[^/]+');
  return new RegExp(pattern).test(path);
}

/** `[dbo].[Orders]` / `"s"."t"` / `sch.t` -> bare table token. */
function bareTableToken(raw: string): string {
  const cleaned = raw.replace(/[[\]"`]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).trim();
}

const WRITE_SQL_PATTERNS: RegExp[] = [
  /\binsert\s+into\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\bupdate\s+([A-Za-z0-9_."\[\]$#]+)\s+set\b/gi,
  /\bdelete\s+from\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\bmerge\s+into\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\btruncate\s+table\s+([A-Za-z0-9_."\[\]$#]+)/gi,
];

/** Distinct written-table tokens from one verbatim SQL string. */
export function parseWriteTablesFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const found: string[] = [];
  for (const pattern of WRITE_SQL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      const token = bareTableToken(match[1]);
      if (!token || token.startsWith('#') || token.startsWith('@')) continue;
      if (!found.some((t) => t.toLowerCase() === token.toLowerCase())) found.push(token);
    }
  }
  return found;
}

interface CorpusIndex {
  tablesByKey: Map<string, SclBehaviourTable>;
  boundaryWritesByKey: Map<string, string[]>;
  boundarySymbolByKey: Map<string, string>;
  httpRoots: Array<{ key: string; symbol: string; method: string; fragment: string }>;
}

export function indexCorpus(corpus: SclCorpus): CorpusIndex {
  const tablesByKey = new Map<string, SclBehaviourTable>();
  const boundaryWritesByKey = new Map<string, string[]>();
  const boundarySymbolByKey = new Map<string, string>();
  const httpRoots: CorpusIndex['httpRoots'] = [];
  for (const entry of corpus.contracts) {
    const contract: SclContract = entry.contract;
    if (contract.kind === 'behaviour_table') {
      tablesByKey.set(contract.key, contract);
      const method = deriveHttpMethod(contract.annotations);
      const fragment = derivePathFragment(contract.annotations);
      if (method && fragment) {
        httpRoots.push({ key: contract.key, symbol: contract.symbol, method, fragment });
      }
    } else if (contract.kind === 'boundary') {
      const boundary = contract as SclBoundaryContract;
      const tables: string[] = [];
      for (const operation of boundary.operations ?? []) {
        for (const table of parseWriteTablesFromSql(operation.sqlVerbatim)) {
          if (!tables.some((t) => t.toLowerCase() === table.toLowerCase())) tables.push(table);
        }
      }
      boundaryWritesByKey.set(contract.key, tables);
      boundarySymbolByKey.set(contract.key, boundary.symbol);
    }
  }
  return { tablesByKey, boundaryWritesByKey, boundarySymbolByKey, httpRoots };
}

export interface CallWalkResult {
  boundaries: string[];
  /** Unresolved call sites — WHERE the chain broke (diagnosis, capped 10). */
  brokenCalls: string[];
}

/** Transitive call walk from a root table to boundary keys, recording every
 * unresolved call site along the way (bounded, cycle-safe). */
export function walkCallGraph(
  rootKey: string,
  tablesByKey: Map<string, SclBehaviourTable>,
  cap = 500,
): CallWalkResult {
  const boundaries = new Set<string>();
  const brokenCalls: string[] = [];
  const visited = new Set<string>();
  const queue = [rootKey];
  while (queue.length > 0 && visited.size < cap) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const table = tablesByKey.get(key);
    for (const row of table?.rows ?? []) {
      if (row.outcome.type !== 'call') continue;
      if (typeof row.outcome.targetKey !== 'string') {
        if (brokenCalls.length < 10) {
          brokenCalls.push(
            `${table?.symbol ?? key}: call to ${row.outcome.targetSymbol} unresolved`,
          );
        }
        continue;
      }
      const target = row.outcome.targetKey;
      if (target.startsWith('Q-')) boundaries.add(target);
      else if (target.startsWith('T-') && !visited.has(target)) queue.push(target);
    }
  }
  return { boundaries: [...boundaries], brokenCalls };
}

/** Back-compat wrapper (boundary keys only). */
export function collectBoundaryKeys(
  rootKey: string,
  tablesByKey: Map<string, SclBehaviourTable>,
  cap = 500,
): string[] {
  return walkCallGraph(rootKey, tablesByKey, cap).boundaries;
}

// ---------------------------------------------------------------------------
// Phase 1 — deterministic derivation into candidates
// ---------------------------------------------------------------------------

export interface UncoveredWriteEndpoint {
  /** The run's `endpoints` candidate. */
  endpointCandidate: DiscoveryCandidate;
  method: string;
  path: string;
  /** Matched http-root table keys (evidence source for the LLM phase). */
  rootKeys: string[];
  /** WHY the deterministic phase found nothing — the diagnosis record
   *  (2026-08-20: unmapped endpoints must self-document). */
  diagnosis: {
    stage: 'no_root_match' | 'chain_broken' | 'boundaries_without_write_sql';
    matched_roots: string[];
    same_verb_root_fragments: string[];
    broken_calls: string[];
    boundaries_reached: string[];
  };
}

export interface DeriveResult {
  candidates: DiscoveryCandidate[];
  uncovered: UncoveredWriteEndpoint[];
}

function normName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildEffectCandidate(args: {
  runId: string;
  endpointName: string;
  table: string;
  confidence: number;
  source: 'scl_corpus' | 'llm_proposal';
  detail: Record<string, unknown>;
}): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId: args.runId,
    candidateType: 'endpoint_data_effects',
    name: `${args.endpointName} → ${args.table} (write)`,
    confidence: args.confidence,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      endpointName: args.endpointName,
      dataEntityName: args.table,
      access_mode: 'write',
      confidence: args.confidence,
      path_metadata_json: { derivation: args.source, ...args.detail },
      relationshipType: 'uses_data',
      usesData: { accessType: 'write', dataIdentifier: args.table },
      _addedBy: 'scl-effect-candidate-emitter',
    },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

/**
 * Derives corpus-backed effect candidates for THIS RUN's write endpoints.
 * Endpoints that already carry an effect candidate (discovery's own mining)
 * are left alone — this fills gaps, it never competes.
 */
export function deriveCorpusEffectCandidates(args: {
  corpus: SclCorpus;
  runId: string;
  runCandidates: DiscoveryCandidate[];
}): DeriveResult {
  const index = indexCorpus(args.corpus);

  const coveredEndpointNames = new Set<string>();
  for (const candidate of args.runCandidates) {
    if (candidate.candidateType !== 'endpoint_data_effects') continue;
    const name = normName((candidate.data as Record<string, unknown> | undefined)?.endpointName);
    if (name) coveredEndpointNames.add(name);
  }

  const candidates: DiscoveryCandidate[] = [];
  const uncovered: UncoveredWriteEndpoint[] = [];

  for (const endpointCandidate of args.runCandidates) {
    if (endpointCandidate.candidateType !== 'endpoints') continue;
    const method = readMethod(endpointCandidate);
    const path = readPathTemplate(endpointCandidate);
    if (!method || !path || !MUTATING_VERBS.has(method)) continue;
    if (coveredEndpointNames.has(normName(endpointCandidate.name))) continue;

    const matched = index.httpRoots.filter(
      (root) => root.method.toUpperCase() === method && pathContainsFragment(root.fragment, path),
    );
    const maxLength = matched.reduce((max, r) => Math.max(max, r.fragment.length), 0);
    const roots = matched.filter((r) => r.fragment.length === maxLength);

    const tables: string[] = [];
    const brokenCalls: string[] = [];
    const boundariesReached: string[] = [];
    for (const root of roots) {
      const walk = walkCallGraph(root.key, index.tablesByKey);
      for (const broken of walk.brokenCalls) {
        if (brokenCalls.length < 10 && !brokenCalls.includes(broken)) brokenCalls.push(broken);
      }
      for (const boundaryKey of walk.boundaries) {
        const symbol = index.boundarySymbolByKey.get(boundaryKey) ?? boundaryKey;
        if (!boundariesReached.includes(symbol)) boundariesReached.push(symbol);
        for (const table of index.boundaryWritesByKey.get(boundaryKey) ?? []) {
          if (!tables.some((t) => t.toLowerCase() === table.toLowerCase())) tables.push(table);
        }
      }
    }

    if (tables.length > 0) {
      for (const table of tables) {
        candidates.push(
          buildEffectCandidate({
            runId: args.runId,
            endpointName: endpointCandidate.name,
            table,
            confidence: 0.9,
            source: 'scl_corpus',
            detail: { roots: roots.map((r) => r.symbol).slice(0, 3) },
          }),
        );
      }
    } else {
      uncovered.push({
        endpointCandidate,
        method,
        path,
        rootKeys: roots.map((r) => r.key),
        diagnosis: {
          stage:
            roots.length === 0
              ? 'no_root_match'
              : boundariesReached.length === 0
                ? 'chain_broken'
                : 'boundaries_without_write_sql',
          matched_roots: roots.map((r) => `${r.symbol} [fragment "${r.fragment}"]`),
          same_verb_root_fragments:
            roots.length === 0
              ? index.httpRoots
                  .filter((r) => r.method.toUpperCase() === method)
                  .map((r) => r.fragment)
                  .slice(0, 15)
              : [],
          broken_calls: brokenCalls,
          boundaries_reached: boundariesReached,
        },
      });
    }
  }

  return { candidates, uncovered };
}

// ---------------------------------------------------------------------------
// Phase 2 — guarded LLM proposals via the gateway gap-fill relay
// ---------------------------------------------------------------------------

/** Endpoints per relay call — bounds prompt size AND spend. */
const LLM_BATCH_SIZE = 8;
/** Verbatim row lines carried per endpoint (evidence, capped). */
const MAX_ROW_LINES = 30;

export interface UnproposedEndpoint {
  method: string;
  path: string;
  reason: string;
  /** The deterministic-phase diagnosis (why the corpus could not map it). */
  diagnosis?: UncoveredWriteEndpoint['diagnosis'];
}

export interface ProposeResult {
  candidates: DiscoveryCandidate[];
  unproposed: UnproposedEndpoint[];
  llmCalls: number;
}

export type EffectProposalRelay = (
  prompt: string,
  correlationTag: string,
  runId: string,
) => Promise<{ content: string }>;

function rowLinesFor(rootKeys: string[], tablesByKey: Map<string, SclBehaviourTable>): string[] {
  const lines: string[] = [];
  for (const key of rootKeys) {
    for (const row of tablesByKey.get(key)?.rows ?? []) {
      if (lines.length >= MAX_ROW_LINES) return lines;
      const condition = row.conditionVerbatim ? `if ${row.conditionVerbatim} -> ` : '';
      const outcome =
        row.outcome.type === 'call'
          ? `call ${row.outcome.targetSymbol}`
          : row.outcome.type === 'terminal'
            ? row.outcome.verbatim
            : row.outcome.type === 'absorb'
              ? `on ${row.outcome.exceptionType}: ${row.outcome.thenVerbatim}`
              : '';
      if (condition || outcome) lines.push(`${condition}${outcome}`.slice(0, 200));
    }
  }
  return lines;
}

/** Strips optional markdown fences and parses the strict-JSON contract. */
export function parseProposalContent(content: string): Array<{
  method?: string;
  path?: string;
  tables?: unknown[];
  rationale?: string;
}> {
  const stripped = content
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const parsed = JSON.parse(stripped) as { proposals?: unknown[] };
  if (!Array.isArray(parsed.proposals)) throw new Error('"proposals" is not an array');
  return parsed.proposals as Array<{
    method?: string;
    path?: string;
    tables?: unknown[];
    rationale?: string;
  }>;
}

export async function proposeEffectCandidatesViaLlm(args: {
  runId: string;
  uncovered: UncoveredWriteEndpoint[];
  corpus: SclCorpus;
  /** Committed physical-table names — the CLOSED proposal vocabulary. */
  vocabulary: string[];
  relay: EffectProposalRelay;
}): Promise<ProposeResult> {
  const { tablesByKey } = indexCorpus(args.corpus);
  const vocabularyByLower = new Map(args.vocabulary.map((name) => [name.toLowerCase(), name]));
  const candidates: DiscoveryCandidate[] = [];
  const unproposed: UnproposedEndpoint[] = [];
  let llmCalls = 0;

  for (let offset = 0; offset < args.uncovered.length; offset += LLM_BATCH_SIZE) {
    const batch = args.uncovered.slice(offset, offset + LLM_BATCH_SIZE);
    const endpointBlocks = batch
      .map((endpoint) => {
        const lines = rowLinesFor(endpoint.rootKeys, tablesByKey);
        return (
          `${endpoint.method} ${endpoint.path}\n` +
          (lines.length > 0
            ? lines.map((l) => `  ${l}`).join('\n')
            : '  (no mined behaviour rows for this endpoint)')
        );
      })
      .join('\n\n');
    const prompt =
      'You map legacy WRITE endpoints to the DATABASE TABLES they modify.\n' +
      'Answer STRICT JSON only, no prose, no markdown fences:\n' +
      '{"proposals":[{"method":"POST","path":"/x","tables":["t1"],"rationale":"..."}]}\n' +
      'Use ONLY table names from this vocabulary — never invent names. Omit an\n' +
      'endpoint entirely when the evidence does not identify its tables.\n\n' +
      `Table vocabulary (the ONLY allowed names):\n${args.vocabulary.join(', ')}\n\n` +
      `Endpoints with mined behaviour evidence:\n\n${endpointBlocks}`;

    try {
      llmCalls += 1;
      const response = await args.relay(prompt, 'scl-effect-map-proposals', args.runId);
      const parsed = parseProposalContent(response.content);
      for (const endpoint of batch) {
        const match = parsed.find(
          (p) =>
            (p.method ?? '').toUpperCase() === endpoint.method &&
            (p.path ?? '') === endpoint.path &&
            Array.isArray(p.tables) &&
            p.tables.length > 0,
        );
        if (!match) {
          unproposed.push({
            method: endpoint.method,
            path: endpoint.path,
            reason: 'the LLM declined to propose tables',
            diagnosis: endpoint.diagnosis,
          });
          continue;
        }
        const accepted: string[] = [];
        const rejected: string[] = [];
        for (const raw of match.tables ?? []) {
          const committed = vocabularyByLower.get(String(raw).toLowerCase());
          if (committed && !accepted.includes(committed)) accepted.push(committed);
          else if (!committed) rejected.push(String(raw));
        }
        if (accepted.length === 0) {
          unproposed.push({
            method: endpoint.method,
            path: endpoint.path,
            reason:
              rejected.length > 0
                ? `every proposed table failed the vocabulary guard: ${rejected.join(', ')}`
                : 'the LLM proposed no tables',
            diagnosis: endpoint.diagnosis,
          });
          continue;
        }
        for (const table of accepted) {
          candidates.push(
            buildEffectCandidate({
              runId: args.runId,
              endpointName: endpoint.endpointCandidate.name,
              table,
              confidence: 0.65,
              source: 'llm_proposal',
              detail: {
                rationale: String(match.rationale ?? '').slice(0, 500),
                guard_rejected: rejected,
              },
            }),
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const endpoint of batch) {
        unproposed.push({
          method: endpoint.method,
          path: endpoint.path,
          reason: `LLM drafting failed: ${message.slice(0, 200)}`,
          diagnosis: endpoint.diagnosis,
        });
      }
    }
  }

  return { candidates, unproposed, llmCalls };
}

// ---------------------------------------------------------------------------
// Committed table vocabulary (the phase-2 guard input)
// ---------------------------------------------------------------------------

/** Physical-table names from the committed model; null on any read failure
 * (callers skip the LLM phase LOUDLY — proposing against no vocabulary would
 * disable the hallucination guard). */
export async function fetchCommittedTableVocabulary(
  projectId: string,
  architectureId: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[] | null> {
  try {
    const response = await fetchFn(
      `${ARCHITECTURE_MODEL_SERVICE_BASE_URL}/api/model/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return null;
    const model = (await response.json()) as {
      metaModel?: { entities?: { physical_data_entities?: Array<{ name?: string }> } };
    };
    const names = (model.metaModel?.entities?.physical_data_entities ?? [])
      .map((entity) => entity?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    return [...new Set(names)].sort();
  } catch {
    return null;
  }
}
