/**
 * UserJourneyOverviewDiagramRenderer Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 6, Task 6.1: 4 focused tests for the overview SVG renderer
 *
 * Test 1: Renderer renders correct number of lane bands and lane header labels for a multi-lane overview DTO
 * Test 2: Renderer renders correct number of journey node rectangles with name labels
 * Test 3: Renderer renders edge lines with arrowhead markers between connected nodes
 * Test 4: Renderer renders empty diagram message when DTO has zero lanes and zero nodes
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer, {
  computeOverviewContentBounds,
} from '../UserJourneyOverviewDiagramRenderer';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestOverviewDto(
  overrides: Partial<UserJourneyOverviewDiagramDto> = {}
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [
      { id: 'lane-sales', name: 'Sales', order: 0 },
      { id: 'lane-support', name: 'Support', order: 1 },
      { id: 'lane-billing', name: 'Billing', order: 2 },
    ],
    nodes: [
      {
        id: 'node-1',
        lane_id: 'lane-sales',
        name: 'Browse Products',
        description: 'Customer browses products in the catalog',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-sales',
        parent_business_process_name: 'Sales',
        metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
      },
      {
        id: 'node-2',
        lane_id: 'lane-sales',
        name: 'Place Order',
        description: 'Customer places an order',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-sales',
        parent_business_process_name: 'Sales',
        metadata: { step_count: 3, application_count: 1, relationship_in_count: 1, relationship_out_count: 1 },
      },
      {
        id: 'node-3',
        lane_id: 'lane-support',
        name: 'Contact Support',
        description: 'Customer contacts support for help',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-support',
        parent_business_process_name: 'Support',
        metadata: { step_count: 4, application_count: 3, relationship_in_count: 1, relationship_out_count: 0 },
      },
      {
        id: 'node-4',
        lane_id: 'lane-billing',
        name: 'Pay Invoice',
        description: 'Customer pays an invoice',
        primary_business_user_id: 'bu-1',
        primary_business_user_name: 'Customer',
        parent_business_process_id: 'bp-billing',
        parent_business_process_name: 'Billing',
        metadata: { step_count: 2, application_count: 1, relationship_in_count: 0, relationship_out_count: 1 },
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source_node_id: 'node-1',
        target_node_id: 'node-2',
        relationship_type: 'SEQUENTIAL',
        label: 'leads to',
        description: 'Browse leads to placing an order',
      },
      {
        id: 'edge-2',
        source_node_id: 'node-2',
        target_node_id: 'node-3',
        relationship_type: 'TRIGGERS',
        label: 'triggers',
        description: 'Order may trigger support',
      },
    ],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
    ...overrides,
  };
}

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyOverviewDiagramRenderer', () => {
  it('Test 1: renders correct number of lane bands and lane header labels for a multi-lane overview DTO', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    // Should have 3 lanes
    const laneBands = container.querySelectorAll('[data-testid^="overview-lane-"]');
    expect(laneBands.length).toBe(3);

    // Each lane should have a label text
    const lane1 = container.querySelector('[data-testid="overview-lane-lane-sales"]');
    expect(lane1).not.toBeNull();
    expect(lane1!.textContent).toContain('Sales');

    const lane2 = container.querySelector('[data-testid="overview-lane-lane-support"]');
    expect(lane2).not.toBeNull();
    expect(lane2!.textContent).toContain('Support');

    const lane3 = container.querySelector('[data-testid="overview-lane-lane-billing"]');
    expect(lane3).not.toBeNull();
    expect(lane3!.textContent).toContain('Billing');
  });

  it('Test 2: renders correct number of journey node rectangles with name labels', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    // Should have 4 node groups
    const nodeGroups = container.querySelectorAll('[data-testid^="overview-node-"]');
    expect(nodeGroups.length).toBe(4);

    // Each node should contain the journey name
    const node1 = container.querySelector('[data-testid="overview-node-node-1"]');
    expect(node1).not.toBeNull();
    expect(node1!.textContent).toContain('Browse Products');

    const node2 = container.querySelector('[data-testid="overview-node-node-2"]');
    expect(node2).not.toBeNull();
    expect(node2!.textContent).toContain('Place Order');

    const node3 = container.querySelector('[data-testid="overview-node-node-3"]');
    expect(node3).not.toBeNull();
    expect(node3!.textContent).toContain('Contact Support');

    const node4 = container.querySelector('[data-testid="overview-node-node-4"]');
    expect(node4).not.toBeNull();
    expect(node4!.textContent).toContain('Pay Invoice');
  });

  it('Test 3: renders edge lines with arrowhead markers between connected nodes', () => {
    const dto = createTestOverviewDto();
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    // Should have 2 edge lines (use line element selector to exclude edge label text elements)
    const edgeLines = container.querySelectorAll('line[data-testid^="overview-edge-"]');
    expect(edgeLines.length).toBe(2);

    // Each edge line should have a marker-end attribute pointing to the arrowhead
    const edge1 = container.querySelector('line[data-testid="overview-edge-edge-1"]');
    expect(edge1).not.toBeNull();
    const markerEnd1 = edge1!.getAttribute('marker-end');
    expect(markerEnd1).toBeTruthy();
    expect(markerEnd1).toContain('url(#overview-arrow)');

    const edge2 = container.querySelector('line[data-testid="overview-edge-edge-2"]');
    expect(edge2).not.toBeNull();
    const markerEnd2 = edge2!.getAttribute('marker-end');
    expect(markerEnd2).toBeTruthy();
    expect(markerEnd2).toContain('url(#overview-arrow)');

    // Verify arrowhead marker definition exists in defs
    const defs = container.querySelector('defs');
    expect(defs).not.toBeNull();
    const marker = defs!.querySelector('marker[id="overview-arrow"]');
    expect(marker).not.toBeNull();
  });

  it('Test 4: renders empty diagram message when DTO has zero lanes and zero nodes', () => {
    const dto = createTestOverviewDto({
      lanes: [],
      nodes: [],
      edges: [],
    });
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const renderer = container.querySelector('[data-testid="overview-diagram-renderer"]');
    expect(renderer).not.toBeNull();
    expect(renderer!.textContent).toContain('no lanes or journeys');

    // Should NOT render any lanes or nodes
    const lanes = container.querySelectorAll('[data-testid^="overview-lane-"]');
    expect(lanes.length).toBe(0);
    const nodes = container.querySelectorAll('[data-testid^="overview-node-"]');
    expect(nodes.length).toBe(0);
  });
});
