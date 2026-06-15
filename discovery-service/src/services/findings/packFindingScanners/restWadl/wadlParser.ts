/**
 * WADL parser (REST WADL pack foundation).
 *
 * Spec: 2026-05-21 WADL Deterministic Parser, Task Group 2.
 *
 * Pure, side-effect-free WADL walker built on `fast-xml-parser`.
 *
 * Public function: `parseWadl(source, opts)` -> `WadlParseResult`.
 *
 * Walker scope (mirrors the WSDL pack's narrow walker scope):
 *  - Root `<application xmlns="http://wadl.dev.java.net/2009/02">` gate.
 *    Any other namespace short-circuits with
 *    `parseError: 'unsupported_wadl_namespace'`.
 *  - `<resources base="...">` -> `<resource path="...">` (recurse via
 *    nested `<resource>` children) -> `<method>` -> `<request>` /
 *    `<response>` -> `<param>` + `<representation>`.
 *  - `<param>` may live directly under `<resource>` (path / matrix params
 *    inherited by every method underneath) or under `<method>/<request>`.
 *    Both scopes contribute to each operation's `params` array. Response
 *    params are not included on operations.
 *  - `<grammars><include href="...">` declarations are resolved against the
 *    caller-supplied `opts.relatedFiles` map. Absolute URLs are silently
 *    skipped (no network). Missing or unparseable files append the href to
 *    `missingGrammars` (single bucket per the spec's Q2).
 *  - `<representation element="X"/>` refs that do not resolve in any loaded
 *    grammar's top-level `<xs:element name="X">` declarations are appended
 *    to `missingSchemaElements`.
 *
 * Soft-fail behaviour: catches every error thrown by `fast-xml-parser`,
 * returns a result with `parseError: 'malformed_xml'` (and empty operations)
 * for the caller to translate into a `wadl_parse_failed` `evidence_gap`
 * finding. The parser NEVER throws out of `parseWadl`.
 *
 * Pure: no `fs`, no `http`, no `process` usage. Caller supplies the source
 * string plus an optional file map for related schemas.
 */

import { XMLParser } from 'fast-xml-parser';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface ParseWadlOptions {
  /**
   * Relative-path -> file-contents map for resolving
   * `<grammars><include href="..."/></grammars>` references. Optional;
   * absent or empty map yields every declared grammar landing on
   * `missingGrammars`.
   */
  relatedFiles?: Map<string, string>;
  /**
   * Identifier for the source file (e.g. `src/main/resources/hifi.wadl`) --
   * surfaces verbatim on emitted findings / evidence.
   */
  sourceFilePath?: string;
}

export interface WadlParam {
  name: string;
  style: 'template' | 'query' | 'header' | 'matrix';
  /** Raw type string from the WADL; missing / blank -> `"unknown"`. */
  type: string;
  required: boolean;
}

export interface WadlRepresentation {
  mediaType: string | null;
  /** `element=` attribute value, with any XML namespace prefix stripped. */
  schemaElementRef: string | null;
  /**
   * Populated when `schemaElementRef` resolves against the loaded
   * `<xs:element name="X">` index from `opts.relatedFiles`; null otherwise.
   */
  resolvedSchemaElementName: string | null;
}

export interface WadlInterface {
  /** First `<doc title="..."/>` value at `<application>` level, when present. */
  applicationTitle: string | null;
  /** First `<doc version="..."/>` value at `<application>` level, when present. */
  version: string | null;
  /** Concatenated text content of every `<application>/<doc>` child. */
  doc: string | null;
  /** Declared `<grammars><include href>` paths, in document order. */
  grammarPaths: string[];
}

export interface WadlOperation {
  /** `${httpMethod} ${path}` -- e.g. `POST /hierarchynodes/{grdOrgId}`. */
  compositeId: string;
  /** `<method id="...">` attribute (when present); null otherwise. */
  methodId: string | null;
  /** Upper-cased HTTP verb from `<method name="...">`. */
  httpMethod: string;
  /** Flattened resource-tree path (does NOT include `baseUrl`). */
  path: string;
  /** Owning `<resources base="...">` value. */
  baseUrl: string | null;
  /** Combined parent-resource + request params (response params excluded). */
  params: WadlParam[];
  request: { representations: WadlRepresentation[] };
  response: { representations: WadlRepresentation[] };
  /**
   * Concatenated `<doc>` text from the parent `<resource>` chain and the
   * `<method>` itself (parent docs first, method doc last; single-space
   * joined). Null when no `<doc>` content present.
   */
  doc: string | null;
  /**
   * Best-effort approximate line number of the `<method>` opening tag in
   * the raw source string (1-based). `undefined` when not derivable.
   */
  sourceLine?: number;
}

export interface WadlParseResult {
  interfaces: WadlInterface[];
  operations: WadlOperation[];
  /**
   * Set on parse failure. Sentinel values:
   *  - `'unsupported_wadl_namespace'` -- root element / namespace gate failed.
   *  - `'malformed_xml'`              -- `fast-xml-parser` threw.
   * Undefined on success.
   */
  parseError?: string;
  /**
   * `<grammars><include href>` entries that did not resolve in
   * `opts.relatedFiles` (or that resolved but failed to parse).
   */
  missingGrammars: string[];
  /**
   * `<representation element="X">` refs that did not resolve in any loaded
   * grammar. One entry per failing reference; no dedup.
   */
  missingSchemaElements: { ref: string; sourceOperationId: string }[];
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

const WADL_NAMESPACE = 'http://wadl.dev.java.net/2009/02';
const ATTR_KEY = ':@';

/**
 * `fast-xml-parser` with `preserveOrder: true` returns each tag as a
 * single-key wrapper object: `{ "<tagName>": Node[]; ":@"?: { "@_attr": v } }`.
 */
type FxpNode = Record<string, unknown>;

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
  const raw = node[tag];
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

function isAbsoluteUrl(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(s);
}

/**
 * Recursively collect all `#text` string content from a node tree, joined
 * with single spaces and trimmed. Used to fold `<doc>` body content into
 * a single description string.
 */
function collectTextContent(nodes: FxpNode[]): string {
  const parts: string[] = [];
  const walk = (arr: FxpNode[]): void => {
    for (const n of arr) {
      for (const key of Object.keys(n)) {
        if (key === ATTR_KEY) continue;
        const raw = n[key];
        if (key === '#text') {
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.length > 0) parts.push(trimmed);
          } else if (raw != null) {
            const s = String(raw).trim();
            if (s.length > 0) parts.push(s);
          }
          continue;
        }
        if (Array.isArray(raw)) walk(raw as FxpNode[]);
      }
    }
  };
  walk(nodes);
  return parts.join(' ').trim();
}

/**
 * Fold the `<doc>` children under a parent node into one string:
 *  - `title=` attribute value (if any)
 *  - inner text content (if any)
 * Joined with single spaces, multiple `<doc>` blocks joined with spaces.
 * Returns null when no useful content was collected.
 */
function concatDocs(parentBody: FxpNode[]): string | null {
  const docs = findByLocalName(parentBody, 'doc');
  if (docs.length === 0) return null;
  const buckets: string[] = [];
  for (const doc of docs) {
    const title = getAttr(doc, 'title');
    const inner = collectTextContent(bodyOf(doc));
    const pieces: string[] = [];
    if (title) pieces.push(title);
    if (inner) pieces.push(inner);
    if (pieces.length > 0) buckets.push(pieces.join(' '));
  }
  const out = buckets.join(' ').trim();
  return out.length > 0 ? out : null;
}

/**
 * Join two path segments with exactly one `/` between them, preserving the
 * leading slash of the first segment when present.
 */
function joinPath(parent: string, child: string): string {
  if (!parent) return child.startsWith('/') ? child : `/${child}`;
  if (!child) return parent;
  const left = parent.replace(/\/+$/, '');
  const right = child.replace(/^\/+/, '');
  return `${left}/${right}`;
}

/**
 * Parse `<param>` nodes inside the given body into `WadlParam` entries.
 * Unknown / missing `style` defaults to `'query'`. Missing / blank `type`
 * normalises to the literal string `"unknown"`.
 */
function readParams(body: FxpNode[]): WadlParam[] {
  const out: WadlParam[] = [];
  const paramNodes = findByLocalName(body, 'param');
  for (const p of paramNodes) {
    const name = getAttr(p, 'name');
    if (!name) continue;
    const rawStyle = getAttr(p, 'style');
    const style: WadlParam['style'] =
      rawStyle === 'template' ||
      rawStyle === 'query' ||
      rawStyle === 'header' ||
      rawStyle === 'matrix'
        ? rawStyle
        : 'query';
    const rawType = getAttr(p, 'type');
    const type = rawType && rawType.trim().length > 0 ? rawType : 'unknown';
    const required = getAttr(p, 'required') === 'true';
    out.push({ name, style, type, required });
  }
  return out;
}

/**
 * Parse `<representation>` nodes inside the given body. Falls back to
 * `findByLocalName` so namespace-prefixed `ns2:representation` matches too.
 */
function readRepresentations(
  body: FxpNode[],
  elementIndex: Set<string>,
  missingSchemaElements: { ref: string; sourceOperationId: string }[],
  sourceOperationId: string,
): WadlRepresentation[] {
  const out: WadlRepresentation[] = [];
  const repNodes = findByLocalName(body, 'representation');
  for (const r of repNodes) {
    const mediaType = getAttr(r, 'mediaType');
    const rawElement = getAttr(r, 'element');
    const schemaElementRef = stripPrefix(rawElement);
    let resolvedSchemaElementName: string | null = null;
    if (schemaElementRef && elementIndex.has(schemaElementRef)) {
      resolvedSchemaElementName = schemaElementRef;
    } else if (schemaElementRef) {
      missingSchemaElements.push({ ref: schemaElementRef, sourceOperationId });
    }
    out.push({
      mediaType: mediaType ?? null,
      schemaElementRef: schemaElementRef ?? null,
      resolvedSchemaElementName,
    });
  }
  return out;
}

/**
 * Build a set of every top-level `<xs:element name="X">` declared in the
 * supplied grammar source. On any throw, returns null so the caller can
 * route the href onto `missingGrammars`.
 */
function indexGrammarElements(
  source: string,
  xmlParser: XMLParser,
): Set<string> | null {
  let parsed: FxpNode[];
  try {
    parsed = xmlParser.parse(source) as FxpNode[];
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out = new Set<string>();
  const schemas = findByLocalName(parsed, 'schema');
  for (const schema of schemas) {
    const children = bodyOf(schema);
    for (const child of children) {
      const tag = tagNameOf(child);
      if (!tag) continue;
      if (stripPrefix(tag) !== 'element') continue;
      const name = getAttr(child, 'name');
      if (name) out.add(name);
    }
  }
  return out;
}

/**
 * Best-effort source-line lookup for a `<method ...>` opening tag carrying
 * the supplied `id=` attribute. Returns undefined when the method has no id
 * or no plausible substring match is found.
 */
function findMethodLine(source: string, methodId: string | null): number | undefined {
  if (!methodId) return undefined;
  // Match either id="X" or id='X'. Anchor on `<method` so attribute order
  // does not matter.
  const escaped = methodId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<method\\b[^>]*\\bid\\s*=\\s*["']${escaped}["']`);
  const m = re.exec(source);
  if (!m) return undefined;
  // 1-based line number = count of `\n` before the match index + 1.
  const before = source.slice(0, m.index);
  let line = 1;
  for (let i = 0; i < before.length; i += 1) {
    if (before.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Parse a WADL string and return its structural breakdown.
 *
 * Pure: no I/O. Caller supplies the source string plus an optional
 * `relatedFiles` map keyed by relative path containing related XSD grammars.
 */
export function parseWadl(
  source: string,
  opts: ParseWadlOptions = {},
): WadlParseResult {
  const empty: WadlParseResult = {
    interfaces: [],
    operations: [],
    missingGrammars: [],
    missingSchemaElements: [],
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
  } catch {
    return { ...empty, parseError: 'malformed_xml' };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ...empty, parseError: 'malformed_xml' };
  }

  const applicationArr = findByLocalName(parsed, 'application');
  if (applicationArr.length === 0) {
    return { ...empty, parseError: 'unsupported_wadl_namespace' };
  }
  const application = applicationArr[0];
  const appAttrs = getAttrs(application);
  const xmlns = appAttrs['@_xmlns'];
  if (xmlns !== WADL_NAMESPACE) {
    return { ...empty, parseError: 'unsupported_wadl_namespace' };
  }

  const applicationBody = bodyOf(application);

  // ---- <application>-level <doc> --------------------------------------
  // applicationTitle = first <doc title="X"> attribute value
  // version          = first <doc version="X"> attribute value
  // doc              = concatenated text + title contents
  let applicationTitle: string | null = null;
  let version: string | null = null;
  const appDocs = findByLocalName(applicationBody, 'doc');
  for (const d of appDocs) {
    if (applicationTitle == null) {
      const t = getAttr(d, 'title');
      if (t) applicationTitle = t;
    }
    if (version == null) {
      const v = getAttr(d, 'version');
      if (v) version = v;
    }
  }
  const interfaceDoc = concatDocs(applicationBody);

  // ---- <grammars> -----------------------------------------------------
  const grammarPaths: string[] = [];
  const missingGrammars: string[] = [];
  const elementIndex = new Set<string>();
  const relatedFiles = opts.relatedFiles ?? new Map<string, string>();
  const grammarsNodes = findByLocalName(applicationBody, 'grammars');
  for (const g of grammarsNodes) {
    const includes = findByLocalName(bodyOf(g), 'include');
    for (const inc of includes) {
      const href = getAttr(inc, 'href');
      if (!href) continue;
      grammarPaths.push(href);
      if (isAbsoluteUrl(href)) continue;
      const content = relatedFiles.get(href);
      if (content == null) {
        missingGrammars.push(href);
        continue;
      }
      const idx = indexGrammarElements(content, xmlParser);
      if (idx == null) {
        // File present but unparseable -- per Q2 treat as missing.
        missingGrammars.push(href);
        continue;
      }
      for (const name of idx) elementIndex.add(name);
    }
  }

  const wadlInterface: WadlInterface = {
    applicationTitle,
    version,
    doc: interfaceDoc,
    grammarPaths,
  };

  // ---- <resources> walk -----------------------------------------------
  const operations: WadlOperation[] = [];
  const missingSchemaElements: { ref: string; sourceOperationId: string }[] = [];

  const resourcesBlocks = findByLocalName(applicationBody, 'resources');
  for (const resourcesBlock of resourcesBlocks) {
    const baseUrl = getAttr(resourcesBlock, 'base');
    const resourceChildren = findByLocalName(bodyOf(resourcesBlock), 'resource');

    // Recursive resource walker. Accumulates the path-segment chain and the
    // inherited-param chain from parent <resource> nodes (parent-resource
    // params are visible to every method underneath per the WADL spec).
    const walkResource = (
      resourceNode: FxpNode,
      parentPath: string,
      parentParams: WadlParam[],
      parentDocs: string[],
    ): void => {
      const rawPath = getAttr(resourceNode, 'path') ?? '';
      const flattenedPath = joinPath(parentPath, rawPath);
      const body = bodyOf(resourceNode);
      const ownParams = readParams(body);
      const inheritedParams = [...parentParams, ...ownParams];
      const ownDoc = concatDocs(body);
      const inheritedDocs = ownDoc ? [...parentDocs, ownDoc] : [...parentDocs];

      // Methods at this resource level.
      const methodNodes = findByLocalName(body, 'method');
      for (const m of methodNodes) {
        const methodId = getAttr(m, 'id');
        const rawName = getAttr(m, 'name') ?? '';
        const httpMethod = rawName.toUpperCase();
        const compositeId = `${httpMethod} ${flattenedPath}`;
        const methodBody = bodyOf(m);
        const methodDoc = concatDocs(methodBody);
        const docChain = methodDoc ? [...inheritedDocs, methodDoc] : inheritedDocs;
        const combinedDoc = docChain.length > 0 ? docChain.join(' ').trim() : null;

        // Request params + representations.
        const requestNode = findByLocalName(methodBody, 'request')[0];
        const requestParams: WadlParam[] = requestNode
          ? readParams(bodyOf(requestNode))
          : [];
        const requestReps: WadlRepresentation[] = requestNode
          ? readRepresentations(
              bodyOf(requestNode),
              elementIndex,
              missingSchemaElements,
              compositeId,
            )
          : [];

        // Response representations (params excluded from operation.params).
        const responseNode = findByLocalName(methodBody, 'response')[0];
        const responseReps: WadlRepresentation[] = responseNode
          ? readRepresentations(
              bodyOf(responseNode),
              elementIndex,
              missingSchemaElements,
              compositeId,
            )
          : [];

        const combinedParams = [...inheritedParams, ...requestParams];

        const op: WadlOperation = {
          compositeId,
          methodId,
          httpMethod,
          path: flattenedPath,
          baseUrl,
          params: combinedParams,
          request: { representations: requestReps },
          response: { representations: responseReps },
          doc: combinedDoc && combinedDoc.length > 0 ? combinedDoc : null,
        };
        const line = findMethodLine(source, methodId);
        if (line != null) op.sourceLine = line;
        operations.push(op);
      }

      // Recurse into nested <resource> children.
      const childResources = findByLocalName(body, 'resource');
      for (const child of childResources) {
        walkResource(child, flattenedPath, inheritedParams, inheritedDocs);
      }
    };

    for (const r of resourceChildren) {
      walkResource(r, '', [], []);
    }
  }

  return {
    interfaces: [wadlInterface],
    operations,
    missingGrammars,
    missingSchemaElements,
  };
}
