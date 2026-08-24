/**
 * Effect-candidate emission from the SCL corpus (2026-08-20 user ruling:
 * "truly one scan, one review, one save" — the code scan itself emits the
 * `endpoint_data_effects` candidates that close the compensation preflight's
 * effect-map gaps; the gateway backfill button remains the recovery path).
 *
 * Phase 1 — DETERMINISTIC (free), VERB-AGNOSTIC (2026-08-22 user ruling:
 * "old codebases don't obey REST and HTTP verb principles ... we just want
 * the full path from endpoint to database"): EVERY http-rooted endpoint
 * (any verb, GET included) and every internal entrypoint candidate carrying
 * `data.className`/`data.methodName` is matched to corpus roots
 * (longest-fragment discipline kills the /lookup vs /lookupStarred
 * substring trap; internal entries join by class#method) and its call
 * graph walked to boundary contracts. Edges are emitted from what the
 * reached SQL PROVES, never from the verb: write tables -> access_mode
 * 'write' (a writing GET gets a real effect map), read tables the same
 * endpoint does not write -> access_mode 'read'. Emitted as normal
 * candidates (the `mintProcCallEdgeCandidates` precedent) — the candidate
 * review is the human gate and save-back resolves names to ids, skipping
 * honestly when a name has no committed entity. Verbs remain an input ONLY
 * to the capture-preflight bookkeeping below (write maps are DEMANDED for
 * mutating verbs — fail-closed stays verb-scoped).
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
import { closeProcCatalog } from './sqlProcHarvester';
import type { SclBehaviourTable, SclBoundaryContract, SclContract } from './sclTypes';

// ---------------------------------------------------------------------------
// Pure helpers — mirrors of the gateway's annotation-pass / backfill helpers
// (producer/consumer mirroring is the established SCL convention).
// ---------------------------------------------------------------------------

const MUTATING_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HTTP_VERBS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']);

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

/**
 * Path fragment from the table's annotations — ALL @Path /
 * @RequestMapping-family values COMPOSED in order (2026-08-21: the extractor
 * prepends the class-level routing annotation, so a handler whose
 * method-level @Path is placeholders-only still yields a literal-bearing
 * fragment like `hierarchy/{date}/{id}` instead of no fragment at all).
 */
export function derivePathFragment(annotations: string[] | undefined): string | null {
  const text = annotationText(annotations);
  const re =
    /@(?:Path|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const part = m[1].replace(/^\/+|\/+$/g, '');
    if (part.length > 0) parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "Path CONTAINS the fragment", template-aware ({param} matches a segment). */
export function pathContainsFragment(fragment: string, path: string): boolean {
  const pattern = fragment.split(/\{[^}]*\}/).map(escapeRegExp).join('[^/]+');
  return new RegExp(pattern).test(path);
}

/**
 * A fragment with NO literal characters (`{businessDate}/{orgUnitId}`) turns
 * into "match any N segments" — it matches EVERYTHING and must never be used
 * as a root fragment (2026-08-20 diagnosis: every endpoint "matched" the
 * same two placeholder-only hierarchy roots).
 */
export function fragmentHasLiterals(fragment: string): boolean {
  return fragment.replace(/\{[^}]*\}/g, '').replace(/\//g, '').trim().length > 0;
}

/** `[dbo].[Orders]` / `"s"."t"` / `sch.t` -> bare table token. */
function bareTableToken(raw: string): string {
  const cleaned = raw.replace(/[[\]"`]/g, '').trim();
  return (cleaned.split('.').pop() ?? cleaned).trim();
}

const PROC_CALL_RE = /\{\s*(?:\?\s*=\s*)?call\s+([A-Za-z0-9_."\[\]$#]+)|\bexec(?:ute)?\s+([A-Za-z0-9_."\[\]$#]+)/gi;

/** Stored-proc names referenced by one verbatim SQL string
 *  (`{call dbo.sp_x(?)}` / `exec sp_x`) — surfaced in the boundary stats so
 *  proc-mediated writes are identifiable from a screenshot. */
export function parseProcCallsFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const found: string[] = [];
  PROC_CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PROC_CALL_RE.exec(sql)) !== null) {
    const token = bareTableToken((match[1] ?? match[2] ?? '').replace(/\(.*$/, ''));
    if (!token) continue;
    if (!found.some((t) => t.toLowerCase() === token.toLowerCase())) found.push(token);
  }
  return found;
}

const WRITE_SQL_PATTERNS: RegExp[] = [
  /\binsert\s+into\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\bupdate\s+([A-Za-z0-9_."\[\]$#]+)\s+set\b/gi,
  /\bdelete\s+from\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\bmerge\s+into\s+([A-Za-z0-9_."\[\]$#]+)/gi,
  /\btruncate\s+table\s+([A-Za-z0-9_."\[\]$#]+)/gi,
];

/** Sybase aliased delete: `delete <alias> from <table> <alias>, ...`. The
 *  plain `delete from X` form stays with WRITE_SQL_PATTERNS. */
const ALIASED_DELETE_RE = /\bdelete\s+([A-Za-z0-9_."\[\]$#]+)\s+from\b/gi;

/**
 * alias(lower) -> table for every `FROM <table> [as] <alias>` pair in the
 * string (comma lists included). Lets the write parser resolve the Sybase
 * ALIASED UPDATE/DELETE forms (`update tr set ... from org_registry tr`)
 * to the REAL table instead of recording the alias as a phantom table
 * (2026-08-24 shakedown: phantom alias writes rode proc catalogs into
 * effect candidates and were then BLOCKED at save as unknown entities).
 */
function fromAliasMap(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  walkFromClauses(sql, ({ table, alias }) => {
    if (!alias) return;
    const cleanTable = bareTableToken(table);
    if (!cleanTable) return;
    const key = alias.toLowerCase();
    if (!map.has(key)) map.set(key, cleanTable);
  });
  return map;
}

/** Distinct written-table tokens from one verbatim SQL string. */
export function parseWriteTablesFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const aliases = fromAliasMap(sql);
  const found: string[] = [];
  const push = (raw: string) => {
    const token = bareTableToken(raw);
    if (!token || token.startsWith('#') || token.startsWith('@')) return;
    // An update/delete target that is actually a FROM-list ALIAS resolves to
    // its real table; unknown tokens pass through unchanged.
    const resolved = aliases.get(token.toLowerCase()) ?? token;
    if (!found.some((t) => t.toLowerCase() === resolved.toLowerCase())) found.push(resolved);
  };
  for (const pattern of WRITE_SQL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      push(match[1]);
    }
  }
  ALIASED_DELETE_RE.lastIndex = 0;
  let deleteMatch: RegExpExecArray | null;
  while ((deleteMatch = ALIASED_DELETE_RE.exec(sql)) !== null) {
    // `delete from X` matches this shape with the token "from" -- that plain
    // form is already handled above.
    if (deleteMatch[1].toLowerCase() === 'from') continue;
    push(deleteMatch[1]);
  }
  return found;
}

const FROM_KEYWORD_RE = /\bfrom\s+/gi;
const JOIN_READ_RE = /\bjoin\s+([A-Za-z0-9_."\[\]$#]+)/gi;

/** Words that can follow a FROM-list table/alias and are never aliases. */
const FROM_LIST_STOP_WORDS = new Set([
  'where', 'group', 'order', 'having', 'union', 'join', 'inner', 'left',
  'right', 'outer', 'cross', 'full', 'on', 'set', 'select', 'and', 'or',
  'not', 'exists', 'when', 'then', 'else', 'end', 'for', 'while', 'if',
  'begin', 'insert', 'update', 'delete', 'values', 'into', 'from', 'with',
  'option', 'compute', 'at', 'holdlock', 'noholdlock', 'readpast',
  'readuncommitted', 'shared', 'return', 'goto', 'open', 'fetch', 'close',
  'deallocate', 'declare', 'print', 'raiserror', 'exec', 'execute', 'go',
]);

const FROM_TABLE_TOKEN_RE = /^[A-Za-z0-9_."\[\]$#@]+/;
const FROM_ALIAS_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Distinct READ-table tokens (FROM/JOIN targets, `DELETE FROM` excluded —
 * that's a write). Feeds the proven-read classification: a COMPLETE walk
 * whose boundaries only read is a POST-implemented query, not a mutation.
 *
 * The FROM clause is walked as a COMMA-SEPARATED LIST with optional aliases
 * (2026-08-23 shakedown: `from rule_fields f, rule_config r` — the classic
 * Sybase comma join — previously yielded only the first table, leaving
 * genuinely-read config tables looking untouched). The walk is conservative:
 * it stops at the first token that is not `<table> [alias] [,]`, so
 * subselects, hints, and clause keywords never get captured as tables.
 */
/** Walk every FROM clause comma list, reporting each `<table> [as]
 *  [alias]` pair (alias null when absent). `deleteFrom` marks the
 *  `DELETE FROM x` occurrence so read extraction can skip it. */
function walkFromClauses(
  sql: string,
  visit: (entry: { table: string; alias: string | null; deleteFrom: boolean }) => void,
): void {
  FROM_KEYWORD_RE.lastIndex = 0;
  let fromMatch: RegExpExecArray | null;
  while ((fromMatch = FROM_KEYWORD_RE.exec(sql)) !== null) {
    const before = sql.slice(Math.max(0, fromMatch.index - 12), fromMatch.index);
    const deleteFrom = /delete\s*$/i.test(before);
    let pos = fromMatch.index + fromMatch[0].length;
    // Walk `<table> [as] [alias] , <table> ...` until the list ends.
    for (;;) {
      const tableMatch = FROM_TABLE_TOKEN_RE.exec(sql.slice(pos));
      if (!tableMatch) break;
      const rawTable = tableMatch[0];
      if (FROM_LIST_STOP_WORDS.has(rawTable.toLowerCase())) break;
      pos += rawTable.length;
      pos += (/^\s*/.exec(sql.slice(pos)) as RegExpExecArray)[0].length;
      // Optional `as` keyword, then optional alias identifier.
      let alias: string | null = null;
      for (let aliasTurn = 0; aliasTurn < 2; aliasTurn += 1) {
        const aliasMatch = FROM_ALIAS_TOKEN_RE.exec(sql.slice(pos));
        if (!aliasMatch) break;
        const word = aliasMatch[0].toLowerCase();
        if (word !== 'as' && FROM_LIST_STOP_WORDS.has(word)) break;
        pos += aliasMatch[0].length;
        pos += (/^\s*/.exec(sql.slice(pos)) as RegExpExecArray)[0].length;
        if (word !== 'as') {
          alias = aliasMatch[0];
          break;
        }
      }
      visit({ table: rawTable, alias, deleteFrom });
      if (sql[pos] !== ',') break;
      pos += 1;
      pos += (/^\s*/.exec(sql.slice(pos)) as RegExpExecArray)[0].length;
    }
  }
}

export function parseReadTablesFromSql(sql: string | null | undefined): string[] {
  if (!sql) return [];
  const found: string[] = [];
  const push = (raw: string) => {
    const token = bareTableToken(raw);
    if (!token || token.startsWith('#') || token.startsWith('@')) return;
    if (!found.some((t) => t.toLowerCase() === token.toLowerCase())) found.push(token);
  };

  walkFromClauses(sql, ({ table, deleteFrom }) => {
    // `DELETE FROM x` is a write, not a read.
    if (deleteFrom) return;
    push(table);
  });

  JOIN_READ_RE.lastIndex = 0;
  let joinMatch: RegExpExecArray | null;
  while ((joinMatch = JOIN_READ_RE.exec(sql)) !== null) {
    push(joinMatch[1]);
  }
  return found;
}

interface CorpusIndex {
  tablesByKey: Map<string, SclBehaviourTable>;
  boundaryWritesByKey: Map<string, string[]>;
  boundaryReadsByKey: Map<string, string[]>;
  boundarySymbolByKey: Map<string, string>;
  /** Per-boundary SQL visibility (2026-08-21 diagnosis: a DAO with ops but
   *  no verbatim SQL means the SQL is INVISIBLE — dynamic / external JDBC —
   *  and nothing can be proven from it). `opNames` names the blind ops. */
  boundaryStatsByKey: Map<
    string,
    { ops: number; withSql: number; opNames: string[]; procs: string[] }
  >;
  /** Behaviour-table keys by `${methodName}/${arity}` (dispatch expansion). */
  tablesByNameArity: Map<string, string[]>;
  /** Behaviour-table keys by `${clsFqn}#${methodName}/${arity}` — the
   *  EXACT-class step of dispatch expansion (2026-08-21 Item 4: blind
   *  name matching could union unrelated classes that share a method
   *  name, polluting the effect map the specs are built from). */
  tablesByClassNameArity: Map<string, string[]>;
  /** Behaviour-table keys by method name alone (arity fallback). */
  tablesByName: Map<string, string[]>;
  /** Boundary keys by operation NAME (DAO methods; arity unknown on ops). */
  boundariesByOpName: Map<string, string[]>;
  /** Class FQNs with ANY corpus presence (table or boundary) — powers the
   *  unresolved-call diagnosis ("class absent from corpus" vs "no matching
   *  method on a present class"). */
  classFqnsInCorpus: Set<string>;
  /** Behaviour-table keys by `Cls#method` (FQN AND simple-name forms) — the
   *  internal-entrypoint join (candidates carry className/methodName). */
  tableKeysByClassMethod: Map<string, string[]>;
  /** Repo proc name -> transitively-closed tables (2026-08-23 harvest). */
  procTablesByName: Map<string, { writes: string[]; reads: string[] }>;
  /** Repo proc name -> nested proc calls (for transitive referenced-marking). */
  procCallsByName: Map<string, string[]>;
  /** Catalog size + which harvested procs no walked SQL ever referenced —
   *  manually-run procs (importVirtualNodes) surface here instead of vanishing. */
  procCatalogCount: number;
  httpRoots: Array<{ key: string; symbol: string; method: string; fragment: string }>;
}

export function indexCorpus(corpus: SclCorpus): CorpusIndex {
  const procTablesByName = closeProcCatalog(corpus.procCatalog ?? []);
  const procCallsByName = new Map<string, string[]>();
  for (const entry of corpus.procCatalog ?? []) {
    if (!procCallsByName.has(entry.name)) procCallsByName.set(entry.name, entry.procCalls);
  }
  const tablesByKey = new Map<string, SclBehaviourTable>();
  const boundaryWritesByKey = new Map<string, string[]>();
  const boundaryReadsByKey = new Map<string, string[]>();
  const boundarySymbolByKey = new Map<string, string>();
  const boundaryStatsByKey = new Map<
    string,
    { ops: number; withSql: number; opNames: string[]; procs: string[] }
  >();
  const tablesByNameArity = new Map<string, string[]>();
  const tablesByClassNameArity = new Map<string, string[]>();
  const tablesByName = new Map<string, string[]>();
  const boundariesByOpName = new Map<string, string[]>();
  const classFqnsInCorpus = new Set<string>();
  const tableKeysByClassMethod = new Map<string, string[]>();
  const httpRoots: CorpusIndex['httpRoots'] = [];
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };
  for (const entry of corpus.contracts) {
    const contract: SclContract = entry.contract;
    if (contract.kind === 'behaviour_table') {
      tablesByKey.set(contract.key, contract);
      const hash = contract.symbol.indexOf('#');
      if (hash >= 0) {
        // Symbols are `Cls#method(ParamTypes)` — strip the parameter list so
        // the index key matches expandDispatch's bare `name/arity` lookup
        // (2026-08-21 fix: the unstripped key made the expansion inert on
        // real corpora; fixture symbols without parens masked it).
        const afterHash = contract.symbol.slice(hash + 1);
        const paren = afterHash.indexOf('(');
        const methodName = paren >= 0 ? afterHash.slice(0, paren) : afterHash;
        classFqnsInCorpus.add(contract.symbol.slice(0, hash));
        push(tablesByNameArity, `${methodName}/${contract.signatureInputs.length}`, contract.key);
        push(
          tablesByClassNameArity,
          `${contract.symbol.slice(0, hash)}#${methodName}/${contract.signatureInputs.length}`,
          contract.key,
        );
        push(tablesByName, methodName, contract.key);
        const clsFqn = contract.symbol.slice(0, hash);
        push(tableKeysByClassMethod, `${clsFqn}#${methodName}`, contract.key);
        const simple = clsFqn.split('.').pop() ?? clsFqn;
        if (simple !== clsFqn) {
          push(tableKeysByClassMethod, `${simple}#${methodName}`, contract.key);
        }
      }
      const method = deriveHttpMethod(contract.annotations);
      const fragment = derivePathFragment(contract.annotations);
      // Placeholder-only fragments match EVERYTHING — never a usable root.
      if (method && fragment && fragmentHasLiterals(fragment)) {
        httpRoots.push({ key: contract.key, symbol: contract.symbol, method, fragment });
      }
    } else if (contract.kind === 'boundary') {
      const boundary = contract as SclBoundaryContract;
      const writes: string[] = [];
      const reads: string[] = [];
      let ops = 0;
      let withSql = 0;
      const opNames: string[] = [];
      const procs: string[] = [];
      for (const operation of boundary.operations ?? []) {
        ops++;
        if (operation.sqlVerbatim) withSql++;
        if (operation.name && opNames.length < 6) opNames.push(operation.name);
        for (const proc of parseProcCallsFromSql(operation.sqlVerbatim)) {
          if (!procs.some((p) => p.toLowerCase() === proc.toLowerCase())) procs.push(proc);
        }
        for (const table of parseWriteTablesFromSql(operation.sqlVerbatim)) {
          if (!writes.some((t) => t.toLowerCase() === table.toLowerCase())) writes.push(table);
        }
        for (const table of parseReadTablesFromSql(operation.sqlVerbatim)) {
          if (!reads.some((t) => t.toLowerCase() === table.toLowerCase())) reads.push(table);
        }
        if (operation.name) push(boundariesByOpName, operation.name, contract.key);
      }
      // Proc-body expansion (2026-08-23): the op SQL names the proc; the
      // harvested body names the tables (transitively closed).
      for (const proc of procs) {
        const closed = procTablesByName.get(proc.toLowerCase());
        if (!closed) continue;
        for (const table of closed.writes) {
          if (!writes.some((w) => w.toLowerCase() === table.toLowerCase())) writes.push(table);
        }
        for (const table of closed.reads) {
          if (!reads.some((r) => r.toLowerCase() === table.toLowerCase())) reads.push(table);
        }
      }
      boundaryWritesByKey.set(contract.key, writes);
      boundaryReadsByKey.set(contract.key, reads);
      boundaryStatsByKey.set(contract.key, { ops, withSql, opNames, procs });
      boundarySymbolByKey.set(contract.key, boundary.symbol);
      const boundaryHash = boundary.symbol.indexOf('#');
      classFqnsInCorpus.add(boundaryHash >= 0 ? boundary.symbol.slice(0, boundaryHash) : boundary.symbol);
    }
  }
  return {
    tablesByKey,
    boundaryWritesByKey,
    boundaryReadsByKey,
    boundarySymbolByKey,
    boundaryStatsByKey,
    tablesByNameArity,
    tablesByClassNameArity,
    tablesByName,
    boundariesByOpName,
    classFqnsInCorpus,
    tableKeysByClassMethod,
    procTablesByName,
    procCallsByName,
    procCatalogCount: (corpus.procCatalog ?? []).length,
    httpRoots,
  };
}

/** Word-boundary scan of a text for harvested proc names — catches proc
 *  dispatch assembled from constants/config where no `exec`/`{call}` syntax
 *  survives adjacent to the name. Catalog names are repo-specific, so the
 *  false-positive surface is tiny. */
export function procNamesReferenced(
  text: string,
  procTablesByName: Map<string, { writes: string[]; reads: string[] }>,
): string[] {
  if (procTablesByName.size === 0 || !text) return [];
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const name of procTablesByName.keys()) {
    const at = lower.indexOf(name);
    if (at < 0) continue;
    const before = at === 0 ? '' : lower[at - 1];
    const after = at + name.length >= lower.length ? '' : lower[at + name.length];
    const boundary = (c: string) => c === '' || !/[a-z0-9_]/.test(c);
    if (boundary(before) && boundary(after)) out.push(name);
  }
  return out;
}

export interface CallWalkResult {
  boundaries: string[];
  /** Behaviour-table keys the walk visited (for verbatim-row SQL scanning). */
  visitedTables: string[];
  /** Call sites NOTHING could resolve — where the chain truly broke. */
  brokenCalls: string[];
  /** Null-target calls resolved via name+arity dispatch expansion. */
  expandedCalls: string[];
  /** TRUE when the walk followed a `cache miss -> loader` bridge row —
   *  the read is cache-fronted in the legacy service (2026-08-23; feeds
   *  the `legacy_cache_strategy` foundations decision). */
  cacheBridgeCrossed: boolean;
}

/** Read a positive-integer cap override from the environment. */
function capFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Dispatch-expansion bounds (2026-08-24 cap policy: caps exist ONLY to stop
 *  pathological name-collision unions, never to ration ordinary fan-out —
 *  small arbitrary caps silently severed real chains twice on the live
 *  estate. Generous defaults, env-tunable, and every refusal message names
 *  the knob so on-machine tuning needs no code read.) */
const DISPATCH_EXPANSION_CAP = capFromEnv('HAIKAI_DISPATCH_CAP_UNKNOWN', 40);
/** KNOWN-receiver-class dispatch (a real interface/abstract with many
 *  implementations — the legacy criteria/visitor pattern) gets the most
 *  headroom: these candidates carry real type evidence. */
const KNOWN_CLASS_DISPATCH_CAP = capFromEnv('HAIKAI_DISPATCH_CAP_KNOWN', 120);
/** Per-root transitive-walk node bound (cycle safety, not rationing). */
const CHAIN_WALK_CAP = capFromEnv('HAIKAI_CHAIN_WALK_CAP', 2000);

/**
 * Resolve a null-target call symbol (`Cls#method(A,B)`) by name+arity across
 * the corpus — the corpus-side mirror of the assembler's deterministic
 * dispatch expansion (interface method -> project implementations). Returns
 * behaviour-table keys + boundary keys, or null when nothing / too many
 * candidates matched.
 */
function expandDispatch(
  targetSymbol: string,
  index: CorpusIndex,
): { tables: string[]; boundaries: string[] } | null {
  const hash = targetSymbol.indexOf('#');
  const paren = targetSymbol.indexOf('(', hash);
  if (hash < 0 || paren < 0) return null;
  const clsFqn = targetSymbol.slice(0, hash);
  const name = targetSymbol.slice(hash + 1, paren);
  const argsText = targetSymbol.slice(paren + 1, targetSymbol.lastIndexOf(')'));
  const arity = argsText.trim() === '' ? 0 : argsText.split(',').length;

  // Class-aware fallback ladder (2026-08-21 Item 4): EXACT class+name+arity
  // first; then name+arity across the corpus; blind NAME-ONLY matching is
  // reserved for `?`-class symbols (receiver unknown at scan time) — for a
  // KNOWN class an arity mismatch stays broken (loud) instead of unioning
  // unrelated classes into the effect map.
  let tables = index.tablesByClassNameArity.get(`${clsFqn}#${name}/${arity}`) ?? [];
  if (tables.length === 0) tables = index.tablesByNameArity.get(`${name}/${arity}`) ?? [];
  if (tables.length === 0 && clsFqn === '?') tables = index.tablesByName.get(name) ?? [];
  const boundaries = index.boundariesByOpName.get(name) ?? [];
  const total = tables.length + boundaries.length;
  const cap = clsFqn === '?' ? DISPATCH_EXPANSION_CAP : KNOWN_CLASS_DISPATCH_CAP;
  if (total === 0 || total > cap) return null;
  return { tables, boundaries };
}

/**
 * WHY a call could not be resolved OR expanded — one short clause appended
 * to the broken-call line (2026-08-21: the screenshot-diagnosis loop needs
 * the failure mode, not just the symbol).
 */
export function unresolvedReason(targetSymbol: string, index: CorpusIndex): string {
  const hash = targetSymbol.indexOf('#');
  const paren = targetSymbol.indexOf('(', hash);
  if (hash < 0 || paren < 0) return 'unparseable target symbol';
  const clsFqn = targetSymbol.slice(0, hash);
  const name = targetSymbol.slice(hash + 1, paren);
  const argsText = targetSymbol.slice(paren + 1, targetSymbol.lastIndexOf(')'));
  const arity = argsText.trim() === '' ? 0 : argsText.split(',').length;
  const total =
    (index.tablesByNameArity.get(`${name}/${arity}`) ?? []).length ||
    (index.tablesByName.get(name) ?? []).length + (index.boundariesByOpName.get(name) ?? []).length;
  const cap = clsFqn === '?' ? DISPATCH_EXPANSION_CAP : KNOWN_CLASS_DISPATCH_CAP;
  if (total > cap) {
    const knob = clsFqn === '?' ? 'HAIKAI_DISPATCH_CAP_UNKNOWN' : 'HAIKAI_DISPATCH_CAP_KNOWN';
    return `${total} name-matched candidates exceed the expansion cap ${cap} (raise ${knob} to widen)`;
  }
  if (clsFqn === '?') {
    return 'receiver type could not be determined at scan time (chained/ternary/array receiver)';
  }
  return index.classFqnsInCorpus.has(clsFqn)
    ? `class in corpus but no method named ${name}/${arity}`
    : 'target class has NO corpus presence (never sliced/reached)';
}

/** JDK-semantic method names that can never bear SQL: an UNRESOLVED call to
 *  one of these on an UNKNOWN (`?`) receiver is StringBuilder/Object plumbing
 *  (chained append/toString in logging helpers), not a lost effect chain.
 *  Recording them spammed EVERY endpoint's broken_calls with identical noise
 *  (2026-08-24 shakedown) and buried the load-bearing breaks. Known-receiver
 *  calls are NEVER suppressed -- only the `?#name(...)` form.  */
const INERT_UNKNOWN_RECEIVER_NAMES = new Set([
  'tostring', 'append', 'equals', 'hashcode', 'valueof', 'compareto',
  'charat', 'substring', 'indexof', 'trim', 'length', 'isempty', 'format',
  'close', 'flush', 'intern', 'concat', 'split', 'replace', 'tolowercase',
  'touppercase',
]);

export function isInertUnknownReceiverCall(targetSymbol: string): boolean {
  const hash = targetSymbol.indexOf('#');
  if (hash < 0 || targetSymbol.slice(0, hash) !== '?') return false;
  const paren = targetSymbol.indexOf('(', hash);
  if (paren < 0) return false;
  return INERT_UNKNOWN_RECEIVER_NAMES.has(targetSymbol.slice(hash + 1, paren).toLowerCase());
}

/** Transitive call walk from a root table to boundary keys: resolved targets
 * are followed directly; null targets go through dispatch expansion; only
 * calls NEITHER path resolves are recorded as broken (bounded, cycle-safe). */
export function walkCallGraph(
  rootKey: string,
  index: CorpusIndex,
  cap = CHAIN_WALK_CAP,
): CallWalkResult {
  const boundaries = new Set<string>();
  const brokenCalls: string[] = [];
  const expandedCalls: string[] = [];
  let cacheBridgeCrossed = false;
  const visited = new Set<string>();
  const queue = [rootKey];
  while (queue.length > 0 && visited.size < cap) {
    const key = queue.shift() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const table = index.tablesByKey.get(key);
    for (const row of table?.rows ?? []) {
      if (row.outcome.type !== 'call') continue;
      if (row.conditionVerbatim === 'cache miss -> loader') cacheBridgeCrossed = true;
      if (typeof row.outcome.targetKey !== 'string') {
        const expansion = expandDispatch(row.outcome.targetSymbol, index);
        if (expansion) {
          if (expandedCalls.length < 10) {
            expandedCalls.push(
              `${table?.symbol ?? key} -> ${row.outcome.targetSymbol} ` +
                `(expanded to ${expansion.tables.length + expansion.boundaries.length} impl(s))`,
            );
          }
          for (const t of expansion.tables) if (!visited.has(t)) queue.push(t);
          for (const b of expansion.boundaries) boundaries.add(b);
        } else if (
          brokenCalls.length < 10 &&
          !isInertUnknownReceiverCall(row.outcome.targetSymbol)
        ) {
          brokenCalls.push(
            `${table?.symbol ?? key}: call to ${row.outcome.targetSymbol} unresolved ` +
              `(${unresolvedReason(row.outcome.targetSymbol, index)})`,
          );
        }
        continue;
      }
      const target = row.outcome.targetKey;
      if (target.startsWith('Q-')) boundaries.add(target);
      else if (target.startsWith('T-') && !visited.has(target)) queue.push(target);
    }
  }
  return { boundaries: [...boundaries], visitedTables: [...visited], brokenCalls, expandedCalls, cacheBridgeCrossed };
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
  diagnosis: WalkDiagnosis;
}

export interface WalkDiagnosis {
  stage:
    | 'no_root_match'
    | 'chain_broken'
    | 'boundaries_without_write_sql'
    | 'boundaries_without_read_sql'
    | 'complete_walk_no_tables';
  matched_roots: string[];
  same_verb_root_fragments: string[];
  broken_calls: string[];
  boundaries_reached: string[];
}

/** A read-verb endpoint whose walk derived NO edges at all — the read-side
 *  mirror of `uncovered` (2026-08-22: GETs failed silently; "why did this
 *  GET derive nothing" must be answerable from the run JSON). */
export interface ReadUnderivedEndpoint {
  method: string;
  path: string;
  diagnosis: WalkDiagnosis;
}

/** ANY entrypoint whose walk hit unresolved calls — INCLUDING ones that
 *  still derived edges (2026-08-22 live diagnosis: every GET derived the
 *  shared boilerplate reads, then broke on its DOMAIN hop; zero-edge
 *  instruments saw nothing while 1338/1742 contracts sat unreachable).
 *  `emitted` = edges this endpoint DID derive, so partial-vs-total is
 *  visible at a glance. */
export interface ChainBreakEndpoint {
  endpointName: string;
  method: string;
  path: string;
  emitted: number;
  broken_calls: string[];
}

/** A write-verb endpoint whose COMPLETE walk proved it only reads. */
export interface ProvenReadEndpoint {
  method: string;
  path: string;
  readTables: string[];
}

export interface DeriveResult {
  candidates: DiscoveryCandidate[];
  uncovered: UncoveredWriteEndpoint[];
  /** POST-implemented queries proven read-only by a complete walk. */
  provenRead: ProvenReadEndpoint[];
  /** Distinct endpoints that emitted at least one READ edge. */
  readMapped: number;
  /** Internal entrypoints walked by class#method (names, capped 20). */
  internalWalked: string[];
  /** Internal entrypoints whose class#method has NO corpus presence
   *  (capped 10) — visible so batch chains never vanish silently. */
  internalUnmatched: string[];
  /** Read-verb endpoints that derived NOTHING, each with the staged walk
   *  diagnosis (capped 100). */
  readUnderived: ReadUnderivedEndpoint[];
  /** Every entrypoint (any verb, internal included) whose walk hit
   *  unresolved calls — even when edges still derived (capped 150). The
   *  summary's topBrokenTargets ranks these; this carries the per-endpoint
   *  detail. */
  chainBreaks: ChainBreakEndpoint[];
  /** Harvested repo procs (CREATE PROC bodies in `.sql` files). */
  procCatalogCount: number;
  /** Harvested procs NO walked SQL referenced — manually-run procs
   *  (importVirtualNodes) stay VISIBLE instead of vanishing (capped 15). */
  procsUnreferenced: string[];
  /** table(lower) -> caller-less proc names touching it (shakedown fix 2,
   *  2026-08-23): lets the foundations never-touched card say WHY a table
   *  is dark ("only touched by caller-less deployed procs X, Y") instead
   *  of leaving the operator to a forensic session. Capped 100 tables. */
  orphanProcTouchers: Record<string, string[]>;
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

function buildReadEffectCandidate(args: {
  runId: string;
  endpointName: string;
  table: string;
  /** 'scl_corpus_read_proof' (strict proven-read) or 'scl_corpus_read'. */
  derivation: string;
  detail: Record<string, unknown>;
}): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId: args.runId,
    candidateType: 'endpoint_data_effects',
    name: `${args.endpointName} → ${args.table} (read)`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      endpointName: args.endpointName,
      dataEntityName: args.table,
      access_mode: 'read',
      confidence: 0.9,
      path_metadata_json: { derivation: args.derivation, ...args.detail },
      relationshipType: 'uses_data',
      usesData: { accessType: 'read', dataIdentifier: args.table },
      _addedBy: 'scl-effect-candidate-emitter',
    },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

/** Everything one set of walked roots proves — shared by the HTTP and
 *  internal branches (identical boundary bookkeeping either way). */
function collectFromRootKeys(
  rootKeys: string[],
  index: CorpusIndex,
): {
  writeTables: string[];
  readTables: string[];
  brokenCalls: string[];
  boundariesReached: string[];
  boundariesFullyVisible: boolean;
  procSeen: boolean;
  cacheBridgeCrossed: boolean;
} {
  const writeTables: string[] = [];
  const readTables: string[] = [];
  const brokenCalls: string[] = [];
  const boundariesReached: string[] = [];
  let boundariesFullyVisible = true;
  let procSeen = false;
  let cacheBridgeCrossed = false;
  const pushTable = (into: string[], table: string) => {
    if (!into.some((x) => x.toLowerCase() === table.toLowerCase())) into.push(table);
  };
  for (const rootKey of rootKeys) {
    const walk = walkCallGraph(rootKey, index);
    if (walk.cacheBridgeCrossed) cacheBridgeCrossed = true;
    // Inline-SQL + proc-dispatch scan (2026-08-23): terminal row verbatims of
    // WALKED tables can carry SQL the boundary plane never sees — inline
    // JDBC in service classes, and proc names assembled from constants
    // (config-sql rows). Tables parse directly; proc references expand
    // through the harvested catalog.
    for (const walkedKey of walk.visitedTables) {
      const table = index.tablesByKey.get(walkedKey);
      for (const row of table?.rows ?? []) {
        if (row.outcome.type !== 'terminal') continue;
        const verbatim = row.outcome.verbatim ?? '';
        for (const w of parseWriteTablesFromSql(verbatim)) pushTable(writeTables, w);
        for (const r of parseReadTablesFromSql(verbatim)) pushTable(readTables, r);
        for (const proc of procNamesReferenced(verbatim, index.procTablesByName)) {
          const closed = index.procTablesByName.get(proc);
          if (!closed) continue;
          for (const w of closed.writes) pushTable(writeTables, w);
          for (const r of closed.reads) pushTable(readTables, r);
        }
      }
    }
    for (const broken of walk.brokenCalls) {
      if (brokenCalls.length < 10 && !brokenCalls.includes(broken)) brokenCalls.push(broken);
    }
    for (const boundaryKey of walk.boundaries) {
      const stats = index.boundaryStatsByKey.get(boundaryKey);
      if (!stats || stats.withSql < stats.ops) boundariesFullyVisible = false;
      if (stats && stats.procs.length > 0) procSeen = true;
      const boundaryReads = index.boundaryReadsByKey.get(boundaryKey) ?? [];
      const boundaryWrites = index.boundaryWritesByKey.get(boundaryKey) ?? [];
      const blindOps =
        stats && stats.withSql === 0 && stats.opNames.length > 0
          ? `; blind ops: ${stats.opNames.join(', ')}`
          : '';
      const procNote =
        stats && stats.procs.length > 0 ? `; procs: ${stats.procs.join(', ')}` : '';
      const symbol =
        (index.boundarySymbolByKey.get(boundaryKey) ?? boundaryKey) +
        (stats
          ? ` (ops ${stats.ops}, sql ${stats.withSql}, reads ${boundaryReads.length}, writes ${boundaryWrites.length}${blindOps}${procNote})`
          : '');
      if (!boundariesReached.includes(symbol)) boundariesReached.push(symbol);
      for (const table of boundaryWrites) {
        if (!writeTables.some((w) => w.toLowerCase() === table.toLowerCase())) {
          writeTables.push(table);
        }
      }
      for (const table of boundaryReads) {
        if (!readTables.some((r) => r.toLowerCase() === table.toLowerCase())) {
          readTables.push(table);
        }
      }
    }
  }
  return { writeTables, readTables, brokenCalls, boundariesReached, boundariesFullyVisible, procSeen, cacheBridgeCrossed };
}

/**
 * Derives corpus-backed effect candidates for THIS RUN's endpoints —
 * VERB-AGNOSTIC (2026-08-22): every HTTP endpoint (any verb) and every
 * internal entrypoint with `data.className`/`data.methodName` is walked;
 * edges come from what the reached SQL proves. Mined effect candidates are
 * never DUPLICATED (per-edge dedup) but the corpus ADDS edges alongside
 * them — chains are truth, mining is a head start. Verbs still rule the
 * capture-preflight bookkeeping only: `uncovered` (write maps demanded)
 * and `provenRead` (write-verb exemptions) stay mutating-verb-scoped.
 */
export function deriveCorpusEffectCandidates(args: {
  corpus: SclCorpus;
  runId: string;
  runCandidates: DiscoveryCandidate[];
}): DeriveResult {
  const index = indexCorpus(args.corpus);

  const existingEdges = new Set<string>(); // `${endpoint}|${table}|${mode}`
  const minedWriteCovered = new Set<string>();
  for (const candidate of args.runCandidates) {
    if (candidate.candidateType !== 'endpoint_data_effects') continue;
    const data = candidate.data as Record<string, unknown> | undefined;
    const name = normName(data?.endpointName);
    if (!name) continue;
    const table = normName(data?.dataEntityName);
    const mode = normName(data?.access_mode) || 'write';
    if (mode === 'write') minedWriteCovered.add(name);
    if (table) existingEdges.add(`${name}|${table}|${mode}`);
  }

  const candidates: DiscoveryCandidate[] = [];
  const uncovered: UncoveredWriteEndpoint[] = [];
  const provenRead: ProvenReadEndpoint[] = [];
  const readMappedEndpoints = new Set<string>();
  const internalWalked: string[] = [];
  const internalUnmatched: string[] = [];
  const readUnderived: ReadUnderivedEndpoint[] = [];
  const chainBreaks: ChainBreakEndpoint[] = [];
  // A proc is "referenced" when walked SQL names it OR a referenced proc
  // execs it (transitively) — only genuinely orphaned procs (importVirtualNodes)
  // stay on the unreferenced list.
  const referencedProcs = new Set<string>();
  const markReferenced = (name: string): void => {
    const lower = name.toLowerCase();
    if (referencedProcs.has(lower) || !index.procTablesByName.has(lower)) return;
    referencedProcs.add(lower);
    for (const nested of index.procCallsByName.get(lower) ?? []) markReferenced(nested);
  };
  for (const [, stats] of index.boundaryStatsByKey) {
    for (const proc of stats.procs) markReferenced(proc);
  }

  const recordChainBreaks = (
    endpointName: string,
    method: string,
    path: string,
    emitted: number,
    brokenCalls: string[],
  ) => {
    if (brokenCalls.length === 0 || chainBreaks.length >= 150) return;
    chainBreaks.push({ endpointName, method, path, emitted, broken_calls: brokenCalls });
  };

  const walkDiagnosis = (
    roots: Array<{ symbol: string; fragment: string }>,
    collected: ReturnType<typeof collectFromRootKeys>,
    method: string,
    sqlStage: 'boundaries_without_write_sql' | 'boundaries_without_read_sql',
  ): WalkDiagnosis => ({
    stage:
      roots.length === 0
        ? 'no_root_match'
        : collected.brokenCalls.length > 0 && collected.boundariesReached.length === 0
          ? 'chain_broken'
          : collected.boundariesReached.length > 0
            ? sqlStage
            : 'complete_walk_no_tables',
    matched_roots: roots.map((r) => `${r.symbol} [fragment "${r.fragment}"]`),
    same_verb_root_fragments:
      roots.length === 0
        ? index.httpRoots
            .filter((r) => r.method.toUpperCase() === method)
            .map((r) => r.fragment)
            .slice(0, 15)
        : [],
    broken_calls: collected.brokenCalls,
    boundaries_reached: collected.boundariesReached,
  });

  const emitWrite = (endpointName: string, table: string, detail: Record<string, unknown>) => {
    const edge = `${normName(endpointName)}|${normName(table)}|write`;
    if (existingEdges.has(edge)) return;
    existingEdges.add(edge);
    candidates.push(
      buildEffectCandidate({
        runId: args.runId,
        endpointName,
        table,
        confidence: 0.9,
        source: 'scl_corpus',
        detail,
      }),
    );
  };
  const emitRead = (
    endpointName: string,
    table: string,
    derivation: string,
    detail: Record<string, unknown>,
  ) => {
    const edge = `${normName(endpointName)}|${normName(table)}|read`;
    if (existingEdges.has(edge)) return;
    existingEdges.add(edge);
    readMappedEndpoints.add(normName(endpointName));
    candidates.push(
      buildReadEffectCandidate({ runId: args.runId, endpointName, table, derivation, detail }),
    );
  };

  for (const endpointCandidate of args.runCandidates) {
    if (endpointCandidate.candidateType !== 'endpoints') continue;
    const data = endpointCandidate.data as Record<string, unknown> | undefined;
    const method = readMethod(endpointCandidate);
    const path = readPathTemplate(endpointCandidate);

    if (method && path && HTTP_VERBS.has(method)) {
      const matched = index.httpRoots.filter(
        (root) => root.method.toUpperCase() === method && pathContainsFragment(root.fragment, path),
      );
      const maxLength = matched.reduce((max, r) => Math.max(max, r.fragment.length), 0);
      const roots = matched.filter((r) => r.fragment.length === maxLength);
      const collected = collectFromRootKeys(roots.map((r) => r.key), index);
      const detail = {
        roots: roots.map((r) => r.symbol).slice(0, 3),
        ...(collected.cacheBridgeCrossed ? { via_legacy_cache: true } : {}),
      };

      const emittedBefore = candidates.length;
      for (const table of collected.writeTables) {
        emitWrite(endpointCandidate.name, table, detail);
      }
      const provenReadOnly =
        collected.writeTables.length === 0 &&
        roots.length > 0 &&
        collected.brokenCalls.length === 0 &&
        collected.readTables.length > 0 &&
        collected.boundariesFullyVisible &&
        !collected.procSeen;
      for (const table of collected.readTables) {
        if (collected.writeTables.some((w) => w.toLowerCase() === table.toLowerCase())) continue;
        emitRead(
          endpointCandidate.name,
          table,
          provenReadOnly ? 'scl_corpus_read_proof' : 'scl_corpus_read',
          detail,
        );
      }

      recordChainBreaks(
        endpointCandidate.name,
        method,
        path,
        candidates.length - emittedBefore,
        collected.brokenCalls,
      );

      // Capture-preflight bookkeeping — verb-scoped by DESIGN (write maps
      // are demanded for mutating verbs; a GET is never "uncovered"). A
      // read-verb endpoint that derived NOTHING records the same staged
      // diagnosis under `readUnderived` instead of failing silently.
      if (!MUTATING_VERBS.has(method)) {
        if (
          collected.writeTables.length === 0 &&
          collected.readTables.length === 0 &&
          readUnderived.length < 100
        ) {
          readUnderived.push({
            method,
            path,
            diagnosis: walkDiagnosis(roots, collected, method, 'boundaries_without_read_sql'),
          });
        }
        continue;
      }
      if (minedWriteCovered.has(normName(endpointCandidate.name))) continue;
      if (collected.writeTables.length > 0) continue;
      if (provenReadOnly) {
        provenRead.push({ method, path, readTables: collected.readTables });
        continue;
      }
      uncovered.push({
        endpointCandidate,
        method,
        path,
        rootKeys: roots.map((r) => r.key),
        diagnosis: walkDiagnosis(roots, collected, method, 'boundaries_without_write_sql'),
      });
      continue;
    }

    // INTERNAL entrypoint (no usable HTTP verb): join by class#method —
    // batch mains / scheduled / listener candidates carry className +
    // methodName; their chains reach the SAME boundary analysis.
    const className = typeof data?.className === 'string' ? data.className : '';
    const methodName = typeof data?.methodName === 'string' ? data.methodName : '';
    if (!className || !methodName) continue;
    const keys = index.tableKeysByClassMethod.get(`${className}#${methodName}`) ?? [];
    if (keys.length === 0) {
      if (internalUnmatched.length < 10) internalUnmatched.push(`${className}#${methodName}`);
      continue;
    }
    if (internalWalked.length < 20) internalWalked.push(endpointCandidate.name);
    const collected = collectFromRootKeys(keys, index);
    const detail = {
      roots: keys.slice(0, 3),
      internal_entry: `${className}#${methodName}`,
      ...(collected.cacheBridgeCrossed ? { via_legacy_cache: true } : {}),
    };
    const emittedBefore = candidates.length;
    for (const table of collected.writeTables) {
      emitWrite(endpointCandidate.name, table, detail);
    }
    for (const table of collected.readTables) {
      if (collected.writeTables.some((w) => w.toLowerCase() === table.toLowerCase())) continue;
      emitRead(endpointCandidate.name, table, 'scl_corpus_read', detail);
    }
    recordChainBreaks(
      endpointCandidate.name,
      'INTERNAL',
      `${className}#${methodName}`,
      candidates.length - emittedBefore,
      collected.brokenCalls,
    );
  }

  const procsUnreferenced = [...index.procTablesByName.keys()]
    .filter((name) => !referencedProcs.has(name))
    .sort()
    .slice(0, 60);
  const orphanProcTouchers: Record<string, string[]> = {};
  for (const [procName, tables] of index.procTablesByName) {
    if (referencedProcs.has(procName)) continue;
    for (const table of [...tables.writes, ...tables.reads]) {
      const key = table.toLowerCase();
      const list = (orphanProcTouchers[key] ??= []);
      if (!list.includes(procName)) list.push(procName);
    }
  }
  for (const key of Object.keys(orphanProcTouchers)) orphanProcTouchers[key].sort();
  // Deterministic cap: keep the alphabetically-first 100 tables.
  const cappedOrphanTouchers = Object.fromEntries(
    Object.keys(orphanProcTouchers)
      .sort()
      .slice(0, 100)
      .map((k) => [k, orphanProcTouchers[k]]),
  );
  return {
    candidates,
    uncovered,
    provenRead,
    readMapped: readMappedEndpoints.size,
    internalWalked,
    internalUnmatched,
    readUnderived,
    chainBreaks,
    procCatalogCount: index.procCatalogCount,
    procsUnreferenced,
    orphanProcTouchers: cappedOrphanTouchers,
  };
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
// Compact summary (2026-08-20: screenshot-friendly — counts + deduped tops,
// never per-endpoint repetition)
// ---------------------------------------------------------------------------

export function summarizeEmission(
  derive: DeriveResult,
  propose: ProposeResult,
): Record<string, unknown> {
  const byStage: Record<string, number> = {};
  const readUnderivedByStage: Record<string, number> = {};
  const brokenCounts = new Map<string, number>();
  const countBroken = (calls: string[] | undefined) => {
    for (const broken of calls ?? []) {
      // Aggregate by the TARGET symbol (after 'call to '), not the caller.
      const target = broken.replace(/^.*?call to /, '').replace(/ unresolved$/, '');
      brokenCounts.set(target, (brokenCounts.get(target) ?? 0) + 1);
    }
  };
  for (const item of propose.unproposed) {
    const stage = item.diagnosis?.stage ?? 'unknown';
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }
  for (const item of derive.readUnderived) {
    readUnderivedByStage[item.diagnosis.stage] =
      (readUnderivedByStage[item.diagnosis.stage] ?? 0) + 1;
  }
  // chainBreaks covers EVERY walked entrypoint with unresolved calls —
  // including partially-derived ones — so it is the single ranking source
  // (aggregating unproposed/readUnderived too would double-count them).
  for (const item of derive.chainBreaks) {
    countBroken(item.broken_calls);
  }
  const topBrokenTargets = [...brokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => `${symbol} (${count})`);
  return {
    derivedWriteCandidates: derive.candidates.filter(
      (c) => (c.data as Record<string, unknown>).access_mode === 'write',
    ).length,
    derivedReadCandidates: derive.candidates.filter(
      (c) => (c.data as Record<string, unknown>).access_mode === 'read',
    ).length,
    readMappedEndpointCount: derive.readMapped,
    readUnderivedCount: derive.readUnderived.length,
    readUnderivedByStage,
    chainBreakCount: derive.chainBreaks.length,
    partialChainCount: derive.chainBreaks.filter((c) => c.emitted > 0).length,
    internalWalkedCount: derive.internalWalked.length,
    internalUnmatched: derive.internalUnmatched,
    procCatalogCount: derive.procCatalogCount,
    procsUnreferenced: derive.procsUnreferenced,
    provenReadEndpoints: derive.provenRead.map((p) => `${p.method} ${p.path}`),
    llmProposed: propose.candidates.length,
    llmCalls: propose.llmCalls,
    unproposedByStage: byStage,
    topBrokenTargets,
  };
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
