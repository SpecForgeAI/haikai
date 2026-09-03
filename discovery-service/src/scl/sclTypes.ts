/**
 * SCL (Structural Contract Language) — contract type definitions.
 *
 * SCL is the neutral structural language the deterministic Java slicer
 * projects legacy source into: "structured behaviour table: neutral skeleton,
 * verbatim semantics". The corpus is a DAG of contracts:
 *
 *   - `[T-...]` behaviour tables — one per method; rows = branches in
 *     evaluation order with VERBATIM conditions/outcomes + file:line cites.
 *   - `[S-...]` shape contracts — one per project type; normative field
 *     names / kinds / nullability / wire names.
 *   - `[Q-...]` boundary contracts — DAOs / repos / external clients with
 *     verbatim SQL; extraction stops here.
 *
 * All ids are content-hashed (deterministic, key-sorted JSON → sha256).
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md.
 */

import { createHash } from 'node:crypto';

/** A file:line citation into the scanned source tree. `line` is 1-based. */
export interface SclSourceRef { path: string; line: number; }

/**
 * One labelled element of a method's public outcome signature: a value class,
 * a thrown exception, or a side effect. Callers reference these LABELS, never
 * the callee's internals.
 */
export interface SclOutcome { label: string; kind: 'value' | 'throws' | 'effect'; detail?: string | null; }

/**
 * What a behaviour-table row RESOLVES to:
 *   - 'terminal': a verbatim return/throw at a cite, labelled into the
 *     enclosing table's outcome signature.
 *   - 'call': delegation to another table (by contract key when resolved;
 *     `targetKey` null when the callee is outside the corpus).
 *   - 'absorb': a catch row absorbing a callee `throws:` outcome, with the
 *     verbatim handler consequence.
 */
export type SclRowOutcome =
  | { type: 'terminal'; verbatim: string; ref: SclSourceRef; outcomeLabel: string }
  | {
      type: 'call';
      targetKey: string | null;
      targetSymbol: string;
      /**
       * Multi-candidate dispatch (2026-09-03): every implementation's contract
       * key when an interface / abstract-class call resolves to MORE than one
       * project implementation. Ordered with the DI-wired primary first when
       * the receiver field carries a `@Qualifier("...")` naming one of them
       * (then `targetKey` is that primary's key); otherwise `targetKey` stays
       * null and all candidates are carried. Pre-fix the expansion was
       * computed for closure and discarded, so 95 rows rendered UNRESOLVED
       * while both implementations sat in the corpus.
       */
      targetKeys?: string[];
      /** The candidate implementation method symbols (extractor-side). */
      candidateSymbols?: string[];
      /** The DI-wired candidate symbol, when a `@Qualifier` names it. */
      primarySymbol?: string | null;
      /**
       * Verbatim call-site arguments (2026-09-03, DETAIL-02): the literal /
       * expression text of each argument, with a bare identifier that names a
       * `static final` constant of the calling class rendered as
       * `NAME = <initializer>`. The callee signature alone hid the behaviour:
       * `getHierarchyLoadDatesFor(String,boolean)` says nothing, the call
       * `("Hierarchy_Loaded", false)` selects the feed and suppresses a cache
       * refresh.
       */
      args?: string[];
    }
  | { type: 'absorb'; exceptionType: string; thenVerbatim: string; ref: SclSourceRef; outcomeLabel: string };

/**
 * One row of a behaviour table. Rows are the unit, never paths (rows are
 * locally true regardless of path feasibility). Rows appear in evaluation
 * order; `gloss` is the optional LLM prose annotation (guarded, never
 * authoritative).
 */
export interface SclRow {
  index: number;
  kind: 'branch' | 'catch' | 'dispatch' | 'loop' | 'terminal';
  conditionVerbatim: string | null;
  conditionRef: SclSourceRef | null;
  outcome: SclRowOutcome;
  gloss?: string | null;
}

/**
 * `[T-...]` behaviour table — one per method. `references` lists the contract
 * keys of every callee / shape this table cites; `annotations` carries the
 * verbatim annotation text on the method (aspect/effect facts are resolved
 * from these once per codebase).
 */
export interface SclBehaviourTable {
  key: string; kind: 'behaviour_table';
  symbol: string; sourcePath: string; startLine: number;
  signatureInputs: Array<{ name: string; typeRef: string }>;
  outcomeSignature: SclOutcome[];
  rows: SclRow[];
  references: string[];
  annotations: string[];
  contentHash: string;
  /**
   * Cache-fronting facts (2026-09-03, spec-quality review BEHAV-03): present
   * when the table's class reads through an in-process cache field. A warm
   * cache means NO database access; a miss loads whatever the loader loads;
   * writes are process-local until invalidated — behaviour a target built
   * from the rows alone would silently change.
   */
  cacheFacts?: SclCacheFacts;
  /**
   * Aspects advising this method (BEHAV-04): annotation-driven advice whose
   * pointcut names an annotation this method carries. The advice's own
   * contract (when it is a table) is also added to `references` so its data
   * effects reach every advised endpoint.
   */
  advisedBy?: SclAdvice[];
  /**
   * Data-derived authorisation (BEHAV-05): rows whose condition is an
   * authorisation predicate and/or whose outcome is a permission denial,
   * plus the boundary contracts (DAO SQL) this table reaches — the tables
   * those predicates read ARE the access-control list.
   */
  authorisation?: SclAuthorisationFacts;
}

/**
 * One field of a shape contract. `kind` is a neutral semantic kind ('string',
 * 'int64', 'date', 'list<...>', 'ref:<S-key>', 'opaque:<carrier>', ...);
 * `sourceCarrier` retains the verbatim legacy type as evidence when the kind
 * is a neutral abstraction of it. `wireName` is the serialized name where the
 * field crosses the wire under a different name.
 */
export interface SclShapeField {
  name: string; kind: string; nullable: boolean | null;
  wireName: string | null; sourceCarrier: string | null; notes: string[];
}

/**
 * `[S-...]` shape contract — one per project type. Normative: field names,
 * recursive kinds, nullability, wire names. Non-normative: `representation`
 * ('pojo' | 'immutable' | 'enum' — POJO→record conversion is OK unless
 * flagged). Deterministic flags: 'mutated_in_flight' (setter after
 * construction — record-conversion hazard), 'sealed_variant_candidate'
 * (project subclasses exist; discriminator normative when present).
 */
export interface SclShapeContract {
  key: string; kind: 'shape';
  symbol: string; sourcePath: string;
  representation: string;
  fields: SclShapeField[];
  wireFacts: { xmlRootName: string | null; discriminator: string | null };
  flags: string[];
  references: string[];
  contentHash: string;
}

/** One boundary operation: verbatim SQL (or derived-query name) + result shape. */
export interface SclBoundaryOperation {
  name: string;
  sqlVerbatim: string | null;
  ref: SclSourceRef | null;
  resultShape: string | null;
  /** Boundary `Fqn#method` targets this operation delegates to (DAO->DAO:
   *  FilterDaoImpl.addFilter -> SequenceDao.getNext). The walk cannot enter
   *  a boundary, so without this the delegate's tables are unreachable
   *  from any endpoint (Kiro 2026-08-24 issue A). */
  delegatesTo?: string[];
}

/** `[Q-...]` boundary contract — repos/DAOs/external clients. Extraction stops here. */
export interface SclBoundaryContract { key: string; kind: 'boundary'; symbol: string; sourcePath: string; operations: SclBoundaryOperation[]; contentHash: string; }

export type SclContract = SclBehaviourTable | SclShapeContract | SclBoundaryContract;

/**
 * A deterministic finding raised during slicing or corpus assembly:
 *   - 'dispatch_ambiguity': unresolvable dynamic dispatch (2+ DI implementations).
 *   - 'complexity_truncated': a complexity-budget truncation (LOUD, never silent).
 *   - 'parse_error': a file the parser could not read.
 *   - 'unresolved_calls': ONE aggregated corpus-assembly finding counting every
 *     call/dispatch row whose targetKey is null (up to 10 sites listed in
 *     `candidates`, total in `detail`).
 *   - 'near_duplicate_cluster': deterministic near-duplicate detection over
 *     behaviour tables (identical normalized row sequences); members listed in
 *     `candidates`. Never auto-merged — the merge/keep call is a DECISION.
 */
export interface SclFinding { kind: 'dispatch_ambiguity' | 'complexity_truncated' | 'parse_error' | 'unresolved_calls' | 'near_duplicate_cluster' | 'proc_repo_drift' | 'proc_live_only' | 'proc_repo_duplicate' | 'proc_repo_only' | 'aspect_pointcut_unresolved' | 'data_derived_authorisation'; symbol: string; detail: string; candidates?: string[]; }

/** Cache-fronting facts on a behaviour table (BEHAV-03). */
export interface SclCacheFacts {
  /** The cache field on the owning class, e.g. `hierarchyCache`. */
  cacheField: string;
  /** The field's declared type verbatim, e.g. `LoadingCache<LocalDate, HierarchyCacheIndex>`. */
  cacheType: string;
  /** Key / value type texts parsed from the generic, when present. */
  keyType: string | null;
  valueType: string | null;
  /** What a MISS loads: the call targets of the table's cache-bridge rows. */
  missLoads: string[];
  /** Methods of the owning class that mutate the cache (put / invalidate / refresh / remove / clear). */
  mutators: Array<{ symbol: string; operations: string[] }>;
}

/** One advice applied to a method (BEHAV-04). */
export interface SclAdvice {
  /** Advice method symbol `pkg.Aspect#advice(...)`. */
  aspectSymbol: string;
  /** `@Around` / `@Before` / `@After` / `@AfterReturning` / `@AfterThrowing`. */
  adviceKind: string;
  /** Verbatim pointcut expression. */
  pointcut: string;
  /** The advice method's own contract key when it is a table, else null. */
  targetKey: string | null;
}

/** Data-derived authorisation facts on a behaviour table (BEHAV-05). */
export interface SclAuthorisationFacts {
  /** Verbatim conditions that read as authorisation predicates. */
  predicates: string[];
  /** Outcome labels that read as permission denials. */
  deniedOutcomes: string[];
  /** Boundary (Q-) contract keys this table references — the tables the predicates read. */
  boundaryKeys: string[];
}

// ---------------------------------------------------------------------------
// Deterministic serialization + content-hashed keys
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * EVERY depth, arrays keep their order, `undefined` object entries are omitted
 * (matching JSON.stringify). The same logical value always yields the same
 * string, regardless of property insertion order — this is the canonical form
 * every SCL content hash is computed over.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return JSON.stringify(value);
  if (t === 'string') return JSON.stringify(value);
  if (t === 'undefined') return 'null'; // only reachable inside arrays (JSON.stringify parity)
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(',')}}`;
  }
  // functions / symbols / bigints have no place in a contract body — refuse
  // loudly rather than hash something non-portable.
  throw new Error(`stableStringify: unsupported value type '${t}'`);
}

function sha256hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Content-hashed contract key: `<prefix>-<first 12 hex chars of
 * sha256(stableStringify(canonicalBody))>`. The canonical body MUST exclude
 * the key field itself (the hash cannot depend on its own result).
 *
 * Prefixes: 'T' behaviour table, 'S' shape, 'Q' boundary, 'F' shared fragment.
 */
export function contractKey(prefix: 'T' | 'S' | 'Q' | 'F', canonicalBody: unknown): string {
  return `${prefix}-${sha256hex(stableStringify(canonicalBody)).slice(0, 12)}`;
}

/**
 * Full sha256 hex of the canonical body — used for `contentHash` fields.
 * Same input discipline as {@link contractKey}: the body excludes the key and
 * the contentHash fields themselves.
 */
export function contentHashOf(canonicalBody: unknown): string {
  return sha256hex(stableStringify(canonicalBody));
}
