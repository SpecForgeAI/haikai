/**
 * Spring-WS annotation scanner (Signal A).
 *
 * Spec: 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 2.
 *
 * Pure scanner over raw Java source strings. Detects:
 *  - class-level `@Endpoint`
 *  - method-level `@PayloadRoot(namespace=..., localPart=...)`
 *  - `@PayloadRoots({...})` containers with nested `@PayloadRoot` entries
 *  - companion `@WebService(name=...)` attribute when present on the same
 *    class (preserved verbatim for the emitter's D-1 layered naming rule)
 *
 * Public function: `scanSpringWsSources(sources)` -> `SpringWsSignal[]`.
 *
 * Returns ONE `SpringWsSignal` per `@Endpoint`-annotated class, with the
 * raw inputs (simple class name, package, `@WebService(name=...)`, namespace)
 * that the central emitter (`soapEndpointEmitter.ts`) needs to apply the D-1
 * layered naming rule. This scanner does NOT apply naming rules itself.
 *
 * Regex / AST patterns mirror the existing `@Controller` / `@RequestMapping`
 * scanning style in `springClassicFindingScanner.ts` (regex over `rawContent`
 * with locality scoping, no tree-sitter dependency).
 *
 * Pure: no I/O beyond reading the passed-in source strings.
 */

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface SpringWsOperation {
  /** The Java method name carrying `@PayloadRoot` */
  methodName: string;
  /** `@PayloadRoot(namespace=...)` -- the request namespace URI */
  namespace: string | null;
  /** `@PayloadRoot(localPart=...)` -- the request root element local name */
  localPart: string;
  /**
   * FQN of the first parameter type, when resolvable from the method
   * signature (annotations are the only source for fully-qualified Java
   * class names). Falls back to the simple type name when no `import`
   * statement is found for it.
   */
  requestDtoClass: string | null;
  /** FQN of the return type, when resolvable. */
  responseDtoClass: string | null;
}

export interface SpringWsSignal {
  /** Repo-relative path of the source file */
  sourcePath: string;
  /** Simple Java class name (no package prefix) */
  simpleClassName: string;
  /** Package declaration on the source file */
  packageName: string | null;
  /**
   * `@WebService(name=...)` attribute value if also annotated on the same
   * class, otherwise null. Preserved verbatim for the emitter's D-1
   * layered naming rule.
   */
  webServiceNameAttribute: string | null;
  /** Operations emitted from `@PayloadRoot` method-level annotations */
  operations: SpringWsOperation[];
}

// ----------------------------------------------------------------------------
// Regex catalogue
// ----------------------------------------------------------------------------

const PACKAGE_REGEX = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m;
const IMPORT_REGEX = /^\s*import\s+(static\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm;
const ENDPOINT_CLASS_REGEX =
  /@Endpoint\b[^{}]*?\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g;
const WEB_SERVICE_NAME_REGEX = /@WebService\s*\(([^)]*)\)/;

const PAYLOAD_ROOT_REGEX = /@PayloadRoot\s*\(([^)]*)\)/g;
const PAYLOAD_ROOTS_REGEX = /@PayloadRoots\s*\(\s*\{([^{}]*)\}\s*\)/g;
const NAMESPACE_ATTR_REGEX = /\bnamespace\s*=\s*"([^"]*)"/;
const LOCAL_PART_ATTR_REGEX = /\blocalPart\s*=\s*"([^"]*)"/;
const NAME_ATTR_REGEX = /\bname\s*=\s*"([^"]*)"/;

/**
 * Method signature directly after an annotation block. Captures the return
 * type and the first parameter type when one is present. Designed to be
 * forgiving -- not a full Java grammar.
 *
 * Pattern: optional modifiers, return type, method name, '(' first-param-type
 * (optional), ...
 */
const METHOD_HEADER_REGEX =
  /(?:public|protected|private|static|final|abstract|synchronized|\s)+([A-Za-z_][A-Za-z0-9_<>,.?\s]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(?:@[A-Za-z_][A-Za-z0-9_.()=, "']*\s+)*([A-Za-z_][A-Za-z0-9_.<>,? ]*?)?\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*[,)]|\))/;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function extractPackage(content: string): string | null {
  const m = PACKAGE_REGEX.exec(content);
  return m ? m[1] : null;
}

/**
 * Build a map of `simpleName -> fqn` from `import x.y.Z;` statements.
 */
function extractImports(content: string): Map<string, string> {
  const map = new Map<string, string>();
  IMPORT_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_REGEX.exec(content)) !== null) {
    const fqn = m[2];
    const simple = fqn.split('.').pop() ?? fqn;
    map.set(simple, fqn);
  }
  return map;
}

/**
 * Resolve a type expression (e.g. `GetCountryRequest`, `List<Foo>`) to its
 * "primary" simple type name -- the leftmost identifier or, when generic,
 * the first type argument. Returns null when not resolvable.
 */
function primarySimpleType(typeExpr: string | null | undefined): string | null {
  if (!typeExpr) return null;
  const trimmed = typeExpr.trim();
  // Strip whitespace and generics: keep the first identifier inside <...> when
  // the head is a Collection-like container, else keep the head.
  const head = trimmed.split(/[<\s,>]/).filter(Boolean)[0];
  if (!head) return null;
  // Drop any varargs `...` artefact and array `[]`
  return head.replace(/\.\.\.$|\[\]$/g, '');
}

function resolveFqn(
  typeExpr: string | null | undefined,
  imports: Map<string, string>,
  packageName: string | null,
): string | null {
  const simple = primarySimpleType(typeExpr);
  if (!simple) return null;
  if (simple.includes('.')) return simple;
  const fromImport = imports.get(simple);
  if (fromImport) return fromImport;
  // Same-package fallback when we have a package declaration; otherwise
  // return the simple name (caller can inspect verbatim).
  if (packageName) return `${packageName}.${simple}`;
  return simple;
}

/**
 * Find the class block body (everything inside `{ ... }`) following a class
 * declaration starting at `classStart`. Returns `null` if matching braces
 * can't be found.
 */
function extractClassBody(content: string, classStart: number): string | null {
  // Find the opening brace following the class declaration.
  const open = content.indexOf('{', classStart);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Find class-level annotations directly preceding `classStart`. Walks
 * backwards collecting annotation lines until a non-annotation, non-whitespace
 * line is hit (e.g. `import`, another `class`, etc.).
 */
function collectClassAnnotationsBlock(content: string, classStart: number): string {
  // Take everything from the previous semicolon / newline-newline boundary up
  // to classStart. Simple heuristic: walk back until we hit a `;` or two
  // consecutive non-annotation tokens.
  let i = classStart - 1;
  while (i > 0 && content[i] !== ';' && content[i] !== '}') {
    i--;
  }
  return content.slice(i + 1, classStart);
}

/**
 * Extract `@WebService(name="X")` from an annotation block. Returns null
 * when `@WebService` is absent or has no `name=` attribute.
 */
function extractWebServiceName(annotationBlock: string): string | null {
  const m = WEB_SERVICE_NAME_REGEX.exec(annotationBlock);
  if (!m) return null;
  const args = m[1];
  const nameMatch = NAME_ATTR_REGEX.exec(args);
  return nameMatch ? nameMatch[1] : null;
}

/**
 * For a given `@PayloadRoot(...)` annotation argument string, parse out
 * `namespace=` and `localPart=`.
 */
function parsePayloadRootArgs(args: string): { namespace: string | null; localPart: string | null } {
  const ns = NAMESPACE_ATTR_REGEX.exec(args);
  const lp = LOCAL_PART_ATTR_REGEX.exec(args);
  return {
    namespace: ns ? ns[1] : null,
    localPart: lp ? lp[1] : null,
  };
}

interface RawPayloadRootHit {
  namespace: string | null;
  localPart: string | null;
  /** Offset in the class body where this `@PayloadRoot` is found. */
  offset: number;
}

/**
 * Find every `@PayloadRoot(...)` and `@PayloadRoots({ ... })` hit in the
 * class body. For `@PayloadRoots`, expand into multiple raw hits.
 */
function collectPayloadRootHits(classBody: string): RawPayloadRootHit[] {
  const hits: RawPayloadRootHit[] = [];

  // @PayloadRoots({ @PayloadRoot(...), @PayloadRoot(...) })
  PAYLOAD_ROOTS_REGEX.lastIndex = 0;
  const consumedRanges: Array<[number, number]> = [];
  let pm: RegExpExecArray | null;
  while ((pm = PAYLOAD_ROOTS_REGEX.exec(classBody)) !== null) {
    const inner = pm[1];
    const baseOffset = pm.index;
    consumedRanges.push([pm.index, pm.index + pm[0].length]);
    // Now find each @PayloadRoot inside the inner.
    const innerRegex = /@PayloadRoot\s*\(([^)]*)\)/g;
    let im: RegExpExecArray | null;
    while ((im = innerRegex.exec(inner)) !== null) {
      const parsed = parsePayloadRootArgs(im[1]);
      hits.push({
        namespace: parsed.namespace,
        localPart: parsed.localPart,
        offset: baseOffset + im.index,
      });
    }
  }

  // Bare @PayloadRoot(...) hits not already consumed by @PayloadRoots.
  PAYLOAD_ROOT_REGEX.lastIndex = 0;
  let bm: RegExpExecArray | null;
  while ((bm = PAYLOAD_ROOT_REGEX.exec(classBody)) !== null) {
    const start = bm.index;
    if (consumedRanges.some(([s, e]) => start >= s && start < e)) continue;
    const parsed = parsePayloadRootArgs(bm[1]);
    hits.push({
      namespace: parsed.namespace,
      localPart: parsed.localPart,
      offset: start,
    });
  }

  hits.sort((a, b) => a.offset - b.offset);
  return hits;
}

/**
 * For a `@PayloadRoot` hit found at `offset` in the class body, find the
 * immediately-following method header and extract `methodName`, `returnType`,
 * and `firstParamType`. Returns null when no method header is found.
 */
function extractFollowingMethod(
  classBody: string,
  offset: number,
): { methodName: string; returnType: string | null; firstParamType: string | null } | null {
  // Search forward starting from offset.
  const slice = classBody.slice(offset);
  // Skip any further annotations (e.g. `@ResponsePayload`).
  // We re-run METHOD_HEADER_REGEX in a forgiving way: match the first
  // method-shaped pattern.
  METHOD_HEADER_REGEX.lastIndex = 0;
  const m = METHOD_HEADER_REGEX.exec(slice);
  if (!m) return null;
  const returnType = m[1]?.trim() ?? null;
  const methodName = m[2];
  const firstParamType = m[3]?.trim() || null;
  return { methodName, returnType, firstParamType };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function scanSpringWsSources(
  sources: { path: string; content: string }[],
): SpringWsSignal[] {
  const out: SpringWsSignal[] = [];

  for (const src of sources) {
    if (!src.content) continue;
    // Cheap pre-filter: skip files with no `@Endpoint` token at all.
    if (!src.content.includes('@Endpoint')) continue;

    const packageName = extractPackage(src.content);
    const imports = extractImports(src.content);

    ENDPOINT_CLASS_REGEX.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = ENDPOINT_CLASS_REGEX.exec(src.content)) !== null) {
      const simpleClassName = cm[1];
      const classStart = cm.index;
      const annotationBlock = collectClassAnnotationsBlock(src.content, classStart);
      const webServiceNameAttribute = extractWebServiceName(annotationBlock);
      const classBody = extractClassBody(src.content, classStart) ?? '';

      const hits = collectPayloadRootHits(classBody);
      const operations: SpringWsOperation[] = [];
      for (const hit of hits) {
        if (!hit.localPart) continue;
        const methodInfo = extractFollowingMethod(classBody, hit.offset);
        const methodName = methodInfo?.methodName ?? hit.localPart;
        const requestDtoClass = resolveFqn(
          methodInfo?.firstParamType ?? null,
          imports,
          packageName,
        );
        const responseDtoClass = resolveFqn(
          methodInfo?.returnType ?? null,
          imports,
          packageName,
        );
        operations.push({
          methodName,
          namespace: hit.namespace,
          localPart: hit.localPart,
          requestDtoClass,
          responseDtoClass,
        });
      }

      out.push({
        sourcePath: src.path,
        simpleClassName,
        packageName,
        webServiceNameAttribute,
        operations,
      });
    }
  }

  return out;
}
