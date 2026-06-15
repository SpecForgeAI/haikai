/**
 * AST Traversal Utilities
 *
 * Provides utilities for traversing tree-sitter Java syntax trees
 * and extracting structured metadata from annotations, class declarations,
 * field declarations, method declarations, and import statements.
 *
 * These utilities are technology-agnostic within the Java language --
 * they extract raw AST data that higher-level extractors (JPA, Spring MVC,
 * etc.) interpret for domain-specific meaning.
 *
 * Spec: Java/Spring Boot Extension Pack
 * - Task Group 2: AST Traversal Utilities
 */

import type { SyntaxNode, Tree } from './javaParser';

// ---------------------------------------------------------------------------
// TypeScript interfaces for extracted AST metadata
// ---------------------------------------------------------------------------

/**
 * Represents a single annotation extracted from a Java AST node.
 */
export interface AnnotationInfo {
  /** Annotation name without the '@' prefix (e.g., 'Entity', 'Column') */
  name: string;
  /** Key-value pairs of annotation arguments (empty object if no arguments) */
  arguments: Record<string, string>;
  /** Line number (0-based) in the source file */
  line: number;
}

/**
 * Represents a custom annotation TYPE declaration (`public @interface Foo {}`)
 * extracted from a Java AST.
 *
 * Added for inbound-surface-completeness (Spec #4, Task Group 1): the
 * meta-annotation matcher needs the meta-annotations a custom annotation is
 * ITSELF declared with so it can resolve a composed mapping
 * (`@ApiV2Get` meta-annotated with `@GetMapping` ⇒ GET). `annotation_type_
 * declaration` nodes are NOT collected by `extractClassDeclarations` (they are
 * not `class`/`interface`/`record` declarations), so they are surfaced here
 * separately and never pollute the regular class set.
 */
export interface AnnotationTypeInfo {
  /** Annotation type name (e.g. 'ApiV2Get'). */
  name: string;
  /** The meta-annotations the annotation type is itself declared with. */
  annotations: AnnotationInfo[];
  /** Line number (0-based) of the declaration. */
  line: number;
}

/**
 * Represents a class or interface declaration extracted from a Java AST.
 */
export interface ClassInfo {
  /** Class/interface name */
  name: string;
  /** Annotations on the class */
  annotations: AnnotationInfo[];
  /** Superclass name (or null if none) */
  superclass: string | null;
  /** Implemented interface names */
  interfaces: string[];
  /** Package name (or empty string if default package) */
  packageName: string;
  /** Whether this is an interface (vs. class) */
  isInterface: boolean;
  /** Modifiers (public, abstract, final, etc.) */
  modifiers: string[];
  /** Line number (0-based) of the class declaration */
  line: number;
  /** The underlying syntax node for further traversal */
  node: SyntaxNode;
}

/**
 * Represents a field declaration extracted from a Java class.
 */
export interface FieldInfo {
  /** Field name */
  name: string;
  /** Field type as a string */
  type: string;
  /** Annotations on the field */
  annotations: AnnotationInfo[];
  /** Modifiers (private, protected, public, static, final, etc.) */
  modifiers: string[];
  /** Line number (0-based) of the field declaration */
  line: number;
}

/**
 * Represents a method parameter extracted from a method declaration.
 */
export interface ParameterInfo {
  /** Parameter name */
  name: string;
  /** Parameter type as a string */
  type: string;
  /** Annotations on the parameter */
  annotations: AnnotationInfo[];
}

/**
 * Represents a single intra-method call discovered inside a method body.
 *
 * Added 2026-05-29 (Endpoint->Data-Effect Call Graph, Task Group 3). Captures
 * just enough about an invocation for the Spring Classic resolver to walk a
 * controller->service->repository chain: the receiver expression (autowired
 * field / local variable the call is made on) and the invoked method name.
 */
export interface CallInfo {
  /** The receiver field/variable the call is made on, `this.` stripped (or null for un-qualified calls). */
  receiver: string | null;
  /** The simple method name invoked (e.g. 'save', 'findById'). */
  methodName: string;
  /** The full dotted callee text (e.g. 'ownerService.save'). */
  callee: string;
  /** Number of positional arguments (used as a cheap arity hint). */
  argCount: number;
  /**
   * The positional call arguments, one entry per argument (so
   * `args.length === argCount` and ORDER is preserved). Best-effort,
   * deterministic literal capture so a downstream resolver can read outbound
   * targets (URLs / topics / queue names) and SQL text the way Spec #1's DB
   * resolver reads repository methods:
   *   - string literal      -> its UNQUOTED, escape-decoded text
   *   - char/numeric/boolean literal -> its raw source text (e.g. `42L`, `true`, `'c'`)
   *   - bare identifier (e.g. a `final`/static constant) -> its identifier text
   *   - anything else (method call, concatenation, builder, `X.class`, lambda,
   *     null) -> a stable placeholder token (the raw node text, truncated) so
   *     arity + ordering are preserved WITHOUT fabricating a literal
   *
   * Added 2026-05-30 (Outbound Integration Graph, Spec #5, Task Group 1; the
   * shared substrate Spec #6's SQL-text capture also consumes). Populates the
   * already-existing `CallIR.args: string[]` IR field via `toCallIR`.
   */
  args: string[];
  /** Line number (0-based) of the call site. */
  line: number;
}

/**
 * Represents a method declaration extracted from a Java class.
 */
export interface MethodInfo {
  /** Method name */
  name: string;
  /** Return type as a string */
  returnType: string;
  /** Method parameters */
  parameters: ParameterInfo[];
  /** Annotations on the method */
  annotations: AnnotationInfo[];
  /** Modifiers (public, private, protected, static, abstract, etc.) */
  modifiers: string[];
  /** Line number (0-based) of the method declaration */
  line: number;
  /**
   * Intra-method calls discovered inside this method's body (Task Group 3).
   * Empty for abstract / interface methods with no body.
   */
  calls: CallInfo[];
  /** The underlying syntax node for further traversal */
  node: SyntaxNode;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collects all descendant nodes of a given type.
 */
function collectNodesOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  const results: SyntaxNode[] = [];
  if (node.type === type) {
    results.push(node);
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      results.push(...collectNodesOfType(child, type));
    }
  }
  return results;
}

/**
 * Gets the text content of a named child node.
 */
function getNamedChildText(node: SyntaxNode, fieldName: string): string | null {
  const child = node.childForFieldName(fieldName);
  return child ? child.text : null;
}

/**
 * Extracts the text content of a type node, handling generic types,
 * array types, and other compound type expressions.
 */
function extractTypeText(typeNode: SyntaxNode | null): string {
  if (!typeNode) return 'void';
  return typeNode.text;
}

/**
 * Parses annotation argument text to extract key-value pairs.
 *
 * Handles formats like:
 * - `(name = "users")` -> { name: 'users' }
 * - `("users")` -> { value: 'users' }
 * - `(name = "users", schema = "public")` -> { name: 'users', schema: 'public' }
 * - `(strategy = GenerationType.IDENTITY)` -> { strategy: 'GenerationType.IDENTITY' }
 */
function parseAnnotationArguments(argListNode: SyntaxNode): Record<string, string> {
  const args: Record<string, string> = {};

  for (let i = 0; i < argListNode.namedChildCount; i++) {
    const child = argListNode.namedChild(i);
    if (!child) continue;

    if (child.type === 'element_value_pair') {
      // key = value format
      const key = getNamedChildText(child, 'key');
      const value = getNamedChildText(child, 'value');
      if (key && value !== null) {
        args[key] = stripQuotes(value);
      }
    } else {
      // Single-value annotation (no key) -- treated as "value" key
      args['value'] = stripQuotes(child.text);
    }
  }

  return args;
}

/**
 * Strips surrounding double quotes from a string value.
 */
function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Maximum length for a non-literal call-argument placeholder token. Keeps the
 * retained raw source bounded for huge inline expressions/lambdas while still
 * preserving enough to identify the argument.
 */
const CALL_ARG_PLACEHOLDER_MAX = 120;

/**
 * Decodes the common Java string-literal escape sequences in the BODY of a
 * string literal (the text already stripped of its surrounding quotes). Only
 * the escapes that matter for the verbatim targets a downstream resolver reads
 * (URLs, topics, queue names, SQL text) are handled; an unrecognised escape is
 * left verbatim (best-effort, never throws).
 */
function decodeJavaStringEscapes(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1];
      switch (next) {
        case 'n': out += '\n'; i++; break;
        case 't': out += '\t'; i++; break;
        case 'r': out += '\r'; i++; break;
        case 'b': out += '\b'; i++; break;
        case 'f': out += '\f'; i++; break;
        case '"': out += '"'; i++; break;
        case "'": out += "'"; i++; break;
        case '\\': out += '\\'; i++; break;
        case 'u': {
          // \\uXXXX -> the BMP code unit, when 4 hex digits follow.
          const hex = body.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 5;
          } else {
            out += ch; // malformed -- keep the backslash verbatim
          }
          break;
        }
        default:
          out += ch; // unrecognised escape -- keep the backslash verbatim
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Decodes a single positional call-argument syntax node into the text retained
 * on `CallInfo.args` (and ultimately `CallIR.args`). Best-effort + deterministic
 * (Outbound Integration Graph, Spec #5, Task Group 1; shared with Spec #6):
 *
 *   - `string_literal`                      -> UNQUOTED, escape-decoded body
 *     (so `"http://inventory/items"` -> `http://inventory/items`)
 *   - char / numeric / boolean / null literal -> the raw source text
 *     (e.g. `'c'`, `42L`, `3.14`, `true`, `null`)
 *   - bare `identifier` (e.g. a `final`/static constant such as `TOPIC`)
 *     -> the identifier text (best-effort; CONSTANT resolution is the
 *     resolver's job)
 *   - anything else (method call, concatenation, builder chain, `X.class`,
 *     lambda, array/object literal, etc.) -> the raw node text, truncated to
 *     `CALL_ARG_PLACEHOLDER_MAX` -- a STABLE placeholder so arity + ordering are
 *     preserved without fabricating a literal the resolver would mistake for a
 *     target.
 *
 * Note: nested calls inside an argument (e.g. `send(buildEvent("x"))`) are
 * captured here only as the outer argument's placeholder text; the nested call
 * is independently emitted as its own `CallInfo` by `extractMethodCalls`'
 * whole-subtree `method_invocation` walk, so no call site is lost.
 */
function decodeCallArgument(argNode: SyntaxNode): string {
  switch (argNode.type) {
    case 'string_literal': {
      // tree-sitter `.text` includes the surrounding double quotes; strip them
      // then decode the common escapes. (Java text blocks `"""..."""` also
      // parse as `string_literal`; stripQuotes leaves them intact, which is an
      // acceptable best-effort placeholder for that rarer case.)
      const stripped = stripQuotes(argNode.text);
      return decodeJavaStringEscapes(stripped);
    }
    case 'character_literal':
    case 'decimal_integer_literal':
    case 'hex_integer_literal':
    case 'octal_integer_literal':
    case 'binary_integer_literal':
    case 'decimal_floating_point_literal':
    case 'hex_floating_point_literal':
    case 'true':
    case 'false':
    case 'null_literal':
    case 'identifier':
      // Primitive literal / boolean / null / bare constant identifier -> raw
      // source text verbatim (best-effort; arity + ordering preserved).
      return argNode.text;
    default: {
      // Non-literal expression (method call, concatenation, builder, `X.class`,
      // lambda, array/object initializer, ...) -> stable, bounded placeholder.
      const raw = argNode.text;
      return raw.length > CALL_ARG_PLACEHOLDER_MAX
        ? `${raw.slice(0, CALL_ARG_PLACEHOLDER_MAX)}…`
        : raw;
    }
  }
}

/**
 * Extracts the type identifier from a superclass or super_interfaces node.
 * The node text includes "extends" or "implements" keywords, so we need
 * to find the actual type_identifier children.
 */
function extractSuperclassName(superclassNode: SyntaxNode): string | null {
  // The superclass node has children: "extends" keyword + type_identifier
  for (let i = 0; i < superclassNode.namedChildCount; i++) {
    const child = superclassNode.namedChild(i);
    if (child && (child.type === 'type_identifier' || child.type === 'generic_type' || child.type === 'scoped_type_identifier')) {
      return child.text;
    }
  }
  // Fallback: strip 'extends ' prefix if present
  const text = superclassNode.text.trim();
  if (text.startsWith('extends ')) {
    return text.substring('extends '.length).trim();
  }
  return text;
}

/**
 * Extracts interface names from a super_interfaces node.
 */
function extractInterfaceNames(interfacesNode: SyntaxNode): string[] {
  const names: string[] = [];
  // The node has children: "implements" keyword + type_list
  // type_list contains type_identifier nodes separated by commas
  const typeListNodes = collectNodesOfType(interfacesNode, 'type_list');
  for (const typeList of typeListNodes) {
    for (let i = 0; i < typeList.namedChildCount; i++) {
      const child = typeList.namedChild(i);
      if (child && child.type !== ',') {
        names.push(child.text);
      }
    }
  }
  // If no type_list found, look for type_identifiers directly
  if (names.length === 0) {
    for (let i = 0; i < interfacesNode.namedChildCount; i++) {
      const child = interfacesNode.namedChild(i);
      if (child && (child.type === 'type_identifier' || child.type === 'generic_type')) {
        names.push(child.text);
      }
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts all annotations from a node's modifiers.
 *
 * Handles both marker annotations (`@Entity`) and full annotations
 * with arguments (`@Table(name = "users", schema = "public")`).
 *
 * @param node - A class_declaration, field_declaration, or method_declaration node
 * @returns Array of extracted annotations
 */
export function extractAnnotations(node: SyntaxNode): AnnotationInfo[] {
  const annotations: AnnotationInfo[] = [];

  // Annotations can be in a modifiers node or directly on the node
  const sources: SyntaxNode[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'modifiers') {
      sources.push(child);
    }
  }

  // Also check direct children that are annotations (e.g., on formal parameters)
  sources.push(node);

  for (const source of sources) {
    for (let i = 0; i < source.childCount; i++) {
      const child = source.child(i);
      if (!child) continue;

      if (child.type === 'marker_annotation') {
        // @Entity style (no arguments)
        const nameNode = child.childForFieldName('name') || child.namedChild(0);
        if (nameNode) {
          annotations.push({
            name: nameNode.text,
            arguments: {},
            line: child.startPosition.row,
          });
        }
      } else if (child.type === 'annotation') {
        // @Table(name = "users") style (with arguments)
        const nameNode = child.childForFieldName('name') || child.namedChild(0);
        let args: Record<string, string> = {};

        const argList = child.childForFieldName('arguments');
        if (argList) {
          args = parseAnnotationArguments(argList);
        }

        if (nameNode) {
          annotations.push({
            name: nameNode.text,
            arguments: args,
            line: child.startPosition.row,
          });
        }
      }
    }
  }

  return annotations;
}

/**
 * Extracts all class and interface declarations from a syntax tree.
 *
 * @param tree - The parsed syntax tree
 * @returns Array of class/interface declarations with metadata
 */
export function extractClassDeclarations(tree: Tree): ClassInfo[] {
  const root = tree.rootNode;
  const classes: ClassInfo[] = [];

  // Extract package name
  const packageDecl = collectNodesOfType(root, 'package_declaration')[0];
  const packageName = packageDecl
    ? packageDecl.namedChildren
        .filter((c: SyntaxNode) => c.type !== 'package')
        .map((c: SyntaxNode) => c.text)
        .join('')
    : '';

  // Find all class, interface, and record declarations (including nested).
  // Java records (Java 14+) are compact immutable classes commonly used for
  // DTOs; they must be extracted too or the adapter misses every DTO expressed
  // as `public record FooDto(...)`.
  const classNodes = [
    ...collectNodesOfType(root, 'class_declaration'),
    ...collectNodesOfType(root, 'interface_declaration'),
    ...collectNodesOfType(root, 'record_declaration'),
  ];

  for (const classNode of classNodes) {
    const nameNode = classNode.childForFieldName('name');
    if (!nameNode) continue;

    const annotations = extractAnnotations(classNode);
    const modifiers = extractModifiers(classNode);
    const isInterface = classNode.type === 'interface_declaration';

    // Extract superclass -- tree-sitter wraps this as a "superclass" node
    // containing "extends" keyword + type_identifier child
    let superclass: string | null = null;
    for (let i = 0; i < classNode.childCount; i++) {
      const child = classNode.child(i);
      if (child && child.type === 'superclass') {
        superclass = extractSuperclassName(child);
        break;
      }
    }

    // Extract implemented interfaces -- tree-sitter uses "super_interfaces" node type
    const interfaces: string[] = [];
    for (let i = 0; i < classNode.childCount; i++) {
      const child = classNode.child(i);
      if (child && child.type === 'super_interfaces') {
        interfaces.push(...extractInterfaceNames(child));
        break;
      }
    }

    classes.push({
      name: nameNode.text,
      annotations,
      superclass,
      interfaces,
      packageName,
      isInterface,
      modifiers,
      line: classNode.startPosition.row,
      node: classNode,
    });
  }

  return classes;
}

/**
 * Extracts all custom annotation TYPE declarations (`@interface Foo`) from a
 * syntax tree, recording the meta-annotations each is itself declared with.
 *
 * Added for inbound-surface-completeness (Spec #4, Task Group 1). These are
 * NOT classes/interfaces/records, so `extractClassDeclarations` does not (and
 * must not) return them — they are surfaced separately so the framework
 * adapter can resolve composed/meta-annotated mapping annotations
 * (`@ApiV2Get` meta-annotated with `@GetMapping` ⇒ GET) without minting any
 * candidate for the annotation type itself.
 *
 * @param tree - The parsed syntax tree
 * @returns Array of annotation-type declarations with their meta-annotations
 */
export function extractAnnotationTypeDeclarations(tree: Tree): AnnotationTypeInfo[] {
  const root = tree.rootNode;
  const out: AnnotationTypeInfo[] = [];
  const nodes = collectNodesOfType(root, 'annotation_type_declaration');
  for (const node of nodes) {
    const nameNode = node.childForFieldName('name') || node.namedChild(0);
    if (!nameNode) continue;
    out.push({
      name: nameNode.text,
      annotations: extractAnnotations(node),
      line: node.startPosition.row,
    });
  }
  return out;
}

/**
 * Extracts modifiers from a declaration node.
 */
function extractModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === 'modifiers') {
      for (let j = 0; j < child.childCount; j++) {
        const mod = child.child(j);
        if (!mod) continue;
        if (
          mod.type !== 'marker_annotation' &&
          mod.type !== 'annotation' &&
          mod.type.match(/^[a-z]/)
        ) {
          modifiers.push(mod.text);
        }
      }
    }
  }
  return modifiers;
}

/**
 * Extracts all field declarations from a class / interface / record body.
 *
 * For classes/interfaces, walks `field_declaration` children of the body.
 *
 * For `record_declaration` nodes, the "fields" are the compact-constructor
 * parameters declared inline in the record header — e.g.
 * `public record MessageDto(UUID id, String text) {}`. This function also
 * collects those as fields so the adapter sees records as data classes
 * with attributes, which is how Spring Boot + Jackson treat them at runtime.
 *
 * @param classNode - A class_declaration, interface_declaration, or
 *                    record_declaration syntax node
 * @returns Array of field declarations with metadata
 */
export function extractFieldDeclarations(classNode: SyntaxNode): FieldInfo[] {
  const fields: FieldInfo[] = [];

  // Record header parameters → treat each as a field.
  if (classNode.type === 'record_declaration') {
    const params = classNode.childForFieldName('parameters');
    if (params) {
      for (let i = 0; i < params.namedChildCount; i++) {
        const p = params.namedChild(i);
        if (!p || p.type !== 'formal_parameter') continue;
        const pTypeNode = p.childForFieldName('type');
        const pNameNode = p.childForFieldName('name');
        if (!pNameNode) continue;
        fields.push({
          name: pNameNode.text,
          type: extractTypeText(pTypeNode),
          annotations: extractAnnotations(p),
          modifiers: [],
          line: p.startPosition.row,
        });
      }
    }
    // Records CAN also have explicit field_declaration (static fields etc.)
    // inside their body, so fall through to the regular body scan below.
  }

  const body = classNode.childForFieldName('body');
  if (!body) return fields;

  const fieldNodes = collectNodesOfType(body, 'field_declaration');

  for (const fieldNode of fieldNodes) {
    const typeNode = fieldNode.childForFieldName('type');
    const declarator = fieldNode.childForFieldName('declarator');

    if (!declarator) continue;

    const nameNode = declarator.childForFieldName('name');
    if (!nameNode) continue;

    const annotations = extractAnnotations(fieldNode);
    const modifiers = extractModifiers(fieldNode);
    const fieldType = extractTypeText(typeNode);

    fields.push({
      name: nameNode.text,
      type: fieldType,
      annotations,
      modifiers,
      line: fieldNode.startPosition.row,
    });
  }

  return fields;
}

/**
 * Extracts intra-method calls from a method body node (Task Group 3).
 *
 * Walks every `method_invocation` descendant of the method body and records
 * its receiver (the field/variable the call is made on), the invoked method
 * name, the arg count, and (Spec #5, Task Group 1) the per-argument literal
 * text. Calls inside nested / anonymous inner classes are intentionally still
 * collected here -- the resolver keys off receiver field names, and an
 * inner-class call on an outer field is rare; over-collection is harmless
 * because the resolver only follows receivers that resolve to an autowired
 * collaborator field.
 *
 * Receiver resolution:
 *   - `ownerService.save(o)`        -> receiver = "ownerService"
 *   - `this.ownerService.save(o)`   -> receiver = "ownerService" (this. stripped)
 *   - `save(o)`                     -> receiver = null (un-qualified)
 *   - `a.b().c()` (chained)         -> receiver = "a.b()" text best-effort; the
 *     resolver only matches simple single-identifier receivers, so chains fall
 *     through to "unresolved" (a finding), never a wrong edge.
 */
export function extractMethodCalls(methodNode: SyntaxNode): CallInfo[] {
  const calls: CallInfo[] = [];
  const body = methodNode.childForFieldName('body');
  if (!body) return calls;

  const invocations = collectNodesOfType(body, 'method_invocation');
  for (const inv of invocations) {
    const nameNode = inv.childForFieldName('name');
    if (!nameNode) continue;
    const methodName = nameNode.text;

    const objectNode = inv.childForFieldName('object');
    let receiver: string | null = null;
    if (objectNode) {
      if (objectNode.type === 'identifier') {
        // `ownerService.save(...)` -> "ownerService"
        receiver = objectNode.text;
      } else if (objectNode.type === 'field_access') {
        // `this.ownerService.save(...)` -> strip the leading `this.` and keep
        // the trailing field name. A deeper `a.b.c` chain keeps the last
        // segment (best-effort); the resolver only trusts single-field
        // autowired receivers, so this never fabricates an edge.
        const text = objectNode.text;
        const stripped = text.replace(/^this\./, '');
        // If still dotted (e.g. nested field access), take the last segment.
        receiver = stripped.includes('.')
          ? stripped.slice(stripped.lastIndexOf('.') + 1)
          : stripped;
      } else {
        // Chained call / parenthesized expr / etc. -- keep raw text so the
        // resolver can see it is NOT a simple receiver and bail to a finding.
        receiver = objectNode.text;
      }
    }

    // Positional arguments: keep `argCount` (the cheap arity hint) EXACTLY as
    // before AND, for Spec #5 (Outbound Integration Graph) / Spec #6 (SQL-text),
    // retain each argument's literal/placeholder text in `args` so a downstream
    // resolver can read outbound targets / SQL strings. `args.length` therefore
    // equals `argCount` and ORDER is preserved.
    const argList = inv.childForFieldName('arguments');
    let argCount = 0;
    const args: string[] = [];
    if (argList) {
      for (let i = 0; i < argList.namedChildCount; i++) {
        const c = argList.namedChild(i);
        if (c) {
          argCount += 1;
          args.push(decodeCallArgument(c));
        }
      }
    }

    const callee = objectNode ? `${objectNode.text}.${methodName}` : methodName;
    calls.push({
      receiver: receiver && receiver.length > 0 ? receiver : null,
      methodName,
      callee,
      argCount,
      args,
      line: inv.startPosition.row,
    });
  }

  return calls;
}

/**
 * Extracts all method declarations from a class body node.
 *
 * @param classNode - A class_declaration or interface_declaration syntax node
 * @returns Array of method declarations with metadata
 */
export function extractMethodDeclarations(classNode: SyntaxNode): MethodInfo[] {
  const methods: MethodInfo[] = [];

  const body = classNode.childForFieldName('body');
  if (!body) return methods;

  const methodNodes = collectNodesOfType(body, 'method_declaration');

  for (const methodNode of methodNodes) {
    const nameNode = methodNode.childForFieldName('name');
    if (!nameNode) continue;

    // Bug 1 fix: skip methods that live inside a nested / anonymous inner
    // class. `collectNodesOfType` walks the entire subtree, so e.g. the
    // `test()` method of an anonymous `new Predicate<T>() { public boolean
    // test(T t) {...} }` would otherwise be attributed to the outer class.
    // Detect by walking up: if we find another `class_body` before reaching
    // the outer class's body, the method is not on the outer class itself.
    let innerAncestor: SyntaxNode | null = methodNode.parent;
    let skipInnerMethod = false;
    while (innerAncestor && innerAncestor !== body) {
      if (innerAncestor.type === 'class_body' && innerAncestor !== body) {
        skipInnerMethod = true;
        break;
      }
      innerAncestor = innerAncestor.parent;
    }
    if (skipInnerMethod) continue;

    const typeNode = methodNode.childForFieldName('type');
    const returnType = extractTypeText(typeNode);

    const annotations = extractAnnotations(methodNode);
    const modifiers = extractModifiers(methodNode);

    // Extract parameters
    const parameters: ParameterInfo[] = [];
    const paramsNode = methodNode.childForFieldName('parameters');
    if (paramsNode) {
      const paramNodes = collectNodesOfType(paramsNode, 'formal_parameter');
      for (const paramNode of paramNodes) {
        const paramType = extractTypeText(paramNode.childForFieldName('type'));
        const paramName = paramNode.childForFieldName('name');
        const paramAnnotations = extractAnnotations(paramNode);

        parameters.push({
          name: paramName ? paramName.text : '',
          type: paramType,
          annotations: paramAnnotations,
        });
      }
    }

    methods.push({
      name: nameNode.text,
      returnType,
      parameters,
      annotations,
      modifiers,
      line: methodNode.startPosition.row,
      calls: extractMethodCalls(methodNode),
      node: methodNode,
    });
  }

  return methods;
}

/**
 * Extracts a specific argument value from an annotation.
 *
 * @param annotation - The annotation to search
 * @param key - The argument key to look for
 * @returns The argument value, or undefined if not found
 */
export function extractAnnotationArgument(
  annotation: AnnotationInfo,
  key: string
): string | undefined {
  return annotation.arguments[key];
}

/**
 * Extracts all import statements from a syntax tree.
 *
 * @param tree - The parsed syntax tree
 * @returns Array of fully qualified import strings (e.g., 'jakarta.persistence.Entity')
 */
export function extractImports(tree: Tree): string[] {
  const root = tree.rootNode;
  const imports: string[] = [];

  const importNodes = collectNodesOfType(root, 'import_declaration');
  for (const importNode of importNodes) {
    // The import path is in a scoped_identifier or asterisk_import child
    const text = importNode.text;
    // Extract the import path from "import <path>;" or "import static <path>;"
    const match = text.match(/import\s+(?:static\s+)?([^;]+);/);
    if (match) {
      imports.push(match[1].trim());
    }
  }

  return imports;
}

/**
 * Checks whether a class has a specific annotation by name.
 *
 * @param annotations - Array of annotations to search
 * @param name - The annotation name to look for (without '@')
 * @returns true if the annotation is present
 */
export function hasAnnotation(annotations: AnnotationInfo[], name: string): boolean {
  return annotations.some(a => a.name === name);
}

/**
 * Finds an annotation by name from an array of annotations.
 *
 * @param annotations - Array of annotations to search
 * @param name - The annotation name to look for (without '@')
 * @returns The matching annotation, or undefined if not found
 */
export function findAnnotation(
  annotations: AnnotationInfo[],
  name: string
): AnnotationInfo | undefined {
  return annotations.find(a => a.name === name);
}
