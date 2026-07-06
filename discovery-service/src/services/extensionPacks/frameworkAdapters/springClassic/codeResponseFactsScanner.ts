/**
 * Code-set RESPONSE facts scanner (Spec 2026-07-06-l — Spring Classic
 * Response Fidelity, Code-Tier Oracle Program).
 *
 * The response-contract scanner reads ANNOTATION-declared facts; this peer
 * reads the facts a handler sets IN CODE, via the Java extractor's per-method
 * call IR (`FunctionIR.calls[]` — receiver / methodName / verbatim args):
 *
 *   - `response.setHeader/addHeader(name, value)` and `ResponseEntity`
 *     builder `.header(name, value)`   -> `headers_set_in_code[]`
 *       (string-literal args captured VERBATIM; non-literal args carried as
 *        expressions with `resolved: false` — never guessed, surfaced as an
 *        `response_header_unresolved` evidence-gap Finding)
 *   - `setContentType` / `.contentType` -> `content_types_set_in_code[]`
 *   - `setStatus` / `sendError` / `.status` -> `status_codes.code_set[]`
 *   - `sendRedirect` / `.location`      -> `redirects[]`
 *   - `addCookie`                        -> `cookies_set_in_code[]`
 *
 *   - VIEW-KIND classification (user decision: parity is API-only, view
 *     endpoints are MARKED out of scope, never silently included):
 *       @Controller (not @RestController) handler without @ResponseBody
 *       returning `String` / `ModelAndView` / `View`
 *         -> `response_kind: 'view-html'` + a
 *            `view_endpoint_out_of_parity_scope` Finding
 *       everything else -> `response_kind: 'json'` (or `'xml'` when the
 *       mapping's `produces` says so — read from the candidate data at
 *       attach time).
 *
 * Pure over `SourceFileIR[]`; endpoint keying reuses the SAME
 * `${verb} ${composedPath}` name composition the sibling scanners use.
 * Findings ride the "run it twice, cheap" pattern via
 * `buildCodeResponseFactsFindings` (consumed by springClassicFindingScanner).
 */

import type { SourceFileIR, ClassIR, FunctionIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';

// ---------------------------------------------------------------------------
// Shared composition (kept byte-compatible with the sibling scanners)
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

function stripArrayBracesAndQuotes(v: string): string {
  let s = v.trim();
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).split(',')[0].trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s;
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

function extractHttpMethod(m: FunctionIR): string {
  for (const [ann, httpMethod] of Object.entries(HTTP_METHOD_ANNOTATIONS)) {
    if (hasAnnotation(m.annotations, ann)) return httpMethod;
  }
  const rm = findAnnotation(m.annotations, 'RequestMapping');
  if (rm) {
    const methodArg = annotationArg(rm, 'method');
    if (methodArg) {
      const parts = methodArg.split('.');
      return parts[parts.length - 1].toUpperCase();
    }
    return 'GET';
  }
  return 'GET';
}

function extractMethodPath(m: FunctionIR): string {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(m.annotations, ann);
    if (!a) continue;
    const val = annotationArg(a, 'value') || annotationArg(a, 'path');
    if (val) return normalisePath(val);
  }
  return '';
}

function endpointNameFor(cls: ClassIR, m: FunctionIR): string {
  return `${extractHttpMethod(m)} ${composeFullPath(extractBasePath(cls), extractMethodPath(m))}`;
}

// ---------------------------------------------------------------------------
// Fact shapes
// ---------------------------------------------------------------------------

export interface CodeSetHeaderFact {
  name: string;
  value: string;
  /** True when BOTH args were string literals (captured verbatim). */
  resolved: boolean;
  source: 'servlet-response' | 'response-entity-builder';
}

export interface CodeResponseFacts {
  headersSetInCode: CodeSetHeaderFact[];
  contentTypesSetInCode: string[];
  statusCodesSetInCode: Array<number | string>;
  redirects: Array<{ target: string; resolved: boolean }>;
  cookiesSetInCode: number;
  responseKind: 'view-html' | 'json' | null;
  controllerClass: string;
  methodName: string;
  sourceFilePath: string;
}

export interface CodeResponseFactsScan {
  factsByEndpointName: Map<string, CodeResponseFacts>;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const SERVLET_SETTERS = new Set(['setHeader', 'addHeader']);
const BUILDER_HEADER = 'header';
const VIEW_RETURN_TYPES = new Set(['String', 'ModelAndView', 'View']);

/**
 * The Java extractor retains string-literal args UNQUOTED (pinned by
 * `javaExtractorCallArgs.test.ts`), so quote-based literal detection is
 * impossible. An arg is treated as UNRESOLVED only when it is clearly an
 * EXPRESSION — a call (`(`), a concatenation (`+`), or a class literal.
 * A bare variable reference is indistinguishable from its literal value and
 * is carried verbatim as resolved (the value text is still exact evidence);
 * only clear expressions trigger the `response_header_unresolved` Finding.
 */
function isExpressionArg(arg: string | undefined): boolean {
  if (typeof arg !== 'string') return true;
  const t = arg.trim();
  return t.includes('(') || t.includes('+') || t.endsWith('.class') || t.length === 0;
}

function isStringLiteral(arg: string | undefined): boolean {
  return !isExpressionArg(arg);
}

function literalValue(arg: string): string {
  return arg.trim();
}

function statusArg(arg: string | undefined): number | string | null {
  if (typeof arg !== 'string') return null;
  const t = arg.trim();
  const n = Number.parseInt(t, 10);
  if (Number.isFinite(n) && String(n) === t) return n;
  const enumTail = /(?:HttpStatus\.)?([A-Z_]+)$/.exec(t);
  if (enumTail) return enumTail[1];
  return null;
}

export function scanCodeResponseFacts(files: SourceFileIR[]): CodeResponseFactsScan {
  const factsByEndpointName = new Map<string, CodeResponseFacts>();

  for (const file of files) {
    if (file.language !== 'java') continue;
    for (const cls of file.classes ?? []) {
      const isController = CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n));
      if (!isController) continue;
      const isRest = hasAnnotation(cls.annotations, 'RestController');
      const classResponseBody = hasAnnotation(cls.annotations, 'ResponseBody');

      for (const method of cls.methods ?? []) {
        const isMapping = ENDPOINT_ANNOTATIONS.some((n) => hasAnnotation(method.annotations, n));
        if (!isMapping) continue;

        const facts: CodeResponseFacts = {
          headersSetInCode: [],
          contentTypesSetInCode: [],
          statusCodesSetInCode: [],
          redirects: [],
          cookiesSetInCode: 0,
          responseKind: null,
          controllerClass: cls.name,
          methodName: method.name,
          sourceFilePath: file.filePath,
        };

        for (const call of method.calls ?? []) {
          const name = call.methodName ?? call.callee.split('.').pop() ?? '';
          const args = call.args ?? [];
          if (SERVLET_SETTERS.has(name) && args.length >= 2) {
            const resolved = isStringLiteral(args[0]) && isStringLiteral(args[1]);
            facts.headersSetInCode.push({
              name: isStringLiteral(args[0]) ? literalValue(args[0]) : args[0],
              value: isStringLiteral(args[1]) ? literalValue(args[1]) : args[1],
              resolved,
              source: 'servlet-response',
            });
          } else if (name === BUILDER_HEADER && args.length >= 2) {
            const resolved = isStringLiteral(args[0]) && isStringLiteral(args[1]);
            facts.headersSetInCode.push({
              name: isStringLiteral(args[0]) ? literalValue(args[0]) : args[0],
              value: isStringLiteral(args[1]) ? literalValue(args[1]) : args[1],
              resolved,
              source: 'response-entity-builder',
            });
          } else if ((name === 'setContentType' || name === 'contentType') && args.length >= 1) {
            facts.contentTypesSetInCode.push(
              isStringLiteral(args[0]) ? literalValue(args[0]) : args[0]
            );
          } else if ((name === 'setStatus' || name === 'status') && args.length >= 1) {
            const code = statusArg(args[0]);
            if (code !== null) facts.statusCodesSetInCode.push(code);
          } else if (name === 'sendError' && args.length >= 1) {
            const code = statusArg(args[0]);
            if (code !== null) facts.statusCodesSetInCode.push(code);
          } else if ((name === 'sendRedirect' || name === 'location') && args.length >= 1) {
            facts.redirects.push({
              target: isStringLiteral(args[0]) ? literalValue(args[0]) : args[0],
              resolved: isStringLiteral(args[0]),
            });
          } else if (name === 'addCookie') {
            facts.cookiesSetInCode += 1;
          }
        }

        // View-kind classification (API-only parity scope decision).
        const methodResponseBody = hasAnnotation(method.annotations, 'ResponseBody');
        const returnsView = VIEW_RETURN_TYPES.has((method.returnType ?? '').trim());
        const isView = !isRest && !classResponseBody && !methodResponseBody && returnsView;
        facts.responseKind = isView ? 'view-html' : 'json';

        // Redirect-prefix view returns ("redirect:/x") count as redirects too —
        // only detectable via literal return in body text, which the IR does
        // not carry; the sendRedirect path above covers the servlet form.

        const hasAnyFact =
          facts.headersSetInCode.length > 0 ||
          facts.contentTypesSetInCode.length > 0 ||
          facts.statusCodesSetInCode.length > 0 ||
          facts.redirects.length > 0 ||
          facts.cookiesSetInCode > 0 ||
          facts.responseKind === 'view-html';
        // json-kind with no code-set facts adds nothing — skip to keep the
        // attach pass additive-only (the contract default is API/json).
        if (!hasAnyFact) continue;

        factsByEndpointName.set(endpointNameFor(cls, method), facts);
      }
    }
  }

  return { factsByEndpointName };
}

// ---------------------------------------------------------------------------
// Attach pass
// ---------------------------------------------------------------------------

interface EndpointData {
  response_contract?: Record<string, unknown>;
  [key: string]: unknown;
}

function contractOf(data: EndpointData): Record<string, unknown> {
  if (!data.response_contract || typeof data.response_contract !== 'object') {
    data.response_contract = { schema_version: 'response_contract.v1', confidence: 0.9 };
  }
  return data.response_contract as Record<string, unknown>;
}

/** Attach code-set facts onto matching `endpoints` candidates (by name). */
export function attachCodeResponseFacts(
  candidates: DiscoveryCandidate[],
  scan: CodeResponseFactsScan
): number {
  if (scan.factsByEndpointName.size === 0) return 0;
  let touched = 0;
  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoints') continue;
    const facts = scan.factsByEndpointName.get(candidate.name ?? '');
    if (!facts) continue;
    const data = (candidate.data ?? (candidate.data = {})) as EndpointData;
    const contract = contractOf(data);

    if (facts.headersSetInCode.length > 0) {
      contract.headers_set_in_code = facts.headersSetInCode.map((h) => ({
        name: h.name,
        value: h.value,
        resolved: h.resolved,
        source: h.source,
      }));
    }
    if (facts.contentTypesSetInCode.length > 0) {
      contract.content_types_set_in_code = facts.contentTypesSetInCode;
    }
    if (facts.statusCodesSetInCode.length > 0) {
      const statusCodes =
        contract.status_codes && typeof contract.status_codes === 'object'
          ? (contract.status_codes as Record<string, unknown>)
          : (contract.status_codes = {});
      statusCodes.code_set_in_code = facts.statusCodesSetInCode;
    }
    if (facts.redirects.length > 0) {
      contract.redirects = facts.redirects;
    }
    if (facts.cookiesSetInCode > 0) {
      contract.cookies_set_in_code = facts.cookiesSetInCode;
    }
    contract.response_kind = facts.responseKind;
    if (facts.responseKind === 'view-html') {
      contract.parity_scope = 'out_of_scope_view';
    }
    touched++;
  }
  return touched;
}

// ---------------------------------------------------------------------------
// Findings (run-it-twice pattern; consumed by springClassicFindingScanner)
// ---------------------------------------------------------------------------

export function buildCodeResponseFactsFindings(scan: CodeResponseFactsScan): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const [endpointName, facts] of scan.factsByEndpointName) {
    const unresolvedHeaders = facts.headersSetInCode.filter((h) => !h.resolved);
    if (unresolvedHeaders.length > 0) {
      out.push({
        findingType: 'response_header_unresolved',
        category: 'evidence_gap',
        severity: 'medium',
        title: `Dynamic response header(s) on ${endpointName}`,
        summary:
          `Endpoint '${endpointName}' (${facts.controllerClass}#${facts.methodName}) sets ` +
          `${unresolvedHeaders.length} response header(s) from non-literal expressions — the ` +
          `wire values cannot be statically captured, so parity for these headers must be ` +
          `proven by replay, not by contract.`,
        detailJson: {
          endpoint: endpointName,
          controllerClass: facts.controllerClass,
          methodName: facts.methodName,
          headers: unresolvedHeaders.map((h) => ({ name: h.name, value: h.value })),
          filePath: facts.sourceFilePath,
        },
      });
    }
    if (facts.responseKind === 'view-html') {
      out.push({
        findingType: 'view_endpoint_out_of_parity_scope',
        category: 'coverage',
        severity: 'info',
        title: `View-serving endpoint marked out of parity scope: ${endpointName}`,
        summary:
          `Endpoint '${endpointName}' (${facts.controllerClass}#${facts.methodName}) renders a ` +
          `server-side VIEW (no @ResponseBody; view return type). Parity verification is ` +
          `API-only for now (user decision, Spec 2026-07-06-l) — this endpoint is marked ` +
          `response_kind='view-html' / parity_scope='out_of_scope_view' and EXCLUDED from ` +
          `byte-parity, visibly, until the UI-migration programme.`,
        detailJson: {
          endpoint: endpointName,
          controllerClass: facts.controllerClass,
          methodName: facts.methodName,
          filePath: facts.sourceFilePath,
        },
      });
    }
  }
  return out;
}
