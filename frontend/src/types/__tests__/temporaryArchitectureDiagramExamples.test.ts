/**
 * Tests for Temporary Architecture Diagram JSON Contract - Example JSON Files
 *
 * Spec: 2026-03-26 Temporary Architecture Diagram JSON Contract (ER First)
 * Task Group 2, Task 2.1: 4 focused tests for example JSON validity
 *
 * These tests verify:
 * 1. temporary-er-diagram-logical.json can be imported and satisfies TemporaryArchitectureDiagram
 * 2. temporary-er-diagram-physical.json can be imported and satisfies TemporaryArchitectureDiagram
 * 3. The LOGICAL example uses correct semantic types (LOGICAL_DATA_ENTITY, LOGICAL_DATA_ATTRIBUTE) throughout
 * 4. The PHYSICAL example uses correct semantic types (PHYSICAL_DATA_ENTITY, PHYSICAL_DATA_ATTRIBUTE) throughout
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
  TemporaryArchitectureDiagramEdge,
  TemporaryArchitectureDiagramGroup,
} from '../temporaryArchitectureDiagram';

const examplesDir = path.resolve(__dirname, '../examples');

function loadJsonExample(filename: string): unknown {
  const filePath = path.join(examplesDir, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Runtime shape checker that validates an unknown object satisfies the
 * TemporaryArchitectureDiagram interface structure. This performs structural
 * checks on all required fields and nested arrays.
 */
function assertIsTemporaryArchitectureDiagram(obj: unknown): asserts obj is TemporaryArchitectureDiagram {
  expect(obj).toBeDefined();
  expect(typeof obj).toBe('object');
  expect(obj).not.toBeNull();

  const diagram = obj as Record<string, unknown>;

  // Required top-level fields
  expect(typeof diagram.id).toBe('string');
  expect(typeof diagram.name).toBe('string');
  expect(typeof diagram.diagram_kind).toBe('string');
  expect(typeof diagram.source_architecture_domain).toBe('string');
  expect(typeof diagram.view_mode).toBe('string');
  expect(typeof diagram.version).toBe('number');
  expect(Array.isArray(diagram.nodes)).toBe(true);
  expect(Array.isArray(diagram.edges)).toBe(true);

  // ER-specific top-level values
  expect(diagram.diagram_kind).toBe('ER');
  expect(diagram.source_architecture_domain).toBe('DATA');
  expect(['LOGICAL', 'PHYSICAL']).toContain(diagram.view_mode);
  expect(diagram.version).toBe(1);

  // Validate nodes
  const nodes = diagram.nodes as Record<string, unknown>[];
  expect(nodes.length).toBeGreaterThanOrEqual(3);
  for (const node of nodes) {
    expect(typeof node.id).toBe('string');
    expect(typeof node.node_kind).toBe('string');
    expect(typeof node.semantic_type).toBe('string');
    expect(typeof node.ref_name).toBe('string');
    expect(typeof node.display_name).toBe('string');
    expect(typeof node.pos_x).toBe('number');
    expect(typeof node.pos_y).toBe('number');
    expect(typeof node.width).toBe('number');
    expect(typeof node.height).toBe('number');

    // Validate compartments
    expect(Array.isArray(node.compartments)).toBe(true);
    const compartments = node.compartments as Record<string, unknown>[];
    expect(compartments.length).toBeGreaterThanOrEqual(1);
    for (const comp of compartments) {
      expect(typeof comp.id).toBe('string');
      expect(typeof comp.compartment_kind).toBe('string');
      expect(Array.isArray(comp.items)).toBe(true);
      const items = comp.items as Record<string, unknown>[];
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const item of items) {
        expect(typeof item.id).toBe('string');
        expect(typeof item.item_kind).toBe('string');
        expect(typeof item.ref_name).toBe('string');
        expect(typeof item.display_name).toBe('string');
        expect(typeof item.semantic_type).toBe('string');
      }
    }
  }

  // Validate edges
  const edges = diagram.edges as Record<string, unknown>[];
  expect(edges.length).toBeGreaterThanOrEqual(2);
  for (const edge of edges) {
    expect(typeof edge.id).toBe('string');
    expect(typeof edge.edge_kind).toBe('string');
    expect(typeof edge.semantic_type).toBe('string');
    expect(typeof edge.source_node_id).toBe('string');
    expect(typeof edge.target_node_id).toBe('string');
    expect(typeof edge.source_ref_name).toBe('string');
    expect(typeof edge.target_ref_name).toBe('string');
    expect(Array.isArray(edge.edge_points)).toBe(true);
    const points = edge.edge_points as Record<string, unknown>[];
    expect(points.length).toBeGreaterThanOrEqual(1);
    for (const point of points) {
      expect(typeof point.sequence_order).toBe('number');
      expect(typeof point.pos_x).toBe('number');
      expect(typeof point.pos_y).toBe('number');
    }
  }

  // Validate internal reference consistency: edge node IDs reference existing nodes
  const nodeIds = new Set(nodes.map((n) => n.id as string));
  const nodeRefNames = new Map(nodes.map((n) => [n.id as string, n.ref_name as string]));
  for (const edge of edges) {
    expect(nodeIds.has(edge.source_node_id as string)).toBe(true);
    expect(nodeIds.has(edge.target_node_id as string)).toBe(true);
    // source_ref_name and target_ref_name must match actual node ref_names
    const sourceNode = nodes.find((n) => n.id === edge.source_node_id);
    const targetNode = nodes.find((n) => n.id === edge.target_node_id);
    expect(sourceNode).toBeDefined();
    expect(targetNode).toBeDefined();
    expect(edge.source_ref_name).toBe(sourceNode!.ref_name);
    expect(edge.target_ref_name).toBe(targetNode!.ref_name);
  }

  // Validate groups if present
  if (diagram.groups) {
    expect(Array.isArray(diagram.groups)).toBe(true);
    const groups = diagram.groups as Record<string, unknown>[];
    for (const group of groups) {
      expect(typeof group.id).toBe('string');
      expect(typeof group.group_kind).toBe('string');
      expect(typeof group.pos_x).toBe('number');
      expect(typeof group.pos_y).toBe('number');
      expect(typeof group.width).toBe('number');
      expect(typeof group.height).toBe('number');
      expect(Array.isArray(group.child_node_ids)).toBe(true);
      const childIds = group.child_node_ids as string[];
      for (const childId of childIds) {
        expect(nodeIds.has(childId)).toBe(true);
      }
    }
  }

  // Validate that at least one edge has source_label and target_label
  const edgesWithLabels = edges.filter(
    (e) => e.source_label != null && e.target_label != null
  );
  expect(edgesWithLabels.length).toBeGreaterThanOrEqual(1);
  for (const edge of edgesWithLabels) {
    const sourceLabel = edge.source_label as Record<string, unknown>;
    const targetLabel = edge.target_label as Record<string, unknown>;
    expect(typeof sourceLabel.text).toBe('string');
    expect(typeof sourceLabel.pos_x).toBe('number');
    expect(typeof sourceLabel.pos_y).toBe('number');
    expect(typeof targetLabel.text).toBe('string');
    expect(typeof targetLabel.pos_x).toBe('number');
    expect(typeof targetLabel.pos_y).toBe('number');
  }

  // Validate that at least one edge has cardinality and relationship_type
  const edgesWithRelInfo = edges.filter(
    (e) => e.cardinality != null && e.relationship_type != null
  );
  expect(edgesWithRelInfo.length).toBeGreaterThanOrEqual(2);

  // Validate metadata if present
  if (diagram.metadata) {
    const meta = diagram.metadata as Record<string, unknown>;
    if (meta.created_by_task != null) {
      expect(typeof meta.created_by_task).toBe('string');
    }
    if (meta.notes != null) {
      expect(Array.isArray(meta.notes)).toBe(true);
    }
  }
}

describe('Temporary Architecture Diagram example JSON files', () => {
  /**
   * Test 1: temporary-er-diagram-logical.json can be imported and satisfies TemporaryArchitectureDiagram.
   *
   * Loads the LOGICAL example JSON file, parses it, and verifies it has
   * the correct structure with all required fields, valid internal references,
   * and all major features (compartments, edge labels, edge points, groups, metadata).
   */
  it('temporary-er-diagram-logical.json satisfies TemporaryArchitectureDiagram', () => {
    const logical = loadJsonExample('temporary-er-diagram-logical.json');
    assertIsTemporaryArchitectureDiagram(logical);

    // Additional LOGICAL-specific assertions
    const diagram = logical as TemporaryArchitectureDiagram;
    expect(diagram.view_mode).toBe('LOGICAL');
    expect(diagram.groups).toBeDefined();
    expect(diagram.groups!.length).toBeGreaterThanOrEqual(1);
    expect(diagram.metadata).toBeDefined();
    expect(diagram.metadata!.created_by_task).toBeDefined();
    expect(diagram.metadata!.notes).toBeDefined();
    expect(diagram.metadata!.notes!.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test 2: temporary-er-diagram-physical.json can be imported and satisfies TemporaryArchitectureDiagram.
   *
   * Loads the PHYSICAL example JSON file, parses it, and verifies it has
   * the correct structure with all required fields, valid internal references,
   * and all major features (compartments, edge labels, edge points, groups, metadata).
   */
  it('temporary-er-diagram-physical.json satisfies TemporaryArchitectureDiagram', () => {
    const physical = loadJsonExample('temporary-er-diagram-physical.json');
    assertIsTemporaryArchitectureDiagram(physical);

    // Additional PHYSICAL-specific assertions
    const diagram = physical as TemporaryArchitectureDiagram;
    expect(diagram.view_mode).toBe('PHYSICAL');
    expect(diagram.groups).toBeDefined();
    expect(diagram.groups!.length).toBeGreaterThanOrEqual(1);
    expect(diagram.metadata).toBeDefined();
    expect(diagram.metadata!.created_by_task).toBeDefined();
    expect(diagram.metadata!.notes).toBeDefined();
    expect(diagram.metadata!.notes!.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Test 3: The LOGICAL example uses correct semantic types throughout.
   *
   * Verifies that every node in the LOGICAL example uses semantic_type = "LOGICAL_DATA_ENTITY"
   * and every compartment item uses semantic_type = "LOGICAL_DATA_ATTRIBUTE".
   * No PHYSICAL semantic types should appear in the LOGICAL example.
   */
  it('LOGICAL example uses LOGICAL_DATA_ENTITY and LOGICAL_DATA_ATTRIBUTE semantic types throughout', () => {
    const logical = loadJsonExample('temporary-er-diagram-logical.json') as TemporaryArchitectureDiagram;

    // Every node must use LOGICAL_DATA_ENTITY
    for (const node of logical.nodes) {
      expect(node.semantic_type).toBe('LOGICAL_DATA_ENTITY');

      // Every compartment item must use LOGICAL_DATA_ATTRIBUTE
      if (node.compartments) {
        for (const comp of node.compartments) {
          for (const item of comp.items) {
            expect(item.semantic_type).toBe('LOGICAL_DATA_ATTRIBUTE');
          }
        }
      }
    }

    // Ensure no PHYSICAL semantic types snuck in
    const allNodeSemanticTypes = logical.nodes.map((n) => n.semantic_type);
    expect(allNodeSemanticTypes).not.toContain('PHYSICAL_DATA_ENTITY');

    const allItemSemanticTypes = logical.nodes.flatMap((n) =>
      (n.compartments ?? []).flatMap((c) => c.items.map((i) => i.semantic_type))
    );
    expect(allItemSemanticTypes).not.toContain('PHYSICAL_DATA_ATTRIBUTE');
    expect(allItemSemanticTypes.length).toBeGreaterThan(0);
  });

  /**
   * Test 4: The PHYSICAL example uses correct semantic types throughout.
   *
   * Verifies that every node in the PHYSICAL example uses semantic_type = "PHYSICAL_DATA_ENTITY"
   * and every compartment item uses semantic_type = "PHYSICAL_DATA_ATTRIBUTE".
   * No LOGICAL semantic types should appear in the PHYSICAL example.
   */
  it('PHYSICAL example uses PHYSICAL_DATA_ENTITY and PHYSICAL_DATA_ATTRIBUTE semantic types throughout', () => {
    const physical = loadJsonExample('temporary-er-diagram-physical.json') as TemporaryArchitectureDiagram;

    // Every node must use PHYSICAL_DATA_ENTITY
    for (const node of physical.nodes) {
      expect(node.semantic_type).toBe('PHYSICAL_DATA_ENTITY');

      // Every compartment item must use PHYSICAL_DATA_ATTRIBUTE
      if (node.compartments) {
        for (const comp of node.compartments) {
          for (const item of comp.items) {
            expect(item.semantic_type).toBe('PHYSICAL_DATA_ATTRIBUTE');
          }
        }
      }
    }

    // Ensure no LOGICAL semantic types snuck in
    const allNodeSemanticTypes = physical.nodes.map((n) => n.semantic_type);
    expect(allNodeSemanticTypes).not.toContain('LOGICAL_DATA_ENTITY');

    const allItemSemanticTypes = physical.nodes.flatMap((n) =>
      (n.compartments ?? []).flatMap((c) => c.items.map((i) => i.semantic_type))
    );
    expect(allItemSemanticTypes).not.toContain('LOGICAL_DATA_ATTRIBUTE');
    expect(allItemSemanticTypes.length).toBeGreaterThan(0);
  });
});
