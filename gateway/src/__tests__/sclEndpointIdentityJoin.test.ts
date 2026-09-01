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
    expect(result).toEqual({
      endpointIds: ['ep-1'],
      unresolved: [],
      joinable: true,
      resolvedByClass: false,
    });
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

  it('NO routes and NO controller class -> joinable:false with nothing unresolved (not a gap)', () => {
    for (const routes of [[], null, undefined]) {
      expect(joinSclStoryToEndpoints({ routes, endpoints: ENDPOINTS })).toEqual({
        endpointIds: [],
        unresolved: [],
        joinable: false,
        resolvedByClass: false,
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
    expect(result.resolvedByClass).toBe(false);
  });
});

/**
 * The LAST-RESORT class tier (2026-09-01). Endpoints persist their owning
 * class in protocol_metadata_json.className since 2026-07-23, so a route-less
 * story can join via its controllerClass — but ONLY on a unique 1:1 hit, and
 * NEVER displacing route identity.
 */
describe('joinSclStoryToEndpoints — class tier', () => {
  const CLASSED: JoinableEndpoint[] = [
    {
      id: 'ep-servlet',
      name: 'lookupServlet',
      verb: null,
      path: null,
      className: 'com.app.web.CacheRefreshServlet',
    },
    {
      id: 'ep-multi-a',
      name: 'GET /multi/a',
      verb: 'GET',
      path: '/multi/a',
      className: 'com.app.web.MultiController',
    },
    {
      id: 'ep-multi-b',
      name: 'GET /multi/b',
      verb: 'GET',
      path: '/multi/b',
      className: 'com.app.web.MultiController',
    },
  ];

  it('resolves 1:1 by class when no routes were declared, reported as resolvedByClass', () => {
    const result = joinSclStoryToEndpoints({
      routes: [],
      endpoints: CLASSED,
      controllerClass: 'com.app.web.CacheRefreshServlet',
    });
    expect(result).toEqual({
      endpointIds: ['ep-servlet'],
      unresolved: [],
      joinable: true,
      resolvedByClass: true,
    });
  });

  it('matches case/whitespace-insensitively', () => {
    const result = joinSclStoryToEndpoints({
      routes: null,
      endpoints: CLASSED,
      controllerClass: '  COM.App.Web.CacheRefreshServlet ',
    });
    expect(result.endpointIds).toEqual(['ep-servlet']);
    expect(result.resolvedByClass).toBe(true);
  });

  it('REFUSES a 1:many class rather than claiming all its endpoints', () => {
    // A row-budget "part N" story implements only SOME of a class's
    // endpoints — attaching all of them would be wrong.
    const result = joinSclStoryToEndpoints({
      routes: [],
      endpoints: CLASSED,
      controllerClass: 'com.app.web.MultiController',
    });
    expect(result).toEqual({
      endpointIds: [],
      unresolved: [],
      joinable: false,
      resolvedByClass: false,
    });
  });

  it('a class matching NOTHING stays not-joinable (never a fabricated match)', () => {
    const result = joinSclStoryToEndpoints({
      routes: [],
      endpoints: CLASSED,
      controllerClass: 'com.app.web.NeverCommitted',
    });
    expect(result.joinable).toBe(false);
    expect(result.resolvedByClass).toBe(false);
  });

  it('is a NO-OP when the committed endpoints predate className (field absent)', () => {
    const legacy: JoinableEndpoint[] = [
      { id: 'ep-old', name: 'lookupServlet', verb: null, path: null },
    ];
    const result = joinSclStoryToEndpoints({
      routes: [],
      endpoints: legacy,
      controllerClass: 'com.app.web.CacheRefreshServlet',
    });
    expect(result.joinable).toBe(false);
  });

  it('NEVER displaces route identity: with routes declared the class tier is not consulted', () => {
    // A real route gap stays reported rather than papered over by class.
    const gap = joinSclStoryToEndpoints({
      routes: [{ verb: 'DELETE', path: '/never/registered' }],
      endpoints: CLASSED,
      controllerClass: 'com.app.web.CacheRefreshServlet',
    });
    expect(gap.endpointIds).toEqual([]);
    expect(gap.unresolved).toHaveLength(1);
    expect(gap.resolvedByClass).toBe(false);

    // And a resolved route never masquerades as a class resolution.
    const routed = joinSclStoryToEndpoints({
      routes: [{ verb: 'GET', path: '/multi/a' }],
      endpoints: CLASSED,
      controllerClass: 'com.app.web.CacheRefreshServlet',
    });
    expect(routed.endpointIds).toEqual(['ep-multi-a']);
    expect(routed.resolvedByClass).toBe(false);
  });

  it('a blank controllerClass is a no-op', () => {
    const result = joinSclStoryToEndpoints({
      routes: [],
      endpoints: CLASSED,
      controllerClass: '   ',
    });
    expect(result.joinable).toBe(false);
  });
});
