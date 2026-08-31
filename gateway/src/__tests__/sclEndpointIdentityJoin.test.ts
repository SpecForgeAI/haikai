/**
 * SCL story ↔ committed-endpoint identity join (2026-08-30).
 *
 * Pins the path normalisation (variables, wildcards, scheme/host, query,
 * slashes, case), the three matching tiers (verb+path, path alone, endpoint
 * name), and the three honest output states: resolved ids, unresolved routes
 * (a real gap), and joinable:false (no routes declared — the
 * deployment-descriptor case, which must NEVER read as a gap).
 */

import {
  JoinableEndpoint,
  joinSclStoryToEndpoints,
  normalisePath,
} from '../services/sclEndpointIdentityJoin';

describe('normalisePath', () => {
  it('reduces every path-variable style to one positional wildcard', () => {
    expect(normalisePath('/views/{businessDate}')).toBe('/views/{}');
    expect(normalisePath('/views/:businessDate')).toBe('/views/{}');
    expect(normalisePath('/views/*')).toBe('/views/{}');
    expect(normalisePath('/views/{a}/tags/{b}')).toBe('/views/{}/tags/{}');
  });

  it('strips scheme+host, query string and fragment', () => {
    expect(normalisePath('https://gateway.internal:8443/views/all?d=1#top')).toBe(
      '/views/all',
    );
  });

  it('collapses duplicate slashes, trims the trailing slash, lower-cases, ensures the leading slash', () => {
    expect(normalisePath('Views//All/')).toBe('/views/all');
    expect(normalisePath('/')).toBe('/');
  });

  it('null / blank read as null', () => {
    expect(normalisePath(null)).toBeNull();
    expect(normalisePath('   ')).toBeNull();
    expect(normalisePath(undefined)).toBeNull();
  });
});

describe('joinSclStoryToEndpoints', () => {
  const ENDPOINTS: JoinableEndpoint[] = [
    { id: 'ep-1', name: 'GET /views/{businessDate}', verb: 'GET', path: '/views/{businessDate}' },
    { id: 'ep-2', name: 'PUT /filters/create', verb: 'PUT', path: '/filters/create' },
    { id: 'ep-3', name: 'lookupServlet', verb: null, path: null },
    { id: 'ep-4', name: 'GET /views/all', verb: null, path: '/views/all' },
  ];

  it('tier 1: verb + path both present and equal', () => {
    const result = joinSclStoryToEndpoints({
      routes: [{ verb: 'GET', path: '/views/:date' }],
      endpoints: ENDPOINTS,
    });
    expect(result).toEqual({ endpointIds: ['ep-1'], unresolved: [], joinable: true });
  });

  it('tier 2: path alone matches when the verb tier misses', () => {
    // The endpoint carries no verb, so verb+path can never match — path does.
    const result = joinSclStoryToEndpoints({
      routes: [{ verb: 'GET', path: '/views/all' }],
      endpoints: ENDPOINTS,
    });
    expect(result.endpointIds).toEqual(['ep-4']);
    expect(result.unresolved).toEqual([]);
  });

  it("tier 3: a path-less route joins by endpoint NAME (the route's verb-less token)", () => {
    const result = joinSclStoryToEndpoints({
      routes: [{ verb: 'lookupServlet', path: null }],
      endpoints: ENDPOINTS,
    });
    expect(result.endpointIds).toEqual(['ep-3']);
  });

  it('a route matching NOTHING is REPORTED as unresolved, never guessed at', () => {
    const result = joinSclStoryToEndpoints({
      routes: [
        { verb: 'GET', path: '/views/{d}' },
        { verb: 'DELETE', path: '/never/registered' },
      ],
      endpoints: ENDPOINTS,
    });
    expect(result.endpointIds).toEqual(['ep-1']);
    expect(result.unresolved).toEqual([{ verb: 'DELETE', path: '/never/registered' }]);
    expect(result.joinable).toBe(true);
  });

  it('NO routes declared -> joinable:false with nothing unresolved (not a gap)', () => {
    for (const routes of [[], null, undefined]) {
      expect(joinSclStoryToEndpoints({ routes, endpoints: ENDPOINTS })).toEqual({
        endpointIds: [],
        unresolved: [],
        joinable: false,
      });
    }
  });

  it('multiple routes accumulate ids; the result is deduped and deterministically sorted', () => {
    const result = joinSclStoryToEndpoints({
      routes: [
        { verb: 'PUT', path: '/filters/create' },
        { verb: 'GET', path: '/views/{x}' },
        { verb: 'get', path: 'views/{y}/' }, // case + trailing-slash variant of the same route
      ],
      endpoints: ENDPOINTS,
    });
    expect(result.endpointIds).toEqual(['ep-1', 'ep-2']);
  });

  it('a path shared by several endpoints matches ALL of them', () => {
    const result = joinSclStoryToEndpoints({
      routes: [{ verb: null, path: '/views/{id}' }],
      endpoints: [
        ...ENDPOINTS,
        { id: 'ep-5', name: 'HEAD /views/{id}', verb: 'HEAD', path: '/views/{id}' },
      ],
    });
    expect(result.endpointIds).toEqual(['ep-1', 'ep-5']);
  });

  it('an empty committed surface leaves every route unresolved (partial, honest)', () => {
    const result = joinSclStoryToEndpoints({
      routes: [{ verb: 'GET', path: '/views/all' }],
      endpoints: [],
    });
    expect(result.endpointIds).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
    expect(result.joinable).toBe(true);
  });
});
