/**
 * Deterministic Group B derivation (gold standard 2026-08-08 — closes the
 * CONV.07 known-open). Pins the honesty rules: values ONLY on positive
 * observation (auth / rate limiting / error contract are never locked from
 * absence), versioning is the one positive-either-way code, and every value
 * carries counted evidence + baseline provenance.
 */
import {
  BaselineItemForDerivation,
  deriveGroupBValues,
} from '../apiSurfaceDerivation';

const BASELINE_ID = 'bl-1';

function item(over: Partial<BaselineItemForDerivation> = {}): BaselineItemForDerivation {
  return {
    method: 'GET',
    path: '/api/v1/orders',
    request_json: {
      query: null,
      headers: { Authorization: 'Bearer abc123', Accept: 'application/json' },
      body: null,
    },
    response_status: 200,
    response_json: {
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    },
    ...over,
  };
}

describe('deriveGroupBValues', () => {
  it('derives protocol/format/versioning/auth from a JSON REST baseline with counted evidence + provenance', () => {
    const { values, itemCount } = deriveGroupBValues(
      [item(), item({ path: '/api/v1/customers' })],
      BASELINE_ID,
    );
    expect(itemCount).toBe(2);
    expect(values['api.protocol'].value).toContain('REST over HTTP with JSON payloads');
    expect(values['api.protocol'].sourceQuote).toContain('2/2 operation(s) returned JSON');
    expect(values['api.protocol'].sourceFile).toBe(`api-behaviour-baseline:${BASELINE_ID}`);
    expect(values['api.contractFormat'].value).toBe('JSON');
    expect(values['api.versioning'].value).toContain('URL-path versioning (v1)');
    expect(values['api.auth'].value).toContain('Bearer token');
    expect(values['api.auth'].sourceQuote).toContain('2/2 request(s)');
  });

  it('locks "Unversioned" as a POSITIVE observation when no version scheme exists anywhere', () => {
    const { values } = deriveGroupBValues(
      [item({ path: '/orders' }), item({ path: '/customers' })],
      BASELINE_ID,
    );
    expect(values['api.versioning'].value).toContain('Unversioned');
    expect(values['api.versioning'].sourceQuote).toContain('any of the 2 captured operation(s)');
  });

  it('NEVER locks auth or rate limiting from absence — omitted with the honest reason instead', () => {
    const bare = item({
      request_json: { query: null, headers: { Accept: 'application/json' }, body: null },
    });
    const { values, omitted } = deriveGroupBValues([bare], BASELINE_ID);
    expect(values['api.auth']).toBeUndefined();
    expect(values['api.rateLimiting']).toBeUndefined();
    expect(omitted.find((o) => o.code === 'api.auth')?.reason).toContain('out-of-band');
    expect(omitted.find((o) => o.code === 'api.rateLimiting')?.reason).toContain('never locked from absence');
  });

  it('derives RFC 7807 from problem+json error samples; a custom envelope from its keys; omits with no 4xx at all', () => {
    const rfc = deriveGroupBValues(
      [
        item(),
        item({
          response_status: 404,
          response_json: {
            headers: { 'Content-Type': 'application/problem+json' },
            body: { type: 'about:blank', title: 'Not Found', status: 404 },
          },
        }),
      ],
      BASELINE_ID,
    );
    expect(rfc.values['api.errorContract'].value).toBe('RFC 7807 problem+json');

    const custom = deriveGroupBValues(
      [
        item({
          response_status: 400,
          response_json: {
            headers: { 'Content-Type': 'application/json' },
            body: { error: 'bad', message: 'nope' },
          },
        }),
      ],
      BASELINE_ID,
    );
    expect(custom.values['api.errorContract'].value).toContain('Custom JSON error envelope');
    expect(custom.values['api.errorContract'].value).toContain('error,message');

    const none = deriveGroupBValues([item()], BASELINE_ID);
    expect(none.values['api.errorContract']).toBeUndefined();
    expect(none.omitted.find((o) => o.code === 'api.errorContract')?.reason).toContain('no 4xx/5xx');
  });

  it('derives header-signalled rate limiting from X-RateLimit-*/Retry-After response headers', () => {
    const { values } = deriveGroupBValues(
      [
        item({
          response_json: {
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': '100',
              'X-RateLimit-Remaining': '99',
            },
            body: {},
          },
        }),
      ],
      BASELINE_ID,
    );
    expect(values['api.rateLimiting'].value).toContain('Header-signalled rate limiting');
    expect(values['api.rateLimiting'].value).toContain('x-ratelimit-limit');
  });

  it('recognises API-key headers and mixed JSON+XML surfaces', () => {
    const { values } = deriveGroupBValues(
      [
        item({
          request_json: { query: null, headers: { 'X-API-Key': 'k' }, body: null },
        }),
        item({
          response_json: { headers: { 'Content-Type': 'application/xml' }, body: null },
        }),
      ],
      BASELINE_ID,
    );
    expect(values['api.auth'].value).toContain('API key header (x-api-key)');
    expect(values['api.contractFormat'].value).toBe('Mixed JSON + XML');
    expect(values['api.protocol'].value).toContain('JSON + XML payloads');
  });

  it('an EMPTY baseline derives NOTHING — all six codes omitted honestly', () => {
    const { values, omitted, itemCount } = deriveGroupBValues([], BASELINE_ID);
    expect(itemCount).toBe(0);
    expect(Object.keys(values)).toEqual([]);
    expect(omitted).toHaveLength(6);
    expect(omitted.every((o) => o.reason.includes('no captured items'))).toBe(true);
  });
});
