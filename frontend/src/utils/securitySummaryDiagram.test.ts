/**
 * Tests for Security Summary diagram generation (service-level association,
 * 2026-07-19, Spec C of 3): display-level subsets (flat, skip-level nesting,
 * innermost-only), containment layout, edge roll-up to the nearest displayed
 * level, preservation of user additions + positions across regeneration, and
 * the nearest-displayed-ancestor circle aggregation.
 */

import { describe, expect, it } from 'vitest';
import type { Diagram, MetaModel } from '../types/model';
import {
  aggregateSecurityCountsToDisplayedEntities,
  generateSecuritySummaryDiagram,
  rollUpDataMovementsToDisplayedPairs,
} from './securitySummaryDiagram';

/**
 * Model: Alpha (comp Core -> svc pay; svc web direct), Beta (svc api).
 * Movements: pay -> api (via service points), Alpha -> Beta (app points),
 * pay -> web (intra-Alpha).
 */
function fixtureModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-a', name: 'Alpha', abbreviation: 'A' },
        { id: 'app-b', name: 'Beta', abbreviation: 'B' },
      ],
      app_components: [{ id: 'comp-core', application_id: 'app-a', name: 'Core' }],
      services: [
        { id: 'svc-pay', application_id: '', app_component_id: 'comp-core', name: 'pay' },
        { id: 'svc-web', application_id: 'app-a', name: 'web' },
        { id: 'svc-api', application_id: 'app-b', name: 'api' },
      ],
      application_points: [
        { id: 'ap-a', kind: 'APPLICATION', application_id: 'app-a' },
        { id: 'ap-b', kind: 'APPLICATION', application_id: 'app-b' },
        { id: 'ap-pay', kind: 'SERVICE', application_id: '', service_id: 'svc-pay' },
        { id: 'ap-web', kind: 'SERVICE', application_id: '', service_id: 'svc-web' },
        { id: 'ap-api', kind: 'SERVICE', application_id: '', service_id: 'svc-api' },
      ],
    },
    relationships: {
      data_movements: [
        { id: 'dm-1', source_application_point_id: 'ap-pay', target_application_point_id: 'ap-api' },
        { id: 'dm-2', source_application_point_id: 'ap-a', target_application_point_id: 'ap-b' },
        { id: 'dm-3', source_application_point_id: 'ap-pay', target_application_point_id: 'ap-web' },
      ],
    },
  } as unknown as MetaModel;
}

const nodesByEntity = (d: Diagram) =>
  new Map(d.diagram_nodes.map((n) => [n.entity_id, n]));

describe('generateSecuritySummaryDiagram — display levels', () => {
  it('application-only: flat app boxes; service movements roll UP; intra-app loops drop', () => {
    const diagram = generateSecuritySummaryDiagram(fixtureModel(), ['application']);
    expect(diagram.diagram_nodes).toHaveLength(2);
    expect(diagram.diagram_nodes.every((n) => n.parent_node_id === null)).toBe(true);
    expect(diagram.settings?.security_display_levels).toEqual(['application']);
    // dm-1 (pay->api) and dm-2 (A->B) both collapse onto A->B; dm-3 self-loops away.
    expect(diagram.diagram_edges).toHaveLength(1);
  });

  it('application -> service (component level SKIPPED): services nest directly inside apps, parents sized to fit', () => {
    const diagram = generateSecuritySummaryDiagram(fixtureModel(), ['application', 'service']);
    const nodes = nodesByEntity(diagram);
    const alpha = nodes.get('app-a')!;
    const pay = nodes.get('svc-pay')!;
    const web = nodes.get('svc-web')!;
    expect(pay.parent_node_id).toBe(alpha.id);
    expect(web.parent_node_id).toBe(alpha.id);
    // Children sit ABSOLUTELY inside the parent's bounds.
    for (const child of [pay, web]) {
      expect(child.pos_x).toBeGreaterThan(alpha.pos_x);
      expect(child.pos_y).toBeGreaterThan(alpha.pos_y);
      expect(child.pos_x + child.width).toBeLessThanOrEqual(alpha.pos_x + alpha.width);
      expect(child.pos_y + child.height).toBeLessThanOrEqual(alpha.pos_y + alpha.height);
    }
    // Edges at service level where possible: pay->api, pay->web, plus app-level A->B.
    expect(diagram.diagram_edges).toHaveLength(3);
  });

  it('service-only: flat service boxes; app-point movements with no displayed box are dropped', () => {
    const diagram = generateSecuritySummaryDiagram(fixtureModel(), ['service']);
    expect(diagram.diagram_nodes.map((n) => n.entity_type)).toEqual([
      'SERVICE', 'SERVICE', 'SERVICE',
    ]);
    // pay->api and pay->web survive; the app-point movement (A->B) has no
    // displayed box on its chain and drops.
    expect(diagram.diagram_edges).toHaveLength(2);
  });
});

describe('regeneration preservation', () => {
  it('keeps surviving top-level positions + derived node ids, preserves user nodes/edges, re-derives movements', () => {
    const model = fixtureModel();
    const first = generateSecuritySummaryDiagram(model, ['application', 'service']);
    const alpha = first.diagram_nodes.find((n) => n.entity_id === 'app-a')!;
    alpha.pos_x = 900;
    alpha.pos_y = 700;
    // User adds a business-user node + an edge from it to Alpha (Diagrams area).
    first.diagram_nodes.push({
      id: 'user-node-1',
      entity_type: 'BUSINESS_USER',
      entity_id: 'bu-1',
      pos_x: 10,
      pos_y: 10,
      width: 80,
      height: 80,
      parent_node_id: null,
    });
    first.diagram_edges.push({
      id: 'user-edge-1',
      relationship_type: 'USER_INTERACTION',
      relationship_id: '',
      source_node_id: 'user-node-1',
      target_node_id: alpha.id,
      edge_points: [],
    });

    const regenerated = generateSecuritySummaryDiagram(model, ['application', 'service'], first);
    const alphaAfter = regenerated.diagram_nodes.find((n) => n.entity_id === 'app-a')!;
    expect(alphaAfter.id).toBe(alpha.id);
    expect(alphaAfter.pos_x).toBe(900);
    expect(alphaAfter.pos_y).toBe(700);
    // Children re-lay INSIDE the moved parent.
    const payAfter = regenerated.diagram_nodes.find((n) => n.entity_id === 'svc-pay')!;
    expect(payAfter.pos_x).toBeGreaterThan(900);
    expect(payAfter.pos_y).toBeGreaterThan(700);
    // User additions survive; the user edge still points at the stable node id.
    expect(regenerated.diagram_nodes.find((n) => n.id === 'user-node-1')).toBeDefined();
    const userEdge = regenerated.diagram_edges.find((e) => e.id === 'user-edge-1')!;
    expect(userEdge.target_node_id).toBe(alpha.id);
    // Derived movements still present (re-derived, ids reused per pair).
    expect(
      regenerated.diagram_edges.filter((e) => e.relationship_type === 'DATA_MOVEMENT'),
    ).toHaveLength(3);
  });
});

describe('rollUpDataMovementsToDisplayedPairs', () => {
  it('resolves endpoints to the DEEPEST displayed box on their chain', () => {
    const model = fixtureModel();
    const displayed = new Set(['app-a', 'app-b', 'svc-api']);
    // pay is NOT displayed -> its endpoint rolls to app-a; api IS displayed.
    expect(
      rollUpDataMovementsToDisplayedPairs(model, ['application', 'service'], displayed),
    ).toContainEqual({ sourceEntityId: 'app-a', targetEntityId: 'svc-api' });
  });
});

describe('aggregateSecurityCountsToDisplayedEntities', () => {
  const serviceEntries: {
    level: string;
    entity_id: string;
    application_id: string | null;
    application_component_id: string | null;
    counts: Record<string, number>;
  }[] = [
    {
      level: 'service', entity_id: 'svc-pay', application_id: 'app-a',
      application_component_id: 'comp-core', counts: { high: 2 },
    },
    {
      level: 'service', entity_id: 'svc-web', application_id: 'app-a',
      application_component_id: null, counts: { high: 1, low: 3 },
    },
    {
      level: 'service', entity_id: 'svc-api', application_id: 'app-b',
      application_component_id: null, counts: { critical: 1 },
    },
  ];

  it('service counts aggregate UP to app boxes on an application-only display', () => {
    const out = aggregateSecurityCountsToDisplayedEntities(
      serviceEntries, ['application'], new Set(['app-a', 'app-b']));
    expect(out.get('app-a')).toEqual({ high: 3, low: 3 });
    expect(out.get('app-b')).toEqual({ critical: 1 });
  });

  it('service counts land on their own boxes when services are displayed', () => {
    const out = aggregateSecurityCountsToDisplayedEntities(
      serviceEntries, ['application', 'service'],
      new Set(['app-a', 'app-b', 'svc-pay', 'svc-web', 'svc-api']));
    expect(out.get('svc-pay')).toEqual({ high: 2 });
    expect(out.get('app-a')).toBeUndefined();
  });

  it('application-level entries land on app boxes even with deeper display levels', () => {
    const appEntries = [{
      level: 'application', entity_id: 'app-a', application_id: 'app-a',
      application_component_id: null, counts: { medium: 5 },
    }];
    const out = aggregateSecurityCountsToDisplayedEntities(
      appEntries, ['application', 'service'], new Set(['app-a', 'svc-pay']));
    expect(out.get('app-a')).toEqual({ medium: 5 });
  });
});
