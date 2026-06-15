/**
 * Java-DTO field parser (Signal D -- Spec 4, Task Group 3).
 *
 * Spec: agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * A NEW deterministic parser over raw Java source strings that reads the
 * FIELDS of annotated SOAP message DTO classes:
 *  - JAXB `@XmlType` / `@XmlRootElement` / `@XmlAccessorType` value classes
 *    (the doc-literal request/response payload shapes), and
 *  - classes named by a `@RequestWrapper(className=...)` /
 *    `@ResponseWrapper(className=...)` on a `@WebMethod` (the JAX-WS wrapper
 *    beans).
 *
 * Per field it emits the SHARED `MessageField` shape (`messageFieldModel.ts`)
 * the deepened WSDL/XSD walker (Task Group 2) also produces, so Group 4's
 * reconciliation can compare the two views FIELD-FOR-FIELD:
 *  - `name`  : the Java field name.
 *  - `type`  : the Java type expression captured AS-IS (`String`,
 *              `List<Address>`, `int`) -- NO normalization.
 *  - `isNullable` : a BOXED reference type (`Integer`, `String`, any
 *              non-primitive) is nullable; a Java PRIMITIVE (`int`, `boolean`,
 *              ...) is not. `@XmlElement(nillable=true)` forces nullable;
 *              `@XmlElement(required=true)` is recorded as `min_occurs=1`.
 *  - cardinality : `List<T>` / `Set<T>` / `Collection<T>` / `T[]` ->
 *              `is_collection=true`; `@XmlElement(required=false)` ->
 *              `min_occurs=0`.
 *  - `complexTypeRef` : the simple name of a field whose type is itself a
 *              non-built-in DTO (so Group 4 emits a shared entity for it).
 *
 * This parser is the ONLY field source for annotation-only / no-WSDL
 * services, so it MUST stand alone and degrade gracefully: a class with no
 * parsable fields yields a `MessageType` with `fields: []` and NEVER throws.
 *
 * DETERMINISTIC: no LLM, no gateway relay, no I/O beyond the passed-in source
 * strings. Regex/brace-scan over the raw source, mirroring `jaxWsScanner.ts`.
 */

import {
  type MessageType,
  type MessageField,
  type FieldCardinality,
  makeField,
} from './messageFieldModel';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface JavaDtoParseInput {
  /** Repo-relative path of the source file. */
  path: string;
  /** Raw Java source string. */
  content: string;
}

// ----------------------------------------------------------------------------
// Regex catalogue (mirrors jaxWsScanner.ts style)
// ----------------------------------------------------------------------------

const PACKAGE_REGEX = /^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m;
const IMPORT_REGEX = /^\s*import\s+(static\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*;/gm;
const CLASS_DECL_REGEX =
  /(?:public|protected|private|static|final|abstract|\s)*\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;

/** Marker annotations that flag a class as a JAXB / wrapper DTO worth parsing. */
const DTO_MARKER_REGEX =
  /@(XmlType|XmlRootElement|XmlAccessorType|XmlElement|RequestWrapper|ResponseWrapper)\b/;

/**
 * Field declaration matcher over a class body. Captures:
 *  group 1: the annotation block immediately preceding the field (greedy over
 *           consecutive `@Annotation(...)` lines), group 2: the type
 *           expression, group 3: the field name.
 *
 * Deliberately forgiving: matches `private`/`protected`/`public`/package
 * fields, skips `static final` constants, and stops the type expression at
 * the field name. Generic args (`List<Foo>`) and arrays (`Foo[]`) are kept in
 * the type expression for the collection-ness check.
 */
const FIELD_REGEX =
  /(?:^|\n)([ \t]*(?:@[A-Za-z_][\w.]*(?:\s*\([^)]*\))?\s*)*)(?:public|protected|private)?\s*(?!static\s+final\b)([A-Za-z_][\w.]*(?:\s*<[^;{}]*?>)?(?:\s*\[\s*\])?)\s+([A-Za-z_]\w*)\s*(?:=|;)/g;

const X_NAME_ATTR = /\bname\s*=\s*"([^"]*)"/;
const X_NILLABLE_ATTR = /\bnillable\s*=\s*(true|false)\b/;
const X_REQUIRED_ATTR = /\brequired\s*=\s*(true|false)\b/;
const CLASS_NAME_ATTR = /\bclassName\s*=\s*"([^"]*)"/;
const LOCAL_NAME_ATTR = /\blocalName\s*=\s*"([^"]*)"/;
const XMLTYPE_NAME_ATTR = /@XmlType\s*\(([^)]*)\)/;
const XMLROOT_NAME_ATTR = /@XmlRootElement\s*\(([^)]*)\)/;

/** Java primitive types -- a primitive field is NOT nullable. */
const JAVA_PRIMITIVES = new Set([
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'boolean',
  'char',
]);

/** Collection container simple names -> treated as `is_collection`. */
const COLLECTION_CONTAINERS = new Set([
  'List',
  'ArrayList',
  'LinkedList',
  'Set',
  'HashSet',
  'LinkedHashSet',
  'TreeSet',
  'Collection',
  'Iterable',
]);

/**
 * Built-in / framework types we do NOT treat as a nested DTO reference.
 * (java.lang, java.util scalars, JAXB temporal types, etc.)
 */
const BUILTIN_SIMPLE_TYPES = new Set([
  'String',
  'CharSequence',
  'Integer',
  'Long',
  'Short',
  'Byte',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'BigDecimal',
  'BigInteger',
  'Number',
  'Object',
  'Date',
  'Calendar',
  'LocalDate',
  'LocalDateTime',
  'LocalTime',
  'OffsetDateTime',
  'ZonedDateTime',
  'Instant',
  'Duration',
  'UUID',
  'URI',
  'URL',
  'XMLGregorianCalendar',
  'QName',
  'byte', // byte[] payloads
]);

// ----------------------------------------------------------------------------
// Helpers
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

/** Extract the brace-balanced class body starting from a class declaration. */
function extractClassBody(content: string, classKwOffset: number): string | null {
  const open = content.indexOf('{', classKwOffset);
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

/** Walk back from a class-keyword offset to gather its annotation block. */
function collectClassAnnotationsBlock(content: string, classKwOffset: number): string {
  let i = classKwOffset - 1;
  while (i > 0 && content[i] !== ';' && content[i] !== '}') i--;
  return content.slice(i + 1, classKwOffset);
}

/** The simple (head) type name of a Java type expression, generics/array stripped. */
function headTypeName(typeExpr: string): string {
  const head = typeExpr.trim().split(/[<\s\[]/).filter(Boolean)[0] ?? typeExpr.trim();
  return head.replace(/\.\.\.$/, '');
}

/** The element type inside a generic container `List<Foo>` -> `Foo`; else the head. */
function elementTypeName(typeExpr: string): string {
  const lt = typeExpr.indexOf('<');
  const gt = typeExpr.lastIndexOf('>');
  if (lt >= 0 && gt > lt) {
    const inner = typeExpr.slice(lt + 1, gt).trim();
    // For Map<K,V> take the last type arg (the value); else the single arg.
    const parts = inner.split(',');
    return headTypeName(parts[parts.length - 1].trim());
  }
  // Array: `Foo[]` -> `Foo`.
  return headTypeName(typeExpr.replace(/\s*\[\s*\]\s*$/, ''));
}

/** Resolve a simple type name to an FQN via imports / same-package fallback. */
function resolveFqn(
  simple: string,
  imports: Map<string, string>,
  packageName: string | null,
): string {
  if (simple.includes('.')) return simple;
  const fromImport = imports.get(simple);
  if (fromImport) return fromImport;
  if (packageName) return `${packageName}.${simple}`;
  return simple;
}

/** True when a type expression is a collection (`List<T>`, `Set<T>`, `T[]`). */
function isCollectionType(typeExpr: string): boolean {
  if (/\[\s*\]\s*$/.test(typeExpr.trim())) return true;
  const head = headTypeName(typeExpr);
  return COLLECTION_CONTAINERS.has(head);
}

// ----------------------------------------------------------------------------
// Field extraction
// ----------------------------------------------------------------------------

function parseFields(
  classBody: string,
  imports: Map<string, string>,
  packageName: string | null,
): MessageField[] {
  const fields: MessageField[] = [];
  const seen = new Set<string>();
  FIELD_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIELD_REGEX.exec(classBody)) !== null) {
    const annotationBlock = m[1] ?? '';
    const typeExprRaw = m[2].trim();
    const fieldName = m[3];

    // Skip obvious non-field captures: method-ish names, keywords.
    if (!fieldName || seen.has(fieldName)) continue;

    const headType = headTypeName(typeExprRaw);
    // Skip lines that are clearly not fields (e.g. captured `return x;`,
    // control keywords leaking through the forgiving regex).
    if (
      headType === 'return' ||
      headType === 'new' ||
      headType === 'this' ||
      headType === 'class' ||
      headType === 'void'
    ) {
      continue;
    }

    const collection = isCollectionType(typeExprRaw);

    // Nullability: boxed reference type is nullable; primitive is not.
    // `@XmlElement(nillable=true)` forces nullable regardless.
    const isPrimitive = JAVA_PRIMITIVES.has(headType) && !collection;
    let isNullable = !isPrimitive;
    const nillableMatch = X_NILLABLE_ATTR.exec(annotationBlock);
    if (nillableMatch) {
      isNullable = nillableMatch[1] === 'true';
    }

    // Cardinality: required=false -> optional (min_occurs 0).
    const cardinality: Partial<FieldCardinality> = {
      is_collection: collection,
      max_occurs: collection ? 'unbounded' : 1,
    };
    const requiredMatch = X_REQUIRED_ATTR.exec(annotationBlock);
    if (requiredMatch) {
      cardinality.min_occurs = requiredMatch[1] === 'true' ? 1 : 0;
    }

    // complexTypeRef: a non-builtin element type is a nested DTO reference.
    const elemType = collection ? elementTypeName(typeExprRaw) : headType;
    const complexTypeRef =
      elemType && !BUILTIN_SIMPLE_TYPES.has(elemType) && !JAVA_PRIMITIVES.has(elemType)
        ? elemType
        : null;
    // (resolveFqn available for callers needing the FQN of the nested type.)
    void resolveFqn;

    fields.push(
      makeField({
        name: fieldName,
        type: typeExprRaw, // AS-IS Java type expression
        source: 'java',
        isNullable,
        cardinality,
        complexTypeRef,
      }),
    );
    seen.add(fieldName);
  }
  return fields;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Parse the annotated SOAP DTO classes in a set of Java source files into the
 * shared `MessageType` model. Pure + deterministic; degrades gracefully (a
 * class with no parsable fields yields `fields: []`, never a throw).
 *
 * A class is parsed when its annotation block carries any JAXB / wrapper
 * marker (`@XmlType` / `@XmlRootElement` / `@XmlAccessorType` / `@XmlElement`
 * on a member / `@RequestWrapper` / `@ResponseWrapper`). The `name` of the
 * emitted `MessageType` prefers an explicit `@XmlType(name=...)` /
 * `@XmlRootElement(name=...)`, else the simple Java class name.
 */
export function parseJavaDtoFields(inputs: JavaDtoParseInput[]): MessageType[] {
  const out: MessageType[] = [];

  for (const src of inputs) {
    if (!src.content) continue;
    // Cheap pre-filter: only files that mention a JAXB / wrapper marker.
    if (!DTO_MARKER_REGEX.test(src.content)) continue;

    const packageName = extractPackage(src.content);
    const imports = extractImports(src.content);

    CLASS_DECL_REGEX.lastIndex = 0;
    let cm: RegExpExecArray | null;
    while ((cm = CLASS_DECL_REGEX.exec(src.content)) !== null) {
      const simpleClassName = cm[1];
      const classKwOffset = src.content.indexOf('class', cm.index);
      if (classKwOffset < 0) continue;
      const annotationBlock = collectClassAnnotationsBlock(src.content, classKwOffset);

      // Only parse classes that look like JAXB value beans. A class with a
      // member-level @XmlElement but no class-level marker still qualifies, so
      // also peek at the body when the class annotation block is bare.
      const classBody = extractClassBody(src.content, classKwOffset) ?? '';
      const classLevelMarker =
        /@(XmlType|XmlRootElement|XmlAccessorType)\b/.test(annotationBlock);
      const memberLevelMarker = /@XmlElement\b/.test(classBody);
      if (!classLevelMarker && !memberLevelMarker) continue;

      // Resolve the message-type name: explicit @XmlType/@XmlRootElement name
      // attribute wins; else the simple class name.
      let typeName = simpleClassName;
      const xmlTypeArgs = XMLTYPE_NAME_ATTR.exec(annotationBlock)?.[1] ?? '';
      const xmlRootArgs = XMLROOT_NAME_ATTR.exec(annotationBlock)?.[1] ?? '';
      const explicitName =
        X_NAME_ATTR.exec(xmlTypeArgs)?.[1] ??
        X_NAME_ATTR.exec(xmlRootArgs)?.[1] ??
        null;
      if (explicitName && explicitName !== '##default') {
        typeName = explicitName;
      }

      // Degrade gracefully -- parseFields never throws; empty body -> [].
      let fields: MessageField[] = [];
      try {
        fields = parseFields(classBody, imports, packageName);
      } catch {
        fields = [];
      }

      out.push({
        name: typeName,
        provenanceNamespace: null,
        provenanceClass: packageName
          ? `${packageName}.${simpleClassName}`
          : simpleClassName,
        fields,
        source: 'java',
      });
    }
  }

  return out;
}

/**
 * Convenience: extract the `@RequestWrapper(className=...)` /
 * `@ResponseWrapper(className=...)` FQNs declared in a source file, so the
 * caller (Group 4) can associate a wrapper bean with the operation that names
 * it. Pure; returns the FQNs in document order. Returns `[]` when none.
 */
export function extractWrapperClassNames(content: string): string[] {
  if (!content) return [];
  const out: string[] = [];
  const re = /@(?:Request|Response)Wrapper\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const args = m[1] ?? '';
    const cn = CLASS_NAME_ATTR.exec(args)?.[1];
    if (cn) out.push(cn);
    // `localName` is the XML wrapper element name; not a class -- skipped here.
    void LOCAL_NAME_ATTR;
  }
  return out;
}
