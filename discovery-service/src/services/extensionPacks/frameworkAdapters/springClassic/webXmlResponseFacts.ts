/**
 * Full `web.xml` RESPONSE-FACTS parser + attach pass (Spec 2026-07-06-l —
 * Spring Classic Response Fidelity, Code-Tier Oracle Program).
 *
 * The existing `webXmlServletParser` reads ONLY `<servlet>`/`<servlet-mapping>`.
 * This module reads the response-shaping remainder of the deployment
 * descriptor:
 *
 *   - `<filter>` + `<filter-mapping>`  -> ordered filter chain facts
 *     (document order IS the container's chain order), url-patterns,
 *     dispatcher types, init-params; CharacterEncodingFilter-style filters
 *     additionally yield the app CHARSET fact.
 *   - `<error-page>` (error-code and exception-type forms) -> app-global
 *     error responses, merged into every HTTP endpoint's `response_contract
 *     .error_responses[]` with `source: 'web-xml-error-page'`.
 *   - `<listener>`   -> surfaced as facts (candidate semantics land in
 *     Spec -m's internal-functionality work; the PARSE lives here so the
 *     descriptor is read once).
 *   - `<session-config>` / `<context-param>` / `<mime-mapping>` -> app-level
 *     facts (logged; carried on the parse result for downstream consumers).
 *
 * Pure + regex-based (the codebase's descriptor idiom — no DOM dependency),
 * namespace-prefix tolerant, never throws on malformed input.
 */

import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import {
  NS,
  readAllTagText,
  readTagText,
} from '../../../findings/packFindingScanners/webXmlServletParser';

// ---------------------------------------------------------------------------
// Fact shapes
// ---------------------------------------------------------------------------

export interface WebXmlFilterFact {
  filterName: string;
  filterClass: string;
  /** 0-based document order — the container's chain order. */
  order: number;
  urlPatterns: string[];
  servletNames: string[];
  dispatcherTypes: string[];
  initParams: Record<string, string>;
  /** True when the filter is an encoding filter (class or params say so). */
  isEncodingFilter: boolean;
  encodingCharset: string | null;
}

export interface WebXmlErrorPageFact {
  errorCode: number | null;
  exceptionType: string | null;
  location: string;
}

export interface WebXmlResponseFacts {
  filters: WebXmlFilterFact[];
  errorPages: WebXmlErrorPageFact[];
  listeners: string[];
  sessionConfig: {
    timeoutMinutes: number | null;
    cookieHttpOnly: boolean | null;
    cookieSecure: boolean | null;
  } | null;
  contextParams: Record<string, string>;
  mimeMappings: Record<string, string>;
  /** App charset from an encoding filter's `encoding` init-param, if any. */
  charset: string | null;
  /** The web.xml file the facts came from (first one wins; extras counted). */
  sourceFilePath: string | null;
  extraDescriptorCount: number;
}

const EMPTY_FACTS: WebXmlResponseFacts = {
  filters: [],
  errorPages: [],
  listeners: [],
  sessionConfig: null,
  contextParams: {},
  mimeMappings: {},
  charset: null,
  sourceFilePath: null,
  extraDescriptorCount: 0,
};

// ---------------------------------------------------------------------------
// Parse (pure)
// ---------------------------------------------------------------------------

function readBlocks(xml: string, localName: string): string[] {
  const re = new RegExp(
    `<\\s*${NS}${localName}\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}${localName}\\s*>`,
    'gi'
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function readInitParams(block: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const paramBlock of readBlocks(block, 'init-param')) {
    const name = readTagText(paramBlock, 'param-name');
    const value = readTagText(paramBlock, 'param-value');
    if (name) params[name] = value ?? '';
  }
  return params;
}

export function parseWebXmlResponseFacts(xml: string): Omit<WebXmlResponseFacts, 'sourceFilePath' | 'extraDescriptorCount'> {
  if (!xml || typeof xml !== 'string') {
    return { ...EMPTY_FACTS };
  }

  // ----- filters: <filter> declarations joined with <filter-mapping>s -----
  const declared = new Map<string, { filterClass: string; initParams: Record<string, string>; order: number }>();
  let order = 0;
  for (const block of readBlocks(xml, 'filter')) {
    const name = readTagText(block, 'filter-name');
    const klass = readTagText(block, 'filter-class');
    if (!name || !klass) continue;
    if (!declared.has(name)) {
      declared.set(name, { filterClass: klass, initParams: readInitParams(block), order: order++ });
    }
  }
  const mappings = new Map<string, { urlPatterns: string[]; servletNames: string[]; dispatcherTypes: string[] }>();
  for (const block of readBlocks(xml, 'filter-mapping')) {
    const name = readTagText(block, 'filter-name');
    if (!name) continue;
    const entry = mappings.get(name) ?? { urlPatterns: [], servletNames: [], dispatcherTypes: [] };
    for (const p of readAllTagText(block, 'url-pattern')) if (!entry.urlPatterns.includes(p)) entry.urlPatterns.push(p);
    for (const s of readAllTagText(block, 'servlet-name')) if (!entry.servletNames.includes(s)) entry.servletNames.push(s);
    for (const d of readAllTagText(block, 'dispatcher')) if (!entry.dispatcherTypes.includes(d)) entry.dispatcherTypes.push(d);
    mappings.set(name, entry);
  }
  const filters: WebXmlFilterFact[] = [];
  let charset: string | null = null;
  for (const [name, decl] of declared) {
    const mapping = mappings.get(name) ?? { urlPatterns: [], servletNames: [], dispatcherTypes: [] };
    const encodingParam =
      decl.initParams.encoding ?? decl.initParams.Encoding ?? null;
    const isEncodingFilter =
      /CharacterEncodingFilter/i.test(decl.filterClass) || encodingParam !== null;
    const encodingCharset = isEncodingFilter ? (encodingParam ?? 'UTF-8') : null;
    if (isEncodingFilter && charset === null && encodingCharset) charset = encodingCharset;
    filters.push({
      filterName: name,
      filterClass: decl.filterClass,
      order: decl.order,
      urlPatterns: mapping.urlPatterns,
      servletNames: mapping.servletNames,
      dispatcherTypes: mapping.dispatcherTypes,
      initParams: decl.initParams,
      isEncodingFilter,
      encodingCharset,
    });
  }

  // ----- error pages -----
  const errorPages: WebXmlErrorPageFact[] = [];
  for (const block of readBlocks(xml, 'error-page')) {
    const codeText = readTagText(block, 'error-code');
    const exception = readTagText(block, 'exception-type');
    const location = readTagText(block, 'location');
    if (!location) continue;
    const code = codeText !== null ? Number.parseInt(codeText, 10) : NaN;
    errorPages.push({
      errorCode: Number.isFinite(code) ? code : null,
      exceptionType: exception,
      location,
    });
  }

  // ----- listeners -----
  const listeners: string[] = [];
  for (const block of readBlocks(xml, 'listener')) {
    const klass = readTagText(block, 'listener-class');
    if (klass && !listeners.includes(klass)) listeners.push(klass);
  }

  // ----- session-config -----
  let sessionConfig: WebXmlResponseFacts['sessionConfig'] = null;
  const sessionBlocks = readBlocks(xml, 'session-config');
  if (sessionBlocks.length > 0) {
    const block = sessionBlocks[0];
    const timeoutText = readTagText(block, 'session-timeout');
    const timeout = timeoutText !== null ? Number.parseInt(timeoutText, 10) : NaN;
    const cookieBlocks = readBlocks(block, 'cookie-config');
    const bool = (v: string | null): boolean | null =>
      v === null ? null : /^true$/i.test(v) ? true : /^false$/i.test(v) ? false : null;
    sessionConfig = {
      timeoutMinutes: Number.isFinite(timeout) ? timeout : null,
      cookieHttpOnly: cookieBlocks.length > 0 ? bool(readTagText(cookieBlocks[0], 'http-only')) : null,
      cookieSecure: cookieBlocks.length > 0 ? bool(readTagText(cookieBlocks[0], 'secure')) : null,
    };
  }

  // ----- context params + mime mappings -----
  const contextParams: Record<string, string> = {};
  for (const block of readBlocks(xml, 'context-param')) {
    const name = readTagText(block, 'param-name');
    const value = readTagText(block, 'param-value');
    if (name) contextParams[name] = value ?? '';
  }
  const mimeMappings: Record<string, string> = {};
  for (const block of readBlocks(xml, 'mime-mapping')) {
    const ext = readTagText(block, 'extension');
    const type = readTagText(block, 'mime-type');
    if (ext && type) mimeMappings[ext] = type;
  }

  return { filters, errorPages, listeners, sessionConfig, contextParams, mimeMappings, charset };
}

/** Locate web.xml IR files (rawContent) and parse the FIRST; count extras. */
export function scanWebXmlResponseFacts(files: SourceFileIR[]): WebXmlResponseFacts {
  const descriptors = files.filter(
    (f) => /(^|[\\/])web\.xml$/i.test(f.filePath) && typeof f.rawContent === 'string'
  );
  if (descriptors.length === 0) return { ...EMPTY_FACTS };
  const parsed = parseWebXmlResponseFacts(descriptors[0].rawContent as string);
  return {
    ...parsed,
    sourceFilePath: descriptors[0].filePath,
    extraDescriptorCount: descriptors.length - 1,
  };
}

// ---------------------------------------------------------------------------
// Servlet-spec url-pattern matching (exact / path-prefix `/x/*` / `*.ext` / `/`)
// ---------------------------------------------------------------------------

export function urlPatternMatches(pattern: string, path: string): boolean {
  if (!pattern || !path) return false;
  if (pattern === '/' || pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (pattern.startsWith('*.')) {
    return path.endsWith(pattern.slice(1));
  }
  return path === pattern || path.split('?')[0] === pattern;
}

// ---------------------------------------------------------------------------
// Attach pass (mutates endpoint candidates' response_contract, additively)
// ---------------------------------------------------------------------------

interface Endpointish {
  data: Record<string, unknown> & {
    fullPath?: string;
    path?: string;
    httpMethod?: string;
    response_contract?: Record<string, unknown>;
  };
}

function endpointPathOf(candidate: DiscoveryCandidate): string | null {
  const data = (candidate.data ?? {}) as Endpointish['data'];
  const path = data.fullPath ?? data.path;
  if (typeof path === 'string' && path.startsWith('/')) return path.split('?')[0];
  // Fall back to the `VERB /path` name convention.
  const name = candidate.name ?? '';
  const m = /^[A-Z]+\s+(\/\S*)/.exec(name);
  return m ? m[1] : null;
}

function contractOf(data: Endpointish['data']): Record<string, unknown> {
  if (!data.response_contract || typeof data.response_contract !== 'object') {
    data.response_contract = {
      schema_version: 'response_contract.v1',
      confidence: 0.9,
    };
  }
  return data.response_contract as Record<string, unknown>;
}

/**
 * Attach web-xml response facts onto every HTTP `endpoints` candidate:
 * matched ordered filters -> `response_contract.filters[]`; app-global
 * error pages -> merged `error_responses[]` (source: web-xml-error-page);
 * encoding-filter charset -> `serialization.charset` (never overwrites an
 * existing charset fact). Returns the touched-candidate count.
 */
export function attachWebXmlResponseFacts(
  candidates: DiscoveryCandidate[],
  facts: WebXmlResponseFacts
): number {
  if (
    facts.filters.length === 0 &&
    facts.errorPages.length === 0 &&
    facts.charset === null
  ) {
    return 0;
  }
  let touched = 0;
  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoints') continue;
    const path = endpointPathOf(candidate);
    if (!path) continue;
    const data = (candidate.data ?? (candidate.data = {})) as Endpointish['data'];

    const matched = facts.filters
      .filter((f) => f.urlPatterns.some((p) => urlPatternMatches(p, path)))
      .sort((a, b) => a.order - b.order)
      .map((f) => ({
        name: f.filterName,
        class: f.filterClass,
        order: f.order,
        dispatcher_types: f.dispatcherTypes,
        source: 'web-xml-filter',
      }));

    const hasWork = matched.length > 0 || facts.errorPages.length > 0 || facts.charset !== null;
    if (!hasWork) continue;
    const contract = contractOf(data);

    if (matched.length > 0) {
      contract.filters = matched;
    }
    if (facts.errorPages.length > 0) {
      const existing = Array.isArray(contract.error_responses)
        ? (contract.error_responses as unknown[])
        : [];
      const merged = [...existing];
      for (const page of facts.errorPages) {
        merged.push({
          ...(page.errorCode !== null ? { statusCode: page.errorCode } : {}),
          ...(page.exceptionType !== null ? { exception: page.exceptionType } : {}),
          location: page.location,
          source: 'web-xml-error-page',
        });
      }
      contract.error_responses = merged;
    }
    if (facts.charset !== null) {
      const serialization =
        contract.serialization && typeof contract.serialization === 'object'
          ? (contract.serialization as Record<string, unknown>)
          : (contract.serialization = {});
      if (serialization.charset === undefined) {
        serialization.charset = facts.charset;
        serialization.charset_source = 'web-xml-encoding-filter';
      }
    }
    touched++;
  }
  return touched;
}
