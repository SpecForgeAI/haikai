/**
 * Coverage Closure — Pass C Postman round-trip EXPORT (Spec 2026-07-20, CC4).
 *
 * Download EVERY endpoint of a capture session as a Postman v2.1 collection so
 * the user can fix the uncovered tail in a tool where they can actually run the
 * requests, then re-upload (the existing Postman import re-attempts only the
 * uncovered ones via delta subtraction):
 *
 *   - COVERED endpoints carry their PROVEN working request (the 2xx capture) as
 *     a reference example — 95% of the collection is known-good, sitting beside
 *     the broken 5% so the user can compare.
 *   - UNCOVERED endpoints carry their LAST-ATTEMPTED request pre-filled and a
 *     description annotated with the failure diagnosis (last status + reason),
 *     so the user knows exactly what to fix.
 *
 * Auth is emitted as collection-level bearer using a `{{bearerToken}}`
 * PLACEHOLDER variable, and any Authorization/api-key request headers are
 * dropped — an exported collection must NEVER carry a real secret (the capture
 * request headers are already redacted, but this is belt-and-braces).
 *
 * Pure + unit-tested: capture resolution and collection assembly are I/O-free.
 */

/** A capture row (subset) the exporter reads. snake_case wire off the session. */
export interface ExportCapture {
  operation_id: string;
  request_method: string | null;
  request_path: string | null;
  request_query_json: Record<string, unknown> | null;
  request_headers_redacted_json: Record<string, unknown> | null;
  request_body_json: Record<string, unknown> | null;
  response_status: number | null;
  captured_at?: string | null;
}

/** An endpoint to export, with its covered/uncovered status + best request. */
export interface PostmanSource {
  operation_id: string;
  method: string;
  path: string;
  covered: boolean;
  /** Diagnosis for the uncovered ones (last status + reason); null when covered. */
  diagnosis: string | null;
  /** The request to seed the item (proven 2xx for covered, last for uncovered). */
  request: {
    method: string;
    path: string;
    query: Record<string, unknown> | null;
    headers: Record<string, unknown> | null;
    body: Record<string, unknown> | null;
  } | null;
}

/** The gate shape the resolver needs (mirrors the service gate). */
export interface GateLike {
  unresolved: Array<{ operation_id: string; method: string; path: string; reason: string }>;
}

/** An included endpoint (method/path) from the coverage summary. */
export interface IncludedEndpoint {
  operation_id: string;
  method: string;
  path: string;
}

const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'cookie',
]);

function isHappy(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/**
 * Choose the best capture per endpoint: for a COVERED endpoint the most recent
 * 2xx (the proven request); for an UNCOVERED endpoint the most recent attempt
 * (whatever the user last tried). Pure.
 */
export function resolvePostmanSources(
  included: ReadonlyArray<IncludedEndpoint>,
  captures: ReadonlyArray<ExportCapture>,
  gate: GateLike,
): PostmanSource[] {
  const unresolvedById = new Map(gate.unresolved.map((u) => [u.operation_id, u]));
  const byOp = new Map<string, ExportCapture[]>();
  for (const c of captures) {
    const list = byOp.get(c.operation_id) ?? [];
    list.push(c);
    byOp.set(c.operation_id, list);
  }
  // Stable "most recent" = last in captured_at order (fallback: input order).
  const mostRecent = (list: ExportCapture[], predicate: (c: ExportCapture) => boolean) => {
    let chosen: ExportCapture | null = null;
    for (const c of list) {
      if (!predicate(c)) continue;
      if (!chosen) {
        chosen = c;
      } else {
        const a = c.captured_at ?? '';
        const b = chosen.captured_at ?? '';
        if (a >= b) chosen = c;
      }
    }
    return chosen;
  };

  return included.map((ep) => {
    const unresolved = unresolvedById.get(ep.operation_id);
    const covered = !unresolved;
    const list = byOp.get(ep.operation_id) ?? [];
    const cap = covered
      ? mostRecent(list, (c) => isHappy(c.response_status)) ?? mostRecent(list, () => true)
      : mostRecent(list, () => true);
    return {
      operation_id: ep.operation_id,
      method: ep.method,
      path: ep.path,
      covered,
      diagnosis: covered
        ? null
        : `last status ${unresolved ? cap?.response_status ?? 'none' : 'none'} — ${unresolved?.reason ?? 'not captured'}`,
      request: cap
        ? {
            method: cap.request_method ?? ep.method,
            path: cap.request_path ?? ep.path,
            query: cap.request_query_json,
            headers: cap.request_headers_redacted_json,
            body: cap.request_body_json,
          }
        : null,
    };
  });
}

interface PostmanHeader {
  key: string;
  value: string;
}

function toPostmanHeaders(headers: Record<string, unknown> | null): PostmanHeader[] {
  if (!headers) return [];
  return Object.entries(headers)
    .filter(([k]) => !AUTH_HEADER_NAMES.has(k.toLowerCase()))
    .map(([key, value]) => ({ key, value: String(value ?? '') }));
}

function toPostmanUrl(path: string, query: Record<string, unknown> | null) {
  const [rawPath] = path.split('?');
  const segments = rawPath.split('/').filter(Boolean);
  const queryParams = query
    ? Object.entries(query).map(([key, value]) => ({ key, value: String(value ?? '') }))
    : [];
  return {
    raw: `{{baseUrl}}${path.startsWith('/') ? path : `/${path}`}`,
    host: ['{{baseUrl}}'],
    path: segments,
    ...(queryParams.length > 0 ? { query: queryParams } : {}),
  };
}

function toPostmanItem(source: PostmanSource) {
  const req = source.request;
  const description = source.covered
    ? `✓ Covered — proven working request (reference example).`
    : `⚠ Uncovered — ${source.diagnosis}. Fix the request here (you can run it), then re-upload to re-attempt only the uncovered endpoints.`;
  const body =
    req && req.body != null
      ? {
          mode: 'raw' as const,
          raw: JSON.stringify(req.body, null, 2),
          options: { raw: { language: 'json' } },
        }
      : undefined;
  return {
    name: `${(source.method || '').toUpperCase()} ${source.path}`,
    request: {
      method: (req?.method ?? source.method ?? 'GET').toUpperCase(),
      header: toPostmanHeaders(req?.headers ?? null),
      url: toPostmanUrl(req?.path ?? source.path, req?.query ?? null),
      ...(body ? { body } : {}),
      description,
    },
  };
}

export interface PostmanCollection {
  info: { name: string; schema: string };
  auth: { type: 'bearer'; bearer: Array<{ key: string; value: string; type: string }> };
  variable: Array<{ key: string; value: string }>;
  item: Array<{ name: string; item: ReturnType<typeof toPostmanItem>[] }>;
}

/**
 * Assemble the Postman v2.1 collection from the resolved sources. Two folders
 * ("Covered (reference examples)", "Uncovered (fix these)"); collection-level
 * bearer auth with a placeholder token; a `baseUrl` variable. Pure.
 */
export function buildPostmanCollection(
  collectionName: string,
  baseUrl: string,
  sources: ReadonlyArray<PostmanSource>,
): PostmanCollection {
  const covered = sources.filter((s) => s.covered).map(toPostmanItem);
  const uncovered = sources.filter((s) => !s.covered).map(toPostmanItem);
  return {
    info: {
      name: collectionName,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{bearerToken}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: baseUrl },
      { key: 'bearerToken', value: '<paste your token here — never commit real secrets>' },
    ],
    item: [
      { name: 'Uncovered (fix these)', item: uncovered },
      { name: 'Covered (reference examples)', item: covered },
    ],
  };
}
