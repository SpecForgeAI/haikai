/**
 * Postman Collection v2.1 export for API Behaviour baselines (pure frontend).
 *
 * Spec: 2026-06-20 Baseline Save & Review -- Batch + Activate + Export, R6
 * (Task Group 7).
 *
 * Maps an `ApiBehaviourBaselineItemDto[]` to a Postman Collection v2.1 JSON
 * document. This is a PURE function -- no fetch, no DOM, no server round-trip.
 * The caller (`BaselineDetailView`, Task Group 6) is responsible for the
 * download (via `utils/fileOperations.ts` `triggerDownload` + `sanitizeFilename`)
 * and for the fail-soft `{{baseUrl}}` prefill from
 * `getCaptureSession(...).api_base_url`.
 *
 * Mapping rules (R6 / requirements Q7):
 *   - One Postman request per baseline item: `method`; URL `{{baseUrl}}{path}`
 *     with query parsed from `request_json.query`; headers from
 *     `request_json.headers`; body = `request_json.body` as raw JSON.
 *   - One saved RESPONSE EXAMPLE per item from `response_json` ({headers, body})
 *     with `code = response_status` and name `"<scenario_name> (<status>)"`.
 *   - `sequence_json` multi-step items FLATTEN their `steps[]` into ordered
 *     SEPARATE requests named `"<scenario> -- <role> #<index>"` (setup -> act
 *     -> cleanup order, by each step's own `index`). Inter-step `response_refs`
 *     are preserved as DESCRIPTION NOTES on the request -- deliberately NOT
 *     generated `pm.*` scripts.
 *   - A single `{{baseUrl}}` collection variable, value = the passed `baseUrl`
 *     (blank string when omitted / unavailable).
 *
 * The raw `request_json` / `response_json` / `sequence_json` blobs are read
 * DEFENSIVELY (loose Record): a malformed / partial item degrades gracefully
 * (skipped fields, never a throw), mirroring `BaselineSequenceView`'s
 * `parseSequenceJson`.
 */

import type { ApiBehaviourBaselineItemDto } from '../api/apiBehaviourClient';

// ---------------------------------------------------------------------------
// Postman Collection v2.1 minimal type surface
// (https://schema.getpostman.com/json/collection/v2.1.0/collection.json)
// Only the subset this exporter emits is typed.
// ---------------------------------------------------------------------------

/** The canonical v2.1 schema URL stamped into `info.schema`. */
export const POSTMAN_SCHEMA_V21 =
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/**
 * The em-dash separator used in flattened sequence request names
 * (`"<scenario> {EM_DASH} <role> #<index>"`). Built from its code point so the
 * source file stays pure ASCII and cannot be corrupted into mojibake on disk.
 */
const EM_DASH = String.fromCharCode(0x2014);

export interface PostmanCollectionInfo {
  name: string;
  schema: string;
  _postman_id?: string;
  description?: string;
}

export interface PostmanVariable {
  key: string;
  value: string;
  type?: string;
}

export interface PostmanHeader {
  key: string;
  value: string;
}

export interface PostmanQueryParam {
  key: string;
  value: string;
}

export interface PostmanUrl {
  raw: string;
  host: string[];
  path: string[];
  query?: PostmanQueryParam[];
}

export interface PostmanBody {
  mode: 'raw';
  raw: string;
  options?: { raw: { language: 'json' } };
}

export interface PostmanRequest {
  method: string;
  header: PostmanHeader[];
  url: PostmanUrl;
  body?: PostmanBody;
  description?: string;
}

export interface PostmanResponse {
  name: string;
  code: number;
  status?: string;
  header: PostmanHeader[];
  body: string;
  _postman_previewlanguage?: 'json' | 'text';
  originalRequest?: PostmanRequest;
}

export interface PostmanItem {
  name: string;
  request: PostmanRequest;
  response: PostmanResponse[];
  description?: string;
}

export interface PostmanCollection {
  info: PostmanCollectionInfo;
  item: PostmanItem[];
  variable: PostmanVariable[];
}

// ---------------------------------------------------------------------------
// Defensive narrowing helpers (mirror BaselineSequenceView.parseSequenceJson)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Render an arbitrary header-value to a string (objects -> JSON, null -> ''). */
function headerValueToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Render an arbitrary query-value to a string (mirrors header rendering). */
function queryValueToString(v: unknown): string {
  return headerValueToString(v);
}

/**
 * Map a `{ name: value }` header record to Postman's `[{ key, value }]` list.
 * A null / non-object input yields an empty list. Object/array values are
 * JSON-stringified; null values become an empty string.
 */
function toPostmanHeaders(raw: unknown): PostmanHeader[] {
  const rec = asRecord(raw);
  if (!rec) return [];
  return Object.keys(rec).map((key) => ({
    key,
    value: headerValueToString(rec[key]),
  }));
}

/**
 * Map a `{ name: value }` query record to Postman's `[{ key, value }]` list.
 * Same defensive shape as {@link toPostmanHeaders}.
 */
function toPostmanQuery(raw: unknown): PostmanQueryParam[] {
  const rec = asRecord(raw);
  if (!rec) return [];
  return Object.keys(rec).map((key) => ({
    key,
    value: queryValueToString(rec[key]),
  }));
}

/** Split a `path` string into Postman's path-segment array (drops a leading '/'). */
function toPathSegments(path: string | null | undefined): string[] {
  const p = (path ?? '').trim();
  if (!p || p === '/') return [];
  // Strip a single leading slash, then split on '/'; keep interior empties out.
  const trimmed = p.startsWith('/') ? p.slice(1) : p;
  return trimmed.split('/').filter((seg) => seg.length > 0);
}

/**
 * Build a Postman URL object for `{{baseUrl}}{path}` + query. `host` is always
 * the single `{{baseUrl}}` variable token; `path` is the split path segments;
 * `query` is included only when non-empty. `raw` reconstructs the full URL
 * string with the query suffix so Postman renders it directly.
 */
function buildUrl(
  path: string | null | undefined,
  query: PostmanQueryParam[],
): PostmanUrl {
  const segments = toPathSegments(path);
  const pathPart = segments.length > 0 ? `/${segments.join('/')}` : '';
  const queryString =
    query.length > 0
      ? '?' +
        query
          .map(
            (q) =>
              `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`,
          )
          .join('&')
      : '';
  const url: PostmanUrl = {
    raw: `{{baseUrl}}${pathPart}${queryString}`,
    host: ['{{baseUrl}}'],
    path: segments,
  };
  if (query.length > 0) url.query = query;
  return url;
}

/**
 * Serialise a request/response body value to a raw JSON string. A string body
 * is passed through verbatim (it is likely already raw text/JSON); everything
 * else is `JSON.stringify`-ed with 2-space indent. `null` / `undefined` yields
 * an empty string so the caller can decide whether to attach a body block.
 */
function bodyToRaw(body: unknown): string {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return '';
  }
}

/** Build a raw-JSON Postman body block, or undefined when there is no body. */
function buildBody(body: unknown): PostmanBody | undefined {
  const raw = bodyToRaw(body);
  if (!raw) return undefined;
  return { mode: 'raw', raw, options: { raw: { language: 'json' } } };
}

/**
 * Build the single saved response EXAMPLE for a baseline item from its
 * `response_json` ({headers, body}) and `response_status`. Name is
 * `"<scenario_name> (<status>)"` (scenario falls back to "Response", status to
 * 0). `_postman_previewlanguage` is `json` so Postman pretty-prints the body.
 */
function buildResponseExample(
  item: ApiBehaviourBaselineItemDto,
  originalRequest: PostmanRequest,
  scenarioName: string,
): PostmanResponse {
  const responseJson = asRecord(item.response_json);
  const status = asNumber(item.response_status) ?? 0;
  const headers = toPostmanHeaders(responseJson?.headers);
  const bodyRaw = bodyToRaw(responseJson?.body);
  return {
    name: `${scenarioName} (${status})`,
    code: status,
    header: headers,
    body: bodyRaw,
    _postman_previewlanguage: 'json',
    originalRequest,
  };
}

/**
 * Build a single-shot Postman item from a baseline item's top-level
 * `request_json` ({query, headers, body}) / `response_json` envelope. Used for
 * every item that is NOT a multi-step sequence.
 */
function buildSingleShotItem(
  item: ApiBehaviourBaselineItemDto,
): PostmanItem {
  const requestJson = asRecord(item.request_json);
  const method = (asString(item.method) ?? 'GET').toUpperCase();
  const scenarioName = asString(item.scenario_name) ?? 'Response';

  const header = toPostmanHeaders(requestJson?.headers);
  const query = toPostmanQuery(requestJson?.query);
  const url = buildUrl(item.path, query);
  const body = buildBody(requestJson?.body);

  const request: PostmanRequest = { method, header, url };
  if (body) request.body = body;

  const response = buildResponseExample(item, request, scenarioName);

  return {
    name: scenarioName,
    request,
    response: [response],
  };
}

/**
 * Format a step's `response_refs` into a human-readable description note. Each
 * ref reads `$<from_step>.<json_path>` (falling back to the raw `ref` string).
 * Returns an empty string when there are no refs.
 */
function refsToDescription(refsRaw: unknown): string {
  if (!Array.isArray(refsRaw) || refsRaw.length === 0) return '';
  const lines: string[] = [];
  for (const r of refsRaw) {
    const ref = asRecord(r);
    if (!ref) continue;
    const refStr = asString(ref.ref);
    const fromStep = asNumber(ref.from_step);
    const jsonPath = asString(ref.json_path);
    if (refStr) {
      const detail =
        fromStep !== null && jsonPath
          ? ` (from step ${fromStep}, path ${jsonPath})`
          : '';
      lines.push(`- ${refStr}${detail}`);
    } else if (fromStep !== null && jsonPath) {
      lines.push(`- $${fromStep}.${jsonPath}`);
    }
  }
  if (lines.length === 0) return '';
  return ['Inter-step references (resolved at replay):', ...lines].join('\n');
}

/**
 * Flatten a sequence item's `sequence_json.steps[]` into ordered Postman items
 * (one request per step), named `"<scenario> {EM_DASH} <role> #<index>"`. Steps
 * are sorted by their own `index` so the natural setup -> act -> cleanup order
 * is preserved regardless of array order. Each step's `response_refs` are
 * carried as DESCRIPTION NOTES (NOT generated `pm.*` scripts). Returns an empty
 * array when the blob has no usable steps (the caller then falls back to a
 * single-shot item).
 */
function flattenSequenceItems(
  item: ApiBehaviourBaselineItemDto,
): PostmanItem[] {
  const root = asRecord(item.sequence_json);
  if (!root) return [];
  const rawSteps = root.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return [];

  const scenarioName = asString(item.scenario_name) ?? 'Sequence';

  const indexed = rawSteps
    .map((rawStep, position) => {
      const step = asRecord(rawStep);
      if (!step) return null;
      return { step, position, index: asNumber(step.index) ?? position };
    })
    .filter(
      (s): s is { step: Record<string, unknown>; position: number; index: number } =>
        s !== null,
    );

  if (indexed.length === 0) return [];

  // Stable sort by the step's own `index` (ties keep original array order).
  indexed.sort((a, b) =>
    a.index !== b.index ? a.index - b.index : a.position - b.position,
  );

  return indexed.map(({ step, index }) => {
    const role = asString(step.role) ?? 'act';
    const request = asRecord(step.request);
    const method = (asString(request?.method) ?? 'GET').toUpperCase();
    const header = toPostmanHeaders(request?.headers);
    const query = toPostmanQuery(request?.query);
    const url = buildUrl(asString(request?.path), query);
    const body = buildBody(request?.body);

    const postmanRequest: PostmanRequest = { method, header, url };
    if (body) postmanRequest.body = body;

    const description = refsToDescription(step.response_refs);
    if (description) postmanRequest.description = description;

    const postmanItem: PostmanItem = {
      name: `${scenarioName} ${EM_DASH} ${role} #${index}`,
      request: postmanRequest,
      response: [],
    };
    if (description) postmanItem.description = description;
    return postmanItem;
  });
}

/**
 * Map a single baseline item to one-or-more Postman items: a sequence item
 * flattens to its ordered steps; everything else maps to one single-shot item.
 */
function itemToPostmanItems(
  item: ApiBehaviourBaselineItemDto,
): PostmanItem[] {
  const flattened = flattenSequenceItems(item);
  if (flattened.length > 0) return flattened;
  return [buildSingleShotItem(item)];
}

/**
 * Build a Postman Collection v2.1 JSON document from a baseline's items.
 *
 * @param name    Collection name (typically the baseline name; falls back to a
 *                generic label when blank).
 * @param items   The baseline's `ApiBehaviourBaselineItemDto[]`.
 * @param baseUrl Optional value for the `{{baseUrl}}` collection variable
 *                (fail-soft prefilled by the caller from the capture session's
 *                `api_base_url`; blank string when omitted / unavailable).
 * @returns       A `PostmanCollection` ready to `JSON.stringify` + download.
 */
export function baselineToPostmanCollection(
  name: string,
  items: ApiBehaviourBaselineItemDto[],
  baseUrl?: string,
): PostmanCollection {
  const safeItems = Array.isArray(items) ? items : [];
  const postmanItems = safeItems.flatMap(itemToPostmanItems);

  return {
    info: {
      name: name && name.trim() ? name : 'API Behaviour Baseline',
      schema: POSTMAN_SCHEMA_V21,
    },
    item: postmanItems,
    variable: [
      {
        key: 'baseUrl',
        value: baseUrl ?? '',
        type: 'string',
      },
    ],
  };
}

export default baselineToPostmanCollection;
