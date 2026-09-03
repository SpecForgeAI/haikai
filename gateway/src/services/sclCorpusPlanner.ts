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
 *   - 6 foundational layers, in build (topological) order:
 *       1. constants-exceptions   enums + *Exception shapes
 *       2. dto-shapes             every remaining shape contract
 *       3. cross-cutting-fragments shared (fan-in>=2) non-root, non-utility
 *                                 behaviour tables (envelope builders etc.)
 *       4. utilities              shared *Utils/*Util/*Helper fragments
 *       5. data-access            ALL boundary [Q-] contracts
 *       6. test-kit               fixture builders from the shape contracts
 *     EMPTY layers are omitted;
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
    if (total <= rowBudget) {
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
    for (const cost of costs) {
      const methodRows = cost.ownRows + cost.residueRows;
      if (current.length > 0 && currentRows + methodRows > rowBudget) {
        slices.push(current);
        current = [];
        currentRows = 0;
      }
      current.push(cost);
      currentRows += methodRows;
    }
    if (current.length > 0) slices.push(current);
    slices.forEach((slice, i) =>
      stories.push(endpointGroupStory({ cls, kind, slice, part: i + 1 }))
    );
  }
  return stories;
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
function contractCostOf(contract: SclContractDto): number {
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
  onSplit: () => void;
}): SclPlannedStory[] {
  const sorted = [...args.contracts].sort(bySymbol);
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
          `layer in symbol order with NO overlap and NO omission.`,
    contractKeys: slice.map(keyOf),
    rowCount: args.countRows ? slice.reduce((sum, c) => sum + rowCountOf(c), 0) : 0,
    tags: ['scl', `scl:foundation:${args.layer}`],
  });

  if (total <= args.rowBudget) return [mk(sorted, null, 1)];

  args.onSplit();
  const slices: SclContractDto[][] = [];
  let current: SclContractDto[] = [];
  let currentCost = 0;
  for (const contract of sorted) {
    const cost = contractCostOf(contract);
    if (current.length > 0 && currentCost + cost > args.rowBudget) {
      slices.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(contract);
    currentCost += cost;
  }
  if (current.length > 0) slices.push(current);
  return slices.map((slice, i) => mk(slice, i + 1, slices.length));
}

/**
 * PURE corpus-plan derivation. Same contracts in ⇒ identical plan out
 * (deterministic ordering everywhere — sort by symbol / class).
 */
export function deriveCorpusPlan(
  contracts: SclContractDto[],
  options?: { rowBudget?: number }
): SclCorpusPlan {
  const rawBudget = options?.rowBudget;
  const rowBudget =
    typeof rawBudget === 'number' && Number.isFinite(rawBudget) && Math.floor(rawBudget) >= 1
      ? Math.floor(rawBudget)
      : DEFAULT_SCL_STORY_ROW_BUDGET;

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
  const constantsShapes = shapes.filter((c) => isEnumShape(c) || isExceptionShape(c));
  const dtoShapes = shapes.filter((c) => !isEnumShape(c) && !isExceptionShape(c));

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
          `corpus shape contracts: ${boundedSymbols(constantsShapes)}. Zero-dependency layer — built first.`,
        contracts: constantsShapes,
        countRows: false,
        rowBudget,
        onSplit: onFoundationSplit,
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
      })
    );
  }

  if (crossCuttingFragments.length > 0) {
    foundationStories.push(
      ...planFoundationLayer({
        layer: 'cross-cutting-fragments',
        title: 'Cross-cutting shared fragments',
        description:
          `${crossCuttingFragments.length} shared behaviour fragment(s) (fan-in >= 2) hoisted ` +
          `out of the endpoint verticals: ${boundedSymbols(crossCuttingFragments)}. ` +
          `Implemented ONCE here; endpoint stories reference their outcome labels.`,
        contracts: crossCuttingFragments,
        countRows: true,
        rowBudget,
        onSplit: onFoundationSplit,
      })
    );
  }

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
    onSplit,
    onController,
  });
  const internalEndpointGroups = buildEndpointGroups({
    roots: internalRoots,
    resolve,
    kind: 'internal',
    rowBudget,
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
  return {
    foundationStories: foundationStories.map(withBoundaries),
    externalEndpointGroups: externalEndpointGroups.map(withBoundaries),
    internalEndpointGroups: internalEndpointGroups.map(withBoundaries),
    stats,
  };
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
