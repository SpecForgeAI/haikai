/**
 * Language-agnostic Intermediate Representation (IR) for source code.
 *
 * Produced by language extractors (one per language: Java, TypeScript, etc.)
 * and consumed by framework adapters (one per framework: Spring Boot, React, etc.).
 *
 * The shape is deliberately minimal and purely structural — no framework-specific
 * fields. Annotations are captured faithfully so framework adapters can interpret
 * them without re-parsing the source.
 *
 * Design rule: if a field would only make sense for a specific framework, it does
 * NOT belong on the IR. Put it in the adapter's output instead.
 */

/** A single imported name or bare import statement. */
export interface ImportIR {
  /** Full import path (e.g. "org.springframework.stereotype.Controller", "fastapi") */
  path: string;
  /** Specific names imported (empty for side-effect/bare imports, or "*") */
  names: string[];
}

/** An annotation or decorator with optional argument values (stringified). */
export interface AnnotationIR {
  /** Annotation name without '@' prefix (e.g. "Controller", "app.get") */
  name: string;
  /** Positional/named arguments, stringified. Unnamed single-arg annotations use key "value". */
  args: Record<string, string>;
  /** 0-based source line */
  line: number;
}

/** A method/function parameter. */
export interface ParameterIR {
  name: string;
  /** Source-level type string (e.g. "int", "List<User>", "str | None"). "unknown" if absent. */
  type: string;
  annotations: AnnotationIR[];
}

/** A class or instance field. */
export interface FieldIR {
  name: string;
  type: string;
  annotations: AnnotationIR[];
  modifiers: string[];
  line: number;
}

/** A call expression inside a function body (e.g. `axios.get(url)`, `fetch(url)`). */
export interface CallIR {
  /** Dotted/member callee text (e.g. "axios.get", "fetch", "apiClient.post"). */
  callee: string;
  /** Stringified arguments (literals / template strings preserved verbatim). */
  args: string[];
  /** Generic type arguments as a single string (e.g. "UserDto[]" from axios.get<UserDto[]>()). */
  typeArgs: string | null;
  line: number;
  /**
   * The receiver expression the call is made ON, with any leading `this.`
   * stripped (e.g. `this.ownerService.save(o)` -> "ownerService",
   * `repo.findById(1)` -> "repo"). Null for un-qualified / `this`-only calls
   * (`save(o)`) and for languages/extractors that don't resolve a receiver.
   *
   * Added 2026-05-29 (Endpoint->Data-Effect Call Graph, Task Group 3): the
   * Spring Classic resolver keys controller->service->repository hops off the
   * receiver field name to walk autowired collaborators across files.
   */
  receiver?: string | null;
  /**
   * The simple method name being invoked (e.g. "save", "findById"). Mirrors
   * the tree-sitter `name` field. Populated alongside `receiver` by the Java
   * extractor; other extractors may leave it undefined (read `callee`).
   */
  methodName?: string;
}

/** A method on a class, or a top-level function. */
export interface FunctionIR {
  name: string;
  /** Return type as a string. "void" or "None" per language. */
  returnType: string;
  parameters: ParameterIR[];
  annotations: AnnotationIR[];
  modifiers: string[];
  line: number;
  /**
   * Call expressions discovered inside this function's body. Populated by
   * language extractors that need cross-function call tracking (e.g. the
   * TypeScript extractor for axios/fetch API-call detection). Other
   * extractors may leave this empty/undefined.
   */
  calls?: CallIR[];
  /**
   * Stable method identifier: fully-qualified-class `#` simple-method-signature
   * (e.g. `com.foo.OwnerService#save(Owner)`). Populated by the Java extractor
   * (Endpoint->Data-Effect Call Graph, Task Group 3) so the resolver can key
   * path hops and `business_logics` candidates by a migration-stable id without
   * persisting the whole call graph. Other extractors may leave this undefined.
   */
  methodId?: string;
}

/** A class, interface, record, or other named type declaration. */
export interface ClassIR {
  name: string;
  annotations: AnnotationIR[];
  /** Immediate parent class (single inheritance) — null if none. */
  extends: string | null;
  /** Implemented interfaces / mixins. */
  implements: string[];
  /** True if this is an interface (Java), trait, or abstract protocol. */
  isInterface: boolean;
  isAbstract: boolean;
  modifiers: string[];
  fields: FieldIR[];
  methods: FunctionIR[];
  line: number;
}

/**
 * A custom annotation TYPE declaration (`@interface Foo`), recording the
 * meta-annotations it is itself declared with.
 *
 * Added for inbound-surface-completeness (Spec #4, Task Group 1). Surfaced on
 * `SourceFileIR.annotationDeclarations` (NOT in `classes`) so framework
 * adapters can resolve composed / meta-annotated mapping annotations
 * (`@ApiV2Get` meta-annotated with `@GetMapping` ⇒ GET) without minting any
 * candidate for the annotation type itself. Reuses `AnnotationIR` for the
 * meta-annotations; introduces no new annotation shape.
 */
export interface AnnotationTypeDeclIR {
  /** Annotation type name (e.g. "ApiV2Get"). */
  name: string;
  /** The meta-annotations the annotation type is itself declared with. */
  annotations: AnnotationIR[];
  /** 0-based source line. */
  line: number;
}

/** The normalised IR produced for a single source file. */
export interface SourceFileIR {
  filePath: string;
  /** Source language identifier. */
  language: 'java' | 'typescript' | 'python' | string;
  /** Package/namespace/module. Empty string for languages without (e.g. default-package Java). Null if not applicable. */
  packageOrNamespace: string | null;
  imports: ImportIR[];
  classes: ClassIR[];
  /** Top-level functions (used for Python/TypeScript). Always empty for Java. */
  functions: FunctionIR[];
  /**
   * Custom annotation TYPE declarations (`@interface Foo`) in this file, with
   * the meta-annotations each is declared with. Populated by the Java
   * extractor (inbound-surface-completeness, Spec #4). Consumed by the
   * spring-classic adapter's meta-annotation matcher. Other extractors may
   * leave this undefined. Deliberately kept OUT of `classes` so existing
   * per-class processors never see annotation types.
   */
  annotationDeclarations?: AnnotationTypeDeclIR[];
  /**
   * All call expressions anywhere in the file (module-level, inside IIFEs,
   * inside anonymous function args like `define([], function(){...})`, etc.).
   * Added for frameworks whose detection signals live in module-level calls
   * rather than inside declared functions — e.g. AngularJS 1.x `angular
   * .module('X').controller('Y', fn)` chains.
   *
   * Currently populated by the TypeScript / JavaScript extractor. Other
   * language extractors may leave this undefined (pattern-driven pack
   * detection uses it opportunistically).
   */
  allCalls?: CallIR[];
  /**
   * Raw source-file contents (verbatim, unparsed). Added for framework
   * adapters that need to resolve patterns the IR can't express — e.g.
   * flow-sensitive variable tracking (`let req = {...}; $http(req)`)
   * where the object literal lives in a different statement from the
   * call site. Populated by the TypeScript / JavaScript extractor when
   * it has the source in hand; other languages may leave it undefined.
   */
  rawContent?: string;
  /**
   * Spring bean XML extraction (2026-04-25). Populated by the Java
   * language pack when this `SourceFileIR` represents a parsed
   * `applicationContext*.xml` / `*-context.xml` / `beans.xml` file
   * rather than a `.java` source. The corresponding `classes`,
   * `methods`, `imports` arrays will be empty for such entries —
   * their architectural payload is in this field. Consumed by the
   * spring-classic framework adapter.
   *
   * Type is loose (`unknown`) to avoid a cycle between `languageIR.ts`
   * and the parser module; the adapter narrows when it reads.
   */
  springXmlBeans?: unknown;
}

// --- Helpers commonly needed by framework adapters -------------------------

export function hasAnnotation(annotations: AnnotationIR[], name: string): boolean {
  return annotations.some((a) => a.name === name);
}

export function findAnnotation(
  annotations: AnnotationIR[],
  name: string,
): AnnotationIR | undefined {
  return annotations.find((a) => a.name === name);
}

export function annotationArg(
  annotation: AnnotationIR | undefined,
  key: string,
): string | undefined {
  return annotation?.args[key];
}
