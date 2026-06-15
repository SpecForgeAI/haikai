/**
 * JAX-WS annotation scanner (Signal B).
 *
 * Spec: 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 3.
 *
 * Pure scanner over raw Java source strings. Detects:
 *  - class-level OR interface-level `@WebService(name=..., targetNamespace=...)`
 *  - method-level `@WebMethod(operationName=...)`
 *  - companion `@RequestWrapper(localName=...)` and
 *    `@ResponseWrapper(localName=...)` annotations on the same method
 *
 * Public function: `scanJaxWsSources(sources)` -> `JaxWsSignal[]`.
 *
 * Interface-declared SEIs (Spec #4, Task Group 5): a JAX-WS Service Endpoint
 * Interface is idiomatically declared as a Java `interface`
 * (`@WebService public interface FooService { @WebMethod ... }`), with the
 * concrete bean (`@WebService(endpointInterface=...) class FooServiceImpl`)
 * implementing it. The declaration regex therefore matches BOTH `class` and
 * `interface` declarations so an interface-form SEI's `@WebMethod` operations
 * are detected; `class`-form SEIs are unchanged (regression-guarded).
 *
 * Apache CXF generated sources are OUT OF SCOPE per Q-10. Files whose
 * paths include `target/generated-sources/cxf/` are skipped; hand-written
 * `@WebService` classes anywhere else are still picked up.
 *
 * Regex / AST patterns mirror the existing `@Controller` / `@RequestMapping`
 * scanning style in `springClassicFindingScanner.ts` (regex over the raw
 * source, no tree-sitter).
 *
 * Pure: no I/O beyond reading the passed-in source strings.
 */

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface JaxWsOperation {
  /** Java method name */
  methodName: string;
  /**
   * `@WebMethod(operationName=...)` override when present; otherwise the
   * Java method name.
   */
  operationName: string;
  /** `@RequestWrapper(localName=...)` when present, else null */
  requestRootElement: string | null;
  /** `@ResponseWrapper(localName=...)` when present, else null */
  responseRootElement: string | null;
  /** FQN of the first parameter type, when resolvable. */
  requestDtoClass: string | null;
  /** FQN of the return type, when resolvable. */
  responseDtoClass: string | null;
}

export interface JaxWsSignal {
  /** Repo-relative path of the source file */
  sourcePath: string;
  /** Simple Java class name (no package prefix) */
  simpleClassName: string;
  /** Package declaration on the source file */
  packageName: string | null;
  /**
   * `@WebService(name=...)` attribute value when present, else null.
   * Preserved verbatim for the emitter's D-1 layered naming rule.
   */
  webServiceNameAttribute: string | null;
  /**
   * `@WebService(targetNamespace=...)` attribute value when present, else null.
   */
  targetNamespace: string | null;
  /** Operations emitted from `@WebMethod` method-level annotations */
  operations: JaxWsOperation[];
}

// ----------------------------------------------------------------------------
// Regex catalogue
// ----------------------------------------------------------------------------

const PACKAGE_REGEX = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m;
const IMPORT_REGEX = /^\s*import\s+(static\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm;
// Matches a `class` OR `interface` type declaration. The matched keyword is
// captured in group 1 so the annotation walk can anchor on whichever keyword
// matched (interface-declared SEIs are a first-class JAX-WS shape, Spec #4
// Task Group 5); the simple type name is group 2.
const CLASS_DECL_REGEX =
  /(?:public|protected|private|static|final|abstract|\s)*\b(class|interface)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
const WEB_SERVICE_ARGS_REGEX = /@WebService(?:\s*\(([^)]*)\))?/;

const WEB_METHOD_REGEX = /@WebMethod\b(\s*\(([^)]*)\))?/g;
const REQUEST_WRAPPER_REGEX = /@RequestWrapper\s*\(([^)]*)\)/;
const RESPONSE_WRAPPER_REGEX = /@ResponseWrapper\s*\(([^)]*)\)/;
const NAME_ATTR_REGEX = /\bname\s*=\s*"([^"]*)"/;
const TARGET_NAMESPACE_ATTR_REGEX = /\btargetNamespace\s*=\s*"([^"]*)"/;
const OPERATION_NAME_ATTR_REGEX = /\boperationName\s*=\s*"([^"]*)"/;
const LOCAL_NAME_ATTR_REGEX = /\blocalName\s*=\s*"([^"]*)"/;

/**
 * Forgiving method-header pattern. Captures return type, method name, and
 * first parameter type (when one is present).
 *
 * Tolerates an interface-form abstract method (no body, ends with `;`) as well
 * as a class-form method with a `{ ... }` body -- the header up to the closing
 * `)` is identical, so the same pattern serves both SEI shapes.
 */
const METHOD_HEADER_REGEX =
  /(?:public|protected|private|static|final|abstract|synchronized|\s)+([A-Za-z_][A-Za-z0-9_<>,.?\s]*?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(?:@[A-Za-z_][A-Za-z0-9_.()=, "']*\s+)*([A-Za-z_][A-Za-z0-9_.<>,? ]*?)?\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*[,)]|\))/;

// ----------------------------------------------------------------------------
// Helpers (parallel to springWsScanner.ts)
// ----------------------------------------------------------------------------

function extractPackage(content: string): string | null {
  const m = PACKAGE_REGEX.exec(content);
  return m ? m[1] : null;
}

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

function primarySimpleType(typeExpr: string | null | undefined): string | null {
  if (!typeExpr) return null;
  const trimmed = typeExpr.trim();
  const head = trimmed.split(/[<\s,>]/).filter(Boolean)[0];
  if (!head) return null;
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
  if (packageName) return `${packageName}.${simple}`;
  return simple;
}

function extractClassBody(content: string, classStart: number): string | null {
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
 * Walk backwards from a type declaration to collect the annotation block
 * (everything between the previous `;` / `}` boundary and the declaration
 * keyword position). Works identically for `class` and `interface` keywords --
 * the caller passes the offset of whichever keyword matched.
 */
function collectClassAnnotationsBlock(content: string, declStart: number): string {
  let i = declStart - 1;
  while (i > 0 && content[i] !== ';' && content[i] !== '}') {
    i--;
  }
  return content.slice(i + 1, declStart);
}

function extractFollowingMethod(
  classBody: string,
  offset: number,
): { methodName: string; returnType: string | null; firstParamType: string | null } | null {
  const slice = classBody.slice(offset);
  METHOD_HEADER_REGEX.lastIndex = 0;
  const m = METHOD_HEADER_REGEX.exec(slice);
  if (!m) return null;
  const returnType = m[1]?.trim() ?? null;
  const methodName = m[2];
  const firstParamType = m[3]?.trim() || null;
  return { methodName, returnType, firstParamType };
}

/**
 * Find the annotation block immediately preceding an offset in the class
 * body. Walks back to the previous `;` / `}` / `{` boundary.
 */
function methodAnnotationBlockBefore(classBody: string, offset: number): string {
  let i = offset - 1;
  while (i > 0 && classBody[i] !== ';' && classBody[i] !== '}' && classBody[i] !== '{') {
    i--;
  }
  return classBody.slice(i + 1, offset);
}

function isGeneratedCxf(path: string): boolean {
  const norm = path.replace(/\\/g, '/');
  return norm.includes('target/generated-sources/cxf/');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function scanJaxWsSources(
  sources: { path: string; content: string }[],
): JaxWsSignal[] {
  const out: JaxWsSignal[] = [];

  for (const src of sources) {
    if (!src.content) continue;
    if (isGeneratedCxf(src.path)) continue;
    // Cheap pre-filter: skip files with no `@WebService` token at all.
    if (!src.content.includes('@WebService')) continue;

    const packageName = extractPackage(src.content);
    const imports = extractImports(src.content);

    // Walk every `class X` / `interface X` declaration. For each, examine the
    // annotation block immediately preceding the declaration keyword -- if it
    // contains `@WebService`, we have a JAX-WS endpoint candidate. Interface
    // declarations are included so an interface-form SEI is detected, not only
    // a `class`-form endpoint (Spec #4, Task Group 5).
    CLASS_DECL_REGEX.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CLASS_DECL_REGEX.exec(src.content)) !== null) {
      const declKeyword = cm[1]; // 'class' | 'interface'
      const simpleClassName = cm[2];
      // `cm.index` points at the start of the modifier sequence; locate the
      // MATCHED declaration keyword within the match to anchor the annotation
      // walk (anchor on `class` OR `interface`, not the literal `'class'`).
      const declKwOffset = src.content.indexOf(declKeyword, cm.index);
      if (declKwOffset < 0) continue;
      const annotationBlock = collectClassAnnotationsBlock(src.content, declKwOffset);

      // Only proceed if the type is @WebService-annotated.
      if (!/@WebService\b/.test(annotationBlock)) continue;

      let webServiceNameAttribute: string | null = null;
      let targetNamespace: string | null = null;
      const wsArgsMatch = WEB_SERVICE_ARGS_REGEX.exec(annotationBlock);
      if (wsArgsMatch) {
        const args = wsArgsMatch[1] ?? '';
        const nameMatch = NAME_ATTR_REGEX.exec(args);
        webServiceNameAttribute = nameMatch ? nameMatch[1] : null;
        const tnsMatch = TARGET_NAMESPACE_ATTR_REGEX.exec(args);
        targetNamespace = tnsMatch ? tnsMatch[1] : null;
      }

      const classBody = extractClassBody(src.content, declKwOffset) ?? '';

      const operations: JaxWsOperation[] = [];
      WEB_METHOD_REGEX.lastIndex = 0;
      let wm: RegExpExecArray | null;
      while ((wm = WEB_METHOD_REGEX.exec(classBody)) !== null) {
        const annotationArgs = wm[2] ?? '';
        const annOffset = wm.index;
        const annEnd = annOffset + wm[0].length;

        const methodInfo = extractFollowingMethod(classBody, annEnd);
        if (!methodInfo) continue;

        const blockBefore = methodAnnotationBlockBefore(classBody, annOffset);
        const tailSlice = classBody.slice(annEnd);
        METHOD_HEADER_REGEX.lastIndex = 0;
        const headerMatch = METHOD_HEADER_REGEX.exec(tailSlice);
        const headerOffsetInTail = headerMatch ? headerMatch.index : 0;
        const blockAfter = tailSlice.slice(0, headerOffsetInTail);
        const combinedAnnotationSpan = blockBefore + ' ' + blockAfter;

        const reqWrap = REQUEST_WRAPPER_REGEX.exec(combinedAnnotationSpan);
        const respWrap = RESPONSE_WRAPPER_REGEX.exec(combinedAnnotationSpan);
        const requestRootElement = reqWrap
          ? LOCAL_NAME_ATTR_REGEX.exec(reqWrap[1])?.[1] ?? null
          : null;
        const responseRootElement = respWrap
          ? LOCAL_NAME_ATTR_REGEX.exec(respWrap[1])?.[1] ?? null
          : null;

        const operationNameOverride =
          OPERATION_NAME_ATTR_REGEX.exec(annotationArgs)?.[1] ?? null;

        const requestDtoClass = resolveFqn(
          methodInfo.firstParamType,
          imports,
          packageName,
        );
        const responseDtoClass = resolveFqn(
          methodInfo.returnType,
          imports,
          packageName,
        );

        operations.push({
          methodName: methodInfo.methodName,
          operationName: operationNameOverride ?? methodInfo.methodName,
          requestRootElement,
          responseRootElement,
          requestDtoClass,
          responseDtoClass,
        });

        WEB_METHOD_REGEX.lastIndex = annEnd;
      }

      out.push({
        sourcePath: src.path,
        simpleClassName,
        packageName,
        webServiceNameAttribute,
        targetNamespace,
        operations,
      });
    }
  }

  return out;
}
