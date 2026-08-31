/**
 * Corpus stories join the committed endpoint surface + inherit its findings
 * (2026-08-30).
 *
 * `buildCorpusEndpointGroupItems` used to hardcode `apiEndpointIds: []` on
 * every corpus story, which made every implementation story invisible to the
 * endpoint coverage gate (it only considers stories WITH ids) and left
 * "which story implements endpoint X" mechanically unanswerable; `findingIds`
 * was populated only for flagged/exceptional endpoints, so corpus stories had
 * no finding linkage at all. Pins:
 *
 *   - resolved join: ids land on the story, findings dedupe+sort in, the
 *     acceptance criteria gain the finding + parity lines, provenance says
 *     `resolved`;
 *   - partial join: unresolved routes are NAMED (a real gap), never guessed;
 *   - not_applicable: no routes declared (deployment-descriptor case) — NOT a
 *     gap, and never reported as one;
 *   - omitted endpoint surface: `apiEndpointIds` stays empty exactly as
 *     before (back-compat).
 */

import { buildCorpusEndpointGroupItems } from '../services/migrationBookOfWorkExpansionHandler';
import { SclCorpusPlan, SclPlannedStory } from '../services/sclCorpusPlanner';
import { JoinableEndpoint } from '../services/sclEndpointIdentityJoin';

function plannedStory(overrides: Partial<SclPlannedStory> = {}): SclPlannedStory {
  return {
    layer: 'endpoint:external',
    title: 'Implement OrdersController (2 endpoints)',
    description: '2 external endpoint method(s) of com.app.OrdersController.',
    contractKeys: ['T-ORD-GET', 'T-ORD-LIST'],
    rowCount: 7,
    tags: ['scl', 'scl:endpoint:external'],
    controllerClass: 'com.app.OrdersController',
    ...overrides,
  };
}

function plan(external: SclPlannedStory[]): SclCorpusPlan {
  return {
    foundationStories: [],
    externalEndpointGroups: external,
    internalEndpointGroups: [],
    stats: {
      sharedContractCount: 0,
      controllerCount: external.length,
      splitCount: 0,
      foundationSplitCount: 0,
      rowBudget: 40,
    },
  };
}

const EPIC = {
  id: 'stream:epic-interfaces',
  type: 'epic',
  parentId: null,
  title: 'Interfaces epic',
  sequenceOrder: 1,
  workstream: 'service_tier',
} as never;

const ENDPOINTS: JoinableEndpoint[] = [
  { id: 'ep-1', name: 'GET /orders/{id}', verb: 'GET', path: '/orders/{id}' },
  { id: 'ep-2', name: 'GET /orders', verb: 'GET', path: '/orders' },
];

const FINDINGS = new Map<string, string[]>([
  ['ep-1', ['f-2', 'f-1']],
  ['ep-2', ['f-1', 'f-3']],
]);

function storyItems(items: ReturnType<typeof buildCorpusEndpointGroupItems>) {
  return items.filter((i) => i.type === 'story') as unknown as Array<Record<string, unknown>>;
}

describe('buildCorpusEndpointGroupItems — endpoint-identity join + findings', () => {
  it('RESOLVED: ids land, findings dedupe+sort in, criteria + traceability say so', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([
        plannedStory({
          httpRoutes: [
            { verb: 'GET', path: '/orders/{orderId}' },
            { verb: 'GET', path: '/orders' },
          ],
        }),
      ]),
      startSequence: 0,
      endpoints: ENDPOINTS,
      findingIdsByEndpointId: FINDINGS,
    });
    const [blob] = storyItems(items);

    expect(blob.apiEndpointIds).toEqual(['ep-1', 'ep-2']);
    expect(blob.findingIds).toEqual(['f-1', 'f-2', 'f-3']);
    expect(blob.scl_endpoint_join).toBe('resolved');
    expect(blob.scl_declared_routes).toEqual(['GET /orders/{orderId}', 'GET /orders']);
    expect(blob.scl_unresolved_routes).toEqual([]);

    const ac = blob.acceptanceCriteria as string[];
    expect(ac[0]).toContain('7 behaviour-table row(s) across 2 SCL contract(s)');
    expect(ac).toContainEqual(
      expect.stringContaining("The 3 discovery finding(s) attached to this story's endpoints"),
    );
    expect(ac).toContainEqual(
      expect.stringContaining('Parity holds for all 2 committed endpoint(s)'),
    );
    expect(blob.traceabilitySummary).toContain(
      'Joined to 2 committed endpoint(s) by route identity.',
    );
  });

  it('PARTIAL: an unresolved route is NAMED as a real gap, resolved ids still land', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([
        plannedStory({
          httpRoutes: [
            { verb: 'GET', path: '/orders/{id}' },
            { verb: 'DELETE', path: '/never/committed' },
          ],
        }),
      ]),
      startSequence: 0,
      endpoints: ENDPOINTS,
      findingIdsByEndpointId: FINDINGS,
    });
    const [blob] = storyItems(items);

    expect(blob.apiEndpointIds).toEqual(['ep-1']);
    expect(blob.scl_endpoint_join).toBe('partial');
    expect(blob.scl_unresolved_routes).toEqual(['DELETE /never/committed']);
    // With ANY id resolved the tail reports the join; the gap stays visible
    // in scl_endpoint_join='partial' + scl_unresolved_routes above.
    expect(blob.traceabilitySummary).toContain(
      'Joined to 1 committed endpoint(s) by route identity.',
    );
    // Findings come only from the RESOLVED endpoints.
    expect(blob.findingIds).toEqual(['f-1', 'f-2']);
  });

  it('ZERO resolutions with declared routes -> the tail names the gap', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([
        plannedStory({ httpRoutes: [{ verb: 'DELETE', path: '/never/committed' }] }),
      ]),
      startSequence: 0,
      endpoints: ENDPOINTS,
      findingIdsByEndpointId: FINDINGS,
    });
    const [blob] = storyItems(items);
    expect(blob.apiEndpointIds).toEqual([]);
    expect(blob.scl_endpoint_join).toBe('partial');
    expect(blob.traceabilitySummary).toContain(
      'Declared 1 route(s) that match NO committed endpoint.',
    );
  });

  it('NOT_APPLICABLE: no routes (deployment-descriptor case) is not a gap — scoped by contract key', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([
        plannedStory({
          title: 'Implement LookupServlet (1 endpoints)',
          controllerClass: 'com.app.LookupServlet',
          httpRoutes: [],
        }),
      ]),
      startSequence: 0,
      endpoints: ENDPOINTS,
      findingIdsByEndpointId: FINDINGS,
    });
    const [blob] = storyItems(items);

    expect(blob.apiEndpointIds).toEqual([]);
    expect(blob.findingIds).toEqual([]);
    expect(blob.scl_endpoint_join).toBe('not_applicable');
    expect(blob.traceabilitySummary).toContain(
      'No routing annotations, so no route-identity join is possible',
    );
    expect(blob.traceabilitySummary).toContain('scoped by SCL contract key only');
    // Only the base row-verification criterion — no finding/parity lines.
    expect(blob.acceptanceCriteria as string[]).toHaveLength(1);
  });

  it('OMITTED endpoint surface: apiEndpointIds stays empty exactly as before (back-compat)', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([plannedStory({ httpRoutes: [{ verb: 'GET', path: '/orders' }] })]),
      startSequence: 0,
    });
    const [blob] = storyItems(items);
    expect(blob.apiEndpointIds).toEqual([]);
    expect(blob.findingIds).toEqual([]);
    // The story declares routes but nothing committed was supplied — an
    // honestly-partial join, never a fabricated resolution.
    expect(blob.scl_endpoint_join).toBe('partial');
  });

  it('the legacy marker set survives: codeStoryKind + contract-key scoping unchanged', () => {
    const items = buildCorpusEndpointGroupItems({
      epic: EPIC,
      stream: 'code',
      plan: plan([plannedStory({ httpRoutes: [{ verb: 'GET', path: '/orders' }] })]),
      startSequence: 0,
      endpoints: ENDPOINTS,
      findingIdsByEndpointId: FINDINGS,
    });
    const [blob] = storyItems(items);
    expect(blob.codeStoryKind).toBe('scl-endpoint-group');
    expect(blob.scl_contract_keys).toEqual(['T-ORD-GET', 'T-ORD-LIST']);
    expect(blob.scl_controller_class).toBe('com.app.OrdersController');
    expect(blob.apiInterfaceId).toBeNull();
    expect(blob.baselineByEndpointId).toEqual({});
  });
});
