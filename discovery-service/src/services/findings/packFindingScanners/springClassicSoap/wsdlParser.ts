/**
 * WSDL parser (Signal C foundation).
 *
 * Spec: 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 1.
 * Deepened: 2026-05-30 SOAP/WSDL Message-Field Depth (Spec 4), Task Group 2.
 *
 * Pure, side-effect-free WSDL walker built on `fast-xml-parser`.
 *
 * Public function: `parseWsdl(source, opts)` -> `WsdlParseResult`.
 *
 * ===========================================================================
 * Phase 1 walker scope (deliberately narrow per D-4)
 * ===========================================================================
 *  - `wsdl:portType` operations + their `input` / `output` message parts
 *  - Message parts resolved back to `xsd:element` definitions (embedded
 *    or imported via relative paths)
 *  - Embedded `<xsd:schema>` top-level `xsd:element` and `xsd:complexType`
 *    signatures
 *  - Relative `xsd:import` / `xsd:include` resolution via the caller-supplied
 *    `opts.relatedFiles` map (file-system relative paths within the repo
 *    only); absolute URLs are silently skipped (no network access in v1)
 *  - Multi-port WSDLs: iterate every `wsdl:port` binding and emit operations
 *    for each `port x operation` pair
 *
 * ===========================================================================
 * Spec 4 (Task Group 2) -- full message-field depth
 * ===========================================================================
 * The Phase 1 walker collected only top-level element / complexType NAMES.
 * Spec 4 deepens it to the FULL field structure crossing the SOAP boundary,
 * emitting `result.messageTypes: MessageType[]` -- one `MessageType` per
 * NAMED complex type and per doc-literal wrapper element, each carrying its
 * fields with:
 *  - `name`, source `type` (XSD qname captured AS-IS, NO normalization)
 *  - cardinality (`minOccurs=0` -> optional; `maxOccurs>1`/`unbounded` ->
 *    `is_collection`) in the Group 1 JSONB key shape
 *  - nullability from `nillable="true"` -- kept DISTINCT from `minOccurs=0`
 *  - value-domain restrictions (`enumeration`, `pattern`, `minLength`/
 *    `maxLength`, `minInclusive`/`maxInclusive`, `totalDigits`/
 *    `fractionDigits`) from inline or named `xsd:simpleType` restrictions
 *  - `xsd:extension` base-type fields FOLDED into the derived child
 *
 * Nested/derived complex types are walked to an env-tunable depth cap
 * (`opts.maxDepth`, default `DEFAULT_XSD_MAX_DEPTH`). Hitting the cap STOPS
 * the descent and records a `soap_message_depth_cap` field-finding (no silent
 * truncation). Type cycles (e.g. `Employee -> manager : Employee`) are
 * detected via a visited-type path and STOP with a `soap_message_type_cycle`
 * finding rather than looping. Multi-part / RPC-style messages (more than one
 * `wsdl:part`, or `part type=` instead of `part element=`) record a
 * `soap_message_multipart_unexpanded` finding -- v1 fully expands only the
 * dominant doc-literal-wrapped single-part style.
 *
 * The field-findings ride on `result.fieldDepthFindings` as plain structured
 * records; the SOAP pass call site translates them into evidence-gap Findings
 * via `buildSoapEvidenceGapFinding` (the same builder Phase 1 used).
 *
 * Soft-fail behaviour (UNCHANGED): catches any thrown error from
 * `fast-xml-parser`, returns an empty `operations: []` array with `parseError`
 * populated for the caller to translate into a `wsdl_parse_failed`
 * `evidence_gap` finding.
 *
 * Pure: no `fs`, no `http`, no `process` usage. Caller supplies the source
 * string plus a file map for related schemas and (optionally) the depth cap.
 */

import { XMLParser } from 'fast-xml-parser';
import {
  type MessageField,
  type MessageType,
  type FieldRestrictions,
  makeField,
} from './messageFieldModel';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface WsdlPort {
  /** `wsdl:port` `name=` attribute */
  portName: string;
  /** `wsdl:port` `binding=` attribute -- local name only (namespace prefix stripped) */
  bindingName: string;
  /** `soap:address location=` URL when present, else null */
  soapAddressLocation: string | null;
}

export interface WsdlPortType {
  /** `wsdl:portType` `name=` attribute */
  portTypeName: string;
  /** operation names declared under this port type */
  operationNames: string[];
}

export interface WsdlOperation {
  /** `wsdl:port` `name=` that this operation is reached through */
  portName: string;
  /** `wsdl:portType` `name=` containing this operation */
  portTypeName: string;
  /** `wsdl:operation` `name=` attribute */
  operationName: string;
  /** `soap:operation soapAction=` attribute when present in the binding, else null */
  soapAction: string | null;
  /** local-name of the `wsdl:message` referenced by `wsdl:input message=` */
  inputMessage: string | null;
  /** local-name of the `wsdl:message` referenced by `wsdl:output message=` */
  outputMessage: string | null;
  /** Resolved `xsd:element` local-name on the input message part */
  requestRootElement: string | null;
  /** target namespace of the request element */
  requestNamespace: string | null;
  /** Resolved `xsd:element` local-name on the output message part */
  responseRootElement: string | null;
}

export interface XsdElementDecl {
  /** `xsd:element` `name=` attribute */
  name: string;
  /** owning schema's `targetNamespace=` attribute, when known */
  targetNamespace: string | null;
}

export interface XsdComplexTypeDecl {
  name: string;
  targetNamespace: string | null;
}

export interface XsdSchema {
  /** `xsd:schema` `targetNamespace=` attribute, when present */
  targetNamespace: string | null;
  /** top-level `xsd:element` declarations */
  elements: XsdElementDecl[];
  /** top-level named `xsd:complexType` declarations */
  complexTypes: XsdComplexTypeDecl[];
}

export interface WsdlParseError {
  reason: string;
  sourcePath: string;
}

/**
 * A field-structure STOP condition recorded by the deep walker (Spec 4). The
 * caller translates each into an evidence-gap Finding via
 * `buildSoapEvidenceGapFinding`. Pure data -- no Finding shape leaks into the
 * parser.
 */
export interface WsdlFieldFinding {
  /** Maps 1:1 onto a `buildSoapEvidenceGapFinding` `gapType` sentinel. */
  kind:
    | 'soap_message_depth_cap'
    | 'soap_message_type_cycle'
    | 'soap_message_multipart_unexpanded';
  /** The complex type / message / operation the stop happened on. */
  subject: string;
  /** One-line human-readable reason. */
  reason: string;
  /** Repo-relative WSDL path (forwarded from `opts.sourcePath`). */
  sourcePath: string;
}

export interface WsdlParseResult {
  /** Repo-relative path the WSDL was loaded from (forwarded from `opts.sourcePath`) */
  sourcePath: string;
  /** `wsdl:definitions` `targetNamespace=` attribute, when present */
  targetNamespace: string | null;
  ports: WsdlPort[];
  portTypes: WsdlPortType[];
  operations: WsdlOperation[];
  /** All embedded `<xsd:schema>` blocks plus any resolved relative imports */
  embeddedSchemas: XsdSchema[];
  /**
   * Spec 4: deeply-walked message types (named complex types + doc-literal
   * wrapper elements) with their full field structure. One entry per NAMED
   * complex type and per wrapper element; Group 4 emits ONE shared
   * `logical_data_entity` per named type. Empty when no schema fields parse.
   */
  messageTypes: MessageType[];
  /**
   * Spec 4: field-structure STOP conditions (depth-cap / cycle / multi-part).
   * Empty when the full message-field walk completed cleanly.
   */
  fieldDepthFindings: WsdlFieldFinding[];
  /** Populated when parsing failed; `operations` is `[]` in that case. */
  parseError?: WsdlParseError;
}

/**
 * Default nested/derived complex-type depth cap. Mirrors the env-tunable-cap
 * pattern (Spec 2). The pure walker takes the cap as an explicit option so it
 * stays deterministic in tests; the SOAP pass call site reads the
 * `DISCOVERY_SOAP_XSD_MAX_DEPTH` env knob and threads it in.
 */
export const DEFAULT_XSD_MAX_DEPTH = 6;

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Strip an `xmlns` prefix (e.g. `tns:greet` -> `greet`).
 * Returns the input unchanged when no prefix is present.
 */
function stripPrefix(qname: string | null | undefined): string | null {
  if (qname == null) return null;
  const s = String(qname);
  const idx = s.indexOf(':');
  if (idx < 0) return s;
  return s.slice(idx + 1);
}

/**
 * `fast-xml-parser` with `preserveOrder: true` returns each tag as a
 * single-key wrapper object. `coerceArray` normalises "missing / single /
 * array" into "array".
 */
function coerceArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Internal node shape produced by `fast-xml-parser` with `preserveOrder: true`.
 * Each node is `{ "<tagName>": Node[]; ":@"?: { "@_<attr>": string } }`.
 */
type FxpNode = Record<string, unknown>;

const ATTR_KEY = ':@';

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

/** Get the children array stored under the tag-name key. */
function getChildren(node: FxpNode, tagName: string): FxpNode[] {
  const raw = node[tagName];
  if (!Array.isArray(raw)) return [];
  return raw as FxpNode[];
}

/**
 * Walk a `preserveOrder` node array, returning every entry whose key
 * local-name (post-prefix) equals `localName`.
 */
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

/** Return the first key on a node that is not `:@`. */
function tagNameOf(node: FxpNode): string | null {
  for (const k of Object.keys(node)) {
    if (k === ATTR_KEY) continue;
    return k;
  }
  return null;
}

/** Return the children array for the tag wrapped by `node` (single-key wrapper). */
function bodyOf(node: FxpNode): FxpNode[] {
  const tag = tagNameOf(node);
  if (!tag) return [];
  return getChildren(node, tag);
}

/** Absolute-URL detection: `http://`, `https://`, or any other scheme. */
function isAbsoluteUrl(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s);
}

/**
 * Resolve a relative path against a base path, using POSIX-style segments.
 * Pure: no fs access. Returns the normalised path string (forward slashes).
 */
function resolveRelative(baseFilePath: string, schemaLocation: string): string {
  // Normalise slashes
  const baseDir = baseFilePath
    .replace(/\\/g, '/')
    .replace(/\/[^/]*$/, ''); // drop the filename
  const target = schemaLocation.replace(/\\/g, '/');
  const parts = (baseDir ? baseDir.split('/') : []).filter((p) => p.length > 0);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

// ----------------------------------------------------------------------------
// XSD type registry (Spec 4)
// ----------------------------------------------------------------------------

/**
 * A registered XSD type, keyed by local name. Holds the raw `preserveOrder`
 * node so the field walker can descend into it lazily (depth-/cycle-guarded).
 */
interface RegisteredComplexType {
  name: string;
  targetNamespace: string | null;
  /** The `<xsd:complexType>` node (named, or the element's inline one). */
  node: FxpNode;
}

interface RegisteredSimpleType {
  name: string;
  targetNamespace: string | null;
  node: FxpNode;
}

interface XsdTypeRegistry {
  /** Named complex types + wrapper-element inline complex types, by local name. */
  complexTypes: Map<string, RegisteredComplexType>;
  /** Named simple types, by local name (for restriction resolution). */
  simpleTypes: Map<string, RegisteredSimpleType>;
  /**
   * Doc-literal wrapper elements -> the local name of the complex type they
   * resolve to (their own inline type uses the element name as the key).
   */
  elementTypeRef: Map<string, string>;
}

/**
 * Collect the immediate child nodes of a node whose local name matches `local`.
 */
function childrenByLocal(node: FxpNode, local: string): FxpNode[] {
  return bodyOf(node).filter((c) => stripPrefix(tagNameOf(c)) === local);
}

/** First child by local name, or null. */
function firstChildByLocal(node: FxpNode, local: string): FxpNode | null {
  for (const c of bodyOf(node)) {
    if (stripPrefix(tagNameOf(c)) === local) return c;
  }
  return null;
}

/**
 * Register every named complex/simple type and every top-level element's
 * inline complex type across all schemas. Wrapper elements with an inline
 * complexType are registered under the ELEMENT name (so the doc-literal
 * wrapper becomes its own message type), plus an `elementTypeRef` entry. A
 * wrapper element with `type="tns:Foo"` records an `elementTypeRef` pointing
 * at the named type `Foo`.
 */
function buildTypeRegistry(schemas: FxpNode[], _tns: string | null): XsdTypeRegistry {
  const registry: XsdTypeRegistry = {
    complexTypes: new Map(),
    simpleTypes: new Map(),
    elementTypeRef: new Map(),
  };

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
        if (typeAttr) {
          // Element typed by reference to a named type.
          registry.elementTypeRef.set(name, stripPrefix(typeAttr) as string);
        } else {
          // Inline anonymous complexType -> register under the element name so
          // the doc-literal wrapper element becomes its own message type.
          const inline = firstChildByLocal(child, 'complexType');
          if (inline) {
            registry.complexTypes.set(name, {
              name,
              targetNamespace: schemaNs,
              node: inline,
            });
            registry.elementTypeRef.set(name, name);
          }
        }
      }
    }
  }

  return registry;
}

// ----------------------------------------------------------------------------
// XSD restriction extraction (Spec 4)
// ----------------------------------------------------------------------------

/** XSD built-in primitive prefix detection (anything in the XSD namespace). */
function isXsdBuiltin(typeQName: string | null): boolean {
  if (!typeQName) return false;
  // Built-ins are conventionally prefixed `xsd:` / `xs:`; a bare token with no
  // prefix that is not a known registered type is also treated as built-in by
  // the caller (it checks the registry first).
  const prefix = typeQName.includes(':') ? typeQName.split(':')[0] : '';
  return prefix === 'xsd' || prefix === 'xs';
}

/**
 * Extract value-domain restrictions from a `<xsd:restriction>` node's facet
 * children. Key names match the Group 1 on-attribute JSONB metadata blob.
 */
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
        out.min_inclusive = value; // raw string preserves scale
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

/**
 * Resolve a field's restrictions. Two sources:
 *  - an inline `<xsd:simpleType><xsd:restriction>` directly on the element, or
 *  - a `type=` pointing at a NAMED simpleType in the registry whose body is a
 *    `<xsd:restriction>`.
 * Returns `undefined` when no facets apply.
 */
function resolveRestrictions(
  elementNode: FxpNode,
  typeQName: string | null,
  registry: XsdTypeRegistry,
): FieldRestrictions | undefined {
  // 1) Inline simpleType on the element.
  const inlineSimple = firstChildByLocal(elementNode, 'simpleType');
  if (inlineSimple) {
    const restriction = firstChildByLocal(inlineSimple, 'restriction');
    if (restriction) {
      const facets = extractRestrictionFacets(restriction);
      if (Object.keys(facets).length > 0) return facets;
    }
  }
  // 2) Named simpleType reference.
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
// XSD field walking (Spec 4)
// ----------------------------------------------------------------------------

/**
 * Collect the element particles in a content-model container, descending
 * through `sequence` / `all` / `choice` transparently (their grouping does
 * not change the field set for our purposes). Returns the `<xsd:element>`
 * nodes in document order.
 */
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

/**
 * Parse cardinality from an element's `minOccurs` / `maxOccurs` attributes.
 *  - `minOccurs=0` => optional (`min_occurs:0`).
 *  - `maxOccurs="unbounded"` => `is_collection:true`, `max_occurs:'unbounded'`.
 *  - `maxOccurs` numeric > 1 => `is_collection:true`.
 */
function parseCardinality(elementNode: FxpNode): {
  min_occurs: number;
  max_occurs: number | 'unbounded';
  is_collection: boolean;
} {
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

interface WalkCtx {
  registry: XsdTypeRegistry;
  maxDepth: number;
  sourcePath: string;
  /** Output: discovered message types keyed by local name (dedup shared types). */
  emitted: Map<string, MessageType>;
  /** Output: depth-cap / cycle field-findings. */
  findings: WsdlFieldFinding[];
}

/**
 * Resolve the inline complex-type node for an element that declares one
 * (anonymous nested complexType), if any.
 */
function inlineComplexTypeOf(elementNode: FxpNode): FxpNode | null {
  return firstChildByLocal(elementNode, 'complexType');
}

/**
 * Gather the field set of a complex-type node, FOLDING `xsd:extension`
 * base-type fields into the result (base first, then the derived child's own
 * particles). Returns the ordered `<xsd:element>` particle nodes plus the
 * resolved base type name (when the type derives via extension), so the caller
 * can guard the base against the cycle path.
 */
function complexTypeParticles(
  complexTypeNode: FxpNode,
  registry: XsdTypeRegistry,
): { particles: FxpNode[]; baseTypeName: string | null } {
  // complexContent / simpleContent extension folding.
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
        // Recurse one level to fold the base's particles (base may itself
        // extend another type -- chain folding).
        const baseResult = complexTypeParticles(baseType.node, registry);
        baseParticles.push(...baseResult.particles);
      }
    }
    // The extension's own particles sit directly under <xsd:extension>.
    baseParticles.push(...collectParticleElements(extension));
    return { particles: baseParticles, baseTypeName };
  }

  // No extension: plain content model directly under the complexType.
  return { particles: collectParticleElements(container), baseTypeName: null };
}

/**
 * Walk a single complex type into a `MessageType` with its fields, descending
 * into nested NAMED/inline complex types up to `ctx.maxDepth`. `path` is the
 * set of type names already on the current descent (for cycle detection).
 *
 * Returns the local type name that was emitted (so a parent field can record
 * its `complexTypeRef`), or null when the walk could not produce a type.
 */
function walkComplexType(
  typeName: string,
  complexTypeNode: FxpNode,
  targetNamespace: string | null,
  ctx: WalkCtx,
  depth: number,
  path: Set<string>,
): string {
  // Already emitted? Shared named type -> reuse (dedups across messages).
  if (ctx.emitted.has(typeName)) return typeName;

  const { particles } = complexTypeParticles(complexTypeNode, ctx.registry);
  const fields: MessageField[] = [];

  // Register a placeholder BEFORE descending so a self-reference resolves to
  // this same (in-progress) type rather than re-walking; cycle detection below
  // additionally STOPS the descent with a finding.
  const messageType: MessageType = {
    name: typeName,
    provenanceNamespace: targetNamespace,
    provenanceClass: null,
    fields,
    source: 'xsd',
  };
  ctx.emitted.set(typeName, messageType);

  // The active descent path INCLUDING this type, so a field referencing this
  // very type (self-reference) is detected as a cycle below.
  const localPath = new Set(path).add(typeName);

  for (const el of particles) {
    const name = getAttr(el, 'name');
    const ref = getAttr(el, 'ref');
    // `element ref=` -- reference to a top-level element; use its local name.
    const fieldName = name ?? (ref ? (stripPrefix(ref) as string) : null);
    if (!fieldName) continue;

    const typeQName = getAttr(el, 'type');
    const nillable = getAttr(el, 'nillable') === 'true';
    const cardinality = parseCardinality(el);
    const restrictions = resolveRestrictions(el, typeQName, ctx.registry);

    // Determine whether the field's type is a NESTED complex type we should
    // descend into and reference as a shared entity.
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
      // Anonymous nested complexType: name it after `<parent>.<field>` so it
      // is addressable but does not collide with named types.
      const inlineName = `${typeName}.${fieldName}`;
      if (depth + 1 > ctx.maxDepth) {
        ctx.findings.push({
          kind: 'soap_message_depth_cap',
          subject: inlineName,
          reason:
            `Nested complex type '${inlineName}' exceeds the configured XSD ` +
            `walk depth cap (${ctx.maxDepth}); descent stopped (no truncation ` +
            `of already-captured fields).`,
          sourcePath: ctx.sourcePath,
        });
      } else {
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
      // namedComplexLocal is non-null here (namedComplex is derived from it).
      const namedLocal: string = namedComplexLocal;
      complexTypeRef = namedLocal;
      // Cycle: the named type is already on the active descent path.
      if (localPath.has(namedLocal)) {
        ctx.findings.push({
          kind: 'soap_message_type_cycle',
          subject: namedLocal,
          reason:
            `Type cycle detected at field '${typeName}.${fieldName}' -> ` +
            `'${namedLocal}' (already on the type path); descent stopped ` +
            `to avoid an infinite loop.`,
          sourcePath: ctx.sourcePath,
        });
      } else if (!ctx.emitted.has(namedLocal)) {
        if (depth + 1 > ctx.maxDepth) {
          ctx.findings.push({
            kind: 'soap_message_depth_cap',
            subject: namedLocal,
            reason:
              `Named complex type '${namedLocal}' (via field ` +
              `'${typeName}.${fieldName}') exceeds the configured XSD walk ` +
              `depth cap (${ctx.maxDepth}); descent stopped.`,
            sourcePath: ctx.sourcePath,
          });
        } else {
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
        source: 'xsd',
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
// Original XSD schema walking (top-level name collection -- UNCHANGED)
// ----------------------------------------------------------------------------

/**
 * Walk a single `<xsd:schema>` node and collect top-level element /
 * complexType declarations. Also follows `xsd:import` / `xsd:include`
 * for relative-path schemas against `opts.relatedFiles`.
 *
 * Spec 4: now ALSO accumulates the raw schema nodes into `opts.schemaNodes`
 * so the deep field walker can build a cross-schema type registry. The
 * top-level name collection behaviour is otherwise unchanged.
 */
function walkXsdSchema(
  schemaNode: FxpNode,
  opts: {
    sourcePath: string;
    relatedFiles: Map<string, string>;
    xmlParser: XMLParser;
    visited: Set<string>;
    schemaNodes: FxpNode[];
  },
): XsdSchema[] {
  const collected: XsdSchema[] = [];
  const targetNamespace = getAttr(schemaNode, 'targetNamespace');
  const children = bodyOf(schemaNode);

  // Spec 4: keep the raw schema node for the deep field walker.
  opts.schemaNodes.push(schemaNode);

  const elements: XsdElementDecl[] = [];
  const complexTypes: XsdComplexTypeDecl[] = [];

  for (const child of children) {
    const tag = tagNameOf(child);
    if (!tag) continue;
    const local = stripPrefix(tag);
    if (local === 'element') {
      const name = getAttr(child, 'name');
      if (name) elements.push({ name, targetNamespace });
    } else if (local === 'complexType') {
      const name = getAttr(child, 'name');
      if (name) complexTypes.push({ name, targetNamespace });
    }
  }

  collected.push({ targetNamespace, elements, complexTypes });

  // Follow relative imports / includes via the file map.
  for (const child of children) {
    const tag = tagNameOf(child);
    if (!tag) continue;
    const local = stripPrefix(tag);
    if (local !== 'import' && local !== 'include') continue;
    const schemaLocation = getAttr(child, 'schemaLocation');
    if (!schemaLocation) continue;
    if (isAbsoluteUrl(schemaLocation)) continue; // v1: no network
    const resolved = resolveRelative(opts.sourcePath, schemaLocation);
    if (opts.visited.has(resolved)) continue;
    const content = opts.relatedFiles.get(resolved);
    if (content == null) continue;
    opts.visited.add(resolved);
    try {
      const importedRoot = opts.xmlParser.parse(content) as FxpNode[];
      // Find the top-level <xsd:schema> in the imported document.
      const schemas = findByLocalName(importedRoot, 'schema');
      for (const inner of schemas) {
        const innerOpts = { ...opts, sourcePath: resolved };
        collected.push(...walkXsdSchema(inner, innerOpts));
      }
    } catch {
      // Soft-fail: swallow malformed imported schemas; the top-level
      // WSDL parse already reported a parseError if applicable.
    }
  }

  return collected;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Parse a WSDL string and return a structural breakdown.
 *
 * Pure: no I/O. Caller supplies the source string and a `relatedFiles`
 * map keyed by repo-relative path containing related schemas. Spec 4 adds the
 * optional `maxDepth` cap for the nested complex-type walk (defaults to
 * `DEFAULT_XSD_MAX_DEPTH`).
 */
export function parseWsdl(
  source: string,
  opts: {
    sourcePath: string;
    relatedFiles: Map<string, string>;
    /** Spec 4 nested complex-type depth cap (defaults to `DEFAULT_XSD_MAX_DEPTH`). */
    maxDepth?: number;
  },
): WsdlParseResult {
  const sourcePath = opts.sourcePath;
  const maxDepth = opts.maxDepth ?? DEFAULT_XSD_MAX_DEPTH;
  const empty: WsdlParseResult = {
    sourcePath,
    targetNamespace: null,
    ports: [],
    portTypes: [],
    operations: [],
    embeddedSchemas: [],
    messageTypes: [],
    fieldDepthFindings: [],
  };

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  let parsed: FxpNode[];
  try {
    parsed = xmlParser.parse(source) as FxpNode[];
  } catch (err) {
    return {
      ...empty,
      parseError: {
        reason: err instanceof Error ? err.message : String(err),
        sourcePath,
      },
    };
  }

  // Soft-fail when input is not WSDL at all.
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      ...empty,
      parseError: {
        reason: 'WSDL input produced no parsable root nodes',
        sourcePath,
      },
    };
  }

  const definitionsArr = findByLocalName(parsed, 'definitions');
  if (definitionsArr.length === 0) {
    return {
      ...empty,
      parseError: {
        reason: 'No <wsdl:definitions> root element found',
        sourcePath,
      },
    };
  }
  const definitions = definitionsArr[0];
  const definitionsAttrs = getAttrs(definitions);
  const targetNamespace =
    (definitionsAttrs['@_targetNamespace'] as string | undefined) ?? null;
  const definitionsBody = bodyOf(definitions);

  // --- Embedded schemas under <wsdl:types> ---
  const embeddedSchemas: XsdSchema[] = [];
  const schemaNodes: FxpNode[] = []; // Spec 4: raw schema nodes for the deep walker
  const typesNodes = findByLocalName(definitionsBody, 'types');
  const visitedSchemas = new Set<string>();
  for (const typesNode of typesNodes) {
    const typesBody = bodyOf(typesNode);
    const schemaNodeList = findByLocalName(typesBody, 'schema');
    for (const schemaNode of schemaNodeList) {
      embeddedSchemas.push(
        ...walkXsdSchema(schemaNode, {
          sourcePath,
          relatedFiles: opts.relatedFiles,
          xmlParser,
          visited: visitedSchemas,
          schemaNodes,
        }),
      );
    }
  }

  // --- Messages: name -> { partElement (qname local), partNamespace } ---
  // Spec 4 ALSO records the multi-part / RPC shape per message so the deep
  // walker can emit a `soap_message_multipart_unexpanded` finding.
  const messageParts = new Map<
    string,
    {
      elementLocalName: string | null;
      elementNamespace: string | null;
      partCount: number;
      /** True when a part uses `type=` (RPC-style) rather than `element=`. */
      usesTypeAttr: boolean;
    }
  >();
  const messageNodes = findByLocalName(definitionsBody, 'message');
  for (const msg of messageNodes) {
    const msgName = getAttr(msg, 'name');
    if (!msgName) continue;
    const partNodes = findByLocalName(bodyOf(msg), 'part');
    if (partNodes.length === 0) {
      messageParts.set(msgName, {
        elementLocalName: null,
        elementNamespace: null,
        partCount: 0,
        usesTypeAttr: false,
      });
      continue;
    }
    // Use the first part; SOAP doc-literal-wrapped uses one part typically.
    const part = partNodes[0];
    const elementQName = getAttr(part, 'element');
    const partTypeQName = getAttr(part, 'type');
    const elementLocalName = stripPrefix(elementQName);
    // Namespace: resolve the prefix via xmlns map on <wsdl:definitions> if possible.
    let elementNamespace: string | null = null;
    if (elementQName && elementQName.includes(':')) {
      const prefix = elementQName.split(':')[0];
      const xmlnsKey = `@_xmlns:${prefix}`;
      const raw = definitionsAttrs[xmlnsKey];
      if (typeof raw === 'string') elementNamespace = raw;
    } else if (elementQName) {
      // No prefix -- default namespace.
      const raw = definitionsAttrs['@_xmlns'];
      if (typeof raw === 'string') elementNamespace = raw;
    }
    // Fallback to embedded schema lookup by element name.
    if (!elementNamespace && elementLocalName) {
      for (const sch of embeddedSchemas) {
        if (sch.elements.some((e) => e.name === elementLocalName)) {
          elementNamespace = sch.targetNamespace;
          break;
        }
      }
    }
    messageParts.set(msgName, {
      elementLocalName: elementLocalName ?? null,
      elementNamespace,
      partCount: partNodes.length,
      usesTypeAttr: elementQName == null && partTypeQName != null,
    });
  }

  // --- PortTypes: name -> ordered operations w/ input/output messages ---
  interface PortTypeOp {
    operationName: string;
    inputMessage: string | null;
    outputMessage: string | null;
  }
  const portTypes: WsdlPortType[] = [];
  const portTypeOps = new Map<string, PortTypeOp[]>();
  const portTypeNodes = findByLocalName(definitionsBody, 'portType');
  for (const pt of portTypeNodes) {
    const ptName = getAttr(pt, 'name');
    if (!ptName) continue;
    const ops: PortTypeOp[] = [];
    const opNodes = findByLocalName(bodyOf(pt), 'operation');
    for (const op of opNodes) {
      const opName = getAttr(op, 'name');
      if (!opName) continue;
      const opBody = bodyOf(op);
      const inputNode = findByLocalName(opBody, 'input')[0];
      const outputNode = findByLocalName(opBody, 'output')[0];
      const inputMessage = stripPrefix(inputNode ? getAttr(inputNode, 'message') : null);
      const outputMessage = stripPrefix(outputNode ? getAttr(outputNode, 'message') : null);
      ops.push({ operationName: opName, inputMessage, outputMessage });
    }
    portTypes.push({ portTypeName: ptName, operationNames: ops.map((o) => o.operationName) });
    portTypeOps.set(ptName, ops);
  }

  // --- Bindings: name -> { portTypeLocal, operationSoapActions } ---
  interface BindingInfo {
    portTypeLocalName: string;
    soapActionByOperation: Map<string, string | null>;
  }
  const bindingByName = new Map<string, BindingInfo>();
  const bindingNodes = findByLocalName(definitionsBody, 'binding');
  for (const bnd of bindingNodes) {
    const bndName = getAttr(bnd, 'name');
    if (!bndName) continue;
    const ptQName = getAttr(bnd, 'type');
    const portTypeLocal = stripPrefix(ptQName) ?? '';
    const soapActionByOperation = new Map<string, string | null>();
    const bndBody = bodyOf(bnd);
    const opNodes = findByLocalName(bndBody, 'operation');
    for (const op of opNodes) {
      const opName = getAttr(op, 'name');
      if (!opName) continue;
      let soapAction: string | null = null;
      for (const child of bodyOf(op)) {
        const tag = tagNameOf(child);
        if (!tag) continue;
        if (stripPrefix(tag) === 'operation') {
          // soap:operation
          const v = getAttr(child, 'soapAction');
          if (v != null) soapAction = v;
          break;
        }
      }
      soapActionByOperation.set(opName, soapAction);
    }
    bindingByName.set(bndName, { portTypeLocalName: portTypeLocal, soapActionByOperation });
  }

  // --- Services / Ports ---
  const ports: WsdlPort[] = [];
  const operations: WsdlOperation[] = [];
  const serviceNodes = findByLocalName(definitionsBody, 'service');
  for (const svc of serviceNodes) {
    const portNodes = findByLocalName(bodyOf(svc), 'port');
    for (const pn of portNodes) {
      const portName = getAttr(pn, 'name') ?? '';
      const bindingQName = getAttr(pn, 'binding');
      const bindingLocal = stripPrefix(bindingQName) ?? '';
      // soap:address location
      let soapAddressLocation: string | null = null;
      for (const child of bodyOf(pn)) {
        const tag = tagNameOf(child);
        if (!tag) continue;
        if (stripPrefix(tag) === 'address') {
          soapAddressLocation = getAttr(child, 'location');
          break;
        }
      }
      ports.push({ portName, bindingName: bindingLocal, soapAddressLocation });

      const binding = bindingByName.get(bindingLocal);
      if (!binding) continue;
      const ops = portTypeOps.get(binding.portTypeLocalName) ?? [];
      for (const op of ops) {
        const inputPart = op.inputMessage ? messageParts.get(op.inputMessage) : undefined;
        const outputPart = op.outputMessage ? messageParts.get(op.outputMessage) : undefined;
        operations.push({
          portName,
          portTypeName: binding.portTypeLocalName,
          operationName: op.operationName,
          soapAction: binding.soapActionByOperation.get(op.operationName) ?? null,
          inputMessage: op.inputMessage,
          outputMessage: op.outputMessage,
          requestRootElement: inputPart?.elementLocalName ?? null,
          requestNamespace:
            inputPart?.elementNamespace ?? targetNamespace ?? null,
          responseRootElement: outputPart?.elementLocalName ?? null,
        });
      }
    }
  }

  // ==========================================================================
  // Spec 4: deep message-field walk.
  // ==========================================================================
  const registry = buildTypeRegistry(schemaNodes, targetNamespace);
  const ctx: WalkCtx = {
    registry,
    maxDepth,
    sourcePath,
    emitted: new Map<string, MessageType>(),
    findings: [],
  };

  // Seed the walk from the doc-literal wrapper elements bound to operations
  // (request + response roots). Each resolves through `elementTypeRef` to the
  // complex type carrying its fields. Walking from the message roots (rather
  // than every named type blindly) keeps the emitted set tied to the SOAP
  // contract surface; shared named types are reached transitively and deduped.
  const rootElementNames = new Set<string>();
  for (const op of operations) {
    if (op.requestRootElement) rootElementNames.add(op.requestRootElement);
    if (op.responseRootElement) rootElementNames.add(op.responseRootElement);
  }
  // Multi-part / RPC detection -> finding-and-defer, per operation.
  for (const op of operations) {
    const inPart = op.inputMessage ? messageParts.get(op.inputMessage) : undefined;
    const outPart = op.outputMessage ? messageParts.get(op.outputMessage) : undefined;
    const multipart =
      (inPart && (inPart.partCount > 1 || inPart.usesTypeAttr)) ||
      (outPart && (outPart.partCount > 1 || outPart.usesTypeAttr));
    if (multipart) {
      ctx.findings.push({
        kind: 'soap_message_multipart_unexpanded',
        subject: op.operationName,
        reason:
          `Operation '${op.operationName}' uses a multi-part / RPC-style message ` +
          `not fully expanded in v1 (only doc-literal-wrapped single-part ` +
          `messages are fully walked).`,
        sourcePath,
      });
    }
  }

  // If no operations bound wrapper elements (e.g. schema-only WSDL), fall back
  // to every registered wrapper element so a schema with types still yields
  // message types.
  if (rootElementNames.size === 0) {
    for (const elName of registry.elementTypeRef.keys()) {
      rootElementNames.add(elName);
    }
  }

  for (const elName of rootElementNames) {
    const typeLocal = registry.elementTypeRef.get(elName) ?? elName;
    const ct = registry.complexTypes.get(typeLocal);
    if (!ct) continue;
    walkComplexType(
      typeLocal,
      ct.node,
      ct.targetNamespace,
      ctx,
      0,
      new Set<string>(),
    );
  }

  const messageTypes = Array.from(ctx.emitted.values());

  return {
    sourcePath,
    targetNamespace,
    ports,
    portTypes,
    operations,
    embeddedSchemas,
    messageTypes,
    fieldDepthFindings: ctx.findings,
  };
}
