/**
 * Endpoint -> Data-Effect resolver (Spring Classic).
 *
 * Spec: 2026-05-29 Endpoint->Data-Effect Call Graph for Discovery
 * (Java / Spring Classic first), Task Group 3.
 *
 * Walks the common Spring Classic happy path for each INBOUND HTTP controller
 * mapping method:
 *
 *   controller mapping method
 *     -> (optionally through one or more SAME-CLASS private helpers)
 *       -> call on an autowired @Service / @Component field
 *         -> that service method
 *           -> call on an autowired @Repository / Spring-Data interface field
 *             -> entity (via the repository generic type param JpaRepository<Owner,Long>
 *                -> Owner, OR the captured @Entity / @Table)
 *
 * For every (endpoint, data-entity) pair reached, it produces ONE resolved
 * data-effect edge carrying:
 *   - `access_mode` ∈ {read, write, read-write}
 *   - an operation hint (insert / update / delete / select / insert-or-update)
 *   - `transactional: true | false` (any @Transactional on the resolved path)
 *   - `confidence` (driving the three-outcome model upstream)
 *   - a STRUCTURED ordered list of path hops (each hop = FQN + method signature)
 *   - the VERBATIM SQL/JPQL text behind the edge when one is statically
 *     capturable from the resolved repository method (Data-Layer Fidelity 2,
 *     Task Group A) -- a `@Query` JPQL / native string or a MyBatis mapper
 *     `@Select`/`@Insert`/`@Update`/`@Delete` string.
 *
 * Multi-verb / multi-path mappings (Spec #4 Task Group 6 — closing
 * `TODO(oracle-W1)`): a `@RequestMapping(method={GET,POST})` and/or a
 * `@GetMapping({"/a","/b"})` maps the SAME handler to several
 * (verb x path) variants. W1 already fans out one `endpoints` candidate per
 * variant in the adapter; this resolver now aligns by attaching its data-effect
 * edges (and any unresolved-chain findings) to EVERY (verb x path) variant's
 * `endpointName`, not just the first — so Spec #1's edges line up with the
 * fanned-out endpoint set instead of binding to a single (possibly garbled)
 * name. The downstream walk is run ONCE; only the output `endpointName` is
 * fanned out (the resolution is independent of the endpoint label).
 *
 * Same-class private helpers (2026-05-29 hardening): when a controller mapping
 * method delegates the actual service/repository call to a SAME-CLASS private
 * helper (receiver = `null` for an un-qualified `getVets()` call, or `this` for
 * `this.getVets()`), the walk follows the helper's body and continues the
 * controller->service->repository->entity resolution through it (bounded
 * recursion + cycle guard). The helper is transparent to the persisted path:
 * the controller hop stays the mapping method, the service/repository hops are
 * whatever the helper reaches. This recovers idiomatic endpoints such as the
 * classic PetClinic `GET /vets` / `/vets.json` / `/vets.xml` -> private
 * `getVets()` -> `clinicService.findVets()` -> `Vet` read.
 *
 * When the chain cannot be statically resolved (multiple impls / dynamic
 * dispatch / JdbcTemplate / native SQL / EntityManager.createQuery / reflection
 * / hops deeper than this resolver handles), it produces an UNRESOLVED result
 * instead -- never a fabricated edge. The caller turns those into discovery
 * Findings (Task Group 3.5). The same guarantee now covers the helper-inlining
 * walk: a mapping method that made collaborator/helper calls but resolved to
 * ZERO edges surfaces an `unfollowable_call` UNRESOLVED result rather than a
 * silent drop. Data-Layer Fidelity 2 (Task Group A) additionally captures the
 * VERBATIM JdbcTemplate / native SQL string ON that unresolved finding's
 * `detail` instead of discarding it, so the migration sees the actual query
 * even when the touched table cannot be statically resolved to an entity.
 *
 * The resolver persists ONLY the relevant subgraph: the hops on an endpoint
 * -> data path. The rest of the call graph is discarded.
 *
 * Pure: no I/O. Reads the supplied `SourceFileIR[]` only. Designed to be called
 * BOTH from the framework adapter (to emit `endpoint_data_effects` candidates)
 * AND from the finding scanner (to emit unresolved-chain findings) over the
 * same IR -- running it twice is cheap and keeps candidate vs finding emission
 * cleanly separated.
 */

import type {
  SourceFileIR,
  ClassIR,
  FieldIR,
  FunctionIR,
  CallIR,
  AnnotationIR,
} from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTROLLER_ANNOTATIONS = ['RestController', 'Controller'];
const ENDPOINT_ANNOTATIONS = [
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'RequestMapping',
];
const HTTP_METHOD_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

// Async / message-driven / scheduled inbound surfaces -- v1 gives these NO
// data-effect edges (spec: inbound HTTP controllers only).
const ASYNC_METHOD_ANNOTATIONS = [
  'JmsListener',
  'KafkaListener',
  'RabbitListener',
  'SqsListener',
  'EventListener',
  'Scheduled',
];

const SERVICE_STEREOTYPES = ['Service', 'Component'];
const REPOSITORY_STEREOTYPE = 'Repository';
const TRANSACTIONAL_ANNOTATION = 'Transactional';

// Receivers that denote a SAME-CLASS (`this`) method call. The Java extractor
// records an un-qualified `getVets()` as receiver=null and a `this.getVets()`
// as receiver="this" (the `object` field is the bare `this` node). Both mean
// "a method on the class itself" -- a candidate same-class helper to inline.
const SELF_RECEIVERS = new Set<string | null | undefined>([null, undefined, 'this']);

// Spring-Data repository base interfaces whose generic type param[0] is the
// managed entity (`JpaRepository<Owner, Long>` -> `Owner`).
const SPRING_DATA_REPO_BASES = new Set([
  'Repository',
  'CrudRepository',
  'PagingAndSortingRepository',
  'JpaRepository',
  'MongoRepository',
  'JpaSpecificationExecutor',
  'ReactiveCrudRepository',
  'R2dbcRepository',
]);

// Bare-metal / dynamic-dispatch persistence signals that this resolver cannot
// statically follow to a single entity. Hitting one yields an UNRESOLVED
// result (a finding), never a guessed edge.
const DYNAMIC_PERSISTENCE_TYPES = new Set([
  'JdbcTemplate',
  'NamedParameterJdbcTemplate',
  'JdbcOperations',
  'NamedParameterJdbcOperations',
  'SimpleJdbcTemplate',
  'SimpleJdbcCall',
  'EntityManager',
  'SessionFactory',
  'Session',
  'DataSource',
]);

const DYNAMIC_PERSISTENCE_METHODS = new Set([
  'createQuery',
  'createNativeQuery',
  'createSQLQuery',
  'createNamedQuery',
  'createStoredProcedureQuery',
]);

// MyBatis statement-bearing annotations on a mapper method. When the resolver
// reaches a mapper method carrying one of these, the verbatim SQL string in its
// `value` arg is captured as `query_kind: 'mybatis'` (Data-Layer Fidelity 2,
// Task Group A). These are the inline-SQL annotations; XML-mapper SQL is not
// statically reachable from the IR and is intentionally left to its Finding.
const MYBATIS_STATEMENT_ANNOTATIONS = ['Select', 'Insert', 'Update', 'Delete'];

// Maximum controller -> service -> repository depth the resolver follows.
// One controller hop + a bounded service-call walk. Anything deeper is a
// finding (`too_deep`), not a silent drop.
const MAX_RESOLVE_DEPTH = 6;

// Maximum number of SAME-CLASS helper hops the walk inlines from a single
// mapping method before it stops following (bounded recursion). A cycle guard
// (visited method-id set) sits on top of this so mutually-recursive helpers
// terminate well before the budget. Spring controllers practically never nest
// helpers more than a hop or two deep; this is generous head-room.
const MAX_HELPER_DEPTH = 8;

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** One hop on a resolved endpoint->data path. FQN + method signature. */
export interface PathHop {
  /** Stable method id (FQN + signature), e.g. `com.foo.OwnerService#save(Owner)`. */
  methodId: string;
  /** Simple class name of the hop (e.g. `OwnerService`). */
  className: string;
  /** Simple method name of the hop (e.g. `save`). */
  methodName: string;
  /** The architectural role of the hop on the path. */
  role: 'controller' | 'service' | 'repository';
}

export type AccessMode = 'read' | 'write' | 'read-write';
export type OperationHint =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'insert-or-update';

/**
 * The dialect/source of a captured SQL/JPQL string per endpoint data-effect
 * (Data-Layer Fidelity 2, Task Group A). Verbatim text is captured alongside
 * this discriminator so the migration sees the ACTUAL query, not just the table.
 *   - `jpql`          : a `@Query("SELECT e FROM Entity e ...")` JPQL string.
 *   - `native`        : a `@Query(value="SELECT * FROM t", nativeQuery=true)` string.
 *   - `jdbc_template` : a JdbcTemplate / NamedParameterJdbcTemplate string-SQL arg.
 *   - `mybatis`       : a MyBatis mapper `@Select`/`@Insert`/`@Update`/`@Delete` string.
 */
export type QueryKind = 'jpql' | 'native' | 'jdbc_template' | 'mybatis';

/** A verbatim SQL/JPQL capture (text + dialect) for a resolved repo hop. */
interface CapturedQuery {
  queryText: string;
  queryKind: QueryKind;
}

/** A resolved endpoint->data-entity edge (one per pair). */
export interface ResolvedDataEffect {
  /** Endpoint identity: `${httpMethod} ${fullPath}` (resolves at save-back by name). */
  endpointName: string;
  /** Controller class name (context). */
  controllerClassName: string;
  /** Controller mapping method name (context). */
  endpointMethodName: string;
  /** Target data-entity NAME (resolved at save-back by normalized name). */
  dataEntityName: string;
  accessMode: AccessMode;
  operationHint: OperationHint;
  transactional: boolean;
  confidence: number;
  /** STRUCTURED ordered list of hops (FQN + signature per hop). */
  path: PathHop[];
  /** The source file path of the controller (for candidate `sourceClusterIds`). */
  sourceFilePath: string;
  /**
   * The VERBATIM SQL/JPQL text behind this edge, when one is statically
   * captured from the resolved repository method (Data-Layer Fidelity 2,
   * Task Group A). Sourced from a `@Query` value (JPQL / native) or a MyBatis
   * `@Select`/`@Insert`/`@Update`/`@Delete` value on the repo hop. Undefined
   * when the repository method is a Spring-Data derived query (no explicit SQL).
   * Captured EXACTLY as the annotation carried it -- no normalization.
   */
  queryText?: string;
  /** The dialect/source of {@link queryText}; undefined when no SQL was captured. */
  queryKind?: QueryKind;
}

export type UnresolvedReason =
  | 'multiple_impls'
  | 'dynamic_dispatch'
  | 'jdbc_template'
  | 'native_sql'
  | 'entity_manager'
  | 'reflection'
  | 'too_deep'
  | 'unknown_repository_entity'
  // The mapping method (or a same-class helper it calls) made calls that look
  // like data work but resolved to ZERO edges and no more-specific reason
  // applied -- e.g. a same-class helper whose inner collaborator call could not
  // be followed, or a chained / non-identifier receiver on a collaborator.
  // Restores the spec's "unresolved chains become findings, never silent drops"
  // guarantee for the same-class-helper-inlining walk.
  | 'unfollowable_call';

/**
 * An endpoint touching data we could NOT statically resolve to a single
 * entity. Carries enough context for an actionable finding.
 */
export interface UnresolvedDataEffect {
  endpointName: string;
  controllerClassName: string;
  endpointMethodName: string;
  reason: UnresolvedReason;
  /** Human-readable note on where resolution stopped. */
  detail: string;
  /** The hops resolved BEFORE resolution stopped (may be just the controller). */
  partialPath: PathHop[];
  sourceFilePath: string;
  /**
   * The VERBATIM SQL string the unresolved (JdbcTemplate / native / EntityManager
   * / MyBatis) call carried, when one is statically present in the IR
   * (Data-Layer Fidelity 2, Task Group A). Captured ON the finding instead of
   * discarded, so the migration sees the actual query even when the touched
   * table cannot be statically resolved to a data entity. Undefined when no
   * SQL literal was present (e.g. a dynamically-built query string). Kept
   * VERBATIM -- no normalization.
   */
  queryText?: string;
}

export interface DataEffectResolverOutput {
  resolved: ResolvedDataEffect[];
  unresolved: UnresolvedDataEffect[];
}

// ---------------------------------------------------------------------------
// Internal indexes
// ---------------------------------------------------------------------------

interface ClassEntry {
  cls: ClassIR;
  file: SourceFileIR;
  fqn: string;
}

interface ResolverIndex {
  /** All classes keyed by simple name (last writer wins on dup names). */
  byName: Map<string, ClassEntry>;
  /** Implementations keyed by the interface name they implement (for single-impl resolution). */
  implsByInterface: Map<string, ClassEntry[]>;
}

function fqnOf(file: SourceFileIR, cls: ClassIR): string {
  return file.packageOrNamespace ? `${file.packageOrNamespace}.${cls.name}` : cls.name;
}

function buildResolverIndex(files: SourceFileIR[]): ResolverIndex {
  const byName = new Map<string, ClassEntry>();
  const implsByInterface = new Map<string, ClassEntry[]>();
  for (const file of files) {
    for (const cls of file.classes) {
      const entry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
      byName.set(cls.name, entry);
      if (!cls.isInterface) {
        for (const iface of cls.implements) {
          // `implements` may be generic (`OwnerRepository<Owner>`); key on the
          // simple base name.
          const base = stripGenerics(simpleName(iface));
          const list = implsByInterface.get(base) ?? [];
          list.push(entry);
          implsByInterface.set(base, list);
        }
      }
    }
  }
  return { byName, implsByInterface };
}

// ---------------------------------------------------------------------------
// Small type helpers
// ---------------------------------------------------------------------------

function simpleName(t: string): string {
  const s = t.trim();
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1) : s;
}

function stripGenerics(t: string): string {
  const lt = t.indexOf('<');
  return (lt > 0 ? t.slice(0, lt) : t).trim();
}

/** Extract the leading generic type argument: `JpaRepository<Owner, Long>` -> `Owner`. */
function firstGenericArg(t: string): string | null {
  const m = t.match(/<\s*([^,<>]+)\s*[,>]/);
  return m ? simpleName(stripGenerics(m[1].trim())) : null;
}

function methodIdOf(entry: ClassEntry, m: FunctionIR): string {
  if (m.methodId) return m.methodId;
  // Defensive fallback if the extractor did not stamp an id.
  const params = m.parameters.map((p) => simpleName(stripGenerics(p.type))).join(',');
  return `${entry.fqn}#${m.name}(${params})`;
}

function isController(cls: ClassIR): boolean {
  return CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n));
}

function isMappingMethod(m: FunctionIR): boolean {
  return ENDPOINT_ANNOTATIONS.some((n) => hasAnnotation(m.annotations, n));
}

function isAsyncMethod(m: FunctionIR): boolean {
  return ASYNC_METHOD_ANNOTATIONS.some((n) => hasAnnotation(m.annotations, n));
}

function classIsTransactional(cls: ClassIR): boolean {
  return hasAnnotation(cls.annotations, TRANSACTIONAL_ANNOTATION);
}

function methodIsTransactional(m: FunctionIR): boolean {
  return hasAnnotation(m.annotations, TRANSACTIONAL_ANNOTATION);
}

// ---------------------------------------------------------------------------
// Per-endpoint SQL-text capture (Data-Layer Fidelity 2, Task Group A)
// ---------------------------------------------------------------------------

/**
 * Read the VERBATIM SQL/JPQL behind a resolved repository method, if any:
 *   - `@Query("SELECT e FROM Entity e ...")`                  -> {jpql}
 *   - `@Query(value="SELECT * FROM t", nativeQuery=true)`     -> {native}
 *   - MyBatis `@Select`/`@Insert`/`@Update`/`@Delete("...")`  -> {mybatis}
 *
 * The Java extractor already unquotes the annotation `value` arg (verified:
 * `@Query("SELECT ...")` -> `args.value === "SELECT ..."`), so the captured
 * string is the query EXACTLY as written -- no normalization, no re-quoting.
 *
 * `@Query` native-ness is decided by the `nativeQuery=true` arg (the extractor
 * stringifies the boolean literal, so the value is the string `"true"`).
 *
 * Returns null when the method carries no statically-capturable SQL annotation
 * (e.g. a Spring-Data derived query like `findByLastName`).
 */
function captureRepoMethodQuery(method: FunctionIR | undefined): CapturedQuery | null {
  if (!method) return null;

  // (1) JPA `@Query` -- JPQL by default, native when `nativeQuery=true`.
  const queryAnn = findAnnotation(method.annotations, 'Query');
  if (queryAnn) {
    const text = annotationArg(queryAnn, 'value');
    if (text !== undefined && text.length > 0) {
      const nativeArg = (annotationArg(queryAnn, 'nativeQuery') ?? '').trim().toLowerCase();
      return { queryText: text, queryKind: nativeArg === 'true' ? 'native' : 'jpql' };
    }
  }

  // (2) MyBatis inline-SQL mapper annotations.
  for (const ann of MYBATIS_STATEMENT_ANNOTATIONS) {
    const myb = findAnnotation(method.annotations, ann);
    if (myb) {
      const text = annotationArg(myb, 'value');
      if (text !== undefined && text.length > 0) {
        return { queryText: text, queryKind: 'mybatis' };
      }
    }
  }

  return null;
}

/**
 * The verbatim SQL string a dynamic-persistence call carried, if a string
 * literal is statically present (Data-Layer Fidelity 2, Task Group A). For
 * JdbcTemplate (`jdbcTemplate.queryForList("SELECT ...", ...)`) and EntityManager
 * (`em.createNativeQuery("SELECT ...")`) the SQL is the FIRST string-looking
 * argument; `CallIR.args` is now populated (Spec #5: `extract.ts` `args: c.args`).
 *
 * A "string-looking" arg is one that is NOT a bare Java identifier / class
 * literal (`String.class`, `Integer.class`, a variable name) -- i.e. it contains
 * whitespace or SQL punctuation, which a single identifier never does. This
 * keeps a dynamically-built `sql` variable (no literal in hand) from being
 * mis-captured as the query text. Returns the FIRST such arg verbatim, or null.
 */
function firstSqlLiteralArg(call: CallIR): string | null {
  for (const raw of call.args ?? []) {
    const a = raw.trim();
    if (!a) continue;
    // A bare identifier / qualified name / class-literal (no spaces, no SQL
    // punctuation) is an argument reference, not an inline SQL literal.
    const looksLikeIdentifier = /^[A-Za-z_$][\w$.]*$/.test(a);
    if (looksLikeIdentifier) continue;
    return a;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Endpoint identity (mirror the adapter's path composition exactly so the
// candidate's `endpointName` matches the `endpoints` candidate name and
// resolves by name at save-back).
//
// Spec #4 Task Group 6: ported from the single-value `extractHttpMethod` /
// `extractMethodPath` (which garbled a brace-list verb and silently dropped
// every path alias past the first) to W1's plural fan-out. The shape mirrors
// the adapter's `extractHttpMethods` / `extractMethodPaths` / `splitBraceList`
// exactly; the only difference is this copy consumes a `FunctionIR` (annotations
// live under `m.annotations`). A single-verb / single-path mapping still yields
// exactly one member each -> exactly one endpoint name (no behaviour change for
// the common case).
// ---------------------------------------------------------------------------

function stripArrayBracesAndQuotes(value: string): string {
  let v = value.trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim();
    if (v.includes(',')) v = v.split(',')[0].trim();
  }
  return v.replace(/^["']|["']$/g, '');
}

function normalisePath(path: string): string {
  let v = stripArrayBracesAndQuotes(path);
  if (!v.startsWith('/')) v = '/' + v;
  if (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1);
  return v;
}

function composeFullPath(basePath: string, methodPath: string): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const method = methodPath.startsWith('/') ? methodPath : '/' + methodPath;
  if (!base && !methodPath) return '/';
  if (!base) return method;
  if (!methodPath) return base;
  return base + method;
}

function extractBasePath(cls: ClassIR): string {
  const rm = findAnnotation(cls.annotations, 'RequestMapping');
  if (!rm) return '';
  const val = annotationArg(rm, 'value') || annotationArg(rm, 'path');
  return val ? normalisePath(val) : '';
}

/**
 * Split a possible `{a, b, c}` brace-list into its trimmed members. A bare
 * (non-brace) string returns a single-member list. Empty / whitespace-only
 * members are dropped. Mirrors the adapter's W1 `splitBraceList`.
 */
function splitBraceList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1);
  }
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const HTTP_METHOD_TOKENS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE',
]);

/**
 * Resolve the FULL set of HTTP verbs an endpoint method maps to (W1 plural
 * fan-out; FunctionIR-taking copy). A `@GetMapping` / `@PostMapping` / ...
 * shortcut yields its single verb; `@RequestMapping(method = {GET, POST})`
 * yields one verb per member; bare `@RequestMapping` yields `['GET']`. Always
 * returns at least one verb; order preserved from source.
 */
function extractHttpMethods(m: FunctionIR): string[] {
  for (const [ann, httpMethod] of Object.entries(HTTP_METHOD_ANNOTATIONS)) {
    if (hasAnnotation(m.annotations, ann)) return [httpMethod];
  }
  const rm = findAnnotation(m.annotations, 'RequestMapping');
  if (rm) {
    const methodArg = annotationArg(rm, 'method');
    if (methodArg) {
      const verbs: string[] = [];
      for (const member of splitBraceList(methodArg)) {
        const parts = member.split('.');
        const token = parts[parts.length - 1].toUpperCase();
        if (HTTP_METHOD_TOKENS.has(token) && !verbs.includes(token)) {
          verbs.push(token);
        }
      }
      return verbs.length > 0 ? verbs : ['GET'];
    }
    return ['GET'];
  }
  return ['GET'];
}

/**
 * Resolve the FULL set of method-level paths an endpoint maps to (W1 plural
 * fan-out; FunctionIR-taking copy). `@GetMapping("/x")` -> `['/x']`;
 * `@GetMapping({"/a","/b"})` -> `['/a','/b']`; no `value`/`path` -> `['']` so
 * the caller still composes exactly one full path against the base path. Each
 * member is normalised. Always returns at least one entry.
 */
function extractMethodPaths(m: FunctionIR): string[] {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(m.annotations, ann);
    if (!a) continue;
    const raw = annotationArg(a, 'value') || annotationArg(a, 'path');
    if (!raw) return [''];
    const members = splitBraceList(raw);
    if (members.length === 0) return [''];
    const paths: string[] = [];
    for (const member of members) {
      const p = normalisePath(member);
      if (!paths.includes(p)) paths.push(p);
    }
    return paths.length > 0 ? paths : [''];
  }
  return [''];
}

/**
 * Every `${httpMethod} ${fullPath}` endpoint-identity name a mapping method
 * fans out to (one per verb x path). Mirrors the adapter's emitted
 * `endpoints` candidate names so each data-effect edge resolves to the right
 * `endpoints` row at save-back. Always returns at least one name.
 */
function endpointNamesFor(cls: ClassIR, m: FunctionIR): string[] {
  const basePath = extractBasePath(cls);
  const verbs = extractHttpMethods(m);
  const paths = extractMethodPaths(m);
  const names: string[] = [];
  for (const verb of verbs) {
    for (const methodPath of paths) {
      const name = `${verb} ${composeFullPath(basePath, methodPath)}`;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.length > 0 ? names : [`GET ${composeFullPath(basePath, '')}`];
}

// ---------------------------------------------------------------------------
// Repository field detection + entity resolution
// ---------------------------------------------------------------------------

interface RepositoryHit {
  /** The field on the calling class that holds the repository. */
  field: FieldIR;
  /** The resolved repository class/interface (if found in the scanned set). */
  repoEntry: ClassEntry | null;
  /** The simple type name of the field (e.g. `OwnerRepository`). */
  typeName: string;
}

/**
 * Is this field a Spring-Data / `@Repository` collaborator? Either:
 *   - the field's declared type resolves to an interface that extends a
 *     Spring-Data base (`extends JpaRepository<Owner,Long>`), OR
 *   - the resolved class/interface carries `@Repository`, OR
 *   - the field type name ends with `Repository` / `Dao` (name heuristic).
 */
function asRepositoryField(field: FieldIR, index: ResolverIndex): RepositoryHit | null {
  const typeName = stripGenerics(simpleName(field.type));
  const entry = index.byName.get(typeName) ?? null;

  const extendsSpringData =
    entry?.cls.isInterface &&
    !!entry.cls.extends &&
    SPRING_DATA_REPO_BASES.has(stripGenerics(simpleName(entry.cls.extends)));
  const hasRepoAnnotation = entry ? hasAnnotation(entry.cls.annotations, REPOSITORY_STEREOTYPE) : false;
  const nameSuggests = /(?:Repository|Dao|DAO)$/.test(typeName);

  if (extendsSpringData || hasRepoAnnotation || nameSuggests) {
    return { field, repoEntry: entry, typeName };
  }
  return null;
}

/**
 * Resolve the managed entity NAME for a repository field. Tries, in order:
 *   1. the repository interface's Spring-Data generic param
 *      (`OwnerRepository extends JpaRepository<Owner, Long>` -> `Owner`),
 *   2. the field-type's own generic param (`OwnerRepository<Owner>` -> `Owner`),
 *   3. a captured `@Entity`/`@Table` class whose name matches the repository's
 *      `<Name>Repository` / `<Name>Dao` prefix.
 * Returns null when no entity can be statically determined.
 */
function resolveRepositoryEntity(hit: RepositoryHit, index: ResolverIndex): string | null {
  // (1) Spring-Data base generic param on the resolved interface.
  if (hit.repoEntry?.cls.extends) {
    const ext = hit.repoEntry.cls.extends;
    if (SPRING_DATA_REPO_BASES.has(stripGenerics(simpleName(ext)))) {
      const arg = firstGenericArg(ext);
      if (arg) return arg;
    }
  }

  // (2) Generic param directly on the field type (`OwnerRepository<Owner>`).
  const fieldGeneric = firstGenericArg(hit.field.type);
  if (fieldGeneric) return fieldGeneric;

  // (3) Name-prefix heuristic: `OwnerRepository` -> `Owner`, validated against
  // a captured @Entity / @Table class in the scanned set.
  const prefix = hit.typeName.replace(/(?:Repository|Dao|DAO)$/, '');
  if (prefix.length > 0) {
    const candidate = index.byName.get(prefix);
    if (candidate && hasAnnotation(candidate.cls.annotations, 'Entity')) {
      return candidate.cls.name;
    }
    // Even without an @Entity match, the `<Name>Repository` convention is a
    // strong-enough signal to name the entity (the save-back matcher gates it
    // by whether the name resolves to a real data entity).
    if (prefix.length > 1) return prefix;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Access-mode + operation derivation from repository method semantics
// ---------------------------------------------------------------------------

interface AccessSemantics {
  accessMode: AccessMode;
  operationHint: OperationHint;
}

/**
 * Derive {access_mode, operation hint} from a Spring-Data-style repository
 * method name:
 *   - `save` / `saveAll` / `saveAndFlush`           -> write / insert-or-update
 *   - `insert*`                                      -> write / insert
 *   - `update*`                                      -> write / update
 *   - `delete*` / `remove*`                          -> write / delete
 *   - `find*` / `get*` / `read*` / `query*` /
 *     `count*` / `exists*` / `stream*`               -> read / select
 * Defaults to read/select for unknown verbs (a query is the safe assumption;
 * a write verb is recognised explicitly).
 */
function deriveAccess(methodName: string): AccessSemantics {
  const n = methodName;
  if (/^(save|saveAll|saveAndFlush|persist|store|put)/.test(n)) {
    return { accessMode: 'write', operationHint: 'insert-or-update' };
  }
  if (/^(insert|create|add|new)/.test(n)) {
    return { accessMode: 'write', operationHint: 'insert' };
  }
  if (/^(update|modify|edit|patch|set)/.test(n)) {
    return { accessMode: 'write', operationHint: 'update' };
  }
  if (/^(delete|remove|purge|drop)/.test(n)) {
    return { accessMode: 'write', operationHint: 'delete' };
  }
  // read-shaped verbs (and the default).
  return { accessMode: 'read', operationHint: 'select' };
}

/** Merge two access modes (read + write -> read-write). */
function mergeAccessMode(a: AccessMode, b: AccessMode): AccessMode {
  if (a === b) return a;
  return 'read-write';
}

// ---------------------------------------------------------------------------
// Service-field detection
// ---------------------------------------------------------------------------

/**
 * Is this field an autowired service-layer collaborator (`@Service` /
 * `@Component`, or a service-API interface)? Returns the resolved class entry
 * (the concrete impl when the field is an interface with exactly ONE impl in
 * the scanned set), or null when the field is not a followable service.
 */
function asServiceField(
  field: FieldIR,
  index: ResolverIndex,
): { entry: ClassEntry; viaSingleImpl: boolean } | null {
  const typeName = stripGenerics(simpleName(field.type));
  const entry = index.byName.get(typeName);
  if (!entry) return null;

  // Concrete class with a service stereotype -> follow directly.
  if (!entry.cls.isInterface) {
    if (
      SERVICE_STEREOTYPES.some((n) => hasAnnotation(entry.cls.annotations, n)) ||
      classIsTransactional(entry.cls)
    ) {
      return { entry, viaSingleImpl: false };
    }
    return null;
  }

  // Interface -> single-implementation resolution (exactly one impl in scan).
  const impls = index.implsByInterface.get(typeName) ?? [];
  const stereotypedImpls = impls.filter(
    (e) =>
      SERVICE_STEREOTYPES.some((n) => hasAnnotation(e.cls.annotations, n)) ||
      classIsTransactional(e.cls),
  );
  if (stereotypedImpls.length === 1) {
    return { entry: stereotypedImpls[0], viaSingleImpl: true };
  }
  // Fall back to ANY single impl (e.g. `FooServiceImpl` with no stereotype but
  // it's the only implementer).
  if (impls.length === 1) {
    return { entry: impls[0], viaSingleImpl: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Field lookup by receiver name
// ---------------------------------------------------------------------------

function fieldByName(cls: ClassIR, receiver: string): FieldIR | undefined {
  return cls.fields.find((f) => f.name === receiver);
}

function methodByName(cls: ClassIR, name: string): FunctionIR | undefined {
  return cls.methods.find((m) => m.name === name);
}

/**
 * Is this call a SAME-CLASS helper invocation that we should inline during the
 * walk? True when the receiver denotes `this` (un-qualified `getVets()` ->
 * receiver=null, or `this.getVets()` -> receiver="this") AND the invoked method
 * name resolves to a method declared on `owningClass` itself. Returns the
 * resolved helper `FunctionIR` (so the walker can recurse into its body) or
 * null when the call is not a same-class helper.
 *
 * Importantly this does NOT match a call on an autowired collaborator field
 * (receiver = the field name), so it can never be confused with a service /
 * repository hop -- those keep their existing resolution path.
 */
function asSameClassHelperCall(
  owningClass: ClassIR,
  call: CallIR,
): FunctionIR | null {
  if (!SELF_RECEIVERS.has(call.receiver)) return null;
  const name = call.methodName ?? '';
  if (!name) return null;
  // A mapping method is never its own helper target, but a same-class helper
  // chain CAN re-enter a mapping method; the visited-id cycle guard upstream
  // handles termination, so we resolve purely on declared-method match here.
  return methodByName(owningClass, name) ?? null;
}

// ---------------------------------------------------------------------------
// Core walk
// ---------------------------------------------------------------------------

/** A detected dynamic-persistence escape + any verbatim SQL literal it carried. */
interface DynamicPersistenceHit {
  reason: UnresolvedReason;
  /** The verbatim SQL literal the call carried, if statically present. */
  queryText: string | null;
}

/**
 * Detect dynamic-persistence calls (JdbcTemplate / EntityManager.createQuery /
 * reflection) within a class's methods reachable from the given method. Returns
 * the matching {@link UnresolvedReason} plus the verbatim SQL string the call
 * carried (when statically present in `CallIR.args` -- Data-Layer Fidelity 2,
 * Task Group A), or null when no dynamic-persistence call is present.
 */
function detectDynamicPersistence(
  cls: ClassIR,
  method: FunctionIR,
): DynamicPersistenceHit | null {
  // Fields of a dynamic-persistence type that are USED by this method.
  for (const call of method.calls ?? []) {
    if (call.receiver) {
      const f = fieldByName(cls, call.receiver);
      if (f) {
        const t = stripGenerics(simpleName(f.type));
        if (DYNAMIC_PERSISTENCE_TYPES.has(t)) {
          if (t.startsWith('Jdbc') || t.startsWith('SimpleJdbc') || t === 'DataSource') {
            return { reason: 'jdbc_template', queryText: firstSqlLiteralArg(call) };
          }
          if (t === 'EntityManager' || t === 'Session' || t === 'SessionFactory') {
            return { reason: 'entity_manager', queryText: firstSqlLiteralArg(call) };
          }
        }
      }
    }
    // EntityManager.createQuery / createNativeQuery style.
    if (DYNAMIC_PERSISTENCE_METHODS.has((call.methodName ?? ''))) {
      const reason: UnresolvedReason = (call.methodName ?? '').toLowerCase().includes('native')
        ? 'native_sql'
        : 'entity_manager';
      return { reason, queryText: firstSqlLiteralArg(call) };
    }
    // Reflection signal.
    if ((call.methodName ?? '') === 'invoke' && (call.receiver === 'method' || call.callee.includes('Method'))) {
      return { reason: 'reflection', queryText: null };
    }
  }
  return null;
}

/**
 * From a service method, find the repository data effects it triggers by
 * inspecting its calls on autowired repository fields. Accumulates resolved
 * effects (per entity) and notes any dynamic-persistence escape.
 *
 * Each effect carries any VERBATIM SQL captured from the resolved repository
 * method (`@Query` JPQL / native or a MyBatis statement annotation) so the
 * candidate metadata can surface the actual query text (Data-Layer Fidelity 2,
 * Task Group A).
 */
function resolveServiceMethodEffects(
  serviceEntry: ClassEntry,
  method: FunctionIR,
  index: ResolverIndex,
): {
  effects: Array<{ entity: string; semantics: AccessSemantics; hop: PathHop; query: CapturedQuery | null }>;
  transactional: boolean;
  dynamic: DynamicPersistenceHit | null;
} {
  const effects: Array<{ entity: string; semantics: AccessSemantics; hop: PathHop; query: CapturedQuery | null }> = [];
  const transactional = classIsTransactional(serviceEntry.cls) || methodIsTransactional(method);

  const dynamic = detectDynamicPersistence(serviceEntry.cls, method);

  for (const call of method.calls ?? []) {
    if (!call.receiver) continue;
    const field = fieldByName(serviceEntry.cls, call.receiver);
    if (!field) continue;
    const repoHit = asRepositoryField(field, index);
    if (!repoHit) continue;

    const entity = resolveRepositoryEntity(repoHit, index);
    if (!entity) continue; // unknown entity -> caller treats as a finding

    const semantics = deriveAccess((call.methodName ?? ''));
    const repoMethod = repoHit.repoEntry
      ? methodByName(repoHit.repoEntry.cls, (call.methodName ?? ''))
      : undefined;
    const repoMethodId = repoHit.repoEntry
      ? findRepoMethodId(repoHit.repoEntry, (call.methodName ?? ''))
      : `${repoHit.typeName}#${(call.methodName ?? '')}()`;
    const hop: PathHop = {
      methodId: repoMethodId,
      className: repoHit.typeName,
      methodName: (call.methodName ?? ''),
      role: 'repository',
    };
    effects.push({ entity, semantics, hop, query: captureRepoMethodQuery(repoMethod) });
  }

  return { effects, transactional, dynamic };
}

function findRepoMethodId(repoEntry: ClassEntry, methodName: string): string {
  const m = methodByName(repoEntry.cls, methodName);
  if (m) return methodIdOf(repoEntry, m);
  // Spring-Data derived query method with no explicit declaration in scan.
  return `${repoEntry.fqn}#${methodName}()`;
}

// ---------------------------------------------------------------------------
// Per-endpoint resolution
// ---------------------------------------------------------------------------

interface AccumulatedEffect {
  entity: string;
  accessMode: AccessMode;
  operationHints: Set<OperationHint>;
  transactional: boolean;
  path: PathHop[];
  /** The verbatim SQL/JPQL captured for this entity's resolved repo hop, if any. */
  query: CapturedQuery | null;
}

/**
 * Mutable state threaded through the controller-method walk (including any
 * inlined same-class helper hops). Kept in one struct so the recursive walker
 * and the top-level driver share a single accumulation context.
 */
interface WalkState {
  /** Per-(entity) accumulation so an endpoint reading + writing the same entity
   * collapses into ONE read-write edge, while distinct entities stay distinct. */
  readonly byEntity: Map<string, AccumulatedEffect>;
  /** Endpoint-scoped unresolved results discovered mid-walk (service method not
   * in scan, repository entity unknown, etc.). */
  readonly unresolved: UnresolvedDataEffect[];
  /** The first dynamic-persistence escape seen anywhere on the walk. */
  sawDynamic: UnresolvedReason | null;
  /** The verbatim SQL literal the FIRST dynamic-persistence escape carried, if
   * any (Data-Layer Fidelity 2, Task Group A) -- captured ON the unresolved
   * finding instead of discarded. */
  sawDynamicSql: string | null;
  /** True once the walk has followed a call on an autowired collaborator field
   * (service or repository) -- i.e. the endpoint clearly does data work. Drives
   * the "no silent drops" catch-all finding. */
  sawCollaboratorCall: boolean;
  /** Remaining controller->service->repository depth budget. */
  depthBudget: number;
  /** Method-ids already entered on THIS endpoint's walk (cycle guard for the
   * same-class helper recursion). */
  readonly visited: Set<string>;
}

/**
 * Walk one method body on the controller class, accumulating data effects.
 * Handles three call shapes:
 *   (1) call on an autowired @Service field   -> service hop + its repo effects
 *   (2) call on an autowired @Repository field -> direct controller->repo hop
 *   (3) call on a SAME-CLASS private helper    -> recurse into the helper body
 *       (bounded by `MAX_HELPER_DEPTH` + the `visited` cycle guard), continuing
 *       resolution transparently (the helper adds NO hop -- the controller hop
 *       stays the mapping method, the service/repo hops are what the helper
 *       reaches).
 *
 * `controllerHop` is ALWAYS the mapping method (the architectural entry point),
 * even while recursing through helpers, so the persisted path reads
 * controller -> service -> repository regardless of helper depth.
 */
function walkControllerMethod(
  controllerEntry: ClassEntry,
  method: FunctionIR,
  controllerHop: PathHop,
  endpointName: string,
  endpointMethodName: string,
  index: ResolverIndex,
  state: WalkState,
  helperDepth: number,
): void {
  const methodKey = methodIdOf(controllerEntry, method);
  if (state.visited.has(methodKey)) return; // cycle guard
  state.visited.add(methodKey);

  // Dynamic persistence reached straight from THIS body (controller / helper
  // talking to a JdbcTemplate / EntityManager) -> finding (carrying any
  // verbatim SQL literal the call held).
  const localDynamic = detectDynamicPersistence(controllerEntry.cls, method);
  if (localDynamic && !state.sawDynamic) {
    state.sawDynamic = localDynamic.reason;
    state.sawDynamicSql = localDynamic.queryText;
  }

  for (const call of method.calls ?? []) {
    // (3) SAME-CLASS helper: inline by recursing into its body. Checked BEFORE
    // the field lookup because a self-receiver (`null` / `this`) can never name
    // an autowired field, and this is the path the pre-fix walk silently
    // dropped.
    if (SELF_RECEIVERS.has(call.receiver)) {
      const helper = asSameClassHelperCall(controllerEntry.cls, call);
      if (!helper) continue; // un-qualified call to a non-helper (e.g. a util) -> ignore
      if (helperDepth >= MAX_HELPER_DEPTH) {
        if (!state.sawDynamic) {
          state.unresolved.push({
            endpointName,
            controllerClassName: controllerEntry.cls.name,
            endpointMethodName,
            reason: 'too_deep',
            detail: `Same-class helper recursion exceeded the maximum helper depth (${MAX_HELPER_DEPTH}) while resolving '${call.methodName}'.`,
            partialPath: [controllerHop],
            sourceFilePath: controllerEntry.file.filePath,
          });
        }
        continue;
      }
      walkControllerMethod(
        controllerEntry,
        helper,
        controllerHop,
        endpointName,
        endpointMethodName,
        index,
        state,
        helperDepth + 1,
      );
      continue;
    }

    // From here the call has a non-self receiver. Resolve it to a field on the
    // controller class (autowired collaborator).
    const receiver = call.receiver;
    if (!receiver) continue; // defensive (SELF_RECEIVERS already covered null)
    const field = fieldByName(controllerEntry.cls, receiver);
    if (!field) continue; // chained / local-variable receiver -> not a collaborator

    // Is the receiver an autowired service?
    const serviceResolution = asServiceField(field, index);
    if (!serviceResolution) {
      // (2) The receiver might be a repository the controller (or a helper)
      // calls directly (thin controllers). Treat that as a controller->repo
      // path. The controller hop stays the mapping method even if the repo call
      // physically lives in an inlined helper.
      const repoHit = asRepositoryField(field, index);
      if (repoHit) {
        state.sawCollaboratorCall = true;
        const entity = resolveRepositoryEntity(repoHit, index);
        if (!entity) {
          state.unresolved.push({
            endpointName,
            controllerClassName: controllerEntry.cls.name,
            endpointMethodName,
            reason: 'unknown_repository_entity',
            detail: `Repository '${repoHit.typeName}' called directly from the controller but its managed entity could not be statically determined.`,
            partialPath: [controllerHop],
            sourceFilePath: controllerEntry.file.filePath,
          });
          continue;
        }
        const semantics = deriveAccess((call.methodName ?? ''));
        const repoMethod = repoHit.repoEntry
          ? methodByName(repoHit.repoEntry.cls, (call.methodName ?? ''))
          : undefined;
        const repoMethodId = repoHit.repoEntry
          ? findRepoMethodId(repoHit.repoEntry, (call.methodName ?? ''))
          : `${repoHit.typeName}#${(call.methodName ?? '')}()`;
        accumulate(state.byEntity, entity, semantics, false, [
          controllerHop,
          { methodId: repoMethodId, className: repoHit.typeName, methodName: (call.methodName ?? ''), role: 'repository' },
        ], captureRepoMethodQuery(repoMethod));
      }
      continue;
    }

    // (1) Autowired service field.
    state.sawCollaboratorCall = true;
    const serviceEntry = serviceResolution.entry;

    const serviceMethod = methodByName(serviceEntry.cls, (call.methodName ?? ''));
    if (!serviceMethod) {
      // The service method isn't visible (declared on a parent / not in scan).
      // Bounded: emit a finding rather than guess.
      state.unresolved.push({
        endpointName,
        controllerClassName: controllerEntry.cls.name,
        endpointMethodName,
        reason: 'dynamic_dispatch',
        detail: `Service '${serviceEntry.cls.name}#${(call.methodName ?? '')}' could not be resolved in the scanned set (inherited / dynamic).`,
        partialPath: [controllerHop],
        sourceFilePath: controllerEntry.file.filePath,
      });
      continue;
    }

    state.depthBudget -= 1;
    if (state.depthBudget <= 0) {
      state.unresolved.push({
        endpointName,
        controllerClassName: controllerEntry.cls.name,
        endpointMethodName,
        reason: 'too_deep',
        detail: `Resolution exceeded the maximum controller->service->repository depth (${MAX_RESOLVE_DEPTH}).`,
        partialPath: [controllerHop],
        sourceFilePath: controllerEntry.file.filePath,
      });
      break;
    }

    const serviceHop: PathHop = {
      methodId: methodIdOf(serviceEntry, serviceMethod),
      className: serviceEntry.cls.name,
      methodName: serviceMethod.name,
      role: 'service',
    };

    const { effects, transactional, dynamic } = resolveServiceMethodEffects(
      serviceEntry,
      serviceMethod,
      index,
    );
    if (dynamic && !state.sawDynamic) {
      state.sawDynamic = dynamic.reason;
      state.sawDynamicSql = dynamic.queryText;
    }

    for (const eff of effects) {
      accumulate(state.byEntity, eff.entity, eff.semantics, transactional, [
        controllerHop,
        serviceHop,
        eff.hop,
      ], eff.query);
    }
  }
}

/**
 * Resolve a single mapping method to its data-effect edges + unresolved
 * findings, FANNED OUT across EVERY (verb x path) variant the mapping declares
 * (Spec #4 Task Group 6). The downstream walk runs ONCE (resolution is
 * independent of the endpoint label); the produced resolved / unresolved
 * results are then cloned per variant name so a `@RequestMapping(method={GET,
 * POST})` / `@GetMapping({"/a","/b"})` attaches its edges to ALL variants, not
 * just the first.
 */
function resolveEndpoint(
  controllerEntry: ClassEntry,
  endpointMethod: FunctionIR,
  index: ResolverIndex,
): { resolved: ResolvedDataEffect[]; unresolved: UnresolvedDataEffect[] } {
  // Every (verb x path) variant name this mapping fans out to. The walk stamps
  // the FIRST variant on mid-walk results; the final fan-out below re-keys
  // across all of them.
  const endpointNames = endpointNamesFor(controllerEntry.cls, endpointMethod);
  const primaryName = endpointNames[0];
  const controllerHop: PathHop = {
    methodId: methodIdOf(controllerEntry, endpointMethod),
    className: controllerEntry.cls.name,
    methodName: endpointMethod.name,
    role: 'controller',
  };

  const resolved: ResolvedDataEffect[] = [];

  const state: WalkState = {
    byEntity: new Map<string, AccumulatedEffect>(),
    unresolved: [],
    sawDynamic: null,
    sawDynamicSql: null,
    sawCollaboratorCall: false,
    depthBudget: MAX_RESOLVE_DEPTH,
    visited: new Set<string>(),
  };

  // Walk the mapping method, inlining same-class helpers as needed.
  walkControllerMethod(
    controllerEntry,
    endpointMethod,
    controllerHop,
    primaryName,
    endpointMethod.name,
    index,
    state,
    0,
  );

  const unresolved = state.unresolved;

  // Surface dynamic-persistence escapes as a finding (never a silent drop). The
  // verbatim SQL the escape carried (Data-Layer Fidelity 2, Task Group A) is
  // appended to the finding `detail` and stamped on `queryText` so the
  // migration sees the actual query even when no entity could be resolved.
  if (state.sawDynamic) {
    const sawDynamic = state.sawDynamic;
    const sql = state.sawDynamicSql;
    const baseDetail =
      sawDynamic === 'jdbc_template'
        ? 'Endpoint reaches a JdbcTemplate / DataSource; the touched table cannot be statically resolved to a data entity.'
        : sawDynamic === 'entity_manager'
          ? 'Endpoint reaches an EntityManager / Session query; the touched entity cannot be statically resolved.'
          : sawDynamic === 'native_sql'
            ? 'Endpoint issues a native SQL query; the touched table cannot be statically resolved to a data entity.'
            : sawDynamic === 'reflection'
              ? 'Endpoint uses reflection to dispatch persistence; the touched data cannot be statically resolved.'
              : `Endpoint reaches a persistence path (${sawDynamic}) that cannot be statically resolved to a data entity.`;
    unresolved.push({
      endpointName: primaryName,
      controllerClassName: controllerEntry.cls.name,
      endpointMethodName: endpointMethod.name,
      reason: sawDynamic,
      // Append the verbatim SQL so it is captured ON the finding instead of
      // discarded -- VERBATIM, no normalization.
      detail: sql ? `${baseDetail} SQL: ${sql}` : baseDetail,
      partialPath: [controllerHop],
      sourceFilePath: controllerEntry.file.filePath,
      queryText: sql ?? undefined,
    });
  }

  // Detect a multiple-impl ambiguity that produced NO followable service: if
  // the mapping method (or an inlined helper) calls a field whose type is an
  // interface with >1 impl. Walks the same helper-inclusive reachable set so
  // the ambiguity is caught even when the call lives in a helper.
  for (const m of reachableSameClassMethods(controllerEntry.cls, endpointMethod)) {
    for (const call of m.calls ?? []) {
      if (!call.receiver || SELF_RECEIVERS.has(call.receiver)) continue;
      const field = fieldByName(controllerEntry.cls, call.receiver);
      if (!field) continue;
      const typeName = stripGenerics(simpleName(field.type));
      const entry = index.byName.get(typeName);
      if (entry?.cls.isInterface) {
        const impls = index.implsByInterface.get(typeName) ?? [];
        if (impls.length > 1) {
          unresolved.push({
            endpointName: primaryName,
            controllerClassName: controllerEntry.cls.name,
            endpointMethodName: endpointMethod.name,
            reason: 'multiple_impls',
            detail: `Service interface '${typeName}' has ${impls.length} implementations in the scanned set; the runtime dispatch target is ambiguous.`,
            partialPath: [controllerHop],
            sourceFilePath: controllerEntry.file.filePath,
          });
        }
      }
    }
  }

  // Emit ONE resolved edge per (endpoint, entity).
  for (const acc of state.byEntity.values()) {
    const operationHint = pickOperationHint(acc);
    resolved.push({
      endpointName: primaryName,
      controllerClassName: controllerEntry.cls.name,
      endpointMethodName: endpointMethod.name,
      dataEntityName: acc.entity,
      accessMode: acc.accessMode,
      operationHint,
      transactional: acc.transactional,
      confidence: computeConfidence(acc),
      path: acc.path,
      sourceFilePath: controllerEntry.file.filePath,
      // Verbatim SQL/JPQL captured from the resolved repo hop, if any
      // (Data-Layer Fidelity 2, Task Group A).
      queryText: acc.query?.queryText,
      queryKind: acc.query?.queryKind,
    });
  }

  // No silent drops: if the mapping method (after inlining helpers) clearly did
  // data work through a collaborator yet produced ZERO resolved edges, AND no
  // more-specific unresolved reason already fired for this endpoint, surface a
  // catch-all `unfollowable_call` finding identifying the offending call(s).
  // This recovers the spec's "unresolved chains become findings, never silent
  // drops" guarantee for the helper-inlining walk.
  if (resolved.length === 0 && unresolved.length === 0 && state.sawCollaboratorCall) {
    const offenders = collectUnfollowableCallLabels(controllerEntry.cls, endpointMethod, index);
    unresolved.push({
      endpointName: primaryName,
      controllerClassName: controllerEntry.cls.name,
      endpointMethodName: endpointMethod.name,
      reason: 'unfollowable_call',
      detail:
        `Endpoint makes a data-access call we could not statically follow to a data entity` +
        (offenders.length ? ` (${offenders.join(', ')})` : '') +
        `. Review the chain to capture the data effect manually.`,
      partialPath: [controllerHop],
      sourceFilePath: controllerEntry.file.filePath,
    });
  }

  // Fan out across EVERY (verb x path) variant (Spec #4 Task Group 6). When the
  // mapping declares a single verb+path (the common case) this is a no-op
  // pass-through. When it declares several, each resolved edge / unresolved
  // finding is cloned once per variant name so the harness-visible endpoint set
  // (which W1 already fans out) has its data-effect edges aligned to every
  // variant, not just the first.
  if (endpointNames.length <= 1) {
    return { resolved, unresolved };
  }
  const fannedResolved: ResolvedDataEffect[] = [];
  for (const name of endpointNames) {
    for (const r of resolved) fannedResolved.push({ ...r, endpointName: name });
  }
  const fannedUnresolved: UnresolvedDataEffect[] = [];
  for (const name of endpointNames) {
    for (const u of unresolved) fannedUnresolved.push({ ...u, endpointName: name });
  }
  return { resolved: fannedResolved, unresolved: fannedUnresolved };
}

/**
 * The set of methods reachable from `start` via SAME-CLASS helper calls
 * (including `start` itself), bounded by `MAX_HELPER_DEPTH` and a visited
 * guard. Used by the post-walk multiple-impl scan so an ambiguous service
 * field referenced ONLY from a helper is still caught.
 */
function reachableSameClassMethods(
  cls: ClassIR,
  start: FunctionIR,
): FunctionIR[] {
  const out: FunctionIR[] = [];
  const seen = new Set<string>();
  const stack: Array<{ m: FunctionIR; depth: number }> = [{ m: start, depth: 0 }];
  while (stack.length) {
    const { m, depth } = stack.pop()!;
    const key = m.methodId ?? m.name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (depth >= MAX_HELPER_DEPTH) continue;
    for (const call of m.calls ?? []) {
      if (!SELF_RECEIVERS.has(call.receiver)) continue;
      const helper = methodByName(cls, call.methodName ?? '');
      if (helper) stack.push({ m: helper, depth: depth + 1 });
    }
  }
  return out;
}

/**
 * Build short human-readable labels for the calls on a mapping method's
 * helper-inclusive reachable set that LOOK like data work (a call on a
 * collaborator field, or a same-class helper) but did not resolve to an edge.
 * Drives the `unfollowable_call` finding detail so a reviewer knows where to
 * look. Best-effort + de-duplicated; never throws.
 */
function collectUnfollowableCallLabels(
  cls: ClassIR,
  endpointMethod: FunctionIR,
  index: ResolverIndex,
): string[] {
  const labels = new Set<string>();
  for (const m of reachableSameClassMethods(cls, endpointMethod)) {
    for (const call of m.calls ?? []) {
      const name = call.methodName ?? '';
      if (!name) continue;
      if (SELF_RECEIVERS.has(call.receiver)) {
        // A same-class helper that itself yielded nothing followable.
        if (methodByName(cls, name) && name !== endpointMethod.name) {
          labels.add(`${name}()`);
        }
        continue;
      }
      const field = call.receiver ? fieldByName(cls, call.receiver) : undefined;
      if (!field) continue;
      const isService = !!asServiceField(field, index);
      const isRepo = !!asRepositoryField(field, index);
      if (isService || isRepo) {
        labels.add(`${call.receiver}.${name}()`);
      }
    }
  }
  return Array.from(labels).slice(0, 6);
}

function accumulate(
  byEntity: Map<string, AccumulatedEffect>,
  entity: string,
  semantics: AccessSemantics,
  transactional: boolean,
  path: PathHop[],
  query: CapturedQuery | null,
): void {
  const existing = byEntity.get(entity);
  if (!existing) {
    byEntity.set(entity, {
      entity,
      accessMode: semantics.accessMode,
      operationHints: new Set([semantics.operationHint]),
      transactional,
      path,
      query,
    });
    return;
  }
  existing.accessMode = mergeAccessMode(existing.accessMode, semantics.accessMode);
  existing.operationHints.add(semantics.operationHint);
  existing.transactional = existing.transactional || transactional;
  // Keep the FIRST (shortest, most direct) path for the metadata; additional
  // operations on the same entity merge into the access mode + hints. The first
  // captured SQL (aligned with that first path) is likewise retained; later
  // operations on the same entity do not overwrite it.
  if (!existing.query && query) existing.query = query;
}

/**
 * Pick a single representative operation hint for the edge. read-write or
 * multi-write picks the strongest write hint; pure-read picks select.
 */
function pickOperationHint(acc: AccumulatedEffect): OperationHint {
  const hints = acc.operationHints;
  if (acc.accessMode === 'read') return 'select';
  // Prefer the most specific write op in a stable priority.
  for (const h of ['delete', 'update', 'insert', 'insert-or-update'] as OperationHint[]) {
    if (hints.has(h)) return h;
  }
  return 'insert-or-update';
}

/**
 * Confidence for a resolved edge. A fully-resolved 3-hop happy path
 * (controller -> service -> repository -> known entity) is high (0.9). A
 * 2-hop (controller -> repository) direct path is slightly lower (0.8). A path
 * that leaned on the name-prefix entity heuristic (rather than a generic param
 * or @Entity) gets a LOW confidence so the three-outcome model routes it to a
 * low-confidence-but-resolved candidate, NOT a finding.
 */
function computeConfidence(acc: AccumulatedEffect): number {
  const hopCount = acc.path.length;
  const repoHop = acc.path[acc.path.length - 1];
  // The name-prefix heuristic stamps a repo method id of the form
  // `Type#method()` with no FQN (no `.` before `#`) when the repo class wasn't
  // in the scanned set -- treat that as the weaker resolution.
  const repoResolvedInScan = repoHop?.methodId.includes('.') ?? false;
  if (!repoResolvedInScan) return 0.65; // resolved-but-low -> normal stream, low confidence
  if (hopCount >= 3) return 0.9;
  return 0.8;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolve endpoint -> data-effect edges for every inbound HTTP controller
 * mapping method across the scanned IR. Async (`@JmsListener`, `@Scheduled`,
 * …) and outbound surfaces get NO edges (spec: inbound HTTP only).
 */
export function resolveEndpointDataEffects(
  files: SourceFileIR[],
): DataEffectResolverOutput {
  const index = buildResolverIndex(files);
  const resolved: ResolvedDataEffect[] = [];
  const unresolved: UnresolvedDataEffect[] = [];

  for (const file of files) {
    for (const cls of file.classes) {
      if (!isController(cls)) continue;
      const controllerEntry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
      for (const method of cls.methods) {
        if (!isMappingMethod(method)) continue;
        if (isAsyncMethod(method)) continue; // belt-and-braces: HTTP only
        const out = resolveEndpoint(controllerEntry, method, index);
        resolved.push(...out.resolved);
        unresolved.push(...out.unresolved);
      }
    }
  }

  // Dedupe unresolved by (endpoint, reason) so an endpoint hitting the same
  // escape twice produces one finding. With the multi-verb/multi-path fan-out
  // this also keys per VARIANT endpoint name, so each (verb x path) variant
  // keeps its own finding.
  const seen = new Set<string>();
  const dedupedUnresolved = unresolved.filter((u) => {
    const key = `${u.endpointName}|${u.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { resolved, unresolved: dedupedUnresolved };
}

// ---------------------------------------------------------------------------
// SOAP entry point (Spec 4, 2026-05-30 SOAP/WSDL message-field depth, Group 5)
// ---------------------------------------------------------------------------
//
// SOAP operations get the SAME operation->DB data-effect chain REST endpoints
// get. The ONLY new part is the entry-point: a SOAP handler method is the
// analogue of a `@RequestMapping` controller method. Everything DOWNSTREAM --
// the handler->service->repository->entity walk, the access-mode /
// operation-hint / transactional derivation, the same-class-helper inlining,
// and the unresolved-chain detection -- is REUSED VERBATIM from `resolveEndpoint`
// + `buildResolverIndex` above. We do NOT fork or re-implement the walk.
//
// The single SOAP-specific deviation is the endpoint NAME: `resolveEndpoint`
// stamps a REST-style `${httpMethod} ${path}` name (via `endpointNamesFor`),
// but a SOAP `endpoints` candidate resolves at save-back by its OPERATION name
// (`getCountry`, ...). So the caller supplies the SOAP operation name per
// handler, and we OVERRIDE the `endpointName` field on the resolved /
// unresolved results the reused walk produced -- a post-processing rename, not
// a second walk. (A SOAP handler carries no `@RequestMapping`, so the plural
// fan-out yields exactly one REST-style name to rename -- no duplication.)

/**
 * Detect SOAP handler methods as data-effect entry-points across the IR:
 *   - Spring-WS: a class annotated `@Endpoint` with a method annotated
 *     `@PayloadRoot` (or aggregated under `@PayloadRoots`).
 *   - JAX-WS: a class annotated `@WebService` with a method annotated
 *     `@WebMethod`.
 *
 * Returns one entry-point per handler method, paired with its class entry so
 * the reused walk can resolve the handler's autowired collaborators. The
 * `defaultEndpointName` is the bare handler method name (the SOAP `endpoints`
 * candidate name in the common no-WSDL annotation case); callers with the
 * actual emitted endpoint names can re-key via
 * {@link resolveSoapOperationDataEffects}'s `operationNameByMethod` override.
 *
 * Pure: reads the supplied IR only. This is the SOAP analogue of the
 * `isController` + `isMappingMethod` gate in `resolveEndpointDataEffects` -- the
 * ONLY genuinely new logic Spec 4 Group 5 adds.
 */
export function detectSoapEntryPoints(
  files: SourceFileIR[],
): Array<{ entry: ClassEntry; method: FunctionIR; defaultEndpointName: string }> {
  const out: Array<{ entry: ClassEntry; method: FunctionIR; defaultEndpointName: string }> = [];
  for (const file of files) {
    for (const cls of file.classes) {
      const isSpringWsEndpoint = hasAnnotation(cls.annotations, 'Endpoint');
      const isJaxWsService = hasAnnotation(cls.annotations, 'WebService');
      if (!isSpringWsEndpoint && !isJaxWsService) continue;
      const entry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
      for (const method of cls.methods) {
        const isPayloadRoot =
          hasAnnotation(method.annotations, 'PayloadRoot') ||
          hasAnnotation(method.annotations, 'PayloadRoots');
        const isWebMethod = hasAnnotation(method.annotations, 'WebMethod');
        // Spring-WS handler iff its class is an @Endpoint; JAX-WS handler iff
        // its class is a @WebService. A class can carry both; either gate
        // qualifies the method, and the per-method emit happens at most once.
        const qualifies =
          (isSpringWsEndpoint && isPayloadRoot) || (isJaxWsService && isWebMethod);
        if (!qualifies) continue;
        out.push({ entry, method, defaultEndpointName: method.name });
      }
    }
  }
  return out;
}

/**
 * Resolve SOAP operation -> DB data-effect edges by feeding each detected SOAP
 * handler method into the REUSED downstream resolver (`resolveEndpoint`).
 *
 * REUSE contract: `buildResolverIndex` builds the SAME cross-file class index
 * the REST path uses; `resolveEndpoint` performs the SAME
 * handler->service->repository->entity walk (incl. same-class-helper inlining,
 * dynamic-persistence escape detection, and the "no silent drops" unresolved
 * catch-all). We add NOTHING to the walk -- we only (a) gate the entry-points
 * to SOAP handlers (`detectSoapEntryPoints`) and (b) override the resulting
 * `endpointName` to the SOAP operation name so save-back binds the right
 * `endpoints` row. Unresolved chains come back here exactly as for REST and the
 * caller turns them into Findings (never a fabricated edge).
 *
 * `operationNameByMethod` (optional): maps a `${ClassName}#${methodName}` key to
 * the exact emitted SOAP `endpoints` candidate name. When present the
 * resolved/unresolved `endpointName` uses it; otherwise the handler method name
 * is used (the default endpoint candidate name in the no-WSDL case).
 */
export function resolveSoapOperationDataEffects(
  files: SourceFileIR[],
  operationNameByMethod?: Map<string, string>,
): DataEffectResolverOutput {
  const index = buildResolverIndex(files);
  const resolved: ResolvedDataEffect[] = [];
  const unresolved: UnresolvedDataEffect[] = [];

  for (const { entry, method, defaultEndpointName } of detectSoapEntryPoints(files)) {
    const opKey = `${entry.cls.name}#${method.name}`;
    const soapEndpointName =
      operationNameByMethod?.get(opKey) ?? defaultEndpointName;

    // REUSE the REST downstream walk verbatim. It internally stamps a
    // REST-style endpointName; we rename ONLY that field to the SOAP operation
    // name below so the edge resolves to the right SOAP endpoint at save-back.
    const out = resolveEndpoint(entry, method, index);

    for (const r of out.resolved) {
      resolved.push({ ...r, endpointName: soapEndpointName });
    }
    for (const u of out.unresolved) {
      unresolved.push({ ...u, endpointName: soapEndpointName });
    }
  }

  // Dedupe unresolved by (endpoint, reason) -- mirrors the REST path so a SOAP
  // operation hitting the same escape twice produces one finding.
  const seen = new Set<string>();
  const dedupedUnresolved = unresolved.filter((u) => {
    const key = `${u.endpointName}|${u.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { resolved, unresolved: dedupedUnresolved };
}

// ---------------------------------------------------------------------------
// INTERNAL entry points (Spec 2026-07-06-m — Spring Classic Internal
// Functionality, Code-Tier Oracle Program).
//
// Criterion B of the oracle: internal (non-HTTP) functionality must get the
// SAME data-effect + behaviour treatment as HTTP endpoints. This mirrors the
// SOAP variant above verbatim: a detector gates the entry points, the REUSED
// `resolveEndpoint` walk does everything else, and the edge `endpointName` is
// overridden to the internal endpoint candidate's name (the listener
// `<SUBTYPE-UC> <identifier>` convention emitted by the adapter) so save-back
// binds the right `endpoints` row.
// ---------------------------------------------------------------------------

/** Annotation -> endpoint_subtype map (mirrors the adapter's listener map). */
const INTERNAL_LISTENER_ANNOTATIONS: Record<string, string> = {
  JmsListener: 'jms-listener',
  KafkaListener: 'kafka-listener',
  RabbitListener: 'rabbit-listener',
  SqsListener: 'sqs-listener',
  EventListener: 'event-listener',
  Scheduled: 'scheduled',
};

/**
 * Replicates the adapter's listener-candidate naming EXACTLY
 * (`processMessageAndScheduledMethods` in index.ts): `<SUBTYPE-UC>
 * <identifier>` where the identifier is the destination / topics / queues /
 * event types / cron (or fixedRate= / fixedDelay=), falling back to the
 * method name. Pinned against the adapter output by the internal-functionality
 * test suite so the two can never drift silently.
 */
export function internalListenerEndpointName(
  annotationName: string,
  ann: AnnotationIR,
  methodName: string,
): string | null {
  const subtype = INTERNAL_LISTENER_ANNOTATIONS[annotationName];
  if (!subtype) return null;
  let identifier: string = methodName;
  if (annotationName === 'JmsListener' || annotationName === 'RabbitListener') {
    identifier =
      annotationArg(ann, 'destination') ??
      annotationArg(ann, 'queues') ??
      annotationArg(ann, 'value') ??
      identifier;
  } else if (annotationName === 'KafkaListener') {
    identifier = annotationArg(ann, 'topics') ?? annotationArg(ann, 'topicPattern') ?? identifier;
  } else if (annotationName === 'SqsListener') {
    identifier = annotationArg(ann, 'value') ?? identifier;
  } else if (annotationName === 'EventListener') {
    identifier = annotationArg(ann, 'classes') ?? annotationArg(ann, 'value') ?? identifier;
  } else if (annotationName === 'Scheduled') {
    const cron = annotationArg(ann, 'cron');
    const fixedRate = annotationArg(ann, 'fixedRate');
    const fixedDelay = annotationArg(ann, 'fixedDelay');
    if (cron) identifier = cron;
    else if (fixedRate) identifier = `fixedRate=${fixedRate}`;
    else if (fixedDelay) identifier = `fixedDelay=${fixedDelay}`;
  }
  return `${subtype.toUpperCase()} ${identifier}`;
}

/** An XML-wired internal entry point (from the internal-process XML scanner). */
export interface InternalXmlEntryTarget {
  /** SIMPLE class name (resolved through the bean map by the XML scanner). */
  className: string;
  methodName: string;
  /** The XML-minted endpoint candidate's exact name. */
  entryName: string;
}

/**
 * Detect INTERNAL entry points across the IR:
 *   - listener/scheduled-ANNOTATED methods (six annotations, name convention
 *     replicated via {@link internalListenerEndpointName})
 *   - Quartz `Job` classes (`implements Job` / `extends QuartzJobBean`) ->
 *     their `execute` / `executeInternal` method (`QUARTZ-JOB <ClassName>`)
 *   - XML-wired targets passed in by the internal-process XML scanner
 *     (task:scheduled refs, MethodInvokingJobDetail targets, jms:listeners).
 */
export function detectInternalEntryPoints(
  files: SourceFileIR[],
  xmlTargets: InternalXmlEntryTarget[] = [],
): Array<{ entry: ClassEntry; method: FunctionIR; entryName: string }> {
  const out: Array<{ entry: ClassEntry; method: FunctionIR; entryName: string }> = [];
  const classEntriesBySimpleName = new Map<string, ClassEntry>();

  for (const file of files) {
    for (const cls of file.classes) {
      const entry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
      if (!classEntriesBySimpleName.has(cls.name)) {
        classEntriesBySimpleName.set(cls.name, entry);
      }

      // (a) Annotated listener / scheduled methods.
      for (const method of cls.methods) {
        for (const annotationName of Object.keys(INTERNAL_LISTENER_ANNOTATIONS)) {
          const ann = findAnnotation(method.annotations, annotationName);
          if (!ann) continue;
          const entryName = internalListenerEndpointName(annotationName, ann, method.name);
          if (entryName) out.push({ entry, method, entryName });
        }
      }

      // (b) Quartz Job classes.
      const isQuartzJob =
        (cls.implements ?? []).some((i) => i === 'Job' || i.endsWith('.Job')) ||
        cls.extends === 'QuartzJobBean';
      if (isQuartzJob) {
        const executeMethod = cls.methods.find(
          (m) => m.name === 'execute' || m.name === 'executeInternal',
        );
        if (executeMethod) {
          out.push({ entry, method: executeMethod, entryName: `QUARTZ-JOB ${cls.name}` });
        }
      }
    }
  }

  // (c) XML-wired targets (bean refs resolved to simple class names upstream).
  for (const target of xmlTargets) {
    const entry = classEntriesBySimpleName.get(target.className);
    if (!entry) continue;
    const method = entry.cls.methods.find((m) => m.name === target.methodName);
    if (!method) continue;
    // Dedupe: an XML target pointing at an already-annotated method keeps the
    // annotation-derived entry (first wins), matching the adapter's emission.
    if (out.some((e) => e.entry.cls === entry.cls && e.method === method)) continue;
    out.push({ entry, method, entryName: target.entryName });
  }

  return out;
}

/**
 * Resolve INTERNAL-process -> DB data-effect edges by feeding each internal
 * entry point into the REUSED downstream resolver — the exact contract of
 * {@link resolveSoapOperationDataEffects}: nothing added to the walk, only the
 * entry gate + the `endpointName` override. The pipeline folds these edges'
 * hop method-ids into the behaviour-capture reachable set, so internal code
 * gets behaviour blocks exactly like endpoint code (Spec -m, criterion B).
 */
export function resolveInternalProcessDataEffects(
  files: SourceFileIR[],
  xmlTargets: InternalXmlEntryTarget[] = [],
): DataEffectResolverOutput {
  const index = buildResolverIndex(files);
  const resolved: ResolvedDataEffect[] = [];
  const unresolved: UnresolvedDataEffect[] = [];

  for (const { entry, method, entryName } of detectInternalEntryPoints(files, xmlTargets)) {
    const out = resolveEndpoint(entry, method, index);
    for (const r of out.resolved) {
      resolved.push({ ...r, endpointName: entryName });
    }
    for (const u of out.unresolved) {
      unresolved.push({ ...u, endpointName: entryName });
    }
  }

  const seen = new Set<string>();
  const dedupedUnresolved = unresolved.filter((u) => {
    const key = `${u.endpointName}|${u.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { resolved, unresolved: dedupedUnresolved };
}

// Re-export the call shape so consumers can introspect (unused import guard).
export type { CallIR, AnnotationIR };
