/**
 * UserJourneyOverviewRendererInteraction Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 4, Task 4.1: 5 focused tests for renderer interactions and visual cues
 *
 * Test 1: onNodeClick callback is invoked with correct node data when a node is clicked
 * Test 2: Linked nodes (LINKED status) render with blue color and textDecoration="underline" on the name div element
 * Test 3: Unlinked nodes retain default styling (dark color, no underline, default cursor)
 * Test 4: AMBIGUOUS_RESOLVED nodes receive the same visual treatment as LINKED nodes (blue + underline + pointer)
 * Test 5: Nodes without link field (backward compat) render with default/unlinked styling
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type {
  UserJourneyOverviewDiagramDto,
  UserJourneyOverviewNodeDto,
  UserJourneyOverviewNodeLinkDto,
} from '../../../types/userJourneyOverviewDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

/** JSDOM normalizes CSS colors to rgb() format; these are the expected computed values */
const LINKED_COLOR = 'rgb(25, 118, 210)';   // #1976D2
const DEFAULT_COLOR = 'rgb(51, 51, 51)';    // #333

function createNodeWithLink(
  id: string,
  name: string,
  laneId: string,
  link?: UserJourneyOverviewNodeLinkDto
): UserJourneyOverviewNodeDto {
  return {
    id,
    lane_id: laneId,
    name,
    description: `Description for ${name}`,
    primary_business_user_id: 'bu-1',
    primary_business_user_name: 'Customer',
    parent_business_process_id: 'bp-1',
    parent_business_process_name: 'Sales',
    metadata: { step_count: 3, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
    ...(link !== undefined ? { link } : {}),
  };
}

function createTestDto(
  nodes: UserJourneyOverviewNodeDto[]
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [{ id: 'lane-1', name: 'Sales', order: 0 }],
    nodes,
    edges: [],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
  };
}

function renderInSvg(element: React.ReactElement) {
  return render(<svg>{element}</svg>);
}

/**
 * Helper to find the primary name <div> element within a node group's foreignObject.
 * The name is rendered as an HTML div inside a foreignObject for word wrapping.
 */
function findNameDivElement(container: HTMLElement, nodeId: string): HTMLDivElement | null {
  const nodeGroup = container.querySelector(`[data-testid="overview-node-${nodeId}"]`);
  if (!nodeGroup) return null;
  const foreignObject = nodeGroup.querySelector(':scope > foreignObject');
  if (!foreignObject) return null;
  return foreignObject.querySelector('div') as HTMLDivElement | null;
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyOverviewDiagramRenderer - Interaction Layer (Task Group 4)', () => {
  it('Test 1: onNodeClick callback is invoked with correct node data when a node is clicked', () => {
    const linkedNode = createNodeWithLink('node-click', 'Click Target', 'lane-1', {
      linked_diagram_id: 'diag-123',
      linked_diagram_name: 'Detailed Journey',
      link_status: 'LINKED',
    });
    const dto = createTestDto([linkedNode]);
    const onNodeClick = vi.fn();

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    const nodeGroup = container.querySelector('[data-testid="overview-node-node-click"]');
    expect(nodeGroup).not.toBeNull();

    fireEvent.click(nodeGroup!);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(linkedNode);
  });

  it('Test 2: linked nodes (LINKED status) render with blue color and textDecoration="underline" on the name div element', () => {
    const linkedNode = createNodeWithLink('node-linked', 'Linked Journey', 'lane-1', {
      linked_diagram_id: 'diag-456',
      linked_diagram_name: 'Detail Diagram',
      link_status: 'LINKED',
    });
    const dto = createTestDto([linkedNode]);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const nameDiv = findNameDivElement(container, 'node-linked');
    expect(nameDiv).not.toBeNull();
    expect(nameDiv!.style.color).toBe(LINKED_COLOR);
    expect(nameDiv!.style.textDecoration).toBe('underline');

    // The node group should also have pointer cursor
    const nodeGroup = container.querySelector('[data-testid="overview-node-node-linked"]');
    expect(nodeGroup).not.toBeNull();
    expect((nodeGroup as SVGGElement).style.cursor).toBe('pointer');
  });

  it('Test 3: unlinked nodes retain default styling (dark color, no underline, default cursor)', () => {
    const unlinkedNode = createNodeWithLink('node-unlinked', 'Unlinked Journey', 'lane-1', {
      linked_diagram_id: null,
      linked_diagram_name: null,
      link_status: 'UNLINKED',
    });
    const dto = createTestDto([unlinkedNode]);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const nameDiv = findNameDivElement(container, 'node-unlinked');
    expect(nameDiv).not.toBeNull();
    expect(nameDiv!.style.color).toBe(DEFAULT_COLOR);
    // No underline on unlinked node
    const textDec = nameDiv!.style.textDecoration;
    expect(textDec === '' || textDec === 'none').toBe(true);

    // Cursor should be default for unlinked nodes
    const nodeGroup = container.querySelector('[data-testid="overview-node-node-unlinked"]');
    expect(nodeGroup).not.toBeNull();
    expect((nodeGroup as SVGGElement).style.cursor).toBe('default');
  });

  it('Test 4: AMBIGUOUS_RESOLVED nodes receive the same visual treatment as LINKED nodes (blue + underline + pointer)', () => {
    const ambiguousNode = createNodeWithLink('node-ambiguous', 'Ambiguous Journey', 'lane-1', {
      linked_diagram_id: 'diag-resolved',
      linked_diagram_name: 'Resolved Diagram',
      link_status: 'AMBIGUOUS_RESOLVED',
    });
    const dto = createTestDto([ambiguousNode]);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const nameDiv = findNameDivElement(container, 'node-ambiguous');
    expect(nameDiv).not.toBeNull();
    expect(nameDiv!.style.color).toBe(LINKED_COLOR);
    expect(nameDiv!.style.textDecoration).toBe('underline');

    // Pointer cursor for ambiguous resolved nodes
    const nodeGroup = container.querySelector('[data-testid="overview-node-node-ambiguous"]');
    expect(nodeGroup).not.toBeNull();
    expect((nodeGroup as SVGGElement).style.cursor).toBe('pointer');
  });

  it('Test 5: nodes without link field (backward compat) render with default/unlinked styling', () => {
    // Create node WITHOUT link field at all (simulating pre-increment-14 saved overview)
    const backwardCompatNode = createNodeWithLink('node-nolink', 'Legacy Journey', 'lane-1');
    // Verify no link field exists
    expect(backwardCompatNode.link).toBeUndefined();

    const dto = createTestDto([backwardCompatNode]);

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    const nameDiv = findNameDivElement(container, 'node-nolink');
    expect(nameDiv).not.toBeNull();
    expect(nameDiv!.style.color).toBe(DEFAULT_COLOR);
    const textDec = nameDiv!.style.textDecoration;
    expect(textDec === '' || textDec === 'none').toBe(true);

    // Cursor should be default for nodes without link
    const nodeGroup = container.querySelector('[data-testid="overview-node-node-nolink"]');
    expect(nodeGroup).not.toBeNull();
    expect((nodeGroup as SVGGElement).style.cursor).toBe('default');
  });
});
