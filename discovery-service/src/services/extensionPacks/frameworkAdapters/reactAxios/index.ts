/**
 * React / Axios Framework Adapter (Chunk 3 — expanded)
 *
 * Consumes SourceFileIR and emits DiscoveryCandidates for the frontend-
 * relevant portion of the architecture taxonomy:
 *
 *   logical_entity            — TS interface / object-type alias DTOs
 *   logical_data_attribute    — fields on a logical_entity
 *   business_logic            — exported domain-operation functions
 *   ui_component              — reusable React components (PascalCase, returns JSX / lives in .tsx)
 *   ui_screen                 — page-level components (route elements, or *Page/*Screen/*View)
 *   endpoint                  — axios/fetch API call sites (consumer-side)
 *
 * NOT in scope:
 * - physical_entity / physical_attribute / entity_relationship — frontend has
 *   no database.
 * - interface (as in @RestController) — a frontend doesn't expose endpoints.
 * - Custom hooks, Redux slices, Context providers — kept legacy-side for now.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR, CallIR } from '../../languageIR';

// ---------------------------------------------------------------------------
// Candidate helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId,
    candidateType: type,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'react-axios-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

// ---------------------------------------------------------------------------
// Heuristics — shared
// ---------------------------------------------------------------------------

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const SCREEN_NAME_SUFFIX = /(Page|Screen|View)$/;
const JSX_RETURN_TYPE = /JSX\.Element|ReactNode|ReactElement|React\.FC|\bFC\b|Element\b/;

// Excluded prefixes for business_logic detection. Functions starting with any
// of these are almost never business logic — they're getters, framework
// lifecycle (use*), rendering, format/map helpers, or CRUD/API wrappers.
const BUSINESS_LOGIC_EXCLUDE_PREFIXES = [
  'get', 'set', 'is', 'has', 'use', 'render', 'format', 'map', 'to', 'toString',
  // CRUD / API verbs — typically API wrappers, not domain rules
  'create', 'update', 'delete', 'save', 'find', 'fetch', 'load', 'list', 'add', 'remove',
];

// Names that look like router / saga plumbing, not business logic or screens.
const ROUTER_CONFIG_NAME = /^(App)?Routes$|Router$/;
const SAGA_SUFFIX = /Saga$/;

function isExported(fn: FunctionIR): boolean {
  return fn.modifiers.includes('export') || fn.modifiers.includes('default');
}

function isTsxFile(filePath: string): boolean {
  // Treat both .tsx and .jsx as JSX-bearing file types. Return-type annotation
  // is often missing in JS, so presence of .tsx/.jsx is our strongest
  // "this is a JSX component" signal.
  return filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
}

/**
 * Returns true only when the IMMEDIATE parent directory is one of the
 * page-level conventions. A deeply nested file like
 * `src/pages/FooPage/widgets/BarWidget.tsx` will NOT match — the immediate
 * parent is `widgets/`, not `pages/`. This is what distinguishes a top-level
 * page from a child widget belonging to a page.
 */
function inRoutesDirImmediate(filePath: string): boolean {
  const parts = filePath.split('/');
  if (parts.length < 2) return false;
  const parent = parts[parts.length - 2].toLowerCase();
  return parent === 'pages' || parent === 'screens' || parent === 'routes' || parent === 'views';
}

function looksLikeReactComponent(fn: FunctionIR, filePath: string): boolean {
  if (!PASCAL_CASE.test(fn.name)) return false;
  if (JSX_RETURN_TYPE.test(fn.returnType)) return true;
  // .tsx file with PascalCase export and no JSX return type annotation is a strong heuristic
  if (isTsxFile(filePath) && isExported(fn)) return true;
  return false;
}

function looksLikeClassComponent(cls: ClassIR): boolean {
  if (!cls.extends) return false;
  return /^(React\.)?Component$/.test(cls.extends) || cls.extends === 'PureComponent';
}

// ---------------------------------------------------------------------------
// Heuristics — ui_screen vs ui_component
// ---------------------------------------------------------------------------

/**
 * Returns null if the name looks like router/navigation configuration and
 * should NOT be emitted as a UI candidate at all. Otherwise classifies into
 * ui_screen or ui_component.
 */
function classifyUiKind(
  name: string,
  filePath: string,
): 'ui_screens' | 'ui_components' | null {
  // Router configs (AppRoutes, Routes, MainRouter, etc.) are structural — skip.
  if (ROUTER_CONFIG_NAME.test(name)) return null;
  // Primary signal: name suffix. "*Page", "*Screen", "*View" are strong screen indicators.
  if (SCREEN_NAME_SUFFIX.test(name)) return 'ui_screens';
  // Secondary: file lives DIRECTLY inside a pages/screens/routes/views directory.
  // Nested children of page directories are NOT screens — they're child widgets.
  if (inRoutesDirImmediate(filePath)) return 'ui_screens';
  return 'ui_components';
}

/** Infer component_type for a ui_component from name heuristics. */
function inferComponentType(name: string): string {
  const lower = name.toLowerCase();
  if (/button$/i.test(name) || lower.endsWith('btn')) return 'button';
  if (/input$|field$|select$|textarea$/i.test(name)) return 'input';
  if (/form$/i.test(name)) return 'form';
  if (/modal$|dialog$|popover$/i.test(name)) return 'modal';
  if (/table$|grid$|list$/i.test(name)) return 'table';
  if (/card$|tile$|item$/i.test(name)) return 'card';
  if (/header$|footer$|sidebar$|nav$|navbar$|layout$|shell$/i.test(name)) return 'layout';
  return 'other';
}

// ---------------------------------------------------------------------------
// Heuristics — API calls (axios / fetch)
// ---------------------------------------------------------------------------

const AXIOS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'request']);

interface ParsedApiCall {
  httpMethod: string;
  url: string | null;
  /** When the URL was a bare identifier (variable) — the identifier name, for runtime-resolved URLs. */
  urlVariable: string | null;
  apiLib: 'axios' | 'fetch';
}

/**
 * Classify a CallIR as an API call (axios, fetch, custom apiClient pattern) and
 * extract HTTP method + URL if possible. Returns null if it's not an API call.
 */
function parseApiCall(call: CallIR): ParsedApiCall | null {
  const callee = call.callee;

  // Bare fetch(url, ...)
  if (callee === 'fetch') {
    const parsed = parseUrlArg(call.args[0] || '');
    return { httpMethod: inferHttpFromFetchOpts(call.args[1]), ...parsed, apiLib: 'fetch' };
  }

  // axios('url', {method, ...})
  if (callee === 'axios') {
    const parsed = parseUrlArg(call.args[0] || '');
    return { httpMethod: 'GET', ...parsed, apiLib: 'axios' };
  }

  // <something>.get/post/put/delete/patch/request
  const dot = callee.lastIndexOf('.');
  if (dot === -1) return null;
  const method = callee.slice(dot + 1);
  if (!AXIOS_METHODS.has(method)) return null;

  const parsed = parseUrlArg(call.args[0] || '');
  return {
    httpMethod: method.toUpperCase(),
    ...parsed,
    apiLib: 'axios',
  };
}

/**
 * Parse a URL argument. Returns either a literal URL string or an identifier
 * reference (runtime-resolved). Reserves the right to return both null when
 * the argument is an inline expression (not a literal and not a plain identifier).
 */
function parseUrlArg(text: string): { url: string | null; urlVariable: string | null } {
  if (!text) return { url: null, urlVariable: null };
  const trimmed = text.trim();
  // String literal
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return { url: trimmed.slice(1, -1), urlVariable: null };
  }
  // Template string — preserve ${...} interpolations verbatim
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return { url: trimmed.slice(1, -1), urlVariable: null };
  }
  // Plain identifier (variable reference) — capture as urlVariable, not as URL
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(trimmed)) {
    return { url: null, urlVariable: trimmed };
  }
  // Anything else (inline expression, call result, etc.) — opaque
  return { url: null, urlVariable: null };
}

function inferHttpFromFetchOpts(optsArg: string | undefined): string {
  if (!optsArg) return 'GET';
  const m = optsArg.match(/method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['"`]/i);
  return m ? m[1].toUpperCase() : 'GET';
}

// ---------------------------------------------------------------------------
// Heuristics — logical_entity (DTO)
// ---------------------------------------------------------------------------

/**
 * Name-suffix patterns that mark a TS interface/type as UI plumbing rather
 * than a domain data entity:
 *   - `*Props`      — React component prop bags.
 *   - `*State`      — Redux slice / component local state containers.
 *   - `*Action`     — Redux action shape.
 *   - `*Payload`    — Redux action payload.
 *   - `*Args`/`*Options`/`*Config`  — function / hook argument bags.
 *   - `*Context`    — React Context value shape.
 *   - `*Event`      — synthetic UI event.
 *   - `*Handler`/`*Callback` — function-type aliases (UI plumbing).
 *
 * Bug-13 fix (2026-04-21): these were previously emitted as
 * `logical_data_entities` on the frontend run, inflating the set with ~40
 * `*Props` + ~20 `*State` shapes that are pure UI glue, not domain contracts.
 */
const NON_DOMAIN_INTERFACE_SUFFIXES =
  /(Props|State|Action|Payload|Args|Options|Config|Context|Event|Handler|Callback)$/;

function isLikelyDto(cls: ClassIR): boolean {
  if (!cls.isInterface) return false;
  if (cls.fields.length === 0) return false;
  if (NON_DOMAIN_INTERFACE_SUFFIXES.test(cls.name)) return false;
  return true;
}

function isBusinessLogicCandidate(fn: FunctionIR, filePath: string): boolean {
  if (!isExported(fn)) return false;
  if (looksLikeReactComponent(fn, filePath)) return false;
  if (PASCAL_CASE.test(fn.name)) return false; // likely a component even without JSX return
  // Skip Redux-Saga orchestration (rootSaga, watcherSaga, etc.) and similar plumbing
  if (SAGA_SUFFIX.test(fn.name)) return false;
  const lower = fn.name.replace(/^_/, '');
  for (const prefix of BUSINESS_LOGIC_EXCLUDE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const remainder = lower.slice(prefix.length);
      if (remainder === '' || /^[A-Z]/.test(remainder)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runReactAxiosAdapter(
  files: SourceFileIR[],
  runId: string,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  // Bug-14 fix (2026-04-21): TypeScript frontends commonly redeclare helper
  // types with the same name in multiple files (e.g. `ConditionNode` in three
  // separate modules). Per the meta-model, logical entity names are
  // identifiers — two declarations with the same name should collapse to a
  // single logical entity. Keep the first-seen declaration; subsequent ones
  // are skipped entirely (including their attributes).
  const emittedLogicalEntityNames = new Set<string>();

  for (const file of files) {
    // --- Logical entities (TS interfaces / object-type aliases) ---
    for (const cls of file.classes) {
      if (isLikelyDto(cls)) {
        if (emittedLogicalEntityNames.has(cls.name)) continue;
        emittedLogicalEntityNames.add(cls.name);
        const logical = makeCandidate(
          'logical_data_entities',
          cls.name,
          file.filePath,
          { className: cls.name, isInterface: cls.isInterface, extends: cls.extends },
          runId,
        );
        candidates.push(logical);
        for (const field of cls.fields) {
          candidates.push(
            makeCandidate(
              'logical_data_attributes',
              field.name,
              file.filePath,
              { fieldName: field.name, dataType: field.type, logicalEntityName: cls.name },
              runId,
              logical.id,
            ),
          );
        }
      }
    }

    // --- UI components / screens (class-based) ---
    for (const cls of file.classes) {
      if (cls.isInterface) continue; // skip TS interfaces
      if (!PASCAL_CASE.test(cls.name)) continue;
      if (!looksLikeClassComponent(cls)) continue;
      const kind = classifyUiKind(cls.name, file.filePath);
      if (kind === null) continue; // router configs etc. — skip entirely
      if (kind === 'ui_screens') {
        candidates.push(
          makeCandidate('ui_screens', cls.name, file.filePath, {
            className: cls.name,
            route: null, // unknown from class alone
            description: `Class component at ${file.filePath}`,
          }, runId),
        );
      } else {
        candidates.push(
          makeCandidate('ui_components', cls.name, file.filePath, {
            className: cls.name,
            component_type: inferComponentType(cls.name),
          }, runId),
        );
      }
    }

    // --- UI components / screens (function-based) + business_logic ---
    for (const fn of file.functions) {
      if (looksLikeReactComponent(fn, file.filePath)) {
        const kind = classifyUiKind(fn.name, file.filePath);
        if (kind === null) continue; // router configs etc. — skip entirely
        if (kind === 'ui_screens') {
          candidates.push(
            makeCandidate('ui_screens', fn.name, file.filePath, {
              functionName: fn.name,
              route: null,
              description: `Function component at ${file.filePath}`,
            }, runId),
          );
        } else {
          candidates.push(
            makeCandidate('ui_components', fn.name, file.filePath, {
              functionName: fn.name,
              component_type: inferComponentType(fn.name),
            }, runId),
          );
        }
      } else if (isBusinessLogicCandidate(fn, file.filePath)) {
        candidates.push(
          makeCandidate('business_logics', fn.name, file.filePath, {
            returnType: fn.returnType,
            parameterCount: fn.parameters.length,
          }, runId),
        );
      }
    }

    // --- API call sites (axios / fetch) inside functions and class methods ---
    const allFunctions: Array<{ fn: FunctionIR; ownerName: string | null }> = [
      ...file.functions.map((fn) => ({ fn, ownerName: null as string | null })),
      ...file.classes.flatMap((cls) =>
        cls.methods.map((fn) => ({ fn, ownerName: cls.name })),
      ),
    ];
    // Bug-11/12 fix (2026-04-21): sanitize + canonicalize endpoint URLs
    // before emission, and dedupe within a file on (method, canonicalPath).
    const emittedPerFile = new Set<string>();
    for (const { fn, ownerName } of allFunctions) {
      if (!fn.calls || fn.calls.length === 0) continue;
      for (const call of fn.calls) {
        const api = parseApiCall(call);
        if (!api) continue;
        // Bug-11: reject call sites whose first arg isn't a URL. A bare
        // identifier like `id`/`key`/`name`/`initial-tab` is a method call on
        // a Map/Record/state object misclassified as an HTTP call. Only
        // accept URLs (literal or template) that contain a `/`, a host, or
        // look like an interpolated path.
        const rawUrl = api.url ?? '';
        const looksLikeUrl =
          rawUrl.startsWith('/') ||
          /^https?:\/\//i.test(rawUrl) ||
          /^\$\{[^}]+\}\//.test(rawUrl) ||       // `${BASE}/path`
          /\/\$\{/.test(rawUrl);                 // `something/${id}`
        if (!api.url || !looksLikeUrl) {
          // Non-URL `.get(id)` / `.get(key)` / `.delete(name)` — skip.
          continue;
        }
        // Bug-12: canonicalize.
        //  - Strip common API-base-URL interpolations `${API_BASE_URL}` /
        //    `${apiBase}` / `${API_BASE}` / `${BASE_URL}` at the start.
        //  - Strip query strings (`?expand=...`) — they're parameter values,
        //    not different endpoints.
        let canonical = api.url;
        canonical = canonical.replace(
          /^\$\{(?:API_BASE_URL|apiBase|API_BASE|BASE_URL|apiBaseUrl)\}/,
          '',
        );
        const qIdx = canonical.indexOf('?');
        if (qIdx >= 0) canonical = canonical.slice(0, qIdx);
        // Ensure path starts with `/`
        if (!canonical.startsWith('/') && !/^https?:\/\//i.test(canonical)) {
          canonical = '/' + canonical;
        }
        const name = `${api.httpMethod} ${canonical}`;
        // Dedupe within the same file on (method, canonical path).
        const dedupKey = name;
        if (emittedPerFile.has(dedupKey)) continue;
        emittedPerFile.add(dedupKey);

        const callerSig = ownerName ? `${ownerName}.${fn.name}` : fn.name;
        candidates.push(
          makeCandidate('endpoints', name, file.filePath, {
            httpMethod: api.httpMethod,
            url: api.url,
            canonicalUrl: canonical,
            urlVariable: api.urlVariable,
            apiLibrary: api.apiLib,
            callingFunction: callerSig,
            endpoint_subtype: 'api_call',
            responseType: call.typeArgs,
            line: call.line,
          }, runId),
        );
      }
    }
  }

  return candidates;
}
