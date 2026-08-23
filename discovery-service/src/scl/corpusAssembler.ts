/**
 * SCL corpus assembler — roots, closure, fan-in, near-dup clustering, and the
 * class-level reachability report over a deterministic slice.
 *
 * Pure + deterministic: `assembleCorpus(slice)` is a synchronous function of
 * its input — same slice, byte-identical `stableStringify(corpus)`. No I/O,
 * no timing, no randomness; everything sorted.
 *
 * ROOT DETECTION is generic and application-agnostic (design ruling
 * 2026-08-18 round 2: the tool serves ALL migrations, NEVER hardcode one
 * app's trigger idioms). Built-in detectors:
 *
 *   - external: behaviour tables whose method (or declaring class)
 *     annotations carry an HTTP verb/path annotation (JAX-RS + Spring MVC
 *     names, matched on annotation NAME only, arguments ignored).
 *   - internal (a): `public static void main` methods — detected from the
 *     INDEX (not the tables), so a trivial `main` that was inline-suppressed
 *     still roots its class (and stays out of the orphan report).
 *   - internal (b): `@Scheduled` on the method or class.
 *   - internal (c): the generic framework-invoked heuristic — a class that
 *     implements/extends a type NOT in the project index AND has a public
 *     no-arg run()/execute()/call() method; every table of the class roots.
 *   - internal (d): classes mentioned in resource/config files
 *     (`slice.index.configReferences`) — config-wired. When such a class has
 *     no tables (all methods inlined), the class FQN itself is recorded as
 *     the root symbol so the wiring is visible and the class is excluded
 *     from the orphan report.
 *
 * The {@link RootDetector} type + `extraDetectors` / `extraRoots` options are
 * the extension seam for future per-framework detectors and AMS-registered
 * internal entrypoints.
 *
 * CLOSURE: BFS from each root's contract over the reference edges — table
 * `references` (resolved T-/Q-/S-keys), shape `references`, boundary
 * operations' S-keyed result shapes — PLUS deterministic dispatch expansion:
 * a call/dispatch row whose targetKey is null but whose targetSymbol is an
 * interface method expands to every project implementation's table. The
 * interface + implementation CLASSES count as closure-reached (they are
 * genuinely part of the corpus even when an impl method was inline-trivial).
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md
 * ("Corpus" + "Rulings round 2" — reachability report v1).
 */

import type { JavaClassInfo, JavaMethodInfo, JavaProjectIndex, SyntaxNode } from './javaProjectIndex';
import type { SclSliceResult } from './slicer';
import type { SclBehaviourTable, SclContract, SclFinding } from './sclTypes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One corpus root: an external endpoint or an internal entrypoint. */
export interface SclRoot {
  kind: 'external' | 'internal';
  /** Method symbol (`fqn#name(params)`) — or a class FQN for a config-wired
   *  class whose methods were all inline-suppressed. */
  symbol: string;
  /** Which detector fired, with its evidence (e.g. `http_annotation:@GET`,
   *  `framework_invoked:Runnable`, `config_referenced:beans.xml`). */
  detail: string;
}

/** One contract of the corpus, wrapped with its closure/fan-in metadata. */
export interface SclCorpusContract {
  /** The contract body itself (behaviour table / shape / boundary). */
  contract: SclContract;
  kind: SclContract['kind'];
  contractKey: string;
  sourcePath: string;
  sourceSymbol: string;
  contentHash: string;
  /** Distinct roots whose closure reaches this contract (uncapped total). */
  rootFanIn: number;
  /** Distinct contracts that reference this one (incl. dispatch expansion). */
  refFanIn: number;
  /** Root symbols reaching this contract, sorted, capped at
   *  {@link ROOTS_LIST_CAP}; `rootFanIn` carries the uncapped total. */
  roots: string[];
  /** False when no root reaches it — still persisted (the Structural Model
   *  tab shows unreachable contracts; they mirror unreachable code). */
  reachable: boolean;
}

/** One row of the class-level reachability report (diagnostic-only, v1). */
export interface SclReachabilityItem {
  sourcePath: string;
  /** Class FQN. */
  symbol: string;
  /** Generic signals requiring no framework knowledge — signals, NOT
   *  dispositions (design ruling): `implements_external:<Type>`,
   *  `annotation:<verbatim>`, `config_referenced:<path>`, `has_main`,
   *  `test_only`, or `no_signals`. */
  signals: string[];
}

export interface SclCorpusStats {
  rootCount: number;
  externalRootCount: number;
  internalRootCount: number;
  contractCount: number;
  reachableContractCount: number;
  /** Classes in the reachability report (outside the closure). */
  unreachableClassCount: number;
  /** call/dispatch rows with a null targetKey (see 'unresolved_calls'). */
  unresolvedCallCount: number;
  findingCounts: Record<string, number>;
}

export interface SclCorpus {
  roots: SclRoot[];
  contracts: SclCorpusContract[];
  reachability: SclReachabilityItem[];
  /** Slice findings + assembler findings, deduplicated + sorted. */
  findings: SclFinding[];
  stats: SclCorpusStats;
  /** Repo-resident stored-proc bodies (2026-08-23) — proc -> tables, for
   *  effect-walk expansion through `exec`/`{call}` boundaries. Optional so
   *  pre-existing corpora/fixtures stay valid. */
  procCatalog?: import('./sqlProcHarvester').ProcCatalogEntry[];
}

/**
 * A pluggable root detector — the extension seam for per-framework trigger
 * idioms (design ruling: a detector registry can promote a reachability
 * signal to a corpus root). Returns candidate roots; the assembler
 * deduplicates by symbol (first detector wins) and sorts.
 */
export type RootDetector = (slice: SclSliceResult) => SclRoot[];

export interface AssembleCorpusOptions {
  /** Extra root METHOD SYMBOLS (e.g. AMS-registered internal entrypoints);
   *  recorded as internal roots with detail 'extra_root'. */
  extraRoots?: string[];
  /** Extra detectors, run after the built-ins. */
  extraDetectors?: RootDetector[];
}

/** Roots listed per contract are capped here; `rootFanIn` stays uncapped. */
export const ROOTS_LIST_CAP = 20;

// ---------------------------------------------------------------------------
// Generic annotation / type-resolution helpers
// ---------------------------------------------------------------------------

/**
 * HTTP verb/path annotation names (JAX-RS + Spring MVC). Matched on the
 * annotation NAME only — arguments ignored. Generic across applications.
 */
const HTTP_ANNOTATION_NAMES = new Set([
  '@Path', '@GET', '@POST', '@PUT', '@DELETE', '@PATCH',
  '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping', '@RequestMapping',
]);

/** Framework-invoked candidate method names for detector (c). */
const FRAMEWORK_ENTRY_METHOD_NAMES = new Set(['run', 'execute', 'call']);

/** `@Path("/views")` → `@Path` (verbatim name, args stripped). */
function annotationName(text: string): string {
  const m = text.match(/^@[\w$.]+/);
  return m ? m[0] : text;
}

function stripGenerics(t: string): string {
  const i = t.indexOf('<');
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

function packageOf(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i >= 0 ? fqn.slice(0, i) : '';
}

/**
 * Simple-name resolution of a declared supertype text against the project
 * index (exact FQN, imports, own package, unique simple name) — the report's
 * `implements_external` chase is simple-name only per the design ruling.
 */
function resolveProjectType(
  typeText: string,
  owner: JavaClassInfo,
  index: JavaProjectIndex
): JavaClassInfo | null {
  const bare = stripGenerics(typeText);
  if (bare.includes('.')) return index.classesByFqn.get(bare) || null;
  for (const imp of owner.imports) {
    if (imp.endsWith(`.${bare}`)) return index.classesByFqn.get(imp) || null;
  }
  const samePackage = index.classesByFqn.get(`${packageOf(owner.fqn)}.${bare}`);
  if (samePackage) return samePackage;
  const bySimple = index.classesBySimpleName.get(bare) || [];
  return bySimple.length === 1 ? bySimple[0] : null;
}

/** Declared supertypes (extends + implements) NOT resolvable in the project. */
function externalSupertypes(cls: JavaClassInfo, index: JavaProjectIndex): string[] {
  const declared: string[] = [];
  if (cls.superClass) declared.push(cls.superClass);
  declared.push(...cls.interfaces);
  return declared.filter((t) => resolveProjectType(t, cls, index) === null);
}

function methodSymbol(m: JavaMethodInfo): string {
  return `${m.classFqn}#${m.name}(${m.paramTypes.join(',')})`;
}

/** `public static void main(String[] args)` recognizer (index-level; the
 *  method index carries no modifier list, so signature shape is the proxy). */
function isMainMethod(m: JavaMethodInfo): boolean {
  return (
    m.name === 'main' &&
    m.returnType === 'void' &&
    m.paramTypes.length === 1 &&
    /String\s*(\[\s*\]|\.\.\.)/.test(m.paramTypes[0])
  );
}

/** Non-private/protected, mirroring the behaviour extractor's check. */
function isPublicMethod(m: JavaMethodInfo): boolean {
  if (!m.bodyNode) return true;
  const decl: SyntaxNode | null = m.bodyNode.parent;
  if (!decl) return true;
  for (let i = 0; i < decl.childCount; i++) {
    const c = decl.child(i);
    if (c && c.type === 'modifiers' && /\b(private|protected)\b/.test(c.text)) return false;
  }
  return true;
}

function sortStrings(values: Iterable<string>): string[] {
  return Array.from(values).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Built-in root detectors (generic, application-agnostic)
// ---------------------------------------------------------------------------

function tablesByClassFqn(slice: SclSliceResult): Map<string, SclBehaviourTable[]> {
  const map = new Map<string, SclBehaviourTable[]>();
  for (const t of slice.tables) {
    const fqn = t.symbol.slice(0, t.symbol.indexOf('#'));
    const list = map.get(fqn) || [];
    list.push(t);
    map.set(fqn, list);
  }
  return map;
}

/** External: HTTP verb/path annotation on the table's method or its class. */
const detectExternalHttp: RootDetector = (slice) => {
  const roots: SclRoot[] = [];
  for (const t of slice.tables) {
    const clsFqn = t.symbol.slice(0, t.symbol.indexOf('#'));
    const cls = slice.index.classesByFqn.get(clsFqn);
    const all = [...t.annotations, ...(cls ? cls.annotations : [])];
    const hit = all.find((a) => HTTP_ANNOTATION_NAMES.has(annotationName(a)));
    if (hit) {
      roots.push({ kind: 'external', symbol: t.symbol, detail: `http_annotation:${annotationName(hit)}` });
    }
  }
  return roots;
};

/**
 * Internal (a): `public static void main`. Detected from the INDEX so an
 * inline-suppressed trivial main still becomes a root — the entrypoint is
 * real even when its table was absorbed; this keeps its class out of the
 * orphan report (asserted by the fixture tests).
 */
const detectMain: RootDetector = (slice) => {
  const roots: SclRoot[] = [];
  for (const cls of slice.index.classesByFqn.values()) {
    for (const m of cls.methods) {
      if (isMainMethod(m)) roots.push({ kind: 'internal', symbol: methodSymbol(m), detail: 'has_main' });
    }
  }
  return roots;
};

/** Internal (b): @Scheduled on the table's method or its declaring class. */
const detectScheduled: RootDetector = (slice) => {
  const roots: SclRoot[] = [];
  for (const t of slice.tables) {
    const clsFqn = t.symbol.slice(0, t.symbol.indexOf('#'));
    const cls = slice.index.classesByFqn.get(clsFqn);
    const all = [...t.annotations, ...(cls ? cls.annotations : [])];
    const hit = all.find((a) => annotationName(a) === '@Scheduled');
    if (hit) roots.push({ kind: 'internal', symbol: t.symbol, detail: 'scheduled_annotation' });
  }
  return roots;
};

/**
 * Internal (c): the generic framework-invoked heuristic — the class
 * implements/extends a type outside the project index AND declares a public
 * no-arg run()/execute()/call(); every table of the class becomes a root.
 */
const detectFrameworkInvoked: RootDetector = (slice) => {
  const roots: SclRoot[] = [];
  const byClass = tablesByClassFqn(slice);
  for (const cls of slice.index.classesByFqn.values()) {
    if (cls.kind === 'interface') continue;
    const external = externalSupertypes(cls, slice.index);
    if (external.length === 0) continue;
    const entry = cls.methods.find(
      (m) =>
        FRAMEWORK_ENTRY_METHOD_NAMES.has(m.name) &&
        m.paramTypes.length === 0 &&
        m.bodyNode !== null &&
        isPublicMethod(m)
    );
    if (!entry) continue;
    const detail = `framework_invoked:${stripGenerics(external[0])}`;
    for (const t of byClass.get(cls.fqn) || []) {
      roots.push({ kind: 'internal', symbol: t.symbol, detail });
    }
  }
  return roots;
};

/**
 * Internal (d): config-wired — the class FQN appears verbatim in a resource
 * file. Tables of the class root individually; a wired class with NO tables
 * (all methods inline-suppressed) roots at class level so the wiring stays
 * visible and the class is excluded from the orphan report.
 */
const detectConfigReferenced: RootDetector = (slice) => {
  const roots: SclRoot[] = [];
  const byClass = tablesByClassFqn(slice);
  const resourcePaths = sortStrings(slice.index.configReferences.keys());
  for (const resourcePath of resourcePaths) {
    const fqns = sortStrings(slice.index.configReferences.get(resourcePath) || []);
    for (const fqn of fqns) {
      if (!slice.index.classesByFqn.has(fqn)) continue;
      const detail = `config_referenced:${resourcePath}`;
      const tables = byClass.get(fqn) || [];
      if (tables.length > 0) {
        for (const t of tables) roots.push({ kind: 'internal', symbol: t.symbol, detail });
      } else {
        roots.push({ kind: 'internal', symbol: fqn, detail });
      }
    }
  }
  return roots;
};

const BUILT_IN_DETECTORS: RootDetector[] = [
  detectExternalHttp,
  detectMain,
  detectScheduled,
  detectFrameworkInvoked,
  detectConfigReferenced,
];

// ---------------------------------------------------------------------------
// Closure (reference edges + deterministic dispatch expansion)
// ---------------------------------------------------------------------------

const CONTRACT_KEY_RE = /^[TSQF]-[0-9a-f]{12}$/;

interface DispatchExpansion {
  /** Resolved implementation contract keys. */
  keys: string[];
  /** Interface + implementation class FQNs the dispatch reaches. */
  classFqns: string[];
}

/**
 * Expands a null-targetKey call/dispatch row's targetSymbol. When the symbol
 * names an interface method with project implementations, resolution is
 * deterministic: every implementation's matching method (by name + arity)
 * whose table/boundary key exists becomes an edge; the interface and impl
 * classes count as closure-reached.
 */
function expandDispatchTarget(targetSymbol: string, slice: SclSliceResult): DispatchExpansion {
  const hash = targetSymbol.indexOf('#');
  const paren = targetSymbol.indexOf('(', hash);
  if (hash < 0 || paren < 0) return { keys: [], classFqns: [] };
  const clsFqn = targetSymbol.slice(0, hash);
  const name = targetSymbol.slice(hash + 1, paren);
  const argsText = targetSymbol.slice(paren + 1, targetSymbol.lastIndexOf(')'));
  const arity = argsText.trim() === '' ? 0 : argsText.split(',').length;

  const cls = slice.index.classesByFqn.get(clsFqn);
  if (!cls || cls.kind === 'enum') return { keys: [], classFqns: [] };
  // Interface dispatch expands over `implements`; abstract-class (factory /
  // loader) dispatch expands over transitive `extends` subclasses PLUS the
  // base class's own method when it is concrete (2026-08-21 — previously
  // only interfaces expanded, so factory-pattern call chains never pulled
  // their concrete loader bodies into the corpus).
  const impls =
    cls.kind === 'interface'
      ? slice.index.implementationsOf(cls.fqn)
      : [cls, ...slice.index.subclassesOf(cls.fqn)];
  if (impls.length === 0) return { keys: [], classFqns: [] };

  const keys: string[] = [];
  const classFqns: string[] = [cls.fqn];
  for (const impl of impls) {
    classFqns.push(impl.fqn);
    const m =
      impl.methods.find((mm) => mm.name === name && mm.paramTypes.length === arity) ??
      impl.methods.find((mm) => mm.name === name);
    if (!m) continue;
    const key = slice.keyBySymbol.get(methodSymbol(m));
    if (key) keys.push(key);
  }
  return { keys: sortStrings(keys), classFqns: sortStrings(classFqns) };
}

interface ContractEdges {
  /** Outgoing contract-key edges, sorted. */
  keys: string[];
  /** Class FQNs reached via dispatch expansion (empty for non-tables). */
  dispatchClassFqns: string[];
}

function edgesOf(contract: SclContract, slice: SclSliceResult): ContractEdges {
  const keys = new Set<string>();
  const dispatchClassFqns = new Set<string>();
  if (contract.kind === 'behaviour_table') {
    for (const ref of contract.references) keys.add(ref);
    for (const row of contract.rows) {
      if (row.outcome.type !== 'call' || row.outcome.targetKey !== null) continue;
      const expansion = expandDispatchTarget(row.outcome.targetSymbol, slice);
      for (const k of expansion.keys) keys.add(k);
      for (const f of expansion.classFqns) dispatchClassFqns.add(f);
    }
    for (const input of contract.signatureInputs) {
      if (CONTRACT_KEY_RE.test(input.typeRef)) keys.add(input.typeRef);
    }
  } else if (contract.kind === 'shape') {
    for (const ref of contract.references) keys.add(ref);
  } else {
    for (const op of contract.operations) {
      if (op.resultShape && CONTRACT_KEY_RE.test(op.resultShape)) keys.add(op.resultShape);
    }
  }
  return { keys: sortStrings(keys), dispatchClassFqns: sortStrings(dispatchClassFqns) };
}

// ---------------------------------------------------------------------------
// Near-duplicate detection (v1, deterministic — behaviour tables only)
// ---------------------------------------------------------------------------

const MIN_NEAR_DUP_ROWS = 3;

/** All project identifiers (class simple names, method names, field names). */
function projectIdentifierSet(index: JavaProjectIndex): Set<string> {
  const ids = new Set<string>();
  for (const cls of index.classesByFqn.values()) {
    ids.add(cls.simpleName);
    for (const m of cls.methods) ids.add(m.name);
    for (const f of cls.fields) ids.add(f.name);
  }
  return ids;
}

/** Replaces every Java identifier that names a project class/method/field with '§'. */
function stripProjectIdentifiers(text: string, ids: Set<string>): string {
  return text.replace(/[A-Za-z_$][\w$]*/g, (m) => (ids.has(m) ? '§' : m));
}

/** kind + outcome.type + identifier-stripped outcomeLabel, per row, joined. */
function normalizedRowSequence(table: SclBehaviourTable, ids: Set<string>): string {
  return table.rows
    .map((r) => {
      const label = r.outcome.type === 'call' ? '' : stripProjectIdentifiers(r.outcome.outcomeLabel, ids);
      return `${r.kind}|${r.outcome.type}|${label}`;
    })
    .join(';');
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assembles the SCL corpus from a slice: root enumeration, closure BFS,
 * fan-in, near-dup clustering, the aggregated unresolved-calls finding, and
 * the class-level reachability report. Pure + deterministic.
 */
export function assembleCorpus(slice: SclSliceResult, options?: AssembleCorpusOptions): SclCorpus {
  const { index } = slice;

  // -------------------------------------------------------------------------
  // 1. Roots: built-in detectors, then extras; dedup by symbol (first wins).
  // -------------------------------------------------------------------------
  const detectors = [...BUILT_IN_DETECTORS, ...(options?.extraDetectors ?? [])];
  const rootBySymbol = new Map<string, SclRoot>();
  for (const detector of detectors) {
    for (const root of detector(slice)) {
      if (!rootBySymbol.has(root.symbol)) rootBySymbol.set(root.symbol, root);
    }
  }
  for (const symbol of options?.extraRoots ?? []) {
    if (!rootBySymbol.has(symbol)) {
      rootBySymbol.set(symbol, { kind: 'internal', symbol, detail: 'extra_root' });
    }
  }
  const roots = Array.from(rootBySymbol.values()).sort((a, b) =>
    a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0
  );

  // -------------------------------------------------------------------------
  // 2. Contract graph: key → contract, precomputed edges, reverse fan-in.
  // -------------------------------------------------------------------------
  const allContracts: SclContract[] = [...slice.tables, ...slice.shapes, ...slice.boundaries];
  const contractByKey = new Map<string, SclContract>();
  for (const c of allContracts) contractByKey.set(c.key, c);

  const edgesByKey = new Map<string, ContractEdges>();
  for (const c of allContracts) edgesByKey.set(c.key, edgesOf(c, slice));

  const referrersByKey = new Map<string, Set<string>>();
  for (const c of allContracts) {
    for (const target of (edgesByKey.get(c.key) as ContractEdges).keys) {
      const set = referrersByKey.get(target) || new Set<string>();
      set.add(c.key);
      referrersByKey.set(target, set);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Closure: BFS per root; record which roots reach each contract and
  //    which classes the closure touches (incl. dispatch-expanded classes).
  // -------------------------------------------------------------------------
  const rootsReachingKey = new Map<string, Set<string>>();
  const closureClassFqns = new Set<string>();

  for (const root of roots) {
    const startKey = slice.keyBySymbol.get(root.symbol);
    if (!startKey || !contractByKey.has(startKey)) continue; // class-level / inlined root: no traversal
    const visited = new Set<string>([startKey]);
    const queue: string[] = [startKey];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      const reaching = rootsReachingKey.get(key) || new Set<string>();
      reaching.add(root.symbol);
      rootsReachingKey.set(key, reaching);
      const edges = edgesByKey.get(key);
      if (!edges) continue;
      for (const f of edges.dispatchClassFqns) closureClassFqns.add(f);
      for (const next of edges.keys) {
        if (!contractByKey.has(next) || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
  }

  for (const key of rootsReachingKey.keys()) {
    const contract = contractByKey.get(key) as SclContract;
    if (contract.kind === 'behaviour_table') {
      closureClassFqns.add(contract.symbol.slice(0, contract.symbol.indexOf('#')));
    } else {
      closureClassFqns.add(contract.symbol);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Corpus contracts with fan-in metadata.
  // -------------------------------------------------------------------------
  const contracts: SclCorpusContract[] = allContracts.map((contract) => {
    const reaching = rootsReachingKey.get(contract.key);
    const rootSymbols = reaching ? sortStrings(reaching) : [];
    return {
      contract,
      kind: contract.kind,
      contractKey: contract.key,
      sourcePath: contract.sourcePath,
      sourceSymbol: contract.symbol,
      contentHash: contract.contentHash,
      rootFanIn: rootSymbols.length,
      refFanIn: referrersByKey.get(contract.key)?.size ?? 0,
      roots: rootSymbols.slice(0, ROOTS_LIST_CAP),
      reachable: rootSymbols.length > 0,
    };
  });
  contracts.sort((a, b) =>
    a.sourceSymbol < b.sourceSymbol
      ? -1
      : a.sourceSymbol > b.sourceSymbol
        ? 1
        : a.contractKey < b.contractKey
          ? -1
          : a.contractKey > b.contractKey
            ? 1
            : 0
  );

  // -------------------------------------------------------------------------
  // 5. Assembler findings: aggregated unresolved calls + near-dup clusters.
  // -------------------------------------------------------------------------
  const findings: SclFinding[] = [...slice.findings];

  const unresolvedSites: string[] = [];
  for (const t of slice.tables) {
    for (const row of t.rows) {
      if (row.outcome.type === 'call' && row.outcome.targetKey === null) {
        unresolvedSites.push(`${t.symbol} -> ${row.outcome.targetSymbol}`);
      }
    }
  }
  unresolvedSites.sort();
  if (unresolvedSites.length > 0) {
    findings.push({
      kind: 'unresolved_calls',
      symbol: 'corpus',
      detail: `${unresolvedSites.length} call/dispatch row(s) with no resolved contract key`,
      candidates: unresolvedSites.slice(0, 10),
    });
  }

  const identifiers = projectIdentifierSet(index);
  const clusterMap = new Map<string, Set<string>>(); // normalized sequence → table symbols
  const keyByTableSymbol = new Map<string, string>();
  for (const t of slice.tables) {
    keyByTableSymbol.set(t.symbol, t.key);
    if (t.rows.length < MIN_NEAR_DUP_ROWS) continue;
    const seq = normalizedRowSequence(t, identifiers);
    const set = clusterMap.get(seq) || new Set<string>();
    set.add(t.symbol);
    clusterMap.set(seq, set);
  }
  const clusters: string[][] = [];
  for (const symbols of clusterMap.values()) {
    const members = sortStrings(symbols);
    const distinctKeys = new Set(members.map((s) => keyByTableSymbol.get(s)));
    if (members.length >= 2 && distinctKeys.size >= 2) clusters.push(members);
  }
  clusters.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const members of clusters) {
    findings.push({
      kind: 'near_duplicate_cluster',
      symbol: members[0],
      detail: `${members.length} behaviour tables share an identical normalized row sequence — merge/keep is a DECISION, never auto-merged`,
      candidates: members,
    });
  }

  const findingByIdentity = new Map<string, SclFinding>();
  for (const f of findings) findingByIdentity.set(`${f.kind}|${f.symbol}|${f.detail}`, f);
  const sortedFindings = Array.from(findingByIdentity.values()).sort((a, b) => {
    const ka = `${a.kind}|${a.symbol}|${a.detail}`;
    const kb = `${b.kind}|${b.symbol}|${b.detail}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // -------------------------------------------------------------------------
  // 6. Reachability report (class-level, diagnostic-only).
  //
  // A class is reported when NO root owns it, NO reachable behaviour table
  // belongs to it, and it is not a shape/boundary (or dispatch-expanded
  // class) reached by the closure. Exclusions by design:
  //   - annotation types (@interface): never indexed as classes at all;
  //   - inlined helpers (a class with NO tables and ≥1 inline-suppressed
  //     method): their code lives verbatim INSIDE their callers, so
  //     "unreachable as a table" is definitional, not diagnostic.
  // -------------------------------------------------------------------------
  const inlinedSet = new Set(slice.inlined);
  const byClass = tablesByClassFqn(slice);
  const rootOwnedFqns = new Set<string>();
  for (const root of roots) {
    const hash = root.symbol.indexOf('#');
    rootOwnedFqns.add(hash >= 0 ? root.symbol.slice(0, hash) : root.symbol);
  }
  const configReferencesByFqn = new Map<string, string[]>();
  for (const resourcePath of sortStrings(index.configReferences.keys())) {
    for (const fqn of index.configReferences.get(resourcePath) || []) {
      const list = configReferencesByFqn.get(fqn) || [];
      list.push(resourcePath);
      configReferencesByFqn.set(fqn, list);
    }
  }

  const reachability: SclReachabilityItem[] = [];
  for (const cls of index.classesByFqn.values()) {
    if (rootOwnedFqns.has(cls.fqn)) continue;
    if (closureClassFqns.has(cls.fqn)) continue;
    const tables = byClass.get(cls.fqn) || [];
    if (tables.some((t) => rootsReachingKey.has(t.key))) continue; // defensive; closureClassFqns covers this
    const shapeOrBoundaryKey = slice.keyBySymbol.get(cls.fqn);
    if (shapeOrBoundaryKey && rootsReachingKey.has(shapeOrBoundaryKey)) continue;
    if (tables.length === 0 && cls.methods.some((m) => inlinedSet.has(methodSymbol(m)))) continue;

    const signals: string[] = [];
    for (const ext of sortStrings(externalSupertypes(cls, index))) {
      signals.push(`implements_external:${stripGenerics(ext)}`);
    }
    for (const ann of cls.annotations) signals.push(`annotation:${ann}`);
    for (const resourcePath of configReferencesByFqn.get(cls.fqn) || []) {
      signals.push(`config_referenced:${resourcePath}`);
    }
    if (cls.methods.some(isMainMethod)) signals.push('has_main');
    if (cls.filePath.includes('/test/')) signals.push('test_only');
    if (signals.length === 0) signals.push('no_signals');

    reachability.push({ sourcePath: cls.filePath, symbol: cls.fqn, signals });
  }
  reachability.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));

  // -------------------------------------------------------------------------
  // 7. Stats.
  // -------------------------------------------------------------------------
  const findingCounts: Record<string, number> = {};
  for (const f of sortedFindings) findingCounts[f.kind] = (findingCounts[f.kind] ?? 0) + 1;

  const stats: SclCorpusStats = {
    rootCount: roots.length,
    externalRootCount: roots.filter((r) => r.kind === 'external').length,
    internalRootCount: roots.filter((r) => r.kind === 'internal').length,
    contractCount: contracts.length,
    reachableContractCount: contracts.filter((c) => c.reachable).length,
    unreachableClassCount: reachability.length,
    unresolvedCallCount: unresolvedSites.length,
    findingCounts,
  };

  return { roots, contracts, reachability, findings: sortedFindings, stats, procCatalog: slice.procCatalog ?? [] };
}
