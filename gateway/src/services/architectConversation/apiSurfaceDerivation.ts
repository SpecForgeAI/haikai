/**
 * Deterministic Group B API-surface derivation (gold standard 2026-08-08).
 *
 * CLOSES the CONV.07 known-open: the API like-for-like lock needs the six
 * derived Group B values (api.protocol, api.versioning, api.contractFormat,
 * api.auth, api.errorContract, api.rateLimiting), but the API Behaviour
 * Baseline stores RAW HTTP samples — nothing derived them, so the lock
 * permanently degraded to asking the questions. This module derives them
 * DETERMINISTICALLY from the captured samples (no LLM, no new AMS endpoint):
 * each value is an OBSERVATION over the baseline items with counted evidence
 * and provenance the captured-decision envelope carries verbatim.
 *
 * Honesty rules (the load-bearing part):
 *   - A value is emitted ONLY on positive observation. Absence of evidence
 *     never locks a claim that depends on capture completeness — auth and
 *     rate limiting are OMITTED when nothing was observed (the harness may
 *     inject auth out-of-band; limits may not trip under capture load), so
 *     those questions are still ASKED rather than answered wrong.
 *   - Versioning is the one deliberate exception: a version scheme is a
 *     property of the captured paths/headers themselves, so "unversioned"
 *     IS a positive observation over the full operation set.
 *   - Error contract derives only from actually-captured 4xx/5xx samples;
 *     none captured => omitted.
 *   - Every value's sourceQuote states the evidence counts so a reviewer can
 *     judge the lock's basis at a glance.
 */

import type { SourceContractValue } from './apiSurfaceLock';

/** The baseline-item subset the deriver reads (snake_case AMS wire). */
export interface BaselineItemForDerivation {
  method?: string | null;
  path?: string | null;
  request_json?: {
    query?: Record<string, unknown> | null;
    headers?: Record<string, unknown> | null;
    body?: unknown;
  } | null;
  response_status?: number | null;
  response_json?: {
    headers?: Record<string, unknown> | null;
    body?: unknown;
  } | null;
}

export interface DerivationResult {
  values: Record<string, SourceContractValue>;
  /** Codes NOT derived, each with the honest reason (logged; question asked). */
  omitted: Array<{ code: string; reason: string }>;
  itemCount: number;
}

function lowerKeys(obj: Record<string, unknown> | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(obj ?? {})) {
    out.set(k.toLowerCase(), typeof v === 'string' ? v : String(v ?? ''));
  }
  return out;
}

function value(v: string, quote: string, baselineId: string): SourceContractValue {
  return {
    value: v,
    sourceQuote: quote,
    sourceFile: `api-behaviour-baseline:${baselineId}`,
  };
}

/**
 * Derive the six Group B values from the baseline's captured items. Pure and
 * deterministic — same items, same values.
 */
export function deriveGroupBValues(
  items: BaselineItemForDerivation[],
  baselineId: string
): DerivationResult {
  const values: Record<string, SourceContractValue> = {};
  const omitted: Array<{ code: string; reason: string }> = [];
  const total = items.length;
  if (total === 0) {
    for (const code of [
      'api.protocol',
      'api.versioning',
      'api.contractFormat',
      'api.auth',
      'api.errorContract',
      'api.rateLimiting',
    ]) {
      omitted.push({ code, reason: 'the baseline has no captured items to observe' });
    }
    return { values, omitted, itemCount: 0 };
  }

  // ---- shared scans -------------------------------------------------------
  let jsonResponses = 0;
  let xmlResponses = 0;
  let problemJson = 0;
  const authSchemes = new Map<string, number>();
  let rateLimitHeaderOps = 0;
  const rateLimitHeaderNames = new Set<string>();
  let pathVersioned = 0;
  let headerVersioned = 0;
  let queryVersioned = 0;
  const versionSegments = new Set<string>();
  const errorSamples: BaselineItemForDerivation[] = [];

  for (const item of items) {
    const respHeaders = lowerKeys(item.response_json?.headers ?? null);
    const reqHeaders = lowerKeys(item.request_json?.headers ?? null);
    const contentType = respHeaders.get('content-type') ?? '';

    if (contentType.includes('json')) jsonResponses++;
    if (contentType.includes('xml')) xmlResponses++;
    if (contentType.includes('problem+json')) problemJson++;

    const auth = reqHeaders.get('authorization') ?? '';
    if (auth.toLowerCase().startsWith('bearer')) {
      authSchemes.set('Bearer token (Authorization: Bearer)', (authSchemes.get('Bearer token (Authorization: Bearer)') ?? 0) + 1);
    } else if (auth.toLowerCase().startsWith('basic')) {
      authSchemes.set('HTTP Basic (Authorization: Basic)', (authSchemes.get('HTTP Basic (Authorization: Basic)') ?? 0) + 1);
    } else if (auth.trim() !== '') {
      authSchemes.set(`Authorization header (scheme: ${auth.split(' ')[0]})`, (authSchemes.get(`Authorization header (scheme: ${auth.split(' ')[0]})`) ?? 0) + 1);
    }
    for (const key of reqHeaders.keys()) {
      if (key === 'x-api-key' || key === 'api-key' || key === 'apikey') {
        authSchemes.set(`API key header (${key})`, (authSchemes.get(`API key header (${key})`) ?? 0) + 1);
      }
    }

    let sawRateLimit = false;
    for (const key of respHeaders.keys()) {
      if (key.startsWith('x-ratelimit') || key.startsWith('ratelimit') || key === 'retry-after') {
        rateLimitHeaderNames.add(key);
        sawRateLimit = true;
      }
    }
    if (sawRateLimit) rateLimitHeaderOps++;

    const path = item.path ?? '';
    const seg = /(?:^|\/)(v\d+)(?:\/|$)/i.exec(path);
    if (seg) {
      pathVersioned++;
      versionSegments.add(seg[1].toLowerCase());
    }
    for (const key of reqHeaders.keys()) {
      if (key === 'accept-version' || key === 'api-version' || key === 'x-api-version') {
        headerVersioned++;
        break;
      }
    }
    const query = item.request_json?.query ?? null;
    if (query && Object.keys(query).some((k) => /^(api[-_]?version|version)$/i.test(k))) {
      queryVersioned++;
    }

    const status = item.response_status ?? 0;
    if (status >= 400) errorSamples.push(item);
  }

  // ---- api.protocol -------------------------------------------------------
  if (jsonResponses > 0 || xmlResponses > 0) {
    const payloads =
      jsonResponses > 0 && xmlResponses > 0
        ? 'JSON + XML payloads'
        : xmlResponses > 0
          ? 'XML payloads'
          : 'JSON payloads';
    values['api.protocol'] = value(
      `REST over HTTP with ${payloads}`,
      `Observed on the captured baseline: ${jsonResponses}/${total} operation(s) returned JSON, ` +
        `${xmlResponses}/${total} XML (response Content-Type).`,
      baselineId
    );
  } else {
    omitted.push({
      code: 'api.protocol',
      reason: 'no response Content-Type observed on any captured item',
    });
  }

  // ---- api.contractFormat -------------------------------------------------
  if (jsonResponses > 0 || xmlResponses > 0) {
    const fmt =
      jsonResponses > 0 && xmlResponses > 0
        ? 'Mixed JSON + XML'
        : xmlResponses > 0
          ? 'XML'
          : 'JSON';
    values['api.contractFormat'] = value(
      fmt,
      `Response Content-Type across the baseline: JSON on ${jsonResponses}/${total}, ` +
        `XML on ${xmlResponses}/${total} operation(s).`,
      baselineId
    );
  } else {
    omitted.push({
      code: 'api.contractFormat',
      reason: 'no response Content-Type observed on any captured item',
    });
  }

  // ---- api.versioning (positive observation either way) -------------------
  if (pathVersioned > 0) {
    values['api.versioning'] = value(
      `URL-path versioning (${[...versionSegments].sort().join(', ')})`,
      `Version segment observed in ${pathVersioned}/${total} captured path(s).`,
      baselineId
    );
  } else if (headerVersioned > 0) {
    values['api.versioning'] = value(
      'Header-based versioning',
      `Version header observed on ${headerVersioned}/${total} captured request(s).`,
      baselineId
    );
  } else if (queryVersioned > 0) {
    values['api.versioning'] = value(
      'Query-parameter versioning',
      `Version query parameter observed on ${queryVersioned}/${total} captured request(s).`,
      baselineId
    );
  } else {
    values['api.versioning'] = value(
      'Unversioned (no version scheme in the captured surface)',
      `No version path segment, header, or query parameter on any of the ${total} captured operation(s).`,
      baselineId
    );
  }

  // ---- api.auth (positive observation ONLY) -------------------------------
  if (authSchemes.size > 0) {
    const ranked = [...authSchemes.entries()].sort((a, b) => b[1] - a[1]);
    values['api.auth'] = value(
      ranked.map(([scheme]) => scheme).join('; '),
      ranked.map(([scheme, n]) => `${scheme} on ${n}/${total} request(s)`).join('; ') + '.',
      baselineId
    );
  } else {
    omitted.push({
      code: 'api.auth',
      reason:
        'no auth headers observed on captured requests — the capture harness may ' +
        'inject auth out-of-band, so "no auth" is never locked from absence',
    });
  }

  // ---- api.errorContract (only from captured 4xx/5xx) ---------------------
  if (errorSamples.length > 0) {
    if (problemJson > 0) {
      values['api.errorContract'] = value(
        'RFC 7807 problem+json',
        `application/problem+json observed on ${problemJson} captured response(s) ` +
          `(${errorSamples.length} error sample(s) in the baseline).`,
        baselineId
      );
    } else {
      const keySets = new Set<string>();
      for (const s of errorSamples) {
        const body = s.response_json?.body;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          keySets.add(
            Object.keys(body as Record<string, unknown>)
              .sort()
              .slice(0, 5)
              .join(',')
          );
        }
      }
      if (keySets.size > 0) {
        values['api.errorContract'] = value(
          `Custom JSON error envelope (keys: ${[...keySets].sort().join(' | ')})`,
          `Derived from ${errorSamples.length} captured 4xx/5xx sample(s).`,
          baselineId
        );
      } else {
        omitted.push({
          code: 'api.errorContract',
          reason: `${errorSamples.length} error sample(s) captured but none carried a structured JSON body`,
        });
      }
    }
  } else {
    omitted.push({
      code: 'api.errorContract',
      reason: 'no 4xx/5xx samples in the baseline — the error contract was never observed',
    });
  }

  // ---- api.rateLimiting (positive observation ONLY) -----------------------
  if (rateLimitHeaderOps > 0) {
    values['api.rateLimiting'] = value(
      `Header-signalled rate limiting (${[...rateLimitHeaderNames].sort().join(', ')})`,
      `Rate-limit headers observed on ${rateLimitHeaderOps}/${total} captured response(s).`,
      baselineId
    );
  } else {
    omitted.push({
      code: 'api.rateLimiting',
      reason:
        'no rate-limit headers observed — limits may exist without tripping under ' +
        'capture load, so "none" is never locked from absence',
    });
  }

  return { values, omitted, itemCount: total };
}
