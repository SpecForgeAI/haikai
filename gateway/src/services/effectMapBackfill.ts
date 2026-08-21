/**
 * Effect-map backfill (2026-08-20, user ruling after the 34-endpoint
 * preflight warning: "build these two complementary mechanisms").
 *
 * The compensation machinery refuses (fail-closed) any mutating capture on a
 * write endpoint with no effect-table map (`endpoint_data_effects` write
 * edges in the committed model). Those maps come from code discovery, and
 * exactly the indirection that defeats discovery's endpoint->SQL trace (DI /
 * lookup dispatch) leaves endpoints unmapped. Two remedies, in order:
 *
 * 1. DETERMINISTIC corpus derivation: the SCL structural corpus already
 *    holds (a) behaviour tables whose verbatim annotations name the HTTP
 *    method + path fragment (the annotation pass's own root matching,
 *    reused verbatim), (b) the resolved call graph between tables, and
 *    (c) boundary contracts with verbatim SQL. Endpoint -> matching root
 *    table -> transitive call walk -> boundary write statements -> table
 *    names, filtered against the committed physical entities. Derived
 *    mappings are applied IMMEDIATELY (additively, via the MCP model-write
 *    owner) — they cite real code.
 *
 * 2. LLM PROPOSALS for the remainder: batched strict-JSON drafting from the
 *    matched root-table row verbatims (when any) + the CLOSED table-name
 *    vocabulary of the committed model. Every proposed table must resolve
 *    to a committed physical entity (hallucination guard — enforced here
 *    AND again at apply time); proposals are NEVER auto-applied — the
 *    caller returns them for human review and applies the approved subset.
 *
 * Everything effectful rides injectable deps; the pure helpers are exported
 * for tests.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  deriveHttpMethod,
  derivePathFragment,
  pathContainsFragment,
} from './sclAnnotationPass';
import { SclContractDto, fetchLatestSclContracts } from './sclCorpusPlanner';

// ---------------------------------------------------------------------------
// Wire / result types
// ---------------------------------------------------------------------------

export interface UnmappedEndpoint {
  endpoint_id: string;
  method: string;
  path: string;
}

export interface DerivedEffect extends UnmappedEndpoint {
  tables: string[];
  /** Root symbol(s) + boundary evidence, human-readable. */
  evidence: string;
  /** Write-table names seen in SQL but NOT committed physical entities. */
  unknown_tables: string[];
}

export interface ProposedEffect extends UnmappedEndpoint {
  tables: string[];
  rationale: string;
  /** LLM-proposed names rejected by the closed-vocabulary guard. */
  guard_rejected: string[];
}

export interface UnproposedEndpoint extends UnmappedEndpoint {
  reason: string;
}

/**
 * Per-endpoint DIAGNOSIS of why the deterministic phase could not map it —
 * the "bring this back to be fixed" record (2026-08-20 user ruling: a third
 * of write endpoints outside the migration is not good enough).
 *
 * Stages:
 *   - no_root_match: no http-rooted behaviour table matched the endpoint's
 *     method+path — `same_verb_root_fragments` lists what WAS available.
 *   - chain_broken: root(s) matched but every path to the data layer died on
 *     unresolved calls (DI/dispatch) — `broken_calls` names the exact sites.
 *   - boundaries_without_write_sql: the walk reached DAO boundaries but none
 *     of their operations carried parseable write SQL (dynamic SQL, derived
 *     query names) — `boundaries_reached` names them.
 */
export interface EndpointDiagnosis extends UnmappedEndpoint {
  stage: 'no_root_match' | 'chain_broken' | 'boundaries_without_write_sql';
  matched_roots: string[];
  same_verb_root_fragments: string[];
  broken_calls: string[];
  boundaries_reached: string[];
}

/** A write-verb endpoint whose COMPLETE walk proved it only READS — the
 *  POST-implemented-lookup case (2026-08-21 mirror of the scan emitter's
 *  proven-read classification; read edges are applied so the preflight
 *  stops demanding write maps for it). */
export interface ProvenReadEndpoint extends UnmappedEndpoint {
  read_tables: string[];
  evidence: string;
}

/** Screenshot-friendly rollup (2026-08-20: transfer is screenshots only —
 *  counts + deduped tops, never per-endpoint repetition). */
export interface BackfillSummary {
  unmapped_count: number;
  by_stage: Record<string, number>;
  /** `symbol (count)` — deduped unresolved-call targets, worst first. */
  top_broken_targets: string[];
  /** Endpoints EXCLUDED up front because the model already carries read
   *  effect edges for them (the preflight does not block those). */
  read_mapped_count: number;
  /** Endpoints classified proven-read THIS run (read edges applied). */
  proven_read_count: number;
}

export interface EffectMapBackfillResult {
  unmapped_count: number;
  summary: BackfillSummary;
  derived: DerivedEffect[];
  derived_apply: { applied: number; skipped: Array<{ reason: string }> } | null;
  proven_read: ProvenReadEndpoint[];
  proven_read_apply: { applied: number; skipped: Array<{ reason: string }> } | null;
  proposals: ProposedEffect[];
  unproposed: UnproposedEndpoint[];
  /** Deterministic-phase diagnosis for every endpoint that needed the LLM. */
  trace: EndpointDiagnosis[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const MUTATING_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `[dbo].[Orders]` / `"s"."t"` / `sch.t` -> bare lowercase-insensitive name. */
function bareTableToken(raw: string): string {
  const cleaned = raw.replace(/[[\]"`]/g, '').trim();
  const lastSegment = cleaned.split('.').pop() ?? cleaned;
  return lastSegment.trim();
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
      // Temp tables (#t) and variables (@t) are never committed entities.
      if (!token || token.startsWith('#') || token.startsWith('@')) continue;
      if (!found.some((t) => t.toLowerCase() === token.toLowerCase())) found.push(token);
    }
  }
  return found;
}

const READ_SQL_PATTERNS: RegExp[] = [
  /\bfrom\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\bjoin\s+([A-Za-z0-9_."\[\]$#]+)/gi,
];

/** Distinct READ-table tokens (FROM/JOIN; `DELETE FROM` excluded — that's a
 *  write). Mirror of the scan emitter's — powers the backfill's proven-read
 *  classification (2026-08-21). */
export function parseReadTablesFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const found: string[] = [];
  for (const pattern of READ_SQL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      const before = sql.slice(Math.max(0, match.index - 12), match.index);
      if (/delete\s*$/i.test(before)) continue;
      const token = bareTableToken(match[1]);
      if (!token || token.startsWith('#') || token.startsWith('@')) continue;
      if (!found.some((t) => t.toLowerCase() === token.toLowerCase())) found.push(token);
    }
  }
  return found;
}

interface ContractBodyLike {
  annotations?: unknown[] | null;
  rows?: unknown[] | null;
  operations?: Array<{ sqlVerbatim?: string | null }> | null;
  [key: string]: unknown;
}

export interface HttpRootTable {
  key: string;
  symbol: string;
  method: string;
  fragment: string;
}

/**
 * A fragment with NO literal characters (`{a}/{b}`) matches ANY path — the
 * 2026-08-20 diagnosis showed every endpoint "matching" the same two
 * placeholder-only roots. Never usable.
 */
export function fragmentHasLiterals(fragment: string): boolean {
  return fragment.replace(/\{[^}]*\}/g, '').replace(/\//g, '').trim().length > 0;
}

/** Behaviour tables whose own annotations declare an HTTP method + path
 * fragment — the corpus's endpoint roots (annotation-pass helpers reused;
 * placeholder-only fragments excluded). */
export function collectHttpRootTables(contracts: SclContractDto[]): HttpRootTable[] {
  const roots: HttpRootTable[] = [];
  for (const contract of contracts) {
    if (contract.kind !== 'behaviour_table') continue;
    const body = (contract.body_json ?? null) as ContractBodyLike | null;
    const method = deriveHttpMethod(body);
    const fragment = derivePathFragment(body);
    if (!method || !fragment || !contract.contract_key) continue;
    if (!fragmentHasLiterals(fragment)) continue;
    roots.push({
      key: contract.contract_key,
      symbol: contract.source_symbol ?? contract.contract_key,
      method,
      fragment,
    });
  }
  return roots;
}

/** Name+arity dispatch-expansion index (mirror of the scan emitter's). */
export interface DispatchExpansionIndex {
  tablesByNameArity: Map<string, string[]>;
  tablesByName: Map<string, string[]>;
  boundariesByOpName: Map<string, string[]>;
  /** Class FQNs with ANY corpus presence — powers the unresolved-call
   *  diagnosis clause ("class absent from corpus" vs "no method match"). */
  classFqnsInCorpus: Set<string>;
}

const DISPATCH_EXPANSION_CAP = 5;

export function buildDispatchIndex(contracts: SclContractDto[]): DispatchExpansionIndex {
  const tablesByNameArity = new Map<string, string[]>();
  const tablesByName = new Map<string, string[]>();
  const boundariesByOpName = new Map<string, string[]>();
  const classFqnsInCorpus = new Set<string>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };
  for (const contract of contracts) {
    if (!contract.contract_key) continue;
    const body = (contract.body_json ?? null) as ContractBodyLike | null;
    if (contract.kind === 'behaviour_table') {
      const symbol = contract.source_symbol ?? '';
      const hash = symbol.indexOf('#');
      if (hash >= 0) {
        // Symbols are `Cls#method(ParamTypes)` — strip the parameter list so
        // the key matches expandDispatch's bare `name/arity` lookup
        // (2026-08-21 fix: unstripped keys made the expansion inert on real
        // corpora; paren-less fixture symbols masked it).
        const afterHash = symbol.slice(hash + 1);
        const paren = afterHash.indexOf('(');
        const name = paren >= 0 ? afterHash.slice(0, paren) : afterHash;
        classFqnsInCorpus.add(symbol.slice(0, hash));
        const arity = Array.isArray(
          (body as { signatureInputs?: unknown[] } | null)?.signatureInputs,
        )
          ? ((body as { signatureInputs: unknown[] }).signatureInputs.length)
          : 0;
        push(tablesByNameArity, `${name}/${arity}`, contract.contract_key);
        push(tablesByName, name, contract.contract_key);
      }
    } else if (contract.kind === 'boundary') {
      const symbol = contract.source_symbol ?? '';
      if (symbol) {
        const hash = symbol.indexOf('#');
        classFqnsInCorpus.add(hash >= 0 ? symbol.slice(0, hash) : symbol);
      }
      for (const operation of body?.operations ?? []) {
        const opName = (operation as { name?: string })?.name;
        if (opName) push(boundariesByOpName, opName, contract.contract_key);
      }
    }
  }
  return { tablesByNameArity, tablesByName, boundariesByOpName, classFqnsInCorpus };
}

function expandDispatch(
  targetSymbol: string,
  expansion: DispatchExpansionIndex,
): { tables: string[]; boundaries: string[] } | null {
  const hash = targetSymbol.indexOf('#');
  const paren = targetSymbol.indexOf('(', hash);
  if (hash < 0 || paren < 0) return null;
  const name = targetSymbol.slice(hash + 1, paren);
  const argsText = targetSymbol.slice(paren + 1, targetSymbol.lastIndexOf(')'));
  const arity = argsText.trim() === '' ? 0 : argsText.split(',').length;
  let tables = expansion.tablesByNameArity.get(`${name}/${arity}`) ?? [];
  if (tables.length === 0) tables = expansion.tablesByName.get(name) ?? [];
  const boundaries = expansion.boundariesByOpName.get(name) ?? [];
  const total = tables.length + boundaries.length;
  if (total === 0 || total > DISPATCH_EXPANSION_CAP) return null;
  return { tables, boundaries };
}

/** WHY a call could not be expanded — one clause for the broken-call line
 *  (mirror of the scan emitter's `unresolvedReason`). */
export function unresolvedReason(
  targetSymbol: string,
  expansion: DispatchExpansionIndex,
): string {
  const hash = targetSymbol.indexOf('#');
  const paren = targetSymbol.indexOf('(', hash);
  if (hash < 0 || paren < 0) return 'unparseable target symbol';
  const clsFqn = targetSymbol.slice(0, hash);
  const name = targetSymbol.slice(hash + 1, paren);
  const argsText = targetSymbol.slice(paren + 1, targetSymbol.lastIndexOf(')'));
  const arity = argsText.trim() === '' ? 0 : argsText.split(',').length;
  const total =
    (expansion.tablesByNameArity.get(`${name}/${arity}`) ?? []).length ||
    (expansion.tablesByName.get(name) ?? []).length +
      (expansion.boundariesByOpName.get(name) ?? []).length;
  if (total > DISPATCH_EXPANSION_CAP) {
    return `${total} name-matched candidates exceed the expansion cap ${DISPATCH_EXPANSION_CAP}`;
  }
  return expansion.classFqnsInCorpus.has(clsFqn)
    ? `class in corpus but no method named ${name}/${arity}`
    : 'target class has NO corpus presence (never sliced/reached)';
}

/**
 * The root table(s) matching one endpoint: same method, fragment contained
 * in the endpoint path (template-aware), LONGEST fragment wins (prevents a
 * `/lookup` root swallowing `/lookupStarred` endpoints); length ties all
 * match (distinct roots, additive union is safe).
 */
export function matchRootsForEndpoint(
  endpoint: { method: string; path: string },
  roots: HttpRootTable[],
): HttpRootTable[] {
  const verb = endpoint.method.toUpperCase();
  const candidates = roots.filter(
    (root) =>
      root.method.toUpperCase() === verb &&
      pathContainsFragment(root.fragment, endpoint.path),
  );
  if (candidates.length <= 1) return candidates;
  const maxLength = Math.max(...candidates.map((c) => c.fragment.length));
  return candidates.filter((c) => c.fragment.length === maxLength);
}

export interface CallWalkResult {
  /** Boundary contract keys (`Q-…`) reached from the root. */
  boundaries: string[];
  /** Call rows whose target never resolved — WHERE the chain broke.
   *  `"<walked contract key>: call to <target symbol> unresolved"`. */
  brokenCalls: string[];
}

/**
 * Transitive call walk from a root behaviour table: follows every row's
 * resolved `call` target across behaviour tables, collecting boundary
 * contract keys AND recording every unresolved call site (the diagnosis
 * for "why did the walk find nothing"). Bounded + cycle-safe.
 */
export function walkCallGraph(
  rootKey: string,
  bodiesByKey: Map<string, ContractBodyLike>,
  cap = 500,
  expansion?: DispatchExpansionIndex,
): CallWalkResult {
  const boundaries = new Set<string>();
  const brokenCalls: string[] = [];
  const visited = new Set<string>();
  const queue = [rootKey];
  while (queue.length > 0 && visited.size < cap) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const body = bodiesByKey.get(key);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    for (const row of rows) {
      const outcome = (row as {
        outcome?: { type?: string; targetKey?: string | null; targetSymbol?: string };
      })?.outcome;
      if (outcome?.type !== 'call') continue;
      if (typeof outcome.targetKey !== 'string') {
        // Dispatch expansion (2026-08-20): null-target calls resolve by
        // name+arity across the corpus — the walk continues instead of
        // breaking on factory/interface indirection.
        const expanded = expansion
          ? expandDispatch(outcome.targetSymbol ?? '', expansion)
          : null;
        if (expanded) {
          for (const t of expanded.tables) if (!visited.has(t)) queue.push(t);
          for (const b of expanded.boundaries) boundaries.add(b);
        } else if (brokenCalls.length < 10) {
          const reason = expansion
            ? ` (${unresolvedReason(outcome.targetSymbol ?? '', expansion)})`
            : '';
          brokenCalls.push(
            `${key}: call to ${outcome.targetSymbol ?? '(unknown symbol)'} unresolved${reason}`,
          );
        }
        continue;
      }
      const target = outcome.targetKey;
      if (target.startsWith('Q-')) boundaries.add(target);
      else if (target.startsWith('T-') && !visited.has(target)) queue.push(target);
    }
  }
  return { boundaries: [...boundaries], brokenCalls };
}

/** Back-compat wrapper (boundary keys only). */
export function collectBoundaryKeys(
  rootKey: string,
  bodiesByKey: Map<string, ContractBodyLike>,
  cap = 500,
): string[] {
  return walkCallGraph(rootKey, bodiesByKey, cap).boundaries;
}

// ---------------------------------------------------------------------------
// Model read (raw model JSON — same route the compensation reader uses)
// ---------------------------------------------------------------------------

interface RawModel {
  metaModel?: {
    entities?: {
      endpoints?: Array<{ id?: string; path_or_address?: string; operation_verb?: string }>;
      physical_data_entities?: Array<{ id?: string; name?: string }>;
    };
    relationships?: {
      endpoint_data_effects?: Array<{
        endpoint_id?: string;
        access_mode?: string;
        data_entity_point_id?: string;
      }>;
    };
  };
}

async function defaultFetchRawModel(
  projectId: string,
  architectureId: string,
): Promise<RawModel | null> {
  const base = getConfig().architectureModelServiceBaseUrl;
  const response = await fetch(
    `${base}/api/model/projects/${encodeURIComponent(projectId)}` +
      `/architectures/${encodeURIComponent(architectureId)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) return null;
  return (await response.json()) as RawModel;
}

// ---------------------------------------------------------------------------
// LLM seam (house idiom — lazy require, jsonMode, shared rate-limit pacing)
// ---------------------------------------------------------------------------

export type BackfillLlmCaller = (args: {
  systemPrompt: string;
  userPrompt: string;
  requestTag: string;
}) => Promise<{ content: string }>;

const defaultLlm: BackfillLlmCaller = async ({ systemPrompt, userPrompt, requestTag }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('./llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    requestTag,
    requestTag,
    { jsonMode: true },
  );
  return { content: response.content ?? '' };
};

// ---------------------------------------------------------------------------
// MCP apply seam
// ---------------------------------------------------------------------------

export interface McpApplyEffect {
  endpoint_id: string;
  table_name: string;
  source: 'corpus' | 'llm';
  evidence?: string | null;
  /** Omitted = 'write' (back-compat). 'read' = proven-read edges. */
  access_mode?: 'write' | 'read';
}

export type McpApplyCaller = (
  projectId: string,
  architectureId: string,
  effects: McpApplyEffect[],
) => Promise<{ applied: number; skipped: Array<{ reason: string }> }>;

export const defaultMcpApply: McpApplyCaller = async (projectId, architectureId, effects) => {
  const { mcpBaseUrl } = getConfig();
  const response = await fetch(`${mcpBaseUrl}/mcp/tools/apply_endpoint_effects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sessionId: 'gateway',
      projectId,
      architectureId,
      deltas: effects,
    }),
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`MCP apply_endpoint_effects failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const parsed = (text ? JSON.parse(text) : { applied: 0, skipped: [] }) as {
    applied: number;
    skipped: Array<{ reason: string }>;
  };
  return parsed;
};

// ---------------------------------------------------------------------------
// LLM proposal phase
// ---------------------------------------------------------------------------

/** Endpoints per LLM call — bounds prompt size AND spend. */
const LLM_BATCH_SIZE = 8;
/** Verbatim row lines carried per endpoint (evidence, capped). */
const MAX_ROW_LINES = 30;

function rowLinesFor(rootKeys: string[], bodiesByKey: Map<string, ContractBodyLike>): string[] {
  const lines: string[] = [];
  for (const key of rootKeys) {
    const body = bodiesByKey.get(key);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    for (const row of rows) {
      if (lines.length >= MAX_ROW_LINES) return lines;
      const r = row as {
        conditionVerbatim?: string | null;
        outcome?: { verbatim?: string; targetSymbol?: string; type?: string };
      };
      const condition = r.conditionVerbatim ? `if ${r.conditionVerbatim} -> ` : '';
      const outcome =
        r.outcome?.type === 'call'
          ? `call ${r.outcome.targetSymbol ?? ''}`
          : (r.outcome?.verbatim ?? '');
      if (condition || outcome) lines.push(`${condition}${outcome}`.slice(0, 200));
    }
  }
  return lines;
}

export function parseProposalContent(content: string): Array<{
  method?: string;
  path?: string;
  tables?: unknown[];
  rationale?: string;
}> {
  const parsed = JSON.parse(content) as { proposals?: unknown[] };
  if (!Array.isArray(parsed.proposals)) throw new Error('"proposals" is not an array');
  return parsed.proposals as Array<{
    method?: string;
    path?: string;
    tables?: unknown[];
    rationale?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface EffectMapBackfillDeps {
  fetchRawModel: typeof defaultFetchRawModel;
  fetchContracts: (
    projectId: string,
    architectureId: string,
  ) => Promise<SclContractDto[] | null>;
  llm: BackfillLlmCaller;
  mcpApply: McpApplyCaller;
}

const defaultDeps: EffectMapBackfillDeps = {
  fetchRawModel: defaultFetchRawModel,
  fetchContracts: (projectId, architectureId) =>
    fetchLatestSclContracts(projectId, architectureId),
  llm: defaultLlm,
  mcpApply: defaultMcpApply,
};

/**
 * Runs the full backfill for one architecture: derives + APPLIES the
 * deterministic mappings, drafts guarded LLM proposals for the remainder,
 * and returns both plus the honestly-unproposed tail. The caller applies
 * approved proposals via {@link defaultMcpApply} (source 'llm').
 */
export async function runEffectMapBackfill(
  args: { projectId: string; architectureId: string },
  deps?: Partial<EffectMapBackfillDeps>,
): Promise<EffectMapBackfillResult> {
  const d: EffectMapBackfillDeps = { ...defaultDeps, ...deps };
  const { projectId, architectureId } = args;

  // ---- Model read: unmapped write endpoints + the closed table vocabulary.
  const model = await d.fetchRawModel(projectId, architectureId);
  if (!model) throw new Error('the committed model could not be read');

  const tableByLower = new Map<string, string>();
  for (const entity of model.metaModel?.entities?.physical_data_entities ?? []) {
    if (entity.id && entity.name) tableByLower.set(entity.name.toLowerCase(), entity.name);
  }

  const mappedEndpointIds = new Set<string>();
  const readMappedEndpointIds = new Set<string>();
  for (const edge of model.metaModel?.relationships?.endpoint_data_effects ?? []) {
    const mode = (edge.access_mode ?? '').toLowerCase();
    if (!edge.endpoint_id) continue;
    if (mode === 'write' || mode === 'read-write') mappedEndpointIds.add(edge.endpoint_id);
    else if (mode === 'read') readMappedEndpointIds.add(edge.endpoint_id);
  }

  const unmapped: UnmappedEndpoint[] = [];
  let readMappedCount = 0;
  for (const endpoint of model.metaModel?.entities?.endpoints ?? []) {
    const verb = (endpoint.operation_verb ?? '').toUpperCase();
    if (!endpoint.id || !MUTATING_VERBS.has(verb)) continue;
    if (mappedEndpointIds.has(endpoint.id)) continue;
    if (readMappedEndpointIds.has(endpoint.id)) {
      // Preflight parity (2026-08-21): a read-mapped endpoint does NOT block
      // capture — listing it as "unmapped" here was a false alarm.
      readMappedCount++;
      continue;
    }
    unmapped.push({ endpoint_id: endpoint.id, method: verb, path: endpoint.path_or_address ?? '' });
  }

  if (unmapped.length === 0) {
    return {
      unmapped_count: 0,
      summary: {
        unmapped_count: 0,
        by_stage: {},
        top_broken_targets: [],
        read_mapped_count: readMappedCount,
        proven_read_count: 0,
      },
      derived: [],
      derived_apply: null,
      proven_read: [],
      proven_read_apply: null,
      proposals: [],
      unproposed: [],
      trace: [],
    };
  }

  // ---- Corpus read.
  const contracts = (await d.fetchContracts(projectId, architectureId)) ?? [];
  const bodiesByKey = new Map<string, ContractBodyLike>();
  const boundaryTablesByKey = new Map<string, string[]>();
  const boundaryReadTablesByKey = new Map<string, string[]>();
  /** Per-boundary SQL visibility (2026-08-21 diagnosis: distinguishes a
   *  genuinely read-only DAO from one whose SQL is INVISIBLE to the corpus —
   *  dynamic SQL / external JDBC — where nothing can be proven). */
  const boundaryStatsByKey = new Map<string, { ops: number; withSql: number }>();
  for (const contract of contracts) {
    if (!contract.contract_key) continue;
    const body = (contract.body_json ?? null) as ContractBodyLike | null;
    if (body) bodiesByKey.set(contract.contract_key, body);
    if (contract.kind === 'boundary') {
      const tables: string[] = [];
      const readTables: string[] = [];
      let ops = 0;
      let withSql = 0;
      for (const operation of body?.operations ?? []) {
        ops++;
        if (operation?.sqlVerbatim) withSql++;
        for (const table of parseWriteTablesFromSql(operation?.sqlVerbatim)) {
          if (!tables.some((t) => t.toLowerCase() === table.toLowerCase())) tables.push(table);
        }
        for (const table of parseReadTablesFromSql(operation?.sqlVerbatim)) {
          if (!readTables.some((t) => t.toLowerCase() === table.toLowerCase())) {
            readTables.push(table);
          }
        }
      }
      boundaryTablesByKey.set(contract.contract_key, tables);
      boundaryReadTablesByKey.set(contract.contract_key, readTables);
      boundaryStatsByKey.set(contract.contract_key, { ops, withSql });
    }
  }
  const httpRoots = collectHttpRootTables(contracts);
  const dispatchIndex = buildDispatchIndex(contracts);

  // ---- Phase 1: deterministic derivation (+ per-endpoint diagnosis).
  const symbolByKey = new Map<string, string>();
  for (const contract of contracts) {
    if (contract.contract_key) {
      symbolByKey.set(contract.contract_key, contract.source_symbol ?? contract.contract_key);
    }
  }
  const derived: DerivedEffect[] = [];
  const provenRead: ProvenReadEndpoint[] = [];
  const trace: EndpointDiagnosis[] = [];
  const needProposal: Array<UnmappedEndpoint & { rootKeys: string[] }> = [];
  for (const endpoint of unmapped) {
    const roots = matchRootsForEndpoint(endpoint, httpRoots);
    const rootKeys = roots.map((r) => r.key);
    const writeTables: string[] = [];
    const unknownTables: string[] = [];
    const readTables: string[] = [];
    const brokenCalls: string[] = [];
    const boundariesReached: string[] = [];
    for (const rootKey of rootKeys) {
      const walk = walkCallGraph(rootKey, bodiesByKey, 500, dispatchIndex);
      for (const broken of walk.brokenCalls) {
        if (brokenCalls.length < 10 && !brokenCalls.includes(broken)) brokenCalls.push(broken);
      }
      for (const boundaryKey of walk.boundaries) {
        const stats = boundaryStatsByKey.get(boundaryKey);
        const reads = boundaryReadTablesByKey.get(boundaryKey) ?? [];
        const writes = boundaryTablesByKey.get(boundaryKey) ?? [];
        const symbol =
          (symbolByKey.get(boundaryKey) ?? boundaryKey) +
          (stats
            ? ` (ops ${stats.ops}, sql ${stats.withSql}, reads ${reads.length}, writes ${writes.length})`
            : '');
        if (!boundariesReached.includes(symbol)) boundariesReached.push(symbol);
        for (const table of writes) {
          const committed = tableByLower.get(table.toLowerCase());
          if (committed) {
            if (!writeTables.includes(committed)) writeTables.push(committed);
          } else if (!unknownTables.includes(table)) {
            unknownTables.push(table);
          }
        }
        for (const table of reads) {
          if (!readTables.some((t) => t.toLowerCase() === table.toLowerCase())) {
            readTables.push(table);
          }
        }
      }
    }
    if (writeTables.length > 0) {
      derived.push({
        ...endpoint,
        tables: writeTables,
        evidence: `corpus roots: ${roots.map((r) => r.symbol).join(', ')}`,
        unknown_tables: unknownTables,
      });
    } else if (
      roots.length > 0 &&
      brokenCalls.length === 0 &&
      unknownTables.length === 0 &&
      readTables.length > 0
    ) {
      // PROVEN READ-ONLY (2026-08-21 mirror of the scan emitter): the walk is
      // COMPLETE, no write SQL anywhere (committed or not), and the data
      // layer it reaches carries actual read SQL. Apply read edges so the
      // compensation preflight stops demanding a write map for this
      // POST-implemented lookup.
      provenRead.push({
        ...endpoint,
        read_tables: readTables,
        evidence: `corpus roots: ${roots.map((r) => r.symbol).join(', ')}`,
      });
    } else {
      // Diagnosis: name the exact failure stage + the evidence to fix it.
      trace.push({
        ...endpoint,
        stage:
          roots.length === 0
            ? 'no_root_match'
            : boundariesReached.length === 0
              ? 'chain_broken'
              : 'boundaries_without_write_sql',
        matched_roots: roots.map((r) => `${r.symbol} [fragment "${r.fragment}"]`),
        same_verb_root_fragments:
          roots.length === 0
            ? httpRoots
                .filter((r) => r.method.toUpperCase() === endpoint.method)
                .map((r) => r.fragment)
                .slice(0, 15)
            : [],
        broken_calls: brokenCalls,
        boundaries_reached: boundariesReached,
      });
      needProposal.push({ ...endpoint, rootKeys });
    }
  }

  // ---- Apply the deterministic derivations immediately (additive).
  let derivedApply: EffectMapBackfillResult['derived_apply'] = null;
  if (derived.length > 0) {
    const effects: McpApplyEffect[] = derived.flatMap((entry) =>
      entry.tables.map((table) => ({
        endpoint_id: entry.endpoint_id,
        table_name: table,
        source: 'corpus' as const,
        evidence: entry.evidence,
      })),
    );
    derivedApply = await d.mcpApply(projectId, architectureId, effects);
  }

  // ---- Apply proven-read edges (additive, access_mode 'read').
  let provenReadApply: EffectMapBackfillResult['proven_read_apply'] = null;
  if (provenRead.length > 0) {
    const effects: McpApplyEffect[] = provenRead.flatMap((entry) =>
      entry.read_tables.map((table) => ({
        endpoint_id: entry.endpoint_id,
        table_name: table,
        source: 'corpus' as const,
        evidence: entry.evidence,
        access_mode: 'read' as const,
      })),
    );
    provenReadApply = await d.mcpApply(projectId, architectureId, effects);
  }

  // ---- Phase 2: guarded LLM proposals for the remainder.
  const vocabulary = [...tableByLower.values()].sort();
  const proposals: ProposedEffect[] = [];
  const unproposed: UnproposedEndpoint[] = [];

  for (let offset = 0; offset < needProposal.length; offset += LLM_BATCH_SIZE) {
    const batch = needProposal.slice(offset, offset + LLM_BATCH_SIZE);
    const endpointBlocks = batch
      .map((endpoint) => {
        const lines = rowLinesFor(endpoint.rootKeys, bodiesByKey);
        return (
          `${endpoint.method} ${endpoint.path}\n` +
          (lines.length > 0 ? lines.map((l) => `  ${l}`).join('\n') : '  (no mined behaviour rows)')
        );
      })
      .join('\n\n');
    const systemPrompt =
      'You map legacy write endpoints to the DATABASE TABLES they modify. ' +
      'Answer STRICT JSON only: {"proposals":[{"method":"POST","path":"/x","tables":["t1"],"rationale":"..."}]}. ' +
      'Use ONLY table names from the provided vocabulary — never invent names. ' +
      'Omit an endpoint entirely when the evidence does not identify its tables.';
    const userPrompt =
      `Table vocabulary (the ONLY allowed names):\n${vocabulary.join(', ')}\n\n` +
      `Endpoints with mined behaviour evidence:\n\n${endpointBlocks}`;
    try {
      const response = await d.llm({
        systemPrompt,
        userPrompt,
        requestTag: `effect-map-backfill-${projectId}`,
      });
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
          unproposed.push({ ...endpoint, reason: 'the LLM declined to propose tables' });
          continue;
        }
        const accepted: string[] = [];
        const rejected: string[] = [];
        for (const raw of match.tables ?? []) {
          const committed = tableByLower.get(String(raw).toLowerCase());
          if (committed && !accepted.includes(committed)) accepted.push(committed);
          else if (!committed) rejected.push(String(raw));
        }
        if (accepted.length > 0) {
          proposals.push({
            ...endpoint,
            tables: accepted,
            rationale: String(match.rationale ?? '').slice(0, 500),
            guard_rejected: rejected,
          });
        } else {
          unproposed.push({
            ...endpoint,
            reason:
              rejected.length > 0
                ? `every proposed table failed the guard: ${rejected.join(', ')}`
                : 'the LLM proposed no tables',
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[effect-map-backfill] LLM batch failed (endpoints land in unproposed)', {
        projectId,
        batchStart: offset,
        error: message,
      });
      for (const endpoint of batch) {
        unproposed.push({ ...endpoint, reason: `LLM drafting failed: ${message.slice(0, 200)}` });
      }
    }
  }

  logger.info('[effect-map-backfill] run complete', {
    projectId,
    architectureId,
    unmapped: unmapped.length,
    readMappedSkipped: readMappedCount,
    derived: derived.length,
    derivedApplied: derivedApply?.applied ?? 0,
    provenRead: provenRead.length,
    provenReadApplied: provenReadApply?.applied ?? 0,
    proposals: proposals.length,
    unproposed: unproposed.length,
  });

  // Screenshot-friendly rollup: counts per stage + deduped broken targets.
  const byStage: Record<string, number> = {};
  const brokenCounts = new Map<string, number>();
  for (const entry of trace) {
    byStage[entry.stage] = (byStage[entry.stage] ?? 0) + 1;
    for (const broken of entry.broken_calls) {
      const target = broken.replace(/^.*?call to /, '').replace(/ unresolved.*$/, '');
      brokenCounts.set(target, (brokenCounts.get(target) ?? 0) + 1);
    }
  }
  const topBrokenTargets = [...brokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => `${symbol} (${count})`);

  return {
    unmapped_count: unmapped.length,
    summary: {
      unmapped_count: unproposed.length,
      by_stage: byStage,
      top_broken_targets: topBrokenTargets,
      read_mapped_count: readMappedCount,
      proven_read_count: provenRead.length,
    },
    derived,
    derived_apply: derivedApply,
    proven_read: provenRead,
    proven_read_apply: provenReadApply,
    proposals,
    unproposed,
    trace,
  };
}
