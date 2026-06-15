/**
 * XSD field-walk + JSON-Schema projection.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Group 2.
 *
 * ===========================================================================
 * Provenance
 * ===========================================================================
 * The per-field shape (`MessageField` / `MessageType` / cardinality /
 * restrictions) and the XSD-walking machinery (type registry, particle
 * collection, extension folding, restriction-facet extraction, depth/cycle
 * guards) are COPIED + ADAPTED from the discovery-service canonical sources:
 *   discovery-service/.../springClassicSoap/messageFieldModel.ts
 *   discovery-service/.../springClassicSoap/wsdlParser.ts  (the XSD-walk slice)
 *
 * Adaptation: the WSDL walker consumes `<xsd:schema>` blocks embedded inside a
 * `<wsdl:types>` element. Here the schemas arrive as STANDALONE `.xsd` files
 * (the WADL's grammar documents), so the registry builder parses each XSD
 * source document directly and indexes its top-level `<xs:element>` and
 * `<xs:complexType>` declarations. The field-walk itself is unchanged.
 *
 * The copy is deliberate (no cross-service import): the two services build as
 * separate TypeScript projects. The code is PURE (only `fast-xml-parser`), so a
 * verbatim-adapted copy is the safe move. Keep field semantics in lock-step
 * with the canonical sources above.
 *
 * ===========================================================================
 * What this module adds over the WSDL slice
 * ===========================================================================
 * `messageTypeToJsonSchema()` / `elementToJsonSchema()` project a walked XSD
 * element into an `OpenAPIV3.SchemaObject`-shaped JSON Schema (object with
 * `properties` + `required`, arrays via `items`, XSD built-ins mapped to JSON
 * primitive `type`s, restriction facets mapped onto `enum` / `pattern` /
 * length / numeric bounds). That JSON-Schema shape is EXACTLY what the existing
 * capture pipeline already consumes:
 *   - `persistInventory` writes it to `api_behaviour_operations.request_schema_json`
 *   - `get_oas_operation_detail` surfaces it to the LLM
 *   - the LLM combines it with `sample_db_values` rows to fill real bodies.
 * So a WADL+XSD operation gets the same realistic, Sybase-sampled body
 * treatment an OAS operation gets -- no sampler change required.
 *
 * Pure: no `fs`, no `http`, no `process`. Callers supply XSD source strings.
 */

import { XMLParser } from 'fast-xml-parser';
import type { OpenAPIV3 } from 'openapi-types';

// ----------------------------------------------------------------------------
// Per-field model (adapted from messageFieldModel.ts)
// ----------------------------------------------------------------------------

export interface FieldCardinality {
  min_occurs: number;
  /** Either a finite count or the literal `'unbounded'`. */
  max_occurs: number | 'unbounded';
  is_collection: boolean;
}

export interface FieldRestrictions {
  enumeration?: string[];
  pattern?: string;
  min_length?: number;
  max_length?: number;
  /** Raw string preserves scale (e.g. `"0.00"`). */
  min_inclusive?: string;
  max_inclusive?: string;
  total_digits?: number;
  fraction_digits?: number;
}

export interface MessageField {
  name: string;
  /** SOURCE XSD type qname captured AS-IS (`xsd:string`, `tns:Address`). */
  type: string;
  /** `nillable="true"` present-but-null fact (distinct from `minOccurs=0`). */
  isNullable: boolean;
  cardinality: FieldCardinality;
  restrictions?: FieldRestrictions;
  /** Local name of the NAMED complex type this field resolves to, else null. */
  complexTypeRef: string | null;
}

export interface MessageType {
  /** Local name of the complex type / wrapper element. */
  name: string;
  targetNamespace: string | null;
  fields: MessageField[];
}

function defaultCardinality(): FieldCardinality {
  return { min_occurs: 1, max_occurs: 1, is_collection: false };
}

function makeField(args: {
  name: string;
  type: string;
  isNullable?: boolean;
  cardinality?: Partial<FieldCardinality>;
  restrictions?: FieldRestrictions;
  complexTypeRef?: string | null;
}): MessageField {
  const field: MessageField = {
    name: args.name,
    type: args.type,
    isNullable: args.isNullable ?? false,
    cardinality: { ...defaultCardinality(), ...(args.cardinality ?? {}) },
    complexTypeRef: args.complexTypeRef ?? null,
  };
  if (args.restrictions && Object.keys(args.restrictions).length > 0) {
    field.restrictions = args.restrictions;
  }
  return field;
}

// ----------------------------------------------------------------------------
// fast-xml-parser node helpers (copied from wsdlParser.ts)
// ----------------------------------------------------------------------------

type FxpNode = Record<string, unknown>;
const ATTR_KEY = ':@';

/** Default nested/derived complex-type depth cap (mirrors the WSDL walker). */
export const DEFAULT_XSD_MAX_DEPTH = 6;

function stripPrefix(qname: string | null | undefined): string | null {
  if (qname == null) return null;
  const s = String(qname);
  const idx = s.indexOf(':');
  if (idx < 0) return s;
  return s.slice(idx + 1);
}

function getAttrs(node: FxpNode): Record<string, unknown> {
  const raw = node[ATTR_KEY];
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function getAttr(node: FxpNode, attrName: string): string | null {
  const attrs = getAttrs(node);
  const v = attrs[`@_${attrName}`];
  if (v == null) return null;
  return String(v);
}

function getChildren(node: FxpNode, tagName: string): FxpNode[] {
  const raw = node[tagName];
  if (!Array.isArray(raw)) return [];
  return raw as FxpNode[];
}

function findByLocalName(nodes: FxpNode[], localName: string): FxpNode[] {
  const out: FxpNode[] = [];
  for (const n of nodes) {
    for (const key of Object.keys(n)) {
      if (key === ATTR_KEY) continue;
      if (stripPrefix(key) === localName) {
        out.push(n);
        break;
      }
    }
  }
  return out;
}

function tagNameOf(node: FxpNode): string | null {
  for (const k of Object.keys(node)) {
    if (k === ATTR_KEY) continue;
    return k;
  }
  return null;
}

function bodyOf(node: FxpNode): FxpNode[] {
  const tag = tagNameOf(node);
  if (!tag) return [];
  return getChildren(node, tag);
}

function firstChildByLocal(node: FxpNode, local: string): FxpNode | null {
  for (const c of bodyOf(node)) {
    if (stripPrefix(tagNameOf(c)) === local) return c;
  }
  return null;
}

// ----------------------------------------------------------------------------
// XSD type registry (adapted: standalone .xsd documents)
// ----------------------------------------------------------------------------

interface RegisteredComplexType {
  name: string;
  targetNamespace: string | null;
  node: FxpNode;
}

interface RegisteredSimpleType {
  name: string;
  targetNamespace: string | null;
  node: FxpNode;
}

/**
 * The resolved type index built from one-or-more standalone XSD source files.
 * `elementType` maps each top-level `<xs:element name=>` to either the local
 * name of a NAMED complex type it references (`type="tns:Foo"`), the element's
 * own name when it has an inline anonymous complexType, or the built-in/simple
 * type qname (so a simple-typed top-level element still yields a schema).
 */
export interface XsdTypeRegistry {
  complexTypes: Map<string, RegisteredComplexType>;
  simpleTypes: Map<string, RegisteredSimpleType>;
  /** element local name -> { typeRef, isInlineComplex, simpleTypeQName } */
  elements: Map<
    string,
    {
      /** Local name of the complex type the element resolves to, else null. */
      complexTypeRef: string | null;
      /** Raw `type=` qname when the element is simple-typed, else null. */
      simpleTypeQName: string | null;
      /** Inline `<xs:simpleType>` restriction facets, when present. */
      inlineRestrictions?: FieldRestrictions;
      targetNamespace: string | null;
    }
  >;
}

const XSD_PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
} as const;

/**
 * Parse + index a set of standalone XSD source documents into a single shared
 * type registry. Soft-fails per file: a malformed XSD is skipped (its types
 * simply do not register) rather than throwing.
 */
export function buildXsdRegistry(xsdSources: Map<string, string>): XsdTypeRegistry {
  const registry: XsdTypeRegistry = {
    complexTypes: new Map(),
    simpleTypes: new Map(),
    elements: new Map(),
  };
  const xmlParser = new XMLParser(XSD_PARSER_OPTS);

  for (const [, source] of xsdSources) {
    let parsed: FxpNode[];
    try {
      parsed = xmlParser.parse(source) as FxpNode[];
    } catch {
      continue; // soft-fail: skip unparseable grammar
    }
    if (!Array.isArray(parsed)) continue;
    const schemas = findByLocalName(parsed, 'schema');
    for (const schema of schemas) {
      const schemaNs = getAttr(schema, 'targetNamespace');
      for (const child of bodyOf(schema)) {
        const local = stripPrefix(tagNameOf(child));
        if (local === 'complexType') {
          const name = getAttr(child, 'name');
          if (name) {
            registry.complexTypes.set(name, {
              name,
              targetNamespace: schemaNs,
              node: child,
            });
          }
        } else if (local === 'simpleType') {
          const name = getAttr(child, 'name');
          if (name) {
            registry.simpleTypes.set(name, {
              name,
              targetNamespace: schemaNs,
              node: child,
            });
          }
        } else if (local === 'element') {
          const name = getAttr(child, 'name');
          if (!name) continue;
          const typeAttr = getAttr(child, 'type');
          const inline = firstChildByLocal(child, 'complexType');
          const inlineSimple = firstChildByLocal(child, 'simpleType');
          if (inline) {
            // Inline anonymous complexType -> register under the element name.
            registry.complexTypes.set(name, {
              name,
              targetNamespace: schemaNs,
              node: inline,
            });
            registry.elements.set(name, {
              complexTypeRef: name,
              simpleTypeQName: null,
              targetNamespace: schemaNs,
            });
          } else if (typeAttr && !isXsdBuiltin(typeAttr)) {
            // Element typed by reference to a named type (could be complex or
            // simple -- resolved at walk time against the registry).
            registry.elements.set(name, {
              complexTypeRef: stripPrefix(typeAttr),
              simpleTypeQName: typeAttr,
              targetNamespace: schemaNs,
            });
          } else {
            // Built-in / simple-typed top-level element, possibly with an
            // inline restriction.
            let inlineRestrictions: FieldRestrictions | undefined;
            if (inlineSimple) {
              const restriction = firstChildByLocal(inlineSimple, 'restriction');
              if (restriction) {
                const facets = extractRestrictionFacets(restriction);
                if (Object.keys(facets).length > 0) inlineRestrictions = facets;
              }
            }
            registry.elements.set(name, {
              complexTypeRef: null,
              simpleTypeQName: typeAttr,
              inlineRestrictions,
              targetNamespace: schemaNs,
            });
          }
        }
      }
    }
  }

  return registry;
}

// ----------------------------------------------------------------------------
// XSD restriction extraction (copied from wsdlParser.ts)
// ----------------------------------------------------------------------------

function isXsdBuiltin(typeQName: string | null): boolean {
  if (!typeQName) return false;
  const prefix = typeQName.includes(':') ? typeQName.split(':')[0] : '';
  return prefix === 'xsd' || prefix === 'xs';
}

function extractRestrictionFacets(restrictionNode: FxpNode): FieldRestrictions {
  const out: FieldRestrictions = {};
  const enums: string[] = [];
  for (const facet of bodyOf(restrictionNode)) {
    const local = stripPrefix(tagNameOf(facet));
    const value = getAttr(facet, 'value');
    if (value == null) continue;
    switch (local) {
      case 'enumeration':
        enums.push(value);
        break;
      case 'pattern':
        out.pattern = value;
        break;
      case 'minLength': {
        const n = Number(value);
        if (!Number.isNaN(n)) out.min_length = n;
        break;
      }
      case 'maxLength': {
        const n = Number(value);
        if (!Number.isNaN(n)) out.max_length = n;
        break;
      }
      case 'minInclusive':
        out.min_inclusive = value;
        break;
      case 'maxInclusive':
        out.max_inclusive = value;
        break;
      case 'totalDigits': {
        const n = Number(value);
        if (!Number.isNaN(n)) out.total_digits = n;
        break;
      }
      case 'fractionDigits': {
        const n = Number(value);
        if (!Number.isNaN(n)) out.fraction_digits = n;
        break;
      }
      default:
        break;
    }
  }
  if (enums.length > 0) out.enumeration = enums;
  return out;
}

function resolveRestrictions(
  elementNode: FxpNode,
  typeQName: string | null,
  registry: XsdTypeRegistry,
): FieldRestrictions | undefined {
  const inlineSimple = firstChildByLocal(elementNode, 'simpleType');
  if (inlineSimple) {
    const restriction = firstChildByLocal(inlineSimple, 'restriction');
    if (restriction) {
      const facets = extractRestrictionFacets(restriction);
      if (Object.keys(facets).length > 0) return facets;
    }
  }
  if (typeQName) {
    const local = stripPrefix(typeQName) as string;
    const named = registry.simpleTypes.get(local);
    if (named) {
      const restriction = firstChildByLocal(named.node, 'restriction');
      if (restriction) {
        const facets = extractRestrictionFacets(restriction);
        if (Object.keys(facets).length > 0) return facets;
      }
    }
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// XSD field walking (copied + adapted from wsdlParser.ts)
// ----------------------------------------------------------------------------

function collectParticleElements(containerNode: FxpNode): FxpNode[] {
  const out: FxpNode[] = [];
  for (const child of bodyOf(containerNode)) {
    const local = stripPrefix(tagNameOf(child));
    if (local === 'element') {
      out.push(child);
    } else if (local === 'sequence' || local === 'all' || local === 'choice') {
      out.push(...collectParticleElements(child));
    }
  }
  return out;
}

function parseCardinality(elementNode: FxpNode): FieldCardinality {
  const minRaw = getAttr(elementNode, 'minOccurs');
  const maxRaw = getAttr(elementNode, 'maxOccurs');
  let min_occurs = 1;
  if (minRaw != null) {
    const n = parseInt(minRaw, 10);
    if (!Number.isNaN(n)) min_occurs = n;
  }
  let max_occurs: number | 'unbounded' = 1;
  let is_collection = false;
  if (maxRaw != null) {
    if (maxRaw === 'unbounded') {
      max_occurs = 'unbounded';
      is_collection = true;
    } else {
      const n = parseInt(maxRaw, 10);
      if (!Number.isNaN(n)) {
        max_occurs = n;
        if (n > 1) is_collection = true;
      }
    }
  }
  return { min_occurs, max_occurs, is_collection };
}

function complexTypeParticles(
  complexTypeNode: FxpNode,
  registry: XsdTypeRegistry,
): { particles: FxpNode[]; baseTypeName: string | null } {
  const complexContent = firstChildByLocal(complexTypeNode, 'complexContent');
  const container = complexContent ?? complexTypeNode;
  const extension = firstChildByLocal(container, 'extension');

  let baseTypeName: string | null = null;
  const baseParticles: FxpNode[] = [];
  if (extension) {
    const baseQName = getAttr(extension, 'base');
    baseTypeName = baseQName ? (stripPrefix(baseQName) as string) : null;
    if (baseTypeName) {
      const baseType = registry.complexTypes.get(baseTypeName);
      if (baseType) {
        const baseResult = complexTypeParticles(baseType.node, registry);
        baseParticles.push(...baseResult.particles);
      }
    }
    baseParticles.push(...collectParticleElements(extension));
    return { particles: baseParticles, baseTypeName };
  }

  return { particles: collectParticleElements(container), baseTypeName: null };
}

interface WalkCtx {
  registry: XsdTypeRegistry;
  maxDepth: number;
  /** Output: discovered message types keyed by local name (dedup shared types). */
  emitted: Map<string, MessageType>;
}

function inlineComplexTypeOf(elementNode: FxpNode): FxpNode | null {
  return firstChildByLocal(elementNode, 'complexType');
}

function walkComplexType(
  typeName: string,
  complexTypeNode: FxpNode,
  targetNamespace: string | null,
  ctx: WalkCtx,
  depth: number,
  path: Set<string>,
): string {
  if (ctx.emitted.has(typeName)) return typeName;

  const { particles } = complexTypeParticles(complexTypeNode, ctx.registry);
  const fields: MessageField[] = [];

  const messageType: MessageType = {
    name: typeName,
    targetNamespace,
    fields,
  };
  ctx.emitted.set(typeName, messageType);

  const localPath = new Set(path).add(typeName);

  for (const el of particles) {
    const name = getAttr(el, 'name');
    const ref = getAttr(el, 'ref');
    const fieldName = name ?? (ref ? (stripPrefix(ref) as string) : null);
    if (!fieldName) continue;

    const typeQName = getAttr(el, 'type');
    const nillable = getAttr(el, 'nillable') === 'true';
    const cardinality = parseCardinality(el);
    const restrictions = resolveRestrictions(el, typeQName, ctx.registry);

    let complexTypeRef: string | null = null;
    const inline = inlineComplexTypeOf(el);
    const namedComplexLocal =
      typeQName && !isXsdBuiltin(typeQName)
        ? (stripPrefix(typeQName) as string)
        : null;
    const namedComplex = namedComplexLocal
      ? ctx.registry.complexTypes.get(namedComplexLocal)
      : undefined;

    if (inline) {
      const inlineName = `${typeName}.${fieldName}`;
      if (depth + 1 <= ctx.maxDepth) {
        complexTypeRef = walkComplexType(
          inlineName,
          inline,
          targetNamespace,
          ctx,
          depth + 1,
          localPath,
        );
      }
    } else if (namedComplex && namedComplexLocal) {
      const namedLocal: string = namedComplexLocal;
      complexTypeRef = namedLocal;
      if (localPath.has(namedLocal)) {
        // cycle -- stop the descent (reference recorded, no re-walk)
      } else if (!ctx.emitted.has(namedLocal)) {
        if (depth + 1 <= ctx.maxDepth) {
          walkComplexType(
            namedLocal,
            namedComplex.node,
            namedComplex.targetNamespace,
            ctx,
            depth + 1,
            localPath,
          );
        }
      }
    }

    fields.push(
      makeField({
        name: fieldName,
        type: typeQName ?? (ref ? `ref:${stripPrefix(ref)}` : 'xsd:anyType'),
        isNullable: nillable,
        cardinality,
        restrictions,
        complexTypeRef,
      }),
    );
  }

  return typeName;
}

// ----------------------------------------------------------------------------
// JSON-Schema projection
// ----------------------------------------------------------------------------

/**
 * Map an XSD built-in qname (`xsd:string`, `xs:int`, ...) onto a JSON-Schema
 * primitive `{ type, format? }`. Unknown / unmapped -> `{ type: 'string' }`
 * (the safest default for a free-text-ish field the LLM can still populate).
 */
function xsdBuiltinToJson(qname: string | null): { type: string; format?: string } {
  const local = (stripPrefix(qname) ?? '').toLowerCase();
  switch (local) {
    case 'int':
    case 'integer':
    case 'long':
    case 'short':
    case 'byte':
    case 'unsignedint':
    case 'unsignedlong':
    case 'unsignedshort':
    case 'unsignedbyte':
    case 'nonnegativeinteger':
    case 'positiveinteger':
    case 'negativeinteger':
    case 'nonpositiveinteger':
      return { type: 'integer' };
    case 'decimal':
    case 'double':
    case 'float':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'time':
      return { type: 'string', format: 'time' };
    case 'base64binary':
    case 'hexbinary':
      return { type: 'string', format: 'byte' };
    default:
      return { type: 'string' };
  }
}

/** Apply XSD restriction facets onto a JSON-Schema scalar node, in place. */
function applyRestrictions(
  node: OpenAPIV3.SchemaObject,
  restrictions: FieldRestrictions | undefined,
): void {
  if (!restrictions) return;
  if (restrictions.enumeration && restrictions.enumeration.length > 0) {
    (node as { enum?: unknown[] }).enum = [...restrictions.enumeration];
  }
  if (restrictions.pattern) node.pattern = restrictions.pattern;
  if (typeof restrictions.min_length === 'number') node.minLength = restrictions.min_length;
  if (typeof restrictions.max_length === 'number') node.maxLength = restrictions.max_length;
  if (restrictions.min_inclusive != null) {
    const n = Number(restrictions.min_inclusive);
    if (!Number.isNaN(n)) node.minimum = n;
  }
  if (restrictions.max_inclusive != null) {
    const n = Number(restrictions.max_inclusive);
    if (!Number.isNaN(n)) node.maximum = n;
  }
}

/**
 * Build a JSON-Schema scalar/object node for a single field, recursing into
 * `complexTypeRef` against the emitted type set. `seen` guards type cycles so
 * the projection terminates.
 */
function fieldToJsonNode(
  field: MessageField,
  emitted: Map<string, MessageType>,
  seen: Set<string>,
): OpenAPIV3.SchemaObject {
  let valueNode: OpenAPIV3.SchemaObject;
  if (field.complexTypeRef && emitted.has(field.complexTypeRef)) {
    if (seen.has(field.complexTypeRef)) {
      // cycle -- emit an opaque object placeholder rather than recursing
      valueNode = { type: 'object' };
    } else {
      valueNode = messageTypeToJsonSchema(
        emitted.get(field.complexTypeRef) as MessageType,
        emitted,
        new Set(seen).add(field.complexTypeRef),
      );
    }
  } else {
    valueNode = xsdBuiltinToJson(field.type) as OpenAPIV3.SchemaObject;
    applyRestrictions(valueNode, field.restrictions);
  }

  if (field.cardinality.is_collection) {
    return { type: 'array', items: valueNode };
  }
  return valueNode;
}

/**
 * Project a walked `MessageType` into an `OpenAPIV3.SchemaObject` (object with
 * `properties` + `required`). `required` lists every field whose
 * `cardinality.min_occurs >= 1` (XSD default). Nullable fields additionally
 * carry `nullable: true`.
 */
export function messageTypeToJsonSchema(
  mt: MessageType,
  emitted: Map<string, MessageType>,
  seen: Set<string> = new Set([mt.name]),
): OpenAPIV3.SchemaObject {
  const properties: Record<string, OpenAPIV3.SchemaObject> = {};
  const required: string[] = [];
  for (const field of mt.fields) {
    const node = fieldToJsonNode(field, emitted, seen);
    if (field.isNullable) {
      (node as { nullable?: boolean }).nullable = true;
    }
    properties[field.name] = node;
    if (field.cardinality.min_occurs >= 1) required.push(field.name);
  }
  const schema: OpenAPIV3.SchemaObject = {
    type: 'object',
    properties: properties as Record<string, OpenAPIV3.SchemaObject>,
  };
  if (required.length > 0) schema.required = required;
  return schema;
}

// ----------------------------------------------------------------------------
// Public API: element -> JSON Schema
// ----------------------------------------------------------------------------

export interface ElementToJsonSchemaResult {
  /** The projected JSON Schema; null when the element did not resolve. */
  schema: OpenAPIV3.SchemaObject | null;
  /** True when the element name resolved in the registry. */
  resolved: boolean;
}

/**
 * Resolve a top-level XSD element by local name and project it into a JSON
 * Schema. Handles three shapes:
 *  - inline anonymous complexType    -> walked into an object schema
 *  - `type="tns:NamedComplex"`        -> the named complex type's object schema
 *  - `type="xs:string"` (simple/built-in, possibly restricted) -> scalar schema
 *
 * Returns `{ schema: null, resolved: false }` when the element name is not in
 * the registry (e.g. the WADL referenced an element no provided XSD declares).
 */
export function elementToJsonSchema(
  elementLocalName: string,
  registry: XsdTypeRegistry,
  maxDepth: number = DEFAULT_XSD_MAX_DEPTH,
): ElementToJsonSchemaResult {
  const elementInfo = registry.elements.get(elementLocalName);
  if (!elementInfo) {
    // Element not declared as a top-level element, but its name might match a
    // named complex type directly (some generators reference the type name).
    const ct = registry.complexTypes.get(elementLocalName);
    if (!ct) return { schema: null, resolved: false };
    const ctx: WalkCtx = { registry, maxDepth, emitted: new Map() };
    walkComplexType(ct.name, ct.node, ct.targetNamespace, ctx, 0, new Set());
    const mt = ctx.emitted.get(ct.name);
    if (!mt) return { schema: null, resolved: false };
    return {
      schema: messageTypeToJsonSchema(mt, ctx.emitted),
      resolved: true,
    };
  }

  // Complex-typed element (inline or named).
  if (elementInfo.complexTypeRef && registry.complexTypes.has(elementInfo.complexTypeRef)) {
    const ct = registry.complexTypes.get(elementInfo.complexTypeRef) as RegisteredComplexType;
    const ctx: WalkCtx = { registry, maxDepth, emitted: new Map() };
    walkComplexType(ct.name, ct.node, ct.targetNamespace, ctx, 0, new Set());
    const mt = ctx.emitted.get(ct.name);
    if (!mt) return { schema: null, resolved: false };
    return {
      schema: messageTypeToJsonSchema(mt, ctx.emitted),
      resolved: true,
    };
  }

  // Named type ref that turned out to be a simple type with restrictions.
  if (elementInfo.complexTypeRef && registry.simpleTypes.has(elementInfo.complexTypeRef)) {
    const named = registry.simpleTypes.get(elementInfo.complexTypeRef);
    const node = xsdBuiltinToJson(elementInfo.simpleTypeQName) as OpenAPIV3.SchemaObject;
    if (named) {
      const restriction = firstChildByLocal(named.node, 'restriction');
      if (restriction) {
        // base type drives the JSON primitive
        const baseQName = getAttr(restriction, 'base');
        const baseNode = xsdBuiltinToJson(baseQName) as OpenAPIV3.SchemaObject;
        node.type = baseNode.type;
        if (baseNode.format) node.format = baseNode.format;
        applyRestrictions(node, extractRestrictionFacets(restriction));
      }
    }
    return { schema: node, resolved: true };
  }

  // Built-in / inline-restricted simple-typed top-level element.
  const node = xsdBuiltinToJson(elementInfo.simpleTypeQName) as OpenAPIV3.SchemaObject;
  applyRestrictions(node, elementInfo.inlineRestrictions);
  return { schema: node, resolved: true };
}
