/**
 * Tests for Security Summary diagram generation (Security health dashboard,
 * 2026-07-19, Spec 3 of 3): application-point roll-up (component/service ->
 * parent application), directed-pair dedupe + self-loop dropping, grid
 * generation, and position-preserving regeneration.
 */

import { describe, expect, it } from 'vitest';
import type { Diagram, MetaModel } from '../types/model';
import {
  generateSecuritySummaryDiagram,
  rollUpDataMovementsToApplicationPairs,
} from './securitySummaryDiagram';

/** Minimal meta-model: 3 apps; a service under app-b; movements a->b (twice, via service), b->c, and a self-loop. */
function fixtureModel(): MetaModel {
  return {
    entities: {
      applications: [
        { id: 'app-a', name: 'Alpha', abbreviation: 'A' },
        { id: 'app-b', name: 'Beta', abbreviation: 'B' },
        { id: 'app-c', name: 'Gamma', abbreviation: 'C' },
      ],
      app_components: [{ id: 'comp-b', application_id: 'app-b', name: 'Core' }],
      services: [
        { id: 'svc-b', application_id: '', app_component_id: 'comp-b', name: 'Svc' },
      ],
      application_points: [
        { id: 'ap-a', kind: 'APPLICATION', application_id: 'app-a' },
        { id: 'ap-b-svc', kind: 'SERVICE', application_id: '', service_id: 'svc-b' },
        { id: 'ap-b', kind: 'APPLICATION', application_id: 'app-b' },
        { id: 'ap-c', kind: 'APPLICATION', application_id: 'app-c' },
      ],
    },
    relationships: {
      data_movements: [
        {
          id: 'dm-1',
          source_application_point_id: 'ap-a',
          target_application_point_id: 'ap-b-svc',
        },
        {
          id: 'dm-2',
          source_application_point_id: 'ap-a',
          target_application_point_id: 'ap-b',
        },
        {
          id: 'dm-3',
          source_application_point_id: 'ap-b',
          target_application_point_id: 'ap-c',
        },
        {
          id: 'dm-self',
          source_application_point_id: 'ap-b-svc',
          target_application_point_id: 'ap-b',
        },
      ],
    },
  } as unknown as MetaModel;
}

describe('rollUpDataMovementsToApplicationPairs', () => {
  it('resolves service endpoints to the parent application, dedupes directed pairs, and drops self-loops', () => {
    expect(rollUpDataMovementsToApplicationPairs(fixtureModel())).toEqual([
      { sourceApplicationId: 'app-a', targetApplicationId: 'app-b' },
      { sourceApplicationId: 'app-b', targetApplicationId: 'app-c' },
    ]);
  });
});

describe('generateSecuritySummaryDiagram', () => {
  it('generates one APPLICATION node per app on a grid plus DATA_MOVEMENT edges between them', () => {
    const diagram = generateSecuritySummaryDiagram(fixtureModel());
    expect(diagram.diagram_type).toBe('SECURITY_SUMMARY');
    expect(diagram.diagram_nodes).toHaveLength(3);
    expect(new Set(diagram.diagram_nodes.map((n) => n.entity_type))).toEqual(
      new Set(['APPLICATION']),
    );
    expect(diagram.diagram_edges).toHaveLength(2);
    const nodeByEntity = new Map(diagram.diagram_nodes.map((n) => [n.entity_id, n]));
    const ab = diagram.diagram_edges[0];
    expect(ab.relationship_type).toBe('DATA_MOVEMENT');
    expect(ab.source_node_id).toBe(nodeByEntity.get('app-a')!.id);
    expect(ab.target_node_id).toBe(nodeByEntity.get('app-b')!.id);
    // Grid layout: nodes don't overlap (distinct positions).
    const positions = new Set(diagram.diagram_nodes.map((n) => `${n.pos_x},${n.pos_y}`));
    expect(positions.size).toBe(3);
  });

  it('regeneration preserves surviving node positions/ids, appends new apps below, and removes vanished apps', () => {
    const model = fixtureModel();
    const first = generateSecuritySummaryDiagram(model);
    // User rearranges Alpha's box.
    const alpha = first.diagram_nodes.find((n) => n.entity_id === 'app-a')!;
    alpha.pos_x = 999;
    alpha.pos_y = 555;

    // Model changes: Gamma removed, Delta added.
    const changed = fixtureModel();
    changed.entities.applications = [
      ...changed.entities.applications.filter((a) => a.id !== 'app-c'),
      { id: 'app-d', name: 'Delta', abbreviation: 'D' },
    ] as MetaModel['entities']['applications'];

    const regenerated = generateSecuritySummaryDiagram(changed, first as Diagram);
    expect(regenerated.id).toBe(first.id);
    const alphaAfter = regenerated.diagram_nodes.find((n) => n.entity_id === 'app-a')!;
    expect(alphaAfter.id).toBe(alpha.id);
    expect(alphaAfter.pos_x).toBe(999);
    expect(alphaAfter.pos_y).toBe(555);
    expect(regenerated.diagram_nodes.map((n) => n.entity_id)).not.toContain('app-c');
    const delta = regenerated.diagram_nodes.find((n) => n.entity_id === 'app-d')!;
    // New boxes land BELOW the preserved layout, never on top of it.
    const preservedBottom = Math.max(
      ...regenerated.diagram_nodes
        .filter((n) => n.entity_id !== 'app-d')
        .map((n) => n.pos_y + n.height),
    );
    expect(delta.pos_y).toBeGreaterThan(preservedBottom - delta.height);
    // The b->c edge vanished with Gamma.
    expect(regenerated.diagram_edges).toHaveLength(1);
  });
});
