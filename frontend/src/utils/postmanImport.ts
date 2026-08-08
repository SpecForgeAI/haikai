/**
 * Postman Collection v2.1 IMPORT parser for API Behaviour capture (pure frontend).
 *
 * Spec: 2026-06-23 Import a Postman Collection into Capture, R1 (Task Group 1).
 *
 * The INVERSE of `frontend/src/utils/postmanExport.ts`: takes a raw Postman
 * Collection v2.1 JSON document (a `Record<string, unknown>` as parsed from an
 * uploaded file) and returns a flat `ImportedRequest[]` -- one entry per
 * concrete request, with folders and multi-step `sequence` items FLATTENED into
 * individual requests in source order. This is a PURE function -- no fetch, no
 * DOM, no server round-trip. The caller (the wizard staging step / the
 * detail-view append modal, later task groups) stages the result and drives the
 * `manual-capture` sends.
 *
 * Mapping rules (R1 / requirements A7):
 *   - Each `ImportedRequest` carries `{ method, path, query, headers, body,
 *     sourceItemName, unsupportedReason? }`.
 *   - `method` is upper-cased; falls back to `GET` when absent.
 *   - The URL's `{{baseUrl}}` / host is STRIPPED -- only the path + query are
 *     kept (path is normalised to a single leading-slash string; query becomes
 *     a `{ key: value }` record, mirroring the `ManualCaptureRequest` contract).
 *   - v1 supports `application/json` bodies ONLY. A non-JSON body (`mode` other
 *     than `raw`, or a `raw` body whose language is not JSON, or raw text that
 *     does not parse as JSON) is NOT silently sent: the item is emitted with an
 *     `unsupportedReason` and a `null` body so the staging UI can flag it.
 *   - EXAMPLE MINING (2026-08-08): unresolved `{{var}}` / `:param` / `{param}`
 *     tokens are backfilled from the item's saved response examples
 *     (`response[].originalRequest` -- the EXACT request as actually sent,
 *     which is where curated collections keep the concrete working IDs).
 *     The top-level request stays AUTHORITATIVE: URL variables and collection
 *     variables win over example values, and a literal path segment that
 *     DISAGREES with the example (technically an invalid file) means the
 *     example is ignored for that item and the top-level values stand. Only
 *     tokens the variables could not resolve are sucked out of the example --
 *     path params by template alignment, query values by same-key fallback,
 *     body values by same-JSON-path alignment. `exampleProvenance` records
 *     which example supplied which names so staging can show it.
 *   - ALL collection-level and item-level Postman `auth` blocks are IGNORED --
 *     the session's in-memory secrets are the sole auth source.
 *   - Folders (`item[]` nesting) and multi-step / `sequence` items are recursed
 *     and flattened to individual requests, preserving order.
 *   - Inter-step `response_refs` are NOT resolved and no `pm.*` scripts are
 *     generated (matching the export's deliberate omission).
 *
 * The raw document is read DEFENSIVELY (loose `Record` narrowing): a
 * malformed / partial item degrades gracefully (skipped fields, never a throw),
 * mirroring `postmanExport.ts`'s `asRecord` / `asString` / `asNumber` /
 * `toPathSegments` posture.
 */

import type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
  PostmanUrl,
  PostmanHeader,
  PostmanQueryParam,
  PostmanBody,
} from './postmanExport';

// Re-export the shared v2.1 type surface so importers of THIS module can pull
// the Postman types from one place without redeclaring them. (The interfaces
// themselves live in `postmanExport.ts` -- this is the inverse parser.)
export type {
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
  PostmanUrl,
  PostmanHeader,
  PostmanQueryParam,
  PostmanBody,
};

// ---------------------------------------------------------------------------
// Imported-request shape
// ---------------------------------------------------------------------------

/**
 * One concrete request resolved from a Postman collection item, ready to be
 * staged and (after the architecture-match step) sent through the
 * `manual-capture` primitive.
 *
 *   - `method`          HTTP verb, upper-cased (`GET` fallback).
 *   - `path`            URL path with `{{baseUrl}}` / host stripped, normalised
 *                       to a single leading-slash string (`/` when empty).
 *   - `query`           `{ key: value }` record (last value wins on duplicate
 *                       keys); empty object when the URL carried no query.
 *   - `headers`         `{ name: value }` record; empty object when none.
 *   - `body`            The parsed JSON request body, or `null` when there is
 *                       no body OR the body is unsupported (see below).
 *   - `sourceItemName`  The originating Postman item's `name` (for the staging
 *                       list); falls back to a generic label.
 *   - `unsupportedReason` Present ONLY when the item carried a body this v1
 *                       cannot send (non-`application/json`). The item is still
 *                       emitted (so it is visible + flaggable in staging) but
 *                       MUST NOT be silently sent.
 */
export interface ImportedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  sourceItemName: string;
  unsupportedReason?: string;
  /**
   * Present when the URL carried path parameters (`:param` Postman syntax,
   * `{param}` template tokens, or in-path `{{var}}` usages): the path with
   * every parameter position in canonical `{param}` form. Used for
   * template-level operation matching while `path` stays the SEND form.
   */
  pathTemplate?: string;
  /**
   * Parameter names that could NOT be resolved to a concrete value (no
   * collection/url variable value). An item with unresolved params must
   * NEVER be sent — the literal token would fire at the server (2026-08-02).
   */
  unresolvedParams?: string[];
  /**
   * Present when unresolved tokens were backfilled from one of the item's
   * saved response examples (`response[].originalRequest` — the exact request
   * as actually sent). `resolvedNames` lists the param / token / query names
   * the example supplied (`body` when the whole body came from the example).
   * Variables always win over the example; the example only fills what they
   * could not (2026-08-08).
   */
  exampleProvenance?: { exampleName: string; resolvedNames: string[] };
}

// ---------------------------------------------------------------------------
// Defensive narrowing helpers (mirror postmanExport.ts)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Render an arbitrary header / query value to a string (objects -> JSON). */
function valueToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// URL resolution (strip {{baseUrl}} / host; keep path + query)
// ---------------------------------------------------------------------------

/** True for a Postman host token that is a variable / placeholder we strip. */
function isVariableSegment(seg: string): boolean {
  return /^\{\{.*\}\}$/.test(seg.trim());
}

/** The resolved path pair + any parameters left without a concrete value. */
interface ResolvedPathParts {
  path: string;
  pathTemplate: string;
  unresolvedParams: string[];
}

/**
 * Process path segments into the SEND path + canonical `{param}` template
 * (2026-08-02). Three parameter spellings are recognised:
 *   - `:param`   Postman path-variable syntax — value from the URL's
 *                `variable` array (falling back to collection variables);
 *   - `{param}`  template tokens (our exporter's legacy form);
 *   - `{{var}}`  Postman variables, whole- or partial-segment — value from
 *                collection variables. A LEADING whole-`{{var}}` segment is
 *                treated as a host token and stripped (the `{{baseUrl}}`
 *                convention), preserving the old behaviour.
 * Known values substitute (URL-encoded); unknown ones keep the literal token
 * in `path` AND are reported in `unresolvedParams` so staging can block the
 * send — previously the literal token fired at the server and the capture
 * failed with "NO HTTP attempt".
 */
function processPathSegments(
  segments: string[],
  urlVars: Record<string, string>,
  collectionVars: Record<string, string>,
): ResolvedPathParts {
  const sendSegs: string[] = [];
  const templateSegs: string[] = [];
  const unresolved: string[] = [];
  const valueFor = (name: string): string | null => {
    const v = urlVars[name] ?? collectionVars[name];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };

  segments.forEach((seg, index) => {
    if (index === 0 && isVariableSegment(seg)) return; // `{{baseUrl}}` host token
    const colon = /^:([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(seg);
    const curly = /^\{([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(seg);
    if (colon || curly) {
      const name = (colon ?? curly)![1];
      templateSegs.push(`{${name}}`);
      const v = valueFor(name);
      if (v !== null) {
        sendSegs.push(encodeURIComponent(v));
      } else {
        sendSegs.push(seg);
        unresolved.push(name);
      }
      return;
    }
    if (seg.includes('{{')) {
      const names: string[] = [];
      const substituted = seg.replace(/\{\{([^}]+)\}\}/g, (match, rawName: string) => {
        const name = rawName.trim();
        const v = valueFor(name);
        if (v !== null) return encodeURIComponent(v);
        names.push(name);
        return match;
      });
      templateSegs.push(seg.replace(/\{\{([^}]+)\}\}/g, (_m, n: string) => `{${n.trim()}}`));
      sendSegs.push(substituted);
      unresolved.push(...names);
      return;
    }
    sendSegs.push(seg);
    templateSegs.push(seg);
  });

  return {
    path: sendSegs.length > 0 ? `/${sendSegs.join('/')}` : '/',
    pathTemplate: templateSegs.length > 0 ? `/${templateSegs.join('/')}` : '/',
    unresolvedParams: unresolved,
  };
}

/** Read a Postman `variable` array (`[{key, value}]`) into a record. */
function resolveVariableRecord(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of asArray(raw)) {
    const v = asRecord(entry);
    if (!v) continue;
    const key = asString(v.key);
    if (key === null || key.length === 0) continue;
    out[key] = valueToString(v.value);
  }
  return out;
}

/**
 * Resolve a Postman item's URL down to a `{ path, query }` pair, dropping any
 * `{{baseUrl}}` / host. The URL may be a structured `PostmanUrl` object OR a
 * raw string (Postman allows both); both are handled defensively.
 *
 * Path normalisation: the segments are joined with a single leading slash
 * (`/a/b`); an empty path resolves to `/`. Query duplicate keys: last wins.
 */
function resolveUrl(
  rawUrl: unknown,
  collectionVars: Record<string, string> = {},
): ResolvedPathParts & {
  query: Record<string, string>;
} {
  // String form: parse off the query string, then strip a leading host/scheme
  // and any `{{baseUrl}}` token.
  if (typeof rawUrl === 'string') {
    return resolveUrlString(rawUrl, collectionVars, {});
  }

  const url = asRecord(rawUrl);
  if (!url) return { path: '/', pathTemplate: '/', unresolvedParams: [], query: {} };

  // The URL-level `variable` array carries values for `:param` path variables.
  const urlVars = resolveVariableRecord(url.variable);

  // Prefer the structured `path` array; fall back to parsing `raw`.
  const pathSegments = asArray(url.path)
    .map((seg) => asString(seg))
    .filter((seg): seg is string => seg !== null && seg.length > 0);

  let parts: ResolvedPathParts;
  // Query recovered from the raw string when no structured `query` array
  // exists (2026-08-08 — previously silently dropped in that shape).
  let queryFromRaw: Record<string, string> = {};
  if (pathSegments.length > 0) {
    parts = processPathSegments(pathSegments, urlVars, collectionVars);
  } else if (typeof url.raw === 'string') {
    // No usable path array -- recover the path (and query) from the raw string.
    const fromRaw = resolveUrlString(url.raw, collectionVars, urlVars);
    parts = fromRaw;
    queryFromRaw = fromRaw.query;
  } else {
    parts = { path: '/', pathTemplate: '/', unresolvedParams: [] };
  }

  // The structured `query` array is authoritative; raw-derived entries only
  // fill keys the array does not carry.
  const query: Record<string, string> = { ...queryFromRaw };
  for (const entry of asArray(url.query)) {
    const q = asRecord(entry);
    if (!q) continue;
    const key = asString(q.key);
    if (key === null || key.length === 0) continue;
    query[key] = valueToString(q.value);
  }

  return { ...parts, query };
}

/**
 * Resolve a raw URL string to `{ path, query }`: strip scheme + host (and any
 * leading `{{baseUrl}}`), keep the path and parse the query string. Fail-soft:
 * an unparseable string yields `{ path: '/', query: {} }`.
 */
function resolveUrlString(
  raw: string,
  collectionVars: Record<string, string> = {},
  urlVars: Record<string, string> = {},
): ResolvedPathParts & {
  query: Record<string, string>;
} {
  let s = raw.trim();
  if (!s) return { path: '/', pathTemplate: '/', unresolvedParams: [], query: {} };

  // Split off the query string first.
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf('?');
  const queryString = qIdx >= 0 ? s.slice(qIdx + 1) : '';
  let pathPart = qIdx >= 0 ? s.slice(0, qIdx) : s;

  // Strip a leading `{{baseUrl}}` token.
  pathPart = pathPart.replace(/^\{\{[^}]*\}\}/, '');
  // Strip a scheme + authority (`https://host[:port]`) if present.
  pathPart = pathPart.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/, '');

  const segments = pathPart
    .split('/')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);
  const parts = processPathSegments(segments, urlVars, collectionVars);

  const query: Record<string, string> = {};
  if (queryString) {
    for (const pair of queryString.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
      const rawVal = eq >= 0 ? pair.slice(eq + 1) : '';
      let key = rawKey;
      let val = rawVal;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        /* keep raw */
      }
      try {
        val = decodeURIComponent(rawVal);
      } catch {
        /* keep raw */
      }
      if (key.length === 0) continue;
      query[key] = val;
    }
  }

  return { ...parts, query };
}

// ---------------------------------------------------------------------------
// Header resolution
// ---------------------------------------------------------------------------

/**
 * Map a Postman `header` list (`[{ key, value, disabled? }]`) to a
 * `{ name: value }` record. Disabled headers are dropped. A non-array (or
 * missing) header block yields an empty record. Defensive throughout.
 */
function resolveHeaders(rawHeader: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of asArray(rawHeader)) {
    const h = asRecord(entry);
    if (!h) continue;
    if (h.disabled === true) continue;
    const key = asString(h.key);
    if (key === null || key.length === 0) continue;
    headers[key] = valueToString(h.value);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Body resolution (application/json only; flag everything else)
// ---------------------------------------------------------------------------

const NON_JSON_BODY_REASON =
  'Unsupported body content type (v1 sends application/json bodies only)';

/**
 * Resolve a Postman `body` block to a parsed JSON value, OR flag it as
 * unsupported. v1 supports ONLY `mode: 'raw'` JSON bodies:
 *   - no body block / empty raw -> `{ body: null }` (a plain bodiless request).
 *   - `mode: 'raw'` with a JSON-parseable raw string (or an explicit
 *     `options.raw.language === 'json'`) -> `{ body: <parsed JSON> }`.
 *   - anything else (`formdata`, `urlencoded`, `file`, `graphql`, or raw text
 *     that is not JSON) -> `{ body: null, unsupportedReason }`.
 *
 * When `vars` is provided, `{{var}}` tokens in the raw text substitute BEFORE
 * the JSON parse (2026-08-08) — a body template like `{"id": {{orderId}}}` only
 * parses once its tokens resolve. `hadTokens` reports whether the raw text
 * carried any `{{...}}` token at all, so the caller can distinguish "not JSON"
 * from "JSON once the tokens resolve" and fall back to a saved example body.
 */
function resolveBody(
  rawBody: unknown,
  vars: Record<string, string> = {},
): {
  body: unknown;
  unsupportedReason?: string;
  hadTokens: boolean;
} {
  const body = asRecord(rawBody);
  if (!body) return { body: null, hadTokens: false };

  const mode = asString(body.mode);

  // No mode at all and no raw text -> treat as bodiless.
  if (mode === null && body.raw === undefined) return { body: null, hadTokens: false };

  if (mode !== null && mode !== 'raw') {
    // formdata / urlencoded / file / graphql -- explicitly unsupported in v1.
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON, hadTokens: false };
  }

  const raw = asString(body.raw);
  if (raw === null || raw.trim().length === 0) {
    // A `raw` mode with no text is effectively bodiless.
    return { body: null, hadTokens: false };
  }
  const hadTokens = raw.includes('{{');

  // Honour an explicit non-JSON language hint.
  const options = asRecord(body.options);
  const rawOptions = asRecord(options?.raw);
  const language = asString(rawOptions?.language);
  if (language !== null && language !== 'json') {
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON, hadTokens };
  }

  // Parse the raw text as JSON; non-JSON raw text is flagged, never sent.
  try {
    return { body: JSON.parse(substituteTokens(raw, vars)), hadTokens };
  } catch {
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON, hadTokens };
  }
}

// ---------------------------------------------------------------------------
// Example mining (2026-08-08): backfill unresolved tokens from saved examples
// ---------------------------------------------------------------------------

/**
 * Replace `{{name}}` tokens with values from `vars`; unknown names keep the
 * literal token (the caller decides what an unresolved token means).
 */
function substituteTokens(text: string, vars: Record<string, string>): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (match, rawName: string) => {
    const v = vars[rawName.trim()];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : match;
  });
}

/** A picked saved example: its display name + the exact request it recorded. */
interface PickedExample {
  name: string;
  originalRequest: Record<string, unknown>;
}

/**
 * Pick the item's best saved example: only entries carrying an
 * `originalRequest` qualify; prefer ones whose method matches the top-level
 * request, and among those the first 2xx (`code`) — the request that is KNOWN
 * to have worked. Falls back to the first qualifying example.
 */
function pickExample(rawResponses: unknown, method: string): PickedExample | null {
  interface Candidate extends PickedExample {
    code: number | null;
    methodMatches: boolean;
  }
  const candidates: Candidate[] = [];
  for (const entry of asArray(rawResponses)) {
    const r = asRecord(entry);
    if (!r) continue;
    const originalRequest = asRecord(r.originalRequest);
    if (!originalRequest) continue;
    const code =
      typeof r.code === 'number' && Number.isFinite(r.code) ? r.code : null;
    const exMethod = (asString(originalRequest.method) ?? '').toUpperCase();
    candidates.push({
      name: asString(r.name) ?? 'saved example',
      originalRequest,
      code,
      methodMatches: exMethod === '' || exMethod === method,
    });
  }
  const sameMethod = candidates.filter((c) => c.methodMatches);
  const pool = sameMethod.length > 0 ? sameMethod : candidates;
  const twoXx = pool.find((c) => c.code !== null && c.code >= 200 && c.code < 300);
  const picked = twoXx ?? pool[0] ?? null;
  return picked ? { name: picked.name, originalRequest: picked.originalRequest } : null;
}

/**
 * Align the top-level `pathTemplate` (canonical `{param}` tokens) against the
 * example's CONCRETE path, segment by segment, and extract the value each
 * param position carries. Honesty rules:
 *   - segment counts must match, and every LITERAL template segment must equal
 *     the example's segment (case-insensitive) — a divergence means the file
 *     is technically invalid, so the example is ignored ENTIRELY (`{}`; the
 *     top-level request stands);
 *   - a param position whose example segment is itself an unresolved token
 *     (`{{var}}`, `{param}`, `:param`) contributes no value;
 *   - partial-token segments (`order-{id}`) match by anchored regex.
 * Extracted values are URL-decoded (fail-soft to the raw segment).
 */
function extractExampleParamValues(
  pathTemplate: string,
  examplePath: string,
): Record<string, string> {
  const template = pathTemplate.split('/').filter((s) => s.length > 0);
  const concrete = examplePath.split('/').filter((s) => s.length > 0);
  if (template.length === 0 || template.length !== concrete.length) return {};

  const out: Record<string, string> = {};
  for (let i = 0; i < template.length; i++) {
    const tSeg = template[i];
    const cSeg = concrete[i];
    if (!tSeg.includes('{')) {
      if (tSeg.toLowerCase() !== cSeg.toLowerCase()) return {};
      continue;
    }
    // Build an anchored regex from the template segment: `{name}` positions
    // capture, literal runs are escaped verbatim.
    const names: string[] = [];
    const pattern = tSeg.replace(
      /\{([^}]+)\}|([^{}]+)/g,
      (_m, name: string | undefined, literal: string | undefined) => {
        if (name !== undefined) {
          names.push(name);
          return '(.+?)';
        }
        return (literal ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      },
    );
    const match = new RegExp(`^${pattern}$`).exec(cSeg);
    if (!match) return {};
    names.forEach((name, j) => {
      const rawValue = match[j + 1];
      // The example itself unresolved at this position -> no value from it.
      if (rawValue.includes('{{') || /^[:{]/.test(rawValue)) return;
      let decoded = rawValue;
      try {
        decoded = decodeURIComponent(rawValue);
      } catch {
        /* keep raw */
      }
      out[name] = decoded;
    });
  }
  return out;
}

/**
 * Walk the top-level body and the example body IN PARALLEL: a string leaf that
 * still carries an unresolved `{{token}}` takes the example's PRIMITIVE value
 * at the same JSON path (objects by key, arrays by index). Structure mismatch
 * at a node leaves the top-level value untouched — the top-level request is
 * authoritative; the example only fills its holes. Resolved token names
 * accumulate into `resolvedNames`.
 */
function backfillBodyFromExample(
  node: unknown,
  exampleNode: unknown,
  resolvedNames: string[],
): unknown {
  if (typeof node === 'string' && node.includes('{{')) {
    if (
      exampleNode !== undefined &&
      exampleNode !== null &&
      typeof exampleNode !== 'object'
    ) {
      for (const m of node.matchAll(/\{\{([^}]+)\}\}/g)) {
        resolvedNames.push(m[1].trim());
      }
      return exampleNode;
    }
    return node;
  }
  if (Array.isArray(node) && Array.isArray(exampleNode)) {
    return node.map((child, i) =>
      backfillBodyFromExample(child, exampleNode[i], resolvedNames),
    );
  }
  const rec = asRecord(node);
  const exampleRec = asRecord(exampleNode);
  if (rec && exampleRec) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(rec)) {
      out[key] = backfillBodyFromExample(child, exampleRec[key], resolvedNames);
    }
    return out;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Item resolution + flatten
// ---------------------------------------------------------------------------

/**
 * Resolve a single request-bearing Postman item to one `ImportedRequest`.
 *
 * Example mining (2026-08-08): after the variable pass, any still-unresolved
 * token is backfilled from the item's best saved example (the exact request as
 * actually sent). Resolution priority is URL variables -> collection variables
 * -> example; a literal-segment divergence between the top-level URL and the
 * example (technically an invalid file) discards the example's path values and
 * the top-level request stands.
 */
function resolveItem(
  itemRecord: Record<string, unknown>,
  request: Record<string, unknown>,
  collectionVars: Record<string, string> = {},
): ImportedRequest {
  const method = (asString(request.method) ?? 'GET').toUpperCase();
  let { path, pathTemplate, unresolvedParams, query } = resolveUrl(
    request.url,
    collectionVars,
  );
  const headers = resolveHeaders(request.header);
  const sourceItemName = asString(itemRecord.name) ?? 'Imported request';

  const example = pickExample(itemRecord.response, method);
  const exampleUrl = example ? resolveUrl(example.originalRequest.url) : null;
  const resolvedNames: string[] = [];
  let exampleVars: Record<string, string> = {};

  // Path params: align the template against the example's concrete path and
  // re-resolve with the example's values at the LOWEST priority (the spread
  // order keeps collection variables — and, inside resolveUrl, URL variables —
  // ahead of the example).
  if (unresolvedParams.length > 0 && exampleUrl) {
    exampleVars = extractExampleParamValues(pathTemplate, exampleUrl.path);
    if (Object.keys(exampleVars).length > 0) {
      const rerun = resolveUrl(request.url, { ...exampleVars, ...collectionVars });
      const nowResolved = unresolvedParams.filter(
        (name) => !rerun.unresolvedParams.includes(name),
      );
      if (nowResolved.length > 0) {
        ({ path, pathTemplate, unresolvedParams, query } = rerun);
        resolvedNames.push(...nowResolved);
      }
    }
  }

  // Query values: substitute known variables, then fall back to the example's
  // same-key value when a token survives.
  const exampleQuery = exampleUrl?.query ?? {};
  for (const [key, rawValue] of Object.entries(query)) {
    if (!rawValue.includes('{{')) continue;
    let next = substituteTokens(rawValue, { ...exampleVars, ...collectionVars });
    if (next.includes('{{')) {
      const fromExample = exampleQuery[key];
      if (fromExample !== undefined && !fromExample.includes('{{')) {
        for (const m of rawValue.matchAll(/\{\{([^}]+)\}\}/g)) {
          resolvedNames.push(m[1].trim());
        }
        next = fromExample;
      }
    }
    if (next !== rawValue) query = { ...query, [key]: next };
  }

  // Body: variables substitute inside the raw text before the JSON parse; a
  // parsed body's surviving tokens backfill from the example body at the same
  // JSON path. A body that only FAILS to parse because of its tokens takes the
  // example body wholesale (`body` provenance) — never a token-free non-JSON
  // body, which stays honestly flagged.
  const bodyResolution = resolveBody(request.body, {
    ...exampleVars,
    ...collectionVars,
  });
  let { body, unsupportedReason } = bodyResolution;
  if (example) {
    const exampleBody = resolveBody(example.originalRequest.body);
    if (exampleBody.unsupportedReason === undefined && exampleBody.body !== null) {
      if (unsupportedReason !== undefined && bodyResolution.hadTokens) {
        body = exampleBody.body;
        unsupportedReason = undefined;
        resolvedNames.push('body');
      } else if (body !== null) {
        body = backfillBodyFromExample(body, exampleBody.body, resolvedNames);
      }
    }
  }

  const result: ImportedRequest = {
    method,
    path,
    query,
    headers,
    body,
    sourceItemName,
  };
  if (unsupportedReason) result.unsupportedReason = unsupportedReason;
  // Additive: only present for parameterised URLs so param-less collections
  // (and their existing consumers/fixtures) are byte-identical.
  if (pathTemplate !== path) result.pathTemplate = pathTemplate;
  if (unresolvedParams.length > 0) result.unresolvedParams = unresolvedParams;
  if (example && resolvedNames.length > 0) {
    result.exampleProvenance = {
      exampleName: example.name,
      resolvedNames: [...new Set(resolvedNames)],
    };
  }
  return result;
}

/**
 * Recurse a Postman `item[]` array, flattening folders and multi-step
 * `sequence` items into a flat ordered `ImportedRequest[]`. Each leaf:
 *   - a request-bearing item (`item.request`) -> one `ImportedRequest`.
 *   - a folder (`item.item[]` array) -> recurse, preserving order.
 *   - a multi-step `sequence` item (`item.sequence.steps[]` /
 *     `item.steps[]`) -> one `ImportedRequest` per step in step order.
 * Items that carry none of the above are skipped (never throw).
 */
function flattenItems(
  rawItems: unknown,
  collectionVars: Record<string, string> = {},
): ImportedRequest[] {
  const out: ImportedRequest[] = [];
  for (const entry of asArray(rawItems)) {
    const item = asRecord(entry);
    if (!item) continue;

    // Folder: recurse the nested item[] in order.
    if (Array.isArray(item.item)) {
      out.push(...flattenItems(item.item, collectionVars));
      continue;
    }

    // Multi-step / sequence item: flatten its steps (each step carries a
    // request) in step order. Support `sequence.steps`, a top-level `steps`,
    // and a bare `request`-less item that nests requests under `steps`.
    const steps = resolveSteps(item);
    if (steps.length > 0) {
      out.push(...flattenSteps(item, steps, collectionVars));
      continue;
    }

    // Ordinary request-bearing item.
    const request = asRecord(item.request);
    if (request) {
      out.push(resolveItem(item, request, collectionVars));
    }
  }
  return out;
}

/**
 * Pull a multi-step item's ordered step records, if any. Supports a
 * `sequence.steps[]` blob (mirroring the export's `sequence_json`) and a
 * top-level `steps[]` array. Steps are sorted by their own `index` when
 * present (stable on ties), matching the export's flatten ordering.
 */
function resolveSteps(item: Record<string, unknown>): Record<string, unknown>[] {
  const sequence = asRecord(item.sequence);
  const rawSteps = sequence?.steps ?? item.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return [];

  const indexed = rawSteps
    .map((rawStep, position) => {
      const step = asRecord(rawStep);
      if (!step) return null;
      const idx = typeof step.index === 'number' ? step.index : position;
      return { step, position, index: idx };
    })
    .filter(
      (s): s is { step: Record<string, unknown>; position: number; index: number } =>
        s !== null,
    );

  indexed.sort((a, b) =>
    a.index !== b.index ? a.index - b.index : a.position - b.position,
  );

  return indexed.map((s) => s.step);
}

/**
 * Flatten an ordered list of step records (from {@link resolveSteps}) to
 * `ImportedRequest[]`. Each step's `request` is resolved; the source name is
 * suffixed with the step's role / index so the staging list is unambiguous.
 */
function flattenSteps(
  item: Record<string, unknown>,
  steps: Record<string, unknown>[],
  collectionVars: Record<string, string> = {},
): ImportedRequest[] {
  const baseName = asString(item.name) ?? 'Imported sequence';
  const out: ImportedRequest[] = [];
  steps.forEach((step, position) => {
    const request = asRecord(step.request);
    if (!request) return;
    const role = asString(step.role);
    const index = typeof step.index === 'number' ? step.index : position;
    const stepRecord: Record<string, unknown> = {
      ...step,
      name: role ? `${baseName} (${role} #${index})` : `${baseName} (#${index})`,
    };
    out.push(resolveItem(stepRecord, request, collectionVars));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Parse a raw Postman Collection v2.1 JSON document into a flat, ordered
 * `ImportedRequest[]`. Pure + fail-soft: a malformed / partial collection
 * yields whatever it can (possibly an empty array) and NEVER throws. Folders
 * and multi-step items are flattened; `{{baseUrl}}` / host is stripped;
 * `application/json` bodies are parsed and everything else is flagged via
 * `unsupportedReason`; all embedded `auth` blocks are ignored.
 *
 * @param collection The parsed collection JSON (a `Record<string, unknown>`, or
 *                   the typed `PostmanCollection`). A non-object input yields an
 *                   empty array.
 */
export function parsePostmanCollection(
  collection: Record<string, unknown> | PostmanCollection | unknown,
): ImportedRequest[] {
  const root = asRecord(collection);
  if (!root) return [];
  // Collection-level variables resolve `{{var}}` path usages (and act as a
  // fallback for `:param` values). `baseUrl` is host-only by convention —
  // never substituted into the path (the leading-token strip handles it).
  const collectionVars = resolveVariableRecord(root.variable);
  delete collectionVars.baseUrl;
  return flattenItems(root.item, collectionVars);
}

export default parsePostmanCollection;
