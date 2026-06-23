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

/**
 * Resolve a Postman item's URL down to a `{ path, query }` pair, dropping any
 * `{{baseUrl}}` / host. The URL may be a structured `PostmanUrl` object OR a
 * raw string (Postman allows both); both are handled defensively.
 *
 * Path normalisation: the segments are joined with a single leading slash
 * (`/a/b`); an empty path resolves to `/`. Query duplicate keys: last wins.
 */
function resolveUrl(rawUrl: unknown): {
  path: string;
  query: Record<string, string>;
} {
  // String form: parse off the query string, then strip a leading host/scheme
  // and any `{{baseUrl}}` token.
  if (typeof rawUrl === 'string') {
    return resolveUrlString(rawUrl);
  }

  const url = asRecord(rawUrl);
  if (!url) return { path: '/', query: {} };

  // Prefer the structured `path` array; fall back to parsing `raw`.
  const pathSegments = asArray(url.path)
    .map((seg) => asString(seg))
    .filter((seg): seg is string => seg !== null && seg.length > 0)
    .filter((seg) => !isVariableSegment(seg));

  let path: string;
  if (pathSegments.length > 0) {
    path = `/${pathSegments.join('/')}`;
  } else if (typeof url.raw === 'string') {
    // No usable path array -- recover the path from the raw string.
    path = resolveUrlString(url.raw).path;
  } else {
    path = '/';
  }

  const query: Record<string, string> = {};
  for (const entry of asArray(url.query)) {
    const q = asRecord(entry);
    if (!q) continue;
    const key = asString(q.key);
    if (key === null || key.length === 0) continue;
    query[key] = valueToString(q.value);
  }

  return { path, query };
}

/**
 * Resolve a raw URL string to `{ path, query }`: strip scheme + host (and any
 * leading `{{baseUrl}}`), keep the path and parse the query string. Fail-soft:
 * an unparseable string yields `{ path: '/', query: {} }`.
 */
function resolveUrlString(raw: string): {
  path: string;
  query: Record<string, string>;
} {
  let s = raw.trim();
  if (!s) return { path: '/', query: {} };

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
    .filter((seg) => seg.length > 0)
    .filter((seg) => !isVariableSegment(seg));
  const path = segments.length > 0 ? `/${segments.join('/')}` : '/';

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

  return { path, query };
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
 */
function resolveBody(rawBody: unknown): {
  body: unknown;
  unsupportedReason?: string;
} {
  const body = asRecord(rawBody);
  if (!body) return { body: null };

  const mode = asString(body.mode);

  // No mode at all and no raw text -> treat as bodiless.
  if (mode === null && body.raw === undefined) return { body: null };

  if (mode !== null && mode !== 'raw') {
    // formdata / urlencoded / file / graphql -- explicitly unsupported in v1.
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON };
  }

  const raw = asString(body.raw);
  if (raw === null || raw.trim().length === 0) {
    // A `raw` mode with no text is effectively bodiless.
    return { body: null };
  }

  // Honour an explicit non-JSON language hint.
  const options = asRecord(body.options);
  const rawOptions = asRecord(options?.raw);
  const language = asString(rawOptions?.language);
  if (language !== null && language !== 'json') {
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON };
  }

  // Parse the raw text as JSON; non-JSON raw text is flagged, never sent.
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { body: null, unsupportedReason: NON_JSON_BODY_REASON };
  }
}

// ---------------------------------------------------------------------------
// Item resolution + flatten
// ---------------------------------------------------------------------------

/** Resolve a single request-bearing Postman item to one `ImportedRequest`. */
function resolveItem(
  itemRecord: Record<string, unknown>,
  request: Record<string, unknown>,
): ImportedRequest {
  const method = (asString(request.method) ?? 'GET').toUpperCase();
  const { path, query } = resolveUrl(request.url);
  const headers = resolveHeaders(request.header);
  const { body, unsupportedReason } = resolveBody(request.body);
  const sourceItemName = asString(itemRecord.name) ?? 'Imported request';

  const result: ImportedRequest = {
    method,
    path,
    query,
    headers,
    body,
    sourceItemName,
  };
  if (unsupportedReason) result.unsupportedReason = unsupportedReason;
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
function flattenItems(rawItems: unknown): ImportedRequest[] {
  const out: ImportedRequest[] = [];
  for (const entry of asArray(rawItems)) {
    const item = asRecord(entry);
    if (!item) continue;

    // Folder: recurse the nested item[] in order.
    if (Array.isArray(item.item)) {
      out.push(...flattenItems(item.item));
      continue;
    }

    // Multi-step / sequence item: flatten its steps (each step carries a
    // request) in step order. Support `sequence.steps`, a top-level `steps`,
    // and a bare `request`-less item that nests requests under `steps`.
    const steps = resolveSteps(item);
    if (steps.length > 0) {
      out.push(...flattenSteps(item, steps));
      continue;
    }

    // Ordinary request-bearing item.
    const request = asRecord(item.request);
    if (request) {
      out.push(resolveItem(item, request));
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
    out.push(resolveItem(stepRecord, request));
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
  return flattenItems(root.item);
}

export default parsePostmanCollection;
