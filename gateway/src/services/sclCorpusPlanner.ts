/**
 * SCL corpus-derived spec planner (SCL pipeline spec 7 of 10, 2026-08-18
 * design: agent-os/planning/2026-08-18-scl-pipeline-design.md, "Spec plan
 * restructure" + "Rulings round 2").
 *
 * PURE + DETERMINISTIC derivation (`deriveCorpusPlan`) over the persisted SCL
 * corpus contracts, plus an AMS-backed loader (`loadCorpusPlan`) that mirrors
 * the sclAnnotationPass fetch idiom (scans/latest → contracts with
 * include_body=true).
 *
 * Derivation rules (design §"Spec plan restructure"):
 *   - fan-in >= 2 → HOISTED into a foundational layer (the hoisting rule);
 *   - 6 foundational layers, in build (topological) order — VALIDATED against
 *     the contracts' own reference edges since 2026-09-07, not merely asserted:
 *       1. constants-exceptions   enums + *Exception shapes that reference
 *                                 nothing outside this layer
 *       2. dto-shapes             every remaining shape contract
 *       3. utilities              shared *Utils/*Util/*Helper fragments
 *       4. data-access            ALL boundary [Q-] contracts
 *       5. cross-cutting-fragments shared (fan-in>=2) non-root, non-utility
 *                                 behaviour tables (envelope builders etc.),
 *                                 which call INTO utilities + data-access
 *       6. test-kit               fixture builders from the shape contracts
 *     EMPTY layers are omitted. Within a layer the parts are partitioned in
 *     dependency order too, and `stats.forwardReferences` reports any contract
 *     still placed before something it references;
 *   - then EXTERNAL endpoint groups, then INTERNAL endpoint groups: 1–n
 *     endpoints per story, grouped by declaring legacy controller class,
 *     budgeted by behaviour-table ROW COUNT (config SCL_STORY_ROW_BUDGET,
 *     default 40 — thresholds are config-tunable per the user ruling); a
 *     group over budget splits into cohesive consecutive-method slices
 *     titled "... (part N)". The row count includes the controller's
 *     NON-SHARED vertical residue (fan_in < 2 tables reachable only from it);
 *   - deterministic ordering everywhere (sort by symbol / class).
 *
 * FAIL-SOFT POSTURE: the loader returns null when no scan exists (or the
 * corpus yields zero endpoint groups — an empty corpus must never wipe the
 * legacy plan); read failures THROW and the book-of-work expansion caller
 * catches them and takes the legacy path byte-identically.
 */

import { getConfig } from '../config';
import { SclContractBody, SclContractWire, SclScanWire } from './sclAnnotationPass';

// ---------------------------------------------------------------------------
// Wire type (snake_case AMS wire — extends the annotation pass subset with the
// full roots_json shape the planner reads)
// ---------------------------------------------------------------------------

/** AMS `scl_contracts` row as this planner reads it (include_body=true). */
export interface SclContractDto extends SclContractWire {
  roots_json?: { roots?: unknown[]; total?: number; reachable?: number } | null;
}

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export interface SclPlannedStory {
  /** Foundation layer key, or 'endpoint:external' / 'endpoint:internal'. */
  layer: string;
  title: string;
  description: string;
  /** SCL contract keys this story implements (roots + vertical residue). */
  contractKeys: string[];
  /** Total behaviour-table rows carried by this story (0 for shape layers). */
  rowCount: number;
  /**
   * Predicted rendered size of this story's spec in characters (2026-09-10):
   * verbatim character volume of the carried contracts plus per-row/op/field
   * overhead. The SIZE budget splits on this; the row/operation budget stays
   * as the secondary guard (see `DEFAULT_SCL_STORY_SIZE_BUDGET_CHARS`).
   */
  predictedChars?: number;
  /** Dominant package of the carried contracts (2026-09-10): the cluster key the
   *  expansion promotes to a feature for the cross-cutting fragments layer. */
  clusterKey?: string;
  /** ['scl', 'scl:foundation:<layer>' | 'scl:endpoint:external|internal']. */
  tags: string[];
  /** Declaring legacy controller class (endpoint groups only). */
  controllerClass?: string;
  /**
   * Q- boundary contracts this story's rows reach TRANSITIVELY through
   * `references` (2026-09-03, Kiro review A-2 / C-2). Boundaries live in the
   * data-access foundation layer and are never in `contractKeys`; pre-fix an
   * endpoint story never named the DAO SQL its rows delegate to, so
   * "### Boundary:" appeared in one spec of 116. The carriage renders these
   * as a compact "boundaries reached" section with the verbatim SQL.
   */
  boundaryKeys?: string[];
  /**
   * HTTP routes this story's endpoint contracts declare, for joining SCL
   * stories to committed endpoint element ids. EMPTY for foundation layers and
   * for endpoints with no routing annotation (e.g. `web.xml` servlets).
   */
  httpRoutes?: SclHttpRoute[];
}

export interface SclCorpusPlanStats {
  /** Contracts with fan_in >= 2 (the hoisting-rule population). */
  sharedContractCount: number;
  /** Distinct controller classes across external + internal groups. */
  controllerCount: number;
  /** Controllers whose group was split into row-budget parts. */
  splitCount: number;
  /**
   * Foundation LAYERS that had to split into row-budget parts. Before
   * foundation layers were budgeted this was structurally always 0 and the
   * layers grew without bound.
   */
  foundationSplitCount: number;
  rowBudget: number;
  /**
   * The clustering rule this planner applies (asserted after planning; IMPL-06).
   *
   * IMPL-06 existed because the rule was implicit. Since 2026-09-10 TWO budgets
   * fire together -- the row/operation budget and the rendered-size budget --
   * so reporting `row_budget` alone under-named the rule that produced the plan,
   * which is the same gap IMPL-06 was raised to close. `row_budget` is retained
   * for plans persisted before the size budget existed.
   */
  clusteringRule?: 'row_budget' | 'row_and_size_budget';
  /**
   * Story titles whose carried cost still exceeds the row budget — only a
   * single method whose own rows exceed the budget can do this (it cannot be
   * split further). Logged by the expansion so the rule that fired is visible.
   */
  overBudgetStories?: string[];
  /**
   * FORWARD REFERENCES across the foundation stories (2026-09-07): a story
   * carrying a contract that references a contract in a LATER story. Should
   * always be EMPTY now the layers are partitioned in build order — a non-empty
   * list means an implementer WILL be asked to build against an absent type, so
   * the expansion logs it loudly rather than letting it surface four hours into
   * a run as a blocked task.
   */
  forwardReferences?: string[];
  /**
   * Dependency cycles the topological partition could not order. Members are
   * emitted in symbol order (the fallback `shapeExtractor` also uses) — a cycle
   * is unorderable by construction, so it is reported, not hidden.
   */
  dependencyCycles?: string[][];
  /**
   * Shapes whose NAME matched the constants layer (`*Exception`) but which
   * reference shapes built later, so they were moved to the DTO layer. Non-empty
   * means the name-only classification would have produced a forward reference.
   */
  constantsEvicted?: string[];
  /**
   * Contracts with a signature and NOTHING to build from (2026-09-09): no
   * behaviour rows, no boundary operation carrying verbatim SQL, no shape
   * fields. A story carrying only such contracts cannot be implemented from
   * the spec; one carrying some renders them as declared gaps. Reported at
   * plan time, in the same shape as `forwardReferences`, so the decision is
   * visible before an implementer discovers it as a NOT CAPTURED throw.
   */
  unimplementableContracts?: string[];
  /** The rendered-size budget applied alongside the row/operation budget (2026-09-10). */
  sizeBudgetChars?: number;
  /** Stories whose PREDICTED rendered size still exceeds the size budget (unsplittable single unit). */
  overSizeStories?: string[];
}

export interface SclCorpusPlan {
  /** The 6 foundational layers, in order; EMPTY layers omitted. */
  foundationStories: SclPlannedStory[];
  /** One story per external controller class (split parts when over budget). */
  externalEndpointGroups: SclPlannedStory[];
  /** Same, for internal (non-HTTP) roots — always AFTER externals. */
  internalEndpointGroups: SclPlannedStory[];
  stats: SclCorpusPlanStats;
}

// ---------------------------------------------------------------------------
// Contract readers (tolerant of the loosely-typed body blob)
// ---------------------------------------------------------------------------

/**
 * The generic HTTP annotation set (JAX-RS + Spring MVC idioms — the same
 * conventions sclModernizationRuleset's annotationPrefix rules and
 * sclAnnotationPass.deriveHttpMethod recognise; NEVER app-specific).
 */
export const SCL_HTTP_ANNOTATION_PREFIXES: readonly string[] = [
  '@Path',
  '@GET',
  '@POST',
  '@PUT',
  '@DELETE',
  '@PATCH',
  '@HEAD',
  '@OPTIONS',
  '@RequestMapping',
  '@GetMapping',
  '@PostMapping',
  '@PutMapping',
  '@DeleteMapping',
  '@PatchMapping',
];

function bodyOf(contract: SclContractDto): SclContractBody {
  return contract.body_json ?? {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

/** The contract's own symbol: body symbol, else source_symbol, else key. */
export function symbolOf(contract: SclContractDto): string {
  const bodySymbol = bodyOf(contract).symbol;
  if (typeof bodySymbol === 'string' && bodySymbol.length > 0) return bodySymbol;
  return contract.source_symbol ?? contract.contract_key ?? '';
}

/** Declaring class of a `Class#method(args)` symbol (the whole symbol when
 * there is no `#` — shape symbols are plain type names). */
export function classOfSymbol(symbol: string): string {
  const hash = symbol.indexOf('#');
  return hash > 0 ? symbol.slice(0, hash) : symbol;
}

/** Simple (package-stripped) name of a class. */
export function simpleClassName(cls: string): string {
  const dot = cls.lastIndexOf('.');
  return dot >= 0 ? cls.slice(dot + 1) : cls;
}

function rootsOf(contract: SclContractDto): string[] {
  const roots = contract.roots_json?.roots;
  return Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string') : [];
}

function annotationTexts(contract: SclContractDto): string[] {
  const anns = bodyOf(contract).annotations;
  return Array.isArray(anns) ? anns.map(asText) : [];
}

function rowCountOf(contract: SclContractDto): number {
  const rows = bodyOf(contract).rows;
  return Array.isArray(rows) ? rows.length : 0;
}

function referencesOf(contract: SclContractDto): string[] {
  const refs = (bodyOf(contract) as Record<string, unknown>).references;
  return Array.isArray(refs) ? refs.map(asText) : [];
}

function fanInOf(contract: SclContractDto): number {
  return typeof contract.fan_in === 'number' ? contract.fan_in : 0;
}

/** SHARED = fan_in >= 2 — the hoisting rule. */
export function isSharedContract(contract: SclContractDto): boolean {
  return fanInOf(contract) >= 2;
}

/** Q- boundary contracts: explicit kind, or the Q- content-hash key prefix
 * (same rule as sclModernizationInventory.isBoundaryContract). */
export function isBoundary(contract: SclContractDto): boolean {
  if (contract.kind === 'boundary') return true;
  return typeof contract.contract_key === 'string' && contract.contract_key.startsWith('Q-');
}

/** A ROOT table: a behaviour table whose roots list includes its own symbol. */
export function isRootTable(contract: SclContractDto): boolean {
  if (contract.kind !== 'behaviour_table') return false;
  const symbol = symbolOf(contract);
  return symbol.length > 0 && rootsOf(contract).includes(symbol);
}

/** HTTP-annotated: any body annotation starts with the generic HTTP set. */
export function isHttpAnnotated(contract: SclContractDto): boolean {
  return annotationTexts(contract).some((text) =>
    SCL_HTTP_ANNOTATION_PREFIXES.some((prefix) => text.startsWith(prefix))
  );
}

/** One HTTP route declared by an endpoint contract's annotations. */
export interface SclHttpRoute {
  /** Upper-cased verb when the annotation determines one, else null. */
  verb: string | null;
  /** Declared path when present, else null. */
  path: string | null;
}

/** Annotation name -> implied verb, for the verb-specific mapping forms. */
const VERB_BY_ANNOTATION: ReadonlyMap<string, string> = new Map([
  ['@GetMapping', 'GET'],
  ['@PostMapping', 'POST'],
  ['@PutMapping', 'PUT'],
  ['@DeleteMapping', 'DELETE'],
  ['@PatchMapping', 'PATCH'],
  ['@GET', 'GET'],
  ['@POST', 'POST'],
  ['@PUT', 'PUT'],
  ['@DELETE', 'DELETE'],
  ['@PATCH', 'PATCH'],
  ['@HEAD', 'HEAD'],
  ['@OPTIONS', 'OPTIONS'],
]);

/** Stable de-dupe for a route list (deterministic ordering). */
export function dedupeRoutes(routes: SclHttpRoute[]): SclHttpRoute[] {
  const seen = new Map<string, SclHttpRoute>();
  for (const route of routes) {
    const key = `${route.verb ?? ''} ${route.path ?? ''}`;
    if (!seen.has(key)) seen.set(key, route);
  }
  return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => r);
}

function annotationName(text: string): string {
  const paren = text.indexOf('(');
  return (paren >= 0 ? text.slice(0, paren) : text).trim();
}

/** First quoted string in an annotation, which is its path for all forms. */
function annotationPath(text: string): string | null {
  const quoted = text.match(/"([^"]*)"/);
  if (!quoted) return null;
  const value = quoted[1].trim();
  return value.length > 0 ? value : null;
}

/** `method = RequestMethod.POST` / `method = {RequestMethod.PUT}` -> POST/PUT. */
function requestMappingVerb(text: string): string | null {
  const match = text.match(/RequestMethod\s*\.\s*([A-Za-z]+)/);
  return match ? match[1].toUpperCase() : null;
}

/** One separating slash: absorb a base's trailing slash + a suffix's leading slash. */
function joinRoutePath(base: string, suffix: string): string {
  const left = base.replace(/\/+$/, '');
  const right = suffix.replace(/^\/+/, '');
  return `${left}/${right}`;
}

/**
 * Compose a contract's collected path fragments into full routes (2026-09-01).
 *
 * JAX-RS and Spring both split a route across TWO annotations: the class-level
 * base (`@Path("/filters")` / `@RequestMapping("/filters")`) and the
 * method-level suffix (`@Path("create")` / `@PostMapping("create")`). The
 * naive de-dupe here previously emitted that split as TWO bogus routes
 * (`/filters` and `create`) — neither of which matched the committed
 * `/filters/create`, so every split-annotated endpoint silently failed the
 * route join.
 *
 * Classification rule: a `/`-prefixed fragment is a BASE; anything else is a
 * SUFFIX. When both are present, every base joins every suffix; when either
 * side is absent, the fragments pass through deduped (a bare suffix is kept
 * as-is for the join's suffix tier to resolve — never fabricated into a
 * rooted route).
 */
export function composeAnnotationPaths(paths: string[]): string[] {
  const cleaned = paths.map((p) => p.trim()).filter((p) => p.length > 0);
  const bases = cleaned.filter((p) => p.startsWith('/'));
  const suffixes = cleaned.filter((p) => !p.startsWith('/'));
  if (bases.length === 0 || suffixes.length === 0) {
    return [...new Set(cleaned)].sort();
  }
  const composed: string[] = [];
  for (const base of bases) {
    for (const suffix of suffixes) composed.push(joinRoutePath(base, suffix));
  }
  return [...new Set(composed)].sort();
}

/**
 * HTTP routes a contract declares, derived from its annotations.
 *
 * <p>Covers the Spring (`@RequestMapping` + the verb-specific `@*Mapping`) and
 * JAX-RS (`@Path` + `@GET`/`@POST`/...) forms named in
 * {@link SCL_HTTP_ANNOTATION_PREFIXES}. A JAX-RS method splits its route across
 * two annotations (verb on one, path on `@Path`), so verbs and paths are
 * collected separately and combined. Path fragments themselves are composed by
 * {@link composeAnnotationPaths}: a class-level base + method-level suffix
 * split yields the JOINED route, never the two halves as separate routes.</p>
 *
 * <p>Returns an EMPTY array for endpoints that carry no routing annotation at
 * all — notably `web.xml`-mapped servlets, whose route lives in a deployment
 * descriptor rather than on the class. That is a real limit of this derivation,
 * not something to paper over: callers must treat "no routes" as "cannot join
 * by route", never as "no endpoints".</p>
 */
export function httpRoutesOf(contract: SclContractDto): SclHttpRoute[] {
  const verbs: string[] = [];
  const paths: string[] = [];
  let sawRoutingAnnotation = false;

  for (const text of annotationTexts(contract)) {
    const name = annotationName(text);
    if (!SCL_HTTP_ANNOTATION_PREFIXES.some((prefix) => name === prefix)) continue;
    sawRoutingAnnotation = true;

    const path = annotationPath(text);
    if (path) paths.push(path);

    const mapped = VERB_BY_ANNOTATION.get(name);
    if (mapped) {
      verbs.push(mapped);
      continue;
    }
    if (name === '@RequestMapping') {
      const verb = requestMappingVerb(text);
      if (verb) verbs.push(verb);
    }
  }

  if (!sawRoutingAnnotation) return [];

  const uniqueVerbs = [...new Set(verbs)].sort();
  // Compose class-level bases with method-level suffixes (see
  // composeAnnotationPaths) — a naive de-dupe emitted the two halves of a
  // split annotation as two bogus routes.
  const uniquePaths = composeAnnotationPaths(paths);
  if (uniqueVerbs.length === 0 && uniquePaths.length === 0) return [];
  if (uniqueVerbs.length === 0) return uniquePaths.map((path) => ({ verb: null, path }));
  if (uniquePaths.length === 0) return uniqueVerbs.map((verb) => ({ verb, path: null }));
  const routes: SclHttpRoute[] = [];
  for (const verb of uniqueVerbs) {
    for (const path of uniquePaths) routes.push({ verb, path });
  }
  return routes;
}

function keyOf(contract: SclContractDto): string {
  return contract.contract_key ?? symbolOf(contract);
}

/**
 * Q- boundary keys transitively reachable from `startKeys` via `references`.
 * Boundaries themselves are collected, not descended into; shared behaviour
 * tables ARE traversed (a root may reach a DAO through a shared fragment).
 * Exported for tests.
 */
export function boundariesReachedBy(
  startKeys: ReadonlyArray<string>,
  resolve: (ref: string) => SclContractDto | undefined
): string[] {
  const seen = new Set<string>(startKeys);
  const boundaries = new Set<string>();
  const queue = [...startKeys];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const contract = resolve(key);
    if (!contract) continue;
    if (isBoundary(contract)) {
      boundaries.add(keyOf(contract));
      continue;
    }
    for (const ref of referencesOf(contract)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      queue.push(ref);
    }
  }
  return [...boundaries].sort();
}

/** Deterministic contract ordering: by symbol, then contract key. */
function bySymbol(a: SclContractDto, b: SclContractDto): number {
  return symbolOf(a).localeCompare(symbolOf(b)) || keyOf(a).localeCompare(keyOf(b));
}

/** `com.app.orders.OrderService#find()` -> `com.app.orders`. */
function packageOf(contract: SclContractDto): string {
  const cls = classOfSymbol(symbolOf(contract));
  const dot = cls.lastIndexOf('.');
  return dot > 0 ? cls.slice(0, dot) : '';
}

/**
 * Package first, then symbol (2026-09-10). Used ONLY as the tie-break among
 * contracts that are ready at the same time in the topological walk, so a
 * story part is a coherent package-shaped slice rather than an arbitrary
 * alphabetical one -- a soft boundary, never a partition: small packages pack
 * together up to the budget and only the large ones split.
 */
function byPackageThenSymbol(a: SclContractDto, b: SclContractDto): number {
  return packageOf(a).localeCompare(packageOf(b)) || bySymbol(a, b);
}

function boundedSymbols(contracts: SclContractDto[], max = 10): string {
  // Sorted for input-order independence (descriptions are deterministic too).
  const symbols = [...contracts].sort(bySymbol).map(symbolOf);
  if (symbols.length <= max) return symbols.join(', ');
  return `${symbols.slice(0, max).join(', ')} (+${symbols.length - max} more)`;
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

/** Default behaviour-table row budget per endpoint story (config-tunable). */
export const DEFAULT_SCL_STORY_ROW_BUDGET = 40;

const UTILITY_CLASS_RE = /(Utils|Util|Helper)$/;

interface MethodCost {
  contract: SclContractDto;
  key: string;
  symbol: string;
  ownRows: number;
  /** Vertical residue: non-shared tables reachable ONLY via this method. */
  residueKeys: string[];
  residueRows: number;
}

/**
 * Vertical residue of one root method: transitive closure over `references`
 * RESTRICTED to behaviour tables with fan_in < 2 (non-shared — a fan_in < 2
 * table has at most one caller, so it is reachable ONLY from this vertical).
 * Shared fragments, boundaries, shapes and other roots never join the
 * residue — they live in the hoisted foundation layers.
 */
function residueOf(
  root: SclContractDto,
  resolve: (ref: string) => SclContractDto | undefined
): SclContractDto[] {
  const residue: SclContractDto[] = [];
  const seen = new Set<string>([keyOf(root)]);
  const queue = [...referencesOf(root)];
  while (queue.length > 0) {
    const ref = queue.shift()!;
    const target = resolve(ref);
    if (!target) continue;
    const targetKey = keyOf(target);
    if (seen.has(targetKey)) continue;
    seen.add(targetKey);
    if (
      target.kind !== 'behaviour_table' ||
      isBoundary(target) ||
      isRootTable(target) ||
      isSharedContract(target)
    ) {
      continue;
    }
    residue.push(target);
    queue.push(...referencesOf(target));
  }
  residue.sort(bySymbol);
  return residue;
}

function endpointGroupStory(args: {
  cls: string;
  kind: 'external' | 'internal';
  slice: MethodCost[];
  part: number | null;
}): SclPlannedStory {
  const { cls, kind, slice, part } = args;
  const simple = simpleClassName(cls);
  const rowCount = slice.reduce((sum, m) => sum + m.ownRows + m.residueRows, 0);
  const contractKeys = slice.flatMap((m) => [m.key, ...m.residueKeys]);
  const methodList = slice.map((m) => m.symbol);
  const shownMethods =
    methodList.length <= 10
      ? methodList.join(', ')
      : `${methodList.slice(0, 10).join(', ')} (+${methodList.length - 10} more)`;
  return {
    layer: `endpoint:${kind}`,
    title:
      `Implement ${simple} (${slice.length} endpoints)` + (part !== null ? ` (part ${part})` : ''),
    description:
      `${slice.length} ${kind} endpoint method(s) of ${cls}: ${shownMethods}. ` +
      `${rowCount} behaviour-table row(s) including the non-shared vertical residue; ` +
      `shared fragments (fan-in >= 2) are implemented by the foundation layers and referenced, never re-implemented.`,
    contractKeys,
    rowCount,
    // Routes are collected from the ROOT contracts in this slice (the endpoint
    // methods); vertical-residue contracts are internal helpers and declare no
    // routes of their own.
    httpRoutes: dedupeRoutes(slice.flatMap((m) => httpRoutesOf(m.contract))),
    tags: ['scl', `scl:endpoint:${kind}`],
    controllerClass: cls,
  };
}

function buildEndpointGroups(args: {
  roots: SclContractDto[];
  resolve: (ref: string) => SclContractDto | undefined;
  kind: 'external' | 'internal';
  rowBudget: number;
  sizeBudgetChars?: number;
  onSplit: () => void;
  onController: () => void;
}): SclPlannedStory[] {
  const { roots, resolve, kind, rowBudget } = args;
  const byClass = new Map<string, SclContractDto[]>();
  for (const root of [...roots].sort(bySymbol)) {
    const cls = classOfSymbol(symbolOf(root));
    const list = byClass.get(cls) ?? [];
    if (list.length === 0) byClass.set(cls, list);
    list.push(root);
  }
  const stories: SclPlannedStory[] = [];
  for (const cls of [...byClass.keys()].sort()) {
    args.onController();
    // Consecutive method order = symbol order (deterministic).
    const methods = byClass.get(cls)!.sort(bySymbol);
    const costs: MethodCost[] = methods.map((m) => {
      const residue = residueOf(m, resolve);
      return {
        contract: m,
        key: keyOf(m),
        symbol: symbolOf(m),
        ownRows: rowCountOf(m),
        residueKeys: residue.map(keyOf),
        residueRows: residue.reduce((sum, r) => sum + rowCountOf(r), 0),
      };
    });
    const total = costs.reduce((sum, c) => sum + c.ownRows + c.residueRows, 0);
    const sizeBudget = args.sizeBudgetChars ?? Number.POSITIVE_INFINITY;
    const totalChars = costs.reduce((sum, c) => sum + predictedRenderedChars(c.contract), 0);
    if (total <= rowBudget && totalChars <= sizeBudget) {
      stories.push(endpointGroupStory({ cls, kind, slice: costs, part: null }));
      continue;
    }
    // Over budget → cohesive slices by CONSECUTIVE method order: greedy fill,
    // never splitting a single method's vertical (a method whose own vertical
    // exceeds the budget still gets exactly one part).
    args.onSplit();
    const slices: MethodCost[][] = [];
    let current: MethodCost[] = [];
    let currentRows = 0;
    let currentChars = 0;
    for (const cost of costs) {
      const methodRows = cost.ownRows + cost.residueRows;
      // Size term counts the endpoint method's OWN contract; vertical residue is
      // small by construction (fan_in < 2 helpers) and stays on the row term.
      const methodChars = predictedRenderedChars(cost.contract);
      if (
        current.length > 0 &&
        (currentRows + methodRows > rowBudget || currentChars + methodChars > sizeBudget)
      ) {
        slices.push(current);
        current = [];
        currentRows = 0;
        currentChars = 0;
      }
      current.push(cost);
      currentRows += methodRows;
      currentChars += methodChars;
    }
    if (current.length > 0) slices.push(current);
    slices.forEach((slice, i) =>
      stories.push(endpointGroupStory({ cls, kind, slice, part: i + 1 }))
    );
  }
  return stories;
}

// ---------------------------------------------------------------------------
// Dependency awareness for the foundation layers (2026-09-07)
//
// WHY. A live foundations run lost three specs in sequence to the same
// defect: the planner asserted its six layers were in "build (topological)
// order" but partitioned each layer ALPHABETICALLY and classified the
// constants layer BY NAME. So a `*Exception` whose field typed against a
// DTO landed in the "zero-dependency layer — built first", ahead of the DTO
// it needed; and inside the DTO layer a shape sorted before the shape it
// referenced. Each implementer hit an absent type, did the honest thing
// (marked the task blocked), and the run halted — hours in. Three fixes,
// all measured against the live corpus rather than argued:
//   1. edges: SHAPE contracts depend on the shape contracts they reference
//      (`references` edges, plus an unresolved opaque/carrier leaf resolved
//      to a corpus shape by UNIQUE simple class name — never an ambiguous
//      one, which is how the seq 47/49/50 circular case was mis-attributed);
//   2. the constants layer is filtered to shapes that reference NOTHING
//      outside the layer, iterated to a fixed point (evicting one shape can
//      strand another that referenced it), so its "zero-dependency" promise
//      is true; the evictions are reported;
//   3. within a layer the parts are emitted in topological (build) order
//      with alphabetical tie-break, a cycle is force-broken on its
//      alphabetically-first member and REPORTED, and every foundation story
//      is validated against the edges — `stats.forwardReferences` names any
//      contract still placed before something it references.
// ---------------------------------------------------------------------------

/** One shape field as the planner reads it (see discovery-service SclShapeField). */
interface PlannerShapeField {
  kind?: unknown;
  sourceCarrier?: unknown;
  source_carrier?: unknown;
}

function shapeFieldsOf(contract: SclContractDto): PlannerShapeField[] {
  const fields = (bodyOf(contract) as Record<string, unknown>).fields;
  return Array.isArray(fields) ? (fields as PlannerShapeField[]) : [];
}

function unresolvedCarrierLeaves(contract: SclContractDto): string[] {
  const leaves = new Set<string>();
  for (const field of shapeFieldsOf(contract)) {
    const kind = typeof field.kind === 'string' ? field.kind : '';
    for (const m of kind.matchAll(/opaque:([A-Za-z_$][\w$.]*)/g)) {
      leaves.add(simpleClassName(m[1]));
    }
    const carrier = field.sourceCarrier ?? field.source_carrier;
    if (typeof carrier === 'string' && carrier.length > 0) {
      leaves.add(simpleClassName(stripTypeArguments(carrier)));
    }
  }
  return [...leaves];
}

/** `List<Foo>` -> `List`; leaves a plain name untouched. */
function stripTypeArguments(text: string): string {
  const lt = text.indexOf('<');
  return (lt >= 0 ? text.slice(0, lt) : text).trim();
}

export function buildContractDependencies(
  contracts: SclContractDto[]
): Map<string, Set<string>> {
  const known = new Set(contracts.map(keyOf));
  // SHAPES ONLY, and that restriction is load-bearing. A field's type is a TYPE,
  // so only a shape contract can satisfy it. Including behaviour tables made the
  // lookup ambiguous for every type that also has methods in the corpus: on the
  // live corpus a domain filter type had both a shape contract and behaviour
  // tables whose `Class#method()` symbols reduce to the same leaf, so the
  // exception -> filter edge was discarded as unattributable and the very
  // defect this code exists to prevent survived the first version of it.
  const keysByLeaf = new Map<string, Set<string>>();
  for (const contract of contracts) {
    if (contract.kind !== 'shape' || isBoundary(contract)) continue;
    const leaf = simpleClassName(classOfSymbol(symbolOf(contract)));
    if (!leaf) continue;
    const set = keysByLeaf.get(leaf) ?? new Set<string>();
    set.add(keyOf(contract));
    keysByLeaf.set(leaf, set);
  }

  const deps = new Map<string, Set<string>>();
  for (const contract of contracts) {
    const self = keyOf(contract);
    const set = new Set<string>();
    for (const ref of referencesOf(contract)) {
      if (ref !== self && known.has(ref)) set.add(ref);
    }
    for (const leaf of unresolvedCarrierLeaves(contract)) {
      const candidates = keysByLeaf.get(leaf);
      if (!candidates || candidates.size !== 1) continue; // absent or ambiguous
      const target = [...candidates][0];
      if (target !== self) set.add(target);
    }
    deps.set(self, set);
  }
  return deps;
}

export function topologicalContractOrder(
  contracts: SclContractDto[],
  deps: Map<string, Set<string>>,
  onCycle?: (members: string[]) => void
): SclContractDto[] {
  const inScope = new Map<string, SclContractDto>();
  // Insertion order = ready-key preference: (package, symbol), 2026-09-10.
  for (const c of [...contracts].sort(byPackageThenSymbol)) inScope.set(keyOf(c), c);

  const pending = new Map<string, Set<string>>();
  for (const key of inScope.keys()) {
    const all = deps.get(key) ?? new Set<string>();
    pending.set(key, new Set([...all].filter((d) => d !== key && inScope.has(d))));
  }

  const ordered: SclContractDto[] = [];
  const emitted = new Set<string>();
  let cycleReported = false;
  while (emitted.size < inScope.size) {
    // Ready = every dependency already emitted. Insertion order of `inScope` is
    // (package, symbol) order, so `find` yields the first ready contract of the
    // earliest package -- dependency order still wins over package order.
    const readyKey = [...inScope.keys()].find(
      (k) => !emitted.has(k) && [...pending.get(k)!].every((d) => emitted.has(d))
    );
    if (readyKey === undefined) {
      // CYCLE. Break it by force-emitting ONE member (alphabetically first) and
      // resuming, rather than dumping every remaining contract in symbol order:
      // the live corpus has a single 47-member fragment cycle, and flushing the
      // remainder on the first stall lost the ordering for everything behind it.
      // Resuming instead leaves only genuinely cyclic edges violated — on the
      // live corpus 6 survive, all inside that one cycle.
      const stuck = [...inScope.keys()].filter((k) => !emitted.has(k));
      if (!cycleReported) {
        onCycle?.(stuck);
        cycleReported = true;
      }
      const forced = stuck[0];
      ordered.push(inScope.get(forced)!);
      emitted.add(forced);
      continue;
    }
    ordered.push(inScope.get(readyKey)!);
    emitted.add(readyKey);
  }
  return ordered;
}

/**
 * Cost of ONE contract against the story budget.
 *
 * <p>Behaviour tables cost their row count — identical to the endpoint-group
 * accounting, so a foundation layer and an endpoint group mean the same thing
 * by "budget". Shape and boundary contracts carry no rows but each renders its
 * own section plus a field/outcome table, so they cost 1 rather than 0.
 * Without the floor of 1, every shape layer summed to a cost of ZERO and could
 * never exceed any budget — which is precisely why the shape layers grew
 * unbounded.</p>
 */
/**
 * Rendered-SIZE budget (2026-09-10). One row budget of 40 governed all six
 * layers while rendered specs varied 17K..80K chars -- a 4.6x spread the
 * budget could not see, because row counts are wildly uneven per symbol (one
 * provider method carried 39 rows; eight domain accessors carried 8 rows
 * between them). Cost is now ALSO a function of what actually lands in the
 * spec: verbatim character volume plus per-unit rendering overhead. The
 * default band is calibrated on the two proven-implementable data-access
 * parts (~62-66K chars, both built and passed); the row/operation budget is
 * KEPT as the secondary guard -- it is what protects data-access, where every
 * operation renders a verbatim SQL block (MECH-05), and dropping it would
 * recreate the single 85K spec that budget was built to break up.
 */
export const DEFAULT_SCL_STORY_SIZE_BUDGET_CHARS = 55_000;

const RENDER_OVERHEAD_PER_ROW = 80;
const RENDER_OVERHEAD_PER_OPERATION = 120;
const RENDER_OVERHEAD_PER_FIELD = 60;
const RENDER_OVERHEAD_PER_CONTRACT = 400;

function verbatimLen(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

/** Predicted rendered characters for ONE contract's section of a spec. */
export function predictedRenderedChars(contract: SclContractDto): number {
  const body = bodyOf(contract) as Record<string, unknown>;
  let chars = RENDER_OVERHEAD_PER_CONTRACT;
  if (isBoundary(contract)) {
    const ops = Array.isArray(body.operations) ? body.operations : [];
    for (const raw of ops) {
      const op = (raw ?? {}) as Record<string, unknown>;
      chars += RENDER_OVERHEAD_PER_OPERATION + verbatimLen(op.sqlVerbatim ?? op.sql);
    }
    return chars;
  }
  if (contract.kind === 'shape') {
    const fields = Array.isArray(body.fields) ? body.fields : [];
    return chars + fields.length * RENDER_OVERHEAD_PER_FIELD;
  }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  for (const raw of rows) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const outcome = (row.outcome ?? {}) as Record<string, unknown>;
    chars +=
      RENDER_OVERHEAD_PER_ROW +
      verbatimLen(row.conditionVerbatim) +
      verbatimLen(outcome.verbatim) +
      verbatimLen(outcome.targetSymbol) +
      verbatimLen(outcome.outcomeLabel);
  }
  return chars;
}

/** Dominant package of a slice (most contracts; tie -> alphabetical). */
function dominantPackage(contracts: SclContractDto[]): string | undefined {
  const counts = new Map<string, number>();
  for (const c of contracts) {
    const pkg = packageOf(c);
    counts.set(pkg, (counts.get(pkg) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = -1;
  for (const [pkg, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = pkg;
      bestCount = count;
    }
  }
  return best && best.length > 0 ? best : undefined;
}

/**
 * A contract with a signature and NOTHING to build from (2026-09-09).
 *
 * Live shape: a data-access contract whose own gloss said "the boundary
 * symbol, the operation name, the result shape -- that is everything: no
 * table, no statement, no predicate, no parameter list, no result-set label
 * and no log fragment appears in any row", plus behaviour tables with
 * literally empty row lists. Five of the six NOT CAPTURED throws on a whole
 * branch came from those contracts.
 *
 * Per-contract and OPERATION-aware on purpose: the shape and boundary layers
 * are zero-ROW by design (`countRows: false`), yet a data-access part with
 * verbatim `@Query` SQL is perfectly implementable -- so the layer row count
 * is the wrong signal; only a contract with no rows, no SQL-bearing
 * operation and no fields is unimplementable.
 */
export function contractIsUnimplementable(contract: SclContractDto): boolean {
  const body = bodyOf(contract) as Record<string, unknown>;
  if (isBoundary(contract)) {
    const ops = Array.isArray(body.operations) ? body.operations : [];
    return !ops.some((op) => {
      const o = (op ?? {}) as Record<string, unknown>;
      const sql = typeof o.sqlVerbatim === 'string' ? o.sqlVerbatim : typeof o.sql === 'string' ? o.sql : '';
      return sql.trim().length > 0;
    });
  }
  if (contract.kind === 'shape') {
    return !(Array.isArray(body.fields) && body.fields.length > 0);
  }
  return rowCountOf(contract) === 0;
}

function contractCostOf(contract: SclContractDto): number {
  // Boundaries cost by their OPERATIONS (2026-09-03, MECH-05): each renders a
  // verbatim SQL block, so a 32-DAO data-access layer at cost 1 each never
  // exceeded any budget and grew to the largest spec in the book by 87%.
  if (isBoundary(contract)) {
    const ops = bodyOf(contract).operations;
    return Math.max(1, Array.isArray(ops) ? ops.length : 0);
  }
  return Math.max(1, rowCountOf(contract));
}

/**
 * Plan ONE foundation layer, splitting it into `(part N)` stories when it
 * exceeds the story budget.
 *
 * <p><b>Why this splits (2026-08-30).</b> `buildEndpointGroups` has always
 * enforced `rowBudget`, but foundation layers bypassed it entirely: every
 * contract in a layer landed in exactly one story no matter how large. On a
 * live corpus that produced four unbounded stories — cross-cutting fragments
 * approaching half a megabyte of spec text, the test kit and DTO-shape layers
 * each in the hundreds of kilobytes — together roughly a third of the entire
 * generated book, and the test kit is a hard dependency of every endpoint
 * story, so its size sat directly on the critical path.</p>
 *
 * <p>Parts PARTITION the layer: every contract lands in exactly one part, in
 * deterministic symbol order, and no contract is duplicated across parts. A
 * single contract whose own cost exceeds the budget still yields exactly one
 * part rather than being torn apart — same rule as the endpoint slicer.</p>
 */
function planFoundationLayer(args: {
  layer: string;
  title: string;
  description: string;
  contracts: SclContractDto[];
  countRows: boolean;
  rowBudget: number;
  /** Rendered-size budget in chars (2026-09-10); omitted = no size term (tests of the row rule). */
  sizeBudgetChars?: number;
  onSplit: () => void;
  /**
   * Intra-corpus dependency edges (2026-09-07). When supplied, the layer is
   * partitioned in BUILD order rather than alphabetical order, so a contract
   * never lands in an earlier part than something it references. Omitted =>
   * alphabetical, byte-identical to the pre-fix behaviour.
   */
  deps?: Map<string, Set<string>>;
  onCycle?: (members: string[]) => void;
}): SclPlannedStory[] {
  const sorted = args.deps
    ? topologicalContractOrder(args.contracts, args.deps, args.onCycle)
    : [...args.contracts].sort(bySymbol);
  const total = sorted.reduce((sum, c) => sum + contractCostOf(c), 0);

  const mk = (
    slice: SclContractDto[],
    part: number | null,
    totalParts: number
  ): SclPlannedStory => ({
    layer: args.layer,
    title: args.title + (part !== null ? ` (part ${part})` : ''),
    description:
      part === null
        ? args.description
        : `${args.description} PART ${part} of ${totalParts}: ` +
          `${slice.length} of ${sorted.length} contract(s) in this layer. The layer is ` +
          `split on the ${args.rowBudget}-unit story budget; the parts partition the ` +
          `layer in ${args.deps ? 'BUILD (dependency) order' : 'symbol order'} with NO ` +
          `overlap and NO omission.` +
          (args.deps
            ? ` A contract never appears in an earlier part than a contract it ` +
              `references, so each part is buildable once its predecessors are done.`
            : ''),
    contractKeys: slice.map(keyOf),
    rowCount: args.countRows ? slice.reduce((sum, c) => sum + rowCountOf(c), 0) : 0,
    predictedChars: slice.reduce((sum, c) => sum + predictedRenderedChars(c), 0),
    clusterKey: dominantPackage(slice),
    tags: ['scl', `scl:foundation:${args.layer}`],
  });

  const sizeBudget = args.sizeBudgetChars ?? Number.POSITIVE_INFINITY;
  const totalChars = sorted.reduce((sum, c) => sum + predictedRenderedChars(c), 0);
  if (total <= args.rowBudget && totalChars <= sizeBudget) return [mk(sorted, null, 1)];

  args.onSplit();
  const slices: SclContractDto[][] = [];
  let current: SclContractDto[] = [];
  let currentCost = 0;
  let currentChars = 0;
  for (const contract of sorted) {
    const cost = contractCostOf(contract);
    const chars = predictedRenderedChars(contract);
    // Either budget trips a split: the size term is the primary shape of a
    // part; the row/operation term is the secondary guard (MECH-05).
    if (current.length > 0 && (currentCost + cost > args.rowBudget || currentChars + chars > sizeBudget)) {
      slices.push(current);
      current = [];
      currentCost = 0;
      currentChars = 0;
    }
    current.push(contract);
    currentCost += cost;
    currentChars += chars;
  }
  if (current.length > 0) slices.push(current);
  return slices.map((slice, i) => mk(slice, i + 1, slices.length));
}

/**
 * Forward references across the foundation stories: a story carrying a
 * contract that references a contract carried by a LATER story. Exported for
 * tests; reported on `stats.forwardReferences`.
 */
export function foundationForwardReferences(
  stories: SclPlannedStory[],
  deps: Map<string, Set<string>>
): string[] {
  const storyIndexByKey = new Map<string, number>();
  stories.forEach((story, index) => {
    for (const key of story.contractKeys) {
      if (!storyIndexByKey.has(key)) storyIndexByKey.set(key, index);
    }
  });
  const violations: string[] = [];
  stories.forEach((story, index) => {
    for (const key of story.contractKeys) {
      for (const dep of deps.get(key) ?? new Set<string>()) {
        const depIndex = storyIndexByKey.get(dep);
        if (depIndex === undefined || depIndex <= index) continue;
        violations.push(
          `'${story.title}' carries ${key} which references ${dep}, carried by the ` +
            `later story '${stories[depIndex].title}'`
        );
      }
    }
  });
  return violations.sort();
}

/**
 * PURE corpus-plan derivation. Same contracts in ⇒ identical plan out
 * (deterministic ordering everywhere — sort by symbol / class).
 */
export function deriveCorpusPlan(
  contracts: SclContractDto[],
  options?: { rowBudget?: number; sizeBudgetChars?: number }
): SclCorpusPlan {
  const rawBudget = options?.rowBudget;
  const rowBudget =
    typeof rawBudget === 'number' && Number.isFinite(rawBudget) && Math.floor(rawBudget) >= 1
      ? Math.floor(rawBudget)
      : DEFAULT_SCL_STORY_ROW_BUDGET;
  const rawSize = options?.sizeBudgetChars;
  const sizeBudgetChars =
    typeof rawSize === 'number' && Number.isFinite(rawSize) && Math.floor(rawSize) >= 1000
      ? Math.floor(rawSize)
      : DEFAULT_SCL_STORY_SIZE_BUDGET_CHARS;

  const boundaries = contracts.filter(isBoundary);
  const shapes = contracts.filter((c) => !isBoundary(c) && c.kind === 'shape');
  const tables = contracts.filter((c) => !isBoundary(c) && c.kind === 'behaviour_table');

  // -- Table classification --------------------------------------------------
  const rootTables = tables.filter(isRootTable);
  const externalRoots = rootTables.filter(isHttpAnnotated);
  const internalRoots = rootTables.filter((c) => !isHttpAnnotated(c));

  // Shared (fan_in >= 2) NON-root behaviour tables = the hoisted fragments.
  const sharedFragments = tables.filter((c) => !isRootTable(c) && isSharedContract(c));
  const utilityFragments = sharedFragments.filter((c) =>
    UTILITY_CLASS_RE.test(simpleClassName(classOfSymbol(symbolOf(c))))
  );
  const utilityKeys = new Set(utilityFragments.map(keyOf));
  const crossCuttingFragments = sharedFragments.filter((c) => !utilityKeys.has(keyOf(c)));

  // -- Shape partition -------------------------------------------------------
  const isEnumShape = (c: SclContractDto) =>
    (bodyOf(c) as Record<string, unknown>).representation === 'enum';
  const isExceptionShape = (c: SclContractDto) =>
    simpleClassName(classOfSymbol(symbolOf(c))).endsWith('Exception');

  // -- Dependency edges (2026-09-07) -----------------------------------------
  const contractDeps = buildContractDependencies(contracts);
  const dependencyCycles: string[][] = [];
  const onCycle = (members: string[]) => {
    // The same shapes are partitioned twice (their own layer + the test kit),
    // so a cycle would otherwise be reported once per layer it appears in.
    const sorted = [...members].sort();
    const seen = dependencyCycles.some(
      (c) => c.length === sorted.length && c.every((k, i) => k === sorted[i])
    );
    if (!seen) dependencyCycles.push(sorted);
  };

  // The constants layer is built FIRST and its description promises a
  // zero-dependency layer, so a shape may only join it when EVERYTHING it
  // references is also in it. Classifying by name alone broke that promise:
  // an exception whose field typed against a DTO was built before the DTO.
  // Iterated to a fixed point: evicting one shape can strand another that
  // referenced it.
  const shapeKeys = new Set(shapes.map(keyOf));
  const constantsById = new Map(
    shapes.filter((c) => isEnumShape(c) || isExceptionShape(c)).map((c) => [keyOf(c), c])
  );
  const evictedFromConstants: string[] = [];
  for (;;) {
    const offender = [...constantsById.values()].find((c) =>
      [...(contractDeps.get(keyOf(c)) ?? new Set<string>())].some(
        (d) => shapeKeys.has(d) && !constantsById.has(d)
      )
    );
    if (!offender) break;
    constantsById.delete(keyOf(offender));
    evictedFromConstants.push(symbolOf(offender));
  }
  evictedFromConstants.sort();

  const constantsShapes = shapes.filter((c) => constantsById.has(keyOf(c)));
  const dtoShapes = shapes.filter((c) => !constantsById.has(keyOf(c)));

  const shapeFlags = (c: SclContractDto): string[] => {
    const flags = (bodyOf(c) as Record<string, unknown>).flags;
    return Array.isArray(flags) ? flags.filter((f): f is string => typeof f === 'string') : [];
  };
  const mutatedCount = dtoShapes.filter((c) =>
    shapeFlags(c).includes('mutated-in-flight')
  ).length;
  const sealedCount = dtoShapes.filter((c) =>
    shapeFlags(c).some((f) => f.startsWith('sealed'))
  ).length;

  // -- The 6 foundational layers, in order; EMPTY layers omitted -------------
  // Foundation layers are budget-split exactly like endpoint groups; this
  // counts the LAYERS that had to split, mirroring `splitCount` for controllers.
  let foundationSplitCount = 0;
  const onFoundationSplit = () => {
    foundationSplitCount += 1;
  };
  const foundationStories: SclPlannedStory[] = [];

  if (constantsShapes.length > 0) {
    const enums = constantsShapes.filter(isEnumShape);
    const exceptions = constantsShapes.filter((c) => !isEnumShape(c));
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'constants-exceptions',
        title: 'Constants, enums & exception types',
        description:
          `${enums.length} enum(s) and ${exceptions.length} exception type(s) from the SCL ` +
          `corpus shape contracts: ${boundedSymbols(constantsShapes)}. Built first: every ` +
          `contract here references only other contracts in this layer` +
          (evictedFromConstants.length > 0
            ? `. ${evictedFromConstants.length} name-matched type(s) were moved to the ` +
              `DTO & domain shapes layer because they reference shapes built later: ` +
              `${evictedFromConstants.slice(0, 5).join(', ')}` +
              (evictedFromConstants.length > 5 ? ` (+${evictedFromConstants.length - 5} more)` : '')
            : ' — a genuinely zero-dependency layer') +
          '.',
        contracts: constantsShapes,
        countRows: false,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  if (dtoShapes.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'dto-shapes',
        title: 'DTO & domain shapes',
        description:
          `${dtoShapes.length} shape contract(s) (fields, nullability, wire names normative); ` +
          `${mutatedCount} mutated-in-flight (record-conversion hazard), ` +
          `${sealedCount} sealed-variant candidate(s). Implement per the shape contracts, ` +
          `citing the modernization decisions for representation.`,
        contracts: dtoShapes,
        countRows: false,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  // LAYER ORDER (revised 2026-09-07). Utilities and data-access are emitted
  // BEFORE the cross-cutting fragments, because the dependency edges run that
  // way and the previous order contradicted them. Measured on the live corpus:
  //
  //   cross-cutting-fragments -> dto-shapes            109  (satisfied)
  //   cross-cutting-fragments -> data-access            48  (was VIOLATED)
  //   dto-shapes -> constants-exceptions                30  (satisfied)
  //   cross-cutting-fragments -> constants-exceptions   16  (satisfied)
  //   cross-cutting-fragments -> utilities               2  (was VIOLATED)
  //
  // and, decisively, data-access and utilities have ZERO outbound cross-layer
  // edges -- they are pure sinks, so promoting them cannot create a new
  // violation. Fragments call DAOs and utils, never the reverse.
  if (utilityFragments.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'utilities',
        title: 'Utility functions package',
        description:
          `${utilityFragments.length} shared utility fragment(s) (*Utils/*Util/*Helper, ` +
          `fan-in >= 2): ${boundedSymbols(utilityFragments)}. Built after the near-duplicate ` +
          `consolidation decisions.`,
        contracts: utilityFragments,
        countRows: true,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  if (boundaries.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'data-access',
        title: 'Data-access layer',
        description:
          `${boundaries.length} boundary [Q-] contract(s) — repositories/DAOs implementing the ` +
          `verbatim SQL / derived-query outcomes: ${boundedSymbols(boundaries)}.`,
        contracts: boundaries,
        countRows: false,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  // Fragments come AFTER utilities + data-access: they call into both (48 + 2
  // measured edges) and neither calls back.
  if (crossCuttingFragments.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'cross-cutting-fragments',
        title: 'Cross-cutting shared fragments',
        description:
          `${crossCuttingFragments.length} shared behaviour fragment(s) (fan-in >= 2) hoisted ` +
          `out of the endpoint verticals: ${boundedSymbols(crossCuttingFragments)}. ` +
          `Implemented ONCE here; endpoint stories reference their outcome labels. ` +
          `Built after the utility and data-access layers, which these fragments call into.`,
        contracts: crossCuttingFragments,
        countRows: true,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  if (shapes.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'test-kit',
        title: 'Test kit — fixture builders',
        description:
          `Fixture builders generated from the ${shapes.length} shape contract(s) — the shared ` +
          `test kit every endpoint story's generated per-row suite consumes for its inputs and ` +
          `expected values.`,
        contracts: shapes,
        countRows: false,
        rowBudget,
        onSplit: onFoundationSplit,
        sizeBudgetChars,
        deps: contractDeps,
        onCycle,
      })
    );
  }

  // -- Endpoint groups: external first, then internal ------------------------
  const byKey = new Map<string, SclContractDto>();
  const byContractSymbol = new Map<string, SclContractDto>();
  for (const contract of contracts) {
    const key = contract.contract_key;
    if (typeof key === 'string' && !byKey.has(key)) byKey.set(key, contract);
    const symbol = symbolOf(contract);
    if (symbol && !byContractSymbol.has(symbol)) byContractSymbol.set(symbol, contract);
  }
  const resolve = (ref: string) => byKey.get(ref) ?? byContractSymbol.get(ref);

  const stats: SclCorpusPlanStats = {
    sharedContractCount: contracts.filter(isSharedContract).length,
    controllerCount: 0,
    splitCount: 0,
    foundationSplitCount,
    rowBudget,
    sizeBudgetChars,
    constantsEvicted: evictedFromConstants,
    dependencyCycles,
    forwardReferences: foundationForwardReferences(foundationStories, contractDeps),
    unimplementableContracts: contracts
      .filter(contractIsUnimplementable)
      .map(keyOf)
      .sort(),
  };
  const onController = () => {
    stats.controllerCount += 1;
  };
  const onSplit = () => {
    stats.splitCount += 1;
  };

  const externalEndpointGroups = buildEndpointGroups({
    roots: externalRoots,
    resolve,
    kind: 'external',
    rowBudget,
    sizeBudgetChars,
    onSplit,
    onController,
  });
  const internalEndpointGroups = buildEndpointGroups({
    roots: internalRoots,
    resolve,
    kind: 'internal',
    rowBudget,
    sizeBudgetChars,
    onSplit,
    onController,
  });

  // Boundaries reached (2026-09-03): walk each story's contracts over
  // `references`; collect every Q- boundary encountered; never descend past a
  // boundary. Deterministic (sorted) so the blob stays stable.
  const withBoundaries = (story: SclPlannedStory): SclPlannedStory => ({
    ...story,
    boundaryKeys: boundariesReachedBy(story.contractKeys, resolve),
  });
  const planned = {
    foundationStories: foundationStories.map(withBoundaries),
    externalEndpointGroups: externalEndpointGroups.map(withBoundaries),
    internalEndpointGroups: internalEndpointGroups.map(withBoundaries),
  };
  // Clustering-rule assertion (2026-09-03, IMPL-06): the rule is applied to
  // endpoint groups AND foundation layers alike; anything still over budget
  // is named rather than silently accepted. Both budgets are reported since
  // 2026-09-10 -- a story splits when EITHER the row/operation budget or the
  // rendered-size budget is exceeded, so naming only the row budget described
  // a rule the planner no longer applies on its own.
  stats.clusteringRule = 'row_and_size_budget';
  stats.overSizeStories = [...planned.foundationStories, ...planned.externalEndpointGroups, ...planned.internalEndpointGroups]
    .filter((s) => (s.predictedChars ?? 0) > sizeBudgetChars)
    .map((s) => s.title);
  stats.overBudgetStories = [
    ...planned.externalEndpointGroups,
    ...planned.internalEndpointGroups,
    ...planned.foundationStories,
  ]
    .filter((s) => s.rowCount > rowBudget)
    .map((s) => s.title);
  return { ...planned, stats };
}

// ---------------------------------------------------------------------------
// AMS-backed loader (scans/latest → contracts include_body=true, per the
// sclAnnotationPass idiom)
// ---------------------------------------------------------------------------

export interface SclCorpusPlannerDeps {
  /** GET /scl/scans/latest — null when no scan exists. */
  fetchScan: (projectId: string, architectureId: string) => Promise<SclScanWire | null>;
  /** GET /scl/scans/{scanId}/contracts?kind=...&include_body=true */
  fetchContracts: (
    projectId: string,
    architectureId: string,
    scanId: string,
    kind: string
  ) => Promise<SclContractDto[]>;
}

function sclBase(projectId: string, architectureId: string): string {
  return (
    `${getConfig().architectureModelServiceBaseUrl}/api/model/projects/` +
    `${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/scl`
  );
}

async function amsGetJsonOrNull<T>(url: string, label: string): Promise<T | null> {
  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`AMS ${label} failed: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

const defaultDeps: SclCorpusPlannerDeps = {
  fetchScan: (projectId, architectureId) =>
    amsGetJsonOrNull<SclScanWire>(
      `${sclBase(projectId, architectureId)}/scans/latest`,
      'fetch_scl_scan'
    ),
  fetchContracts: async (projectId, architectureId, scanId, kind) => {
    const url =
      `${sclBase(projectId, architectureId)}/scans/${encodeURIComponent(scanId)}/contracts` +
      `?kind=${encodeURIComponent(kind)}&include_body=true`;
    const rows = await amsGetJsonOrNull<SclContractDto[]>(url, 'fetch_scl_contracts');
    return Array.isArray(rows) ? rows : [];
  },
};

export type LoadCorpusPlanFn = (
  projectId: string,
  currentArchitectureId: string
) => Promise<SclCorpusPlan | null>;

/**
 * The latest scan's FULL contract list (behaviour tables + shapes +
 * boundaries, include_body=true) — the exact AMS read {@link loadCorpusPlan}
 * derives its plan from, exported for the SCL spec carriage (spec 8), which
 * needs the raw contracts rather than the derived plan. Returns null when no
 * scan exists; read failures THROW (the spec-generation caller owns the
 * fail-soft catch → SCL stories go insufficient_context, never the LLM path).
 */
export async function fetchLatestSclContracts(
  projectId: string,
  currentArchitectureId: string,
  deps?: Partial<SclCorpusPlannerDeps>
): Promise<SclContractDto[] | null> {
  const d: SclCorpusPlannerDeps = { ...defaultDeps, ...deps };
  const scan = await d.fetchScan(projectId, currentArchitectureId);
  if (!scan?.id) return null;
  const scanId = scan.id;
  const tables = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'behaviour_table');
  const shapes = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'shape');
  const boundaries = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'boundary');
  return [...tables, ...shapes, ...boundaries];
}

/**
 * Load the latest SCL scan's contracts and derive the corpus plan with the
 * config row budget. Returns null (FAIL-SOFT) when no scan exists or the
 * corpus yields ZERO endpoint groups — an empty/rootless corpus must never
 * replace the legacy interface expansion with nothing. Read failures THROW;
 * the expansion caller owns the catch-and-take-legacy-path posture.
 */
export async function loadCorpusPlan(
  projectId: string,
  currentArchitectureId: string,
  deps?: Partial<SclCorpusPlannerDeps>
): Promise<SclCorpusPlan | null> {
  const d: SclCorpusPlannerDeps = { ...defaultDeps, ...deps };

  const scan = await d.fetchScan(projectId, currentArchitectureId);
  if (!scan?.id) {
    console.log(
      `[diag-gateway] scl_corpus_plan absent projectId=${projectId} ` +
        `architectureId=${currentArchitectureId} reason=no_scan`
    );
    return null;
  }
  const scanId = scan.id;

  const tables = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'behaviour_table');
  const shapes = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'shape');
  const boundaries = await d.fetchContracts(projectId, currentArchitectureId, scanId, 'boundary');
  const contracts = [...tables, ...shapes, ...boundaries];

  let rowBudget = DEFAULT_SCL_STORY_ROW_BUDGET;
  try {
    rowBudget = getConfig().sclStoryRowBudget;
  } catch {
    // Config unavailable in some unit-test contexts — keep the default.
  }

  const plan = deriveCorpusPlan(contracts, { rowBudget });
  if (plan.externalEndpointGroups.length + plan.internalEndpointGroups.length === 0) {
    console.log(
      `[diag-gateway] scl_corpus_plan absent projectId=${projectId} ` +
        `architectureId=${currentArchitectureId} scanId=${scanId} reason=no_endpoint_roots ` +
        `contracts=${contracts.length}`
    );
    return null;
  }
  console.log(
    `[diag-gateway] scl_corpus_plan loaded projectId=${projectId} scanId=${scanId} ` +
      `contracts=${contracts.length} foundationLayers=${plan.foundationStories.length} ` +
      `externalGroups=${plan.externalEndpointGroups.length} ` +
      `internalGroups=${plan.internalEndpointGroups.length} rowBudget=${rowBudget}`
  );
  return plan;
}
