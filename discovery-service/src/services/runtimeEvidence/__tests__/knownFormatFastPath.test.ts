/**
 * Task Group 3 — Known-format fast path (richness-gated).
 *
 * Pins the load-bearing behaviours from tasks.md 3.1:
 *   1. Rich JSON-lines (method + path + headers + body + response status/body)
 *      PASSES the richness gate -> deterministic structured extraction is used.
 *   2. Thin CLF (method + path + status only, no bodies/responses) FAILS the
 *      gate -> signals "fall through to LLM".
 *   3. The richness predicate itself classifies a record rich vs thin given a
 *      known field map.
 *
 * Plus two guards: a method+path-only JSON-lines log is THIN (never force-fit
 * to rich), and a nested `{ request, response }` JSON shape is extracted.
 */

import {
  tryKnownFormatFastPathContent,
  classifyRecordRichness,
  RICHNESS_ACCEPT_FRACTION,
  type RecordFieldPresence,
} from '../knownFormatFastPath';

/** A fully-present field map (everything logged). */
function richPresence(over: Partial<RecordFieldPresence> = {}): RecordFieldPresence {
  return {
    hasMethod: true,
    hasPath: true,
    hasRequestHeaders: true,
    hasRequestBody: true,
    hasResponseStatus: true,
    hasResponseBody: true,
    ...over,
  };
}

describe('knownFormatFastPath — richness predicate', () => {
  it('classifies a full request/response record as RICH', () => {
    expect(classifyRecordRichness(richPresence())).toBe(true);
  });

  it('classifies a method+path-only record as THIN (the CLF case)', () => {
    expect(
      classifyRecordRichness(
        richPresence({
          hasRequestHeaders: false,
          hasRequestBody: false,
          hasResponseStatus: false,
          hasResponseBody: false,
        }),
      ),
    ).toBe(false);
  });

  it('requires BOTH a request detail AND a response detail to be rich', () => {
    // Request detail present, response detail absent -> thin.
    expect(
      classifyRecordRichness(
        richPresence({ hasResponseStatus: false, hasResponseBody: false }),
      ),
    ).toBe(false);
    // Response detail present, request detail absent -> thin.
    expect(
      classifyRecordRichness(
        richPresence({ hasRequestHeaders: false, hasRequestBody: false }),
      ),
    ).toBe(false);
    // One of each is enough.
    expect(
      classifyRecordRichness(
        richPresence({ hasRequestBody: false, hasResponseBody: false }),
      ),
    ).toBe(true);
  });

  it('is never rich without method and path', () => {
    expect(classifyRecordRichness(richPresence({ hasMethod: false }))).toBe(false);
    expect(classifyRecordRichness(richPresence({ hasPath: false }))).toBe(false);
  });
});

describe('knownFormatFastPath — rich JSON-lines PASSES the gate', () => {
  it('extracts method/path/headers/body/response from a flat rich JSON-lines log', () => {
    const lines = [
      JSON.stringify({
        method: 'POST',
        path: '/api/orders',
        request_headers: { 'content-type': 'application/json' },
        request_body: { item: 'widget', qty: 2 },
        status: 201,
        response_body: { id: 'ord-1', ok: true },
      }),
      JSON.stringify({
        method: 'GET',
        path: '/api/orders/42',
        request_headers: { accept: 'application/json' },
        request_body: '',
        status: 200,
        response_body: { id: 'ord-42' },
      }),
    ];
    const result = tryKnownFormatFastPathContent(lines.join('\n'));

    expect(result.usedFastPath).toBe(true);
    if (result.usedFastPath) {
      expect(result.extracted).toHaveLength(2);
      const first = result.extracted[0];
      expect(first.method).toBe('POST');
      expect(first.rawPath).toBe('/api/orders');
      expect(first.status).toBe(201);
      expect(first.requestHeaders).toBeDefined();
      expect(first.responseBody).toContain('ord-1');
    }
  });

  it('extracts a NESTED { request, response } JSON shape', () => {
    const lines = [
      JSON.stringify({
        request: {
          method: 'PUT',
          url: 'http://svc:8080/api/users/7?force=true',
          headers: { authorization: 'Bearer x' },
          body: { name: 'Ada' },
        },
        response: { status: 200, headers: { 'x-trace': 'abc' }, body: { ok: true } },
      }),
    ];
    const result = tryKnownFormatFastPathContent(lines.join('\n'));

    expect(result.usedFastPath).toBe(true);
    if (result.usedFastPath) {
      expect(result.extracted).toHaveLength(1);
      const obs = result.extracted[0];
      expect(obs.method).toBe('PUT');
      // Absolute URL stripped to its path (query preserved); id normalized.
      expect(obs.rawPath).toBe('/api/users/7?force=true');
      expect(obs.normalizedPath).toBe('/api/users/{id}');
      expect(obs.status).toBe(200);
      expect(obs.requestBody).toContain('Ada');
      expect(obs.responseBody).toContain('ok');
    }
  });
});

describe('knownFormatFastPath — thin inputs FALL THROUGH to the LLM', () => {
  it('thin CLF falls through (no bodies / no response payload)', () => {
    const lines = [
      '127.0.0.1 - frank [10/Oct/2026:13:55:36 +0000] "GET /api/users/1 HTTP/1.1" 200 2326',
      '127.0.0.1 - frank [10/Oct/2026:13:55:37 +0000] "POST /api/orders HTTP/1.1" 201 17',
      '127.0.0.1 - frank [10/Oct/2026:13:55:38 +0000] "GET /api/users/2 HTTP/1.1" 200 2200',
    ];
    const result = tryKnownFormatFastPathContent(lines.join('\n'));

    expect(result.usedFastPath).toBe(false);
    if (!result.usedFastPath) {
      expect(result.format).toMatch(/clf_/);
    }
  });

  it('method+path-only JSON-lines is THIN -> falls through (never force-fit to rich)', () => {
    const lines = [
      JSON.stringify({ method: 'GET', path: '/api/a', level: 'info' }),
      JSON.stringify({ method: 'GET', path: '/api/b', level: 'info' }),
      JSON.stringify({ method: 'GET', path: '/api/c', level: 'info' }),
    ];
    const result = tryKnownFormatFastPathContent(lines.join('\n'));

    expect(result.usedFastPath).toBe(false);
  });

  it('falls through when only a minority of records are rich (below the accept fraction)', () => {
    // 1 rich record out of 5 request-bearing -> 0.2 < 0.6 accept fraction.
    const rich = JSON.stringify({
      method: 'POST',
      path: '/api/orders',
      request_headers: { 'content-type': 'application/json' },
      request_body: { x: 1 },
      status: 201,
      response_body: { ok: true },
    });
    const thin = JSON.stringify({ method: 'GET', path: '/api/ping', status: 200 });
    const lines = [rich, thin, thin, thin, thin];
    const result = tryKnownFormatFastPathContent(lines.join('\n'));

    expect(RICHNESS_ACCEPT_FRACTION).toBe(0.6);
    expect(result.usedFastPath).toBe(false);
  });
});
