/**
 * Code-planner findings enrichment (2026-09-01) — the fix-5 producer wired.
 *
 * `attachFindingMentions` was exported but NEVER called: the default view
 * fetch returned `findingIdsByEndpointId: new Map()`, so the map was ALWAYS
 * empty in production. Every corpus story's `findingIds` came out `[]` and
 * the `attached_finding` flag never fired — while the unit tests passed,
 * because they inject the map themselves. Pins:
 *
 *   - the run-scoped enrichment now populates the map inside
 *     `defaultFetchCodeModelView` (de-duped across runs, fail-soft);
 *   - `findingRouteRefsOf` reads codeEndpointMethod/codeEndpointPath off
 *     `detail_json` and skips DB-shaped findings;
 *   - `attachFindingRoutes` matches by exact verb+path then path alone,
 *     MERGES (the name pass assigns) — tier order is load-bearing;
 *   - the ESCALATION subset: `info`-severity findings ride as carriage but
 *     never escalate; `flagEndpoint` reads the subset and falls back to the
 *     full map for pre-existing callers.
 */

jest.mock('../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../services/apiBehaviourBaselineCoverageClient', () => ({
  fetchEndpointBaselineCoverage: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../services/migrationCarryOverCoverageReads', () => ({
  fetchDiscoveryRunsForArchitecture: jest.fn(),
  fetchFindingsForRun: jest.fn(),
}));

import {
  CodeModelView,
  NON_ESCALATING_FINDING_SEVERITIES,
  attachFindingMentions,
  attachFindingRoutes,
  defaultFetchCodeModelView,
  findingRouteRefsOf,
  flagEndpoint,
  isNonEscalatingFinding,
} from '../services/migrationCodeStreamPlanner';
import {
  DiscoveryFindingWire,
  fetchDiscoveryRunsForArchitecture,
  fetchFindingsForRun,
} from '../services/migrationCarryOverCoverageReads';

function endpoint(
  id: string,
  name: string,
  verb: string | null,
  path: string | null,
) {
  return {
    id,
    name,
    interfaceId: 'iface-1',
    interfaceName: 'ViewService',
    interfaceType: 'REST',
    endpointType: 'REST',
    protocol: 'HTTP',
    verb,
    path,
    direction: 'inbound',
    hasProtocolMetadata: false,
  };
}

function view(endpoints: ReturnType<typeof endpoint>[]): CodeModelView {
  return {
    endpoints,
    baselineByEndpointId: new Map(),
    findingIdsByEndpointId: new Map(),
  };
}

const EP_REST = endpoint('ep-1', 'GET /views/{viewId}', 'GET', '/views/{viewId}');
const EP_REST2 = endpoint('ep-2', 'PUT /filters/create', 'PUT', '/filters/create');
const EP_BATCH = endpoint('ep-3', 'BATCH_MAIN com.app.NightlySnapshot', null, null);

describe('isNonEscalatingFinding', () => {
  it('info and low ride as carriage (case/space tolerant); medium/high/critical escalate', () => {
    expect(NON_ESCALATING_FINDING_SEVERITIES).toEqual(new Set(['info', 'low']));
    expect(isNonEscalatingFinding({ severity: 'info' })).toBe(true);
    expect(isNonEscalatingFinding({ severity: '  INFO ' })).toBe(true);
    expect(isNonEscalatingFinding({ severity: 'low' })).toBe(true);
    for (const severity of ['medium', 'high', 'critical']) {
      expect(isNonEscalatingFinding({ severity } as DiscoveryFindingWire)).toBe(false);
    }
  });

  it('an UNKNOWN or missing severity still escalates — never quietly demoted', () => {
    for (const severity of [null, undefined, '', 'weird_new_level']) {
      expect(isNonEscalatingFinding({ severity } as DiscoveryFindingWire)).toBe(false);
    }
  });
});

describe('findingRouteRefsOf', () => {
  it('reads codeEndpointMethod + codeEndpointPath; verb upper-cased, absent verb -> null', () => {
    const refs = findingRouteRefsOf([
      { id: 'f-1', detail_json: { codeEndpointMethod: 'get', codeEndpointPath: '/views/{viewId}' } },
      { id: 'f-2', detail_json: { codeEndpointPath: '/filters/create' } },
    ]);
    expect(refs).toEqual([
      { findingId: 'f-1', verb: 'GET', path: '/views/{viewId}' },
      { findingId: 'f-2', verb: null, path: '/filters/create' },
    ]);
  });

  it('skips findings without a route (DB-profiling shape) and rows without an id', () => {
    const refs = findingRouteRefsOf([
      { id: 'f-db', detail_json: { schemaName: 'dbo', tableName: 'screen_filter' } },
      { id: 'f-null', detail_json: null },
      { detail_json: { codeEndpointPath: '/x' } }, // no id
      { id: 'f-blank', detail_json: { codeEndpointPath: '   ' } },
    ]);
    expect(refs).toEqual([]);
  });

  it('reads the WADL-pair spelling too: plain method/path (2026-09-01 — previously silently dropped)', () => {
    const refs = findingRouteRefsOf([
      { id: 'f-wadl', detail_json: { method: 'put', path: '/filters/create' } },
    ]);
    expect(refs).toEqual([{ findingId: 'f-wadl', verb: 'PUT', path: '/filters/create' }]);
  });

  it('a finding carrying BOTH spellings attaches ONCE — the most-specific pair wins', () => {
    const refs = findingRouteRefsOf([
      {
        id: 'f-both',
        detail_json: {
          codeEndpointMethod: 'GET',
          codeEndpointPath: '/views/{id}',
          method: 'POST',
          path: '/stale/route',
        },
      },
    ]);
    expect(refs).toEqual([{ findingId: 'f-both', verb: 'GET', path: '/views/{id}' }]);
  });

  it('a blank specific pair falls through to the WADL pair (pairs are tried in order)', () => {
    const refs = findingRouteRefsOf([
      {
        id: 'f-fallthrough',
        detail_json: { codeEndpointPath: '   ', method: 'GET', path: '/views/all' },
      },
    ]);
    expect(refs).toEqual([{ findingId: 'f-fallthrough', verb: 'GET', path: '/views/all' }]);
  });

  it('NO shape filter: an internal entry point route (fully-qualified class name) is kept and joins verbatim', () => {
    // The path is not always an HTTP route — internal entry points record the
    // class name, which matches path_or_address through the same
    // normalisation. attachFindingRoutes fails closed, so shape guessing here
    // could only lose real matches.
    const refs = findingRouteRefsOf([
      { id: 'f-batch', detail_json: { method: 'BATCH_MAIN', path: 'com.app.NightlySnapshot' } },
    ]);
    expect(refs).toEqual([
      { findingId: 'f-batch', verb: 'BATCH_MAIN', path: 'com.app.NightlySnapshot' },
    ]);

    const batchEndpoint = endpoint('ep-b', 'BATCH_MAIN com.app.NightlySnapshot', null, 'com.app.NightlySnapshot');
    const out = attachFindingRoutes(view([batchEndpoint]), refs);
    expect(out.findingIdsByEndpointId.get('ep-b')).toEqual(['f-batch']);
  });
});

describe('attachFindingRoutes', () => {
  it('matches on the EXACT verb+path tier through the shared normalisation', () => {
    const out = attachFindingRoutes(view([EP_REST, EP_REST2]), [
      { findingId: 'f-1', verb: 'GET', path: '/views/:someOtherName' },
    ]);
    expect(out.findingIdsByEndpointId.get('ep-1')).toEqual(['f-1']);
    expect(out.findingIdsByEndpointId.has('ep-2')).toBe(false);
  });

  it('falls back to path alone when the verb tier misses; unmatched refs are skipped, never guessed', () => {
    const out = attachFindingRoutes(view([EP_REST]), [
      { findingId: 'f-1', verb: null, path: '/views/{x}' },
      { findingId: 'f-2', verb: 'DELETE', path: '/never/registered' },
    ]);
    expect(out.findingIdsByEndpointId.get('ep-1')).toEqual(['f-1']);
    expect(out.findingIdsByEndpointId.size).toBe(1);
  });

  it('MERGES into name-pass hits (tier order is load-bearing: mentions assign, routes merge)', () => {
    let v = view([EP_BATCH, EP_REST]);
    v = attachFindingMentions(v, [
      {
        findingId: 'f-name',
        title: 'Bare inserts reached from BATCH_MAIN com.app.NightlySnapshot',
        summary: null,
      },
    ]);
    v = attachFindingRoutes(v, [
      { findingId: 'f-route', verb: 'GET', path: '/views/{viewId}' },
    ]);
    // Both tiers' hits survive side by side.
    expect(v.findingIdsByEndpointId.get('ep-3')).toEqual(['f-name']);
    expect(v.findingIdsByEndpointId.get('ep-1')).toEqual(['f-route']);

    // The WRONG order demonstrates why: the name pass ASSIGNS, overwriting
    // an endpoint's route hits when that endpoint also has a name mention.
    let wrong = view([EP_REST]);
    wrong = attachFindingRoutes(wrong, [
      { findingId: 'f-route', verb: 'GET', path: '/views/{viewId}' },
    ]);
    wrong = attachFindingMentions(wrong, [
      { findingId: 'f-name', title: 'Slow response on GET /views/{viewId}', summary: null },
    ]);
    expect(wrong.findingIdsByEndpointId.get('ep-1')).toEqual(['f-name']); // route hit LOST
  });

  it('dedupes per endpoint and keeps ids sorted; empty refs return the view untouched', () => {
    const seeded: CodeModelView = {
      ...view([EP_REST]),
      findingIdsByEndpointId: new Map([['ep-1', ['f-b']]]),
    };
    const out = attachFindingRoutes(seeded, [
      { findingId: 'f-a', verb: 'GET', path: '/views/{v}' },
      { findingId: 'f-a', verb: 'GET', path: '/views/{v}' },
    ]);
    expect(out.findingIdsByEndpointId.get('ep-1')).toEqual(['f-a', 'f-b']);
    expect(attachFindingRoutes(seeded, [])).toBe(seeded);
  });
});

describe('flagEndpoint — escalation subset', () => {
  it('reads the escalating map when supplied: carriage-only findings do NOT escalate', () => {
    const v: CodeModelView = {
      ...view([EP_REST]),
      findingIdsByEndpointId: new Map([['ep-1', ['f-info']]]),
      escalatingFindingIdsByEndpointId: new Map(),
    };
    expect(flagEndpoint(EP_REST, v, 'rest')).not.toContain('attached_finding');

    const escalated: CodeModelView = {
      ...v,
      escalatingFindingIdsByEndpointId: new Map([['ep-1', ['f-material']]]),
    };
    expect(flagEndpoint(EP_REST, escalated, 'rest')).toContain('attached_finding');
  });

  it('ABSENT subset falls back to the full map (pre-existing callers/tests unchanged)', () => {
    const v: CodeModelView = {
      ...view([EP_REST]),
      findingIdsByEndpointId: new Map([['ep-1', ['f-1']]]),
    };
    expect(flagEndpoint(EP_REST, v, 'rest')).toContain('attached_finding');
  });
});

describe('defaultFetchCodeModelView — the producer is finally wired', () => {
  const MODEL_BODY = {
    metaModel: {
      entities: {
        interfaces: [{ id: 'iface-1', name: 'ViewService', interface_type: 'REST' }],
        endpoints: [
          {
            id: 'ep-1',
            name: 'GET /views/{viewId}',
            interface_id: 'iface-1',
            operation_verb: 'GET',
            path_or_address: '/views/{viewId}',
            endpoint_type: 'REST',
            protocol: 'HTTP',
            direction: 'inbound',
          },
        ],
      },
    },
  };
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  function mockModelFetch() {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => MODEL_BODY,
    }) as unknown as typeof globalThis.fetch;
  }

  it('populates BOTH maps from run-scoped findings: info rides as carriage, material escalates', async () => {
    mockModelFetch();
    (fetchDiscoveryRunsForArchitecture as jest.Mock).mockResolvedValue([
      { id: 'run-1' },
      { id: 'run-2' },
    ]);
    (fetchFindingsForRun as jest.Mock).mockImplementation(async (_p, _a, runId) =>
      runId === 'run-1'
        ? [
            {
              id: 'f-info',
              severity: 'info',
              title: 'reviewed note',
              detail_json: { codeEndpointMethod: 'GET', codeEndpointPath: '/views/{id}' },
            },
            {
              id: 'f-low',
              severity: 'low',
              title: 'minor note',
              detail_json: { codeEndpointMethod: 'GET', codeEndpointPath: '/views/{id}' },
            },
            {
              id: 'f-high',
              severity: 'high',
              title: 'real problem',
              detail_json: { codeEndpointMethod: 'GET', codeEndpointPath: '/views/{id}' },
            },
          ]
        : [
            // Duplicate of f-info under a second run — de-duped by id.
            {
              id: 'f-info',
              severity: 'info',
              title: 'reviewed note',
              detail_json: { codeEndpointMethod: 'GET', codeEndpointPath: '/views/{id}' },
            },
          ],
    );

    const result = await defaultFetchCodeModelView('p1', 'arch-1');
    expect(result).not.toBeNull();
    // info + low ride as carriage on the story...
    expect(result!.findingIdsByEndpointId.get('ep-1')).toEqual(['f-high', 'f-info', 'f-low']);
    // ...but only the material finding escalates.
    expect(result!.escalatingFindingIdsByEndpointId?.get('ep-1')).toEqual(['f-high']);
  });

  it('FAIL-SOFT: a findings read failure leaves the maps empty and the view still returns', async () => {
    mockModelFetch();
    (fetchDiscoveryRunsForArchitecture as jest.Mock).mockRejectedValue(
      new Error('AMS down'),
    );

    const result = await defaultFetchCodeModelView('p1', 'arch-1');
    expect(result).not.toBeNull();
    expect(result!.findingIdsByEndpointId.size).toBe(0);
    expect(result!.escalatingFindingIdsByEndpointId?.size).toBe(0);
    expect(result!.endpoints).toHaveLength(1);
  });
});
