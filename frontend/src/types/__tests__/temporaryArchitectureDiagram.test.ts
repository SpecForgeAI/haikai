/**
 * Tests for Temporary Architecture Diagram JSON Contract - Core Interfaces
 *
 * Spec: 2026-03-26 Temporary Architecture Diagram JSON Contract (ER First)
 * Task Group 1, Task 1.1: 4 focused tests for core type structure and constraints
 *
 * These tests verify:
 * 1. TemporaryArchitectureDiagram requires all mandatory fields
 * 2. A well-formed LOGICAL ER diagram object satisfies the interface
 * 3. A well-formed PHYSICAL ER diagram object satisfies the interface
 * 4. The version constant starts at 1
 */

import { describe, it, expect } from 'vitest';
import type {
  TemporaryArchitectureDiagram,
  TemporaryArchitectureDiagramNode,
  TemporaryArchitectureDiagramEdge,
  TemporaryArchitectureDiagramPoint,
  TemporaryArchitectureDiagramCompartment,
  TemporaryArchitectureDiagramCompartmentItem,
  TemporaryArchitectureDiagramGroup,
} from '../temporaryArchitectureDiagram';
import { TEMPORARY_ARCHITECTURE_DIAGRAM_VERSION } from '../temporaryArchitectureDiagram';

describe('TemporaryArchitectureDiagram core interfaces', () => {
  /**
   * Test 1: TemporaryArchitectureDiagram requires all mandatory fields.
   *
   * Verifies that a runtime object with all 8 mandatory fields
   * (id, name, diagram_kind, source_architecture_domain, view_mode, version, nodes, edges)
   * satisfies the interface by checking their presence and correct types.
   */
  it('requires all mandatory fields on TemporaryArchitectureDiagram', () => {
    const diagram: TemporaryArchitectureDiagram = {
      id: 'diag-001',
      name: 'Test Diagram',
      diagram_kind: 'ER',
      source_architecture_domain: 'DATA',
      view_mode: 'LOGICAL',
      version: 1,
      nodes: [],
      edges: [],
    };

    // All 8 mandatory fields must be present and have correct types
    expect(typeof diagram.id).toBe('string');
    expect(typeof diagram.name).toBe('string');
    expect(typeof diagram.diagram_kind).toBe('string');
    expect(typeof diagram.source_architecture_domain).toBe('string');
    expect(typeof diagram.view_mode).toBe('string');
    expect(typeof diagram.version).toBe('number');
    expect(Array.isArray(diagram.nodes)).toBe(true);
    expect(Array.isArray(diagram.edges)).toBe(true);

    // Optional fields should be undefined when not provided
    expect(diagram.description).toBeUndefined();
    expect(diagram.groups).toBeUndefined();
    expect(diagram.metadata).toBeUndefined();
  });

  /**
   * Test 2: A well-formed LOGICAL ER diagram object satisfies the interface.
   *
   * Constructs a complete LOGICAL ER diagram with nodes (LOGICAL_DATA_ENTITY),
   * compartments (LOGICAL_DATA_ATTRIBUTE), edges with cardinality and
   * relationship_type, edge_points, labels, and groups.
   */
  it('accepts a well-formed LOGICAL ER diagram object', () => {
    const point: TemporaryArchitectureDiagramPoint = {
      sequence_order: 1,
      pos_x: 100,
      pos_y: 200,
    };

    const attributeItem: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'attr-001',
      item_kind: 'ATTRIBUTE',
      ref_name: 'customer_id',
      display_name: 'Customer ID',
      semantic_type: 'LOGICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: true,
        is_foreign_key: false,
        data_type: 'String',
        is_nullable: false,
      },
    };

    const compartment: TemporaryArchitectureDiagramCompartment = {
      id: 'comp-001',
      compartment_kind: 'ATTRIBUTES',
      items: [attributeItem],
    };

    const node: TemporaryArchitectureDiagramNode = {
      id: 'node-001',
      node_kind: 'ENTITY',
      semantic_type: 'LOGICAL_DATA_ENTITY',
      ref_name: 'Customer',
      display_name: 'Customer',
      pos_x: 50,
      pos_y: 50,
      width: 200,
      height: 150,
      z_index: 10,
      compartments: [compartment],
      style: {
        background_color: '#FFFFFF',
        line_color: '#000000',
        text_color: '#333333',
      },
      metadata: {
        is_primary: true,
        is_reference: false,
        tags: ['core-entity'],
      },
    };

    const targetNode: TemporaryArchitectureDiagramNode = {
      id: 'node-002',
      node_kind: 'ENTITY',
      semantic_type: 'LOGICAL_DATA_ENTITY',
      ref_name: 'Order',
      display_name: 'Order',
      pos_x: 350,
      pos_y: 50,
      width: 200,
      height: 150,
    };

    const edge: TemporaryArchitectureDiagramEdge = {
      id: 'edge-001',
      edge_kind: 'RELATIONSHIP',
      semantic_type: 'DATA_ENTITY_RELATIONSHIP',
      source_node_id: 'node-001',
      target_node_id: 'node-002',
      source_ref_name: 'Customer',
      target_ref_name: 'Order',
      edge_points: [point, { sequence_order: 2, pos_x: 300, pos_y: 200 }],
      relationship_type: 'ASSOCIATION',
      cardinality: 'ONE_TO_MANY',
      relationship_hint: 'A customer places many orders',
      source_label: { text: '1', pos_x: 110, pos_y: 190 },
      target_label: { text: '*', pos_x: 290, pos_y: 190 },
      style: {
        line_color: '#666666',
        line_type: 'SOLID',
        line_weight: 2,
      },
      metadata: {
        optionality: 'REQUIRED',
        notes: ['Primary relationship'],
      },
    };

    const group: TemporaryArchitectureDiagramGroup = {
      id: 'group-001',
      group_kind: 'SCHEMA',
      pos_x: 30,
      pos_y: 30,
      width: 540,
      height: 200,
      child_node_ids: ['node-001', 'node-002'],
      ref_name: 'core_schema',
      display_name: 'Core Schema',
      style: {
        background_color: '#F0F0F0',
        line_color: '#CCCCCC',
        text_color: '#999999',
      },
    };

    const diagram: TemporaryArchitectureDiagram = {
      id: 'diag-logical-001',
      name: 'Customer Orders Logical ER',
      diagram_kind: 'ER',
      source_architecture_domain: 'DATA',
      view_mode: 'LOGICAL',
      version: 1,
      nodes: [node, targetNode],
      edges: [edge],
      description: 'Logical ER diagram showing customer-order relationships',
      groups: [group],
      metadata: {
        created_by_task: 'generate-er-diagram',
        notes: ['Generated by LLM agent'],
      },
    };

    // Verify top-level structure
    expect(diagram.diagram_kind).toBe('ER');
    expect(diagram.view_mode).toBe('LOGICAL');
    expect(diagram.source_architecture_domain).toBe('DATA');
    expect(diagram.version).toBe(1);
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.groups).toHaveLength(1);

    // Verify LOGICAL semantic types
    expect(diagram.nodes[0].semantic_type).toBe('LOGICAL_DATA_ENTITY');
    expect(diagram.nodes[0].compartments![0].items[0].semantic_type).toBe('LOGICAL_DATA_ATTRIBUTE');

    // Verify edge properties
    expect(diagram.edges[0].relationship_type).toBe('ASSOCIATION');
    expect(diagram.edges[0].cardinality).toBe('ONE_TO_MANY');
    expect(diagram.edges[0].source_label?.text).toBe('1');
    expect(diagram.edges[0].target_label?.text).toBe('*');
    expect(diagram.edges[0].edge_points).toHaveLength(2);
  });

  /**
   * Test 3: A well-formed PHYSICAL ER diagram object satisfies the interface.
   *
   * Constructs a complete PHYSICAL ER diagram with nodes (PHYSICAL_DATA_ENTITY),
   * compartments (PHYSICAL_DATA_ATTRIBUTE with concrete data types), and
   * edges with cardinality.
   */
  it('accepts a well-formed PHYSICAL ER diagram object', () => {
    const physicalAttribute: TemporaryArchitectureDiagramCompartmentItem = {
      id: 'pattr-001',
      item_kind: 'ATTRIBUTE',
      ref_name: 'customer_id',
      display_name: 'customer_id',
      semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
      metadata: {
        is_primary_key: true,
        is_foreign_key: false,
        data_type: 'BIGINT',
        is_nullable: false,
      },
    };

    const physicalNode: TemporaryArchitectureDiagramNode = {
      id: 'pnode-001',
      node_kind: 'ENTITY',
      semantic_type: 'PHYSICAL_DATA_ENTITY',
      ref_name: 'customers',
      display_name: 'customers',
      pos_x: 50,
      pos_y: 50,
      width: 220,
      height: 160,
      compartments: [{
        id: 'pcomp-001',
        compartment_kind: 'ATTRIBUTES',
        items: [physicalAttribute],
      }],
    };

    const physicalTargetNode: TemporaryArchitectureDiagramNode = {
      id: 'pnode-002',
      node_kind: 'ENTITY',
      semantic_type: 'PHYSICAL_DATA_ENTITY',
      ref_name: 'orders',
      display_name: 'orders',
      pos_x: 350,
      pos_y: 50,
      width: 220,
      height: 160,
      compartments: [{
        id: 'pcomp-002',
        compartment_kind: 'ATTRIBUTES',
        items: [{
          id: 'pattr-002',
          item_kind: 'ATTRIBUTE',
          ref_name: 'order_id',
          display_name: 'order_id',
          semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
          metadata: {
            is_primary_key: true,
            data_type: 'BIGINT',
            is_nullable: false,
          },
        }, {
          id: 'pattr-003',
          item_kind: 'ATTRIBUTE',
          ref_name: 'customer_id',
          display_name: 'customer_id',
          semantic_type: 'PHYSICAL_DATA_ATTRIBUTE',
          metadata: {
            is_primary_key: false,
            is_foreign_key: true,
            data_type: 'BIGINT',
            is_nullable: false,
          },
        }],
      }],
    };

    const physicalEdge: TemporaryArchitectureDiagramEdge = {
      id: 'pedge-001',
      edge_kind: 'RELATIONSHIP',
      semantic_type: 'DATA_ENTITY_RELATIONSHIP',
      source_node_id: 'pnode-001',
      target_node_id: 'pnode-002',
      source_ref_name: 'customers',
      target_ref_name: 'orders',
      edge_points: [
        { sequence_order: 1, pos_x: 270, pos_y: 130 },
        { sequence_order: 2, pos_x: 350, pos_y: 130 },
      ],
      relationship_type: 'ASSOCIATION',
      cardinality: 'ONE_TO_MANY',
      source_item_ref_name: 'customer_id',
      target_item_ref_name: 'customer_id',
    };

    const diagram: TemporaryArchitectureDiagram = {
      id: 'diag-physical-001',
      name: 'Customer Orders Physical ER',
      diagram_kind: 'ER',
      source_architecture_domain: 'DATA',
      view_mode: 'PHYSICAL',
      version: 1,
      nodes: [physicalNode, physicalTargetNode],
      edges: [physicalEdge],
    };

    // Verify top-level structure
    expect(diagram.diagram_kind).toBe('ER');
    expect(diagram.view_mode).toBe('PHYSICAL');
    expect(diagram.version).toBe(1);
    expect(diagram.nodes).toHaveLength(2);
    expect(diagram.edges).toHaveLength(1);

    // Verify PHYSICAL semantic types
    expect(diagram.nodes[0].semantic_type).toBe('PHYSICAL_DATA_ENTITY');
    expect(diagram.nodes[0].compartments![0].items[0].semantic_type).toBe('PHYSICAL_DATA_ATTRIBUTE');
    expect(diagram.nodes[1].compartments![0].items[1].metadata?.is_foreign_key).toBe(true);

    // Verify attribute-level edge endpoints
    expect(diagram.edges[0].source_item_ref_name).toBe('customer_id');
    expect(diagram.edges[0].target_item_ref_name).toBe('customer_id');

    // Verify physical data types
    expect(diagram.nodes[0].compartments![0].items[0].metadata?.data_type).toBe('BIGINT');
  });

  /**
   * Test 4: The version constant starts at 1.
   *
   * Verifies that the exported TEMPORARY_ARCHITECTURE_DIAGRAM_VERSION constant
   * is set to 1, matching the contract's initial version requirement.
   */
  it('version constant starts at 1', () => {
    expect(TEMPORARY_ARCHITECTURE_DIAGRAM_VERSION).toBe(1);
  });
});
