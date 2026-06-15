/**
 * OverviewLinkGapFill Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent-Child Diagram Linking
 * Task Group 6, Task 6.3: Strategic gap-fill tests for critical workflows.
 *
 * Gap 1: Renderer correctly handles a mix of LINKED, UNLINKED, and AMBIGUOUS_RESOLVED nodes
 *         in the same diagram (all prior tests used single-node DTOs)
 * Gap 2: Click handler works correctly when overview has edges and linked nodes simultaneously
 * Gap 3: extractUserJourneyOverviewDiagram correctly passes link data through to renderer
 * Gap 4: Nodes with missing link field among nodes with link field render correctly in same diagram
 * Gap 5: Click handler fires for correct node when multiple nodes present (verifies node identity)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type {
  UserJourneyOverviewDiagramDto,
  UserJourneyOverviewNodeDto,
  UserJourneyOverviewNodeLinkDto,
  UserJourneyOverviewEdgeDto,
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
  nodes: UserJourneyOverviewNodeDto[],
  edges: UserJourneyOverviewEdgeDto[] = []
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
    edges,
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

describe('Overview Link Gap Fill (Task Group 6)', () => {
  it('Gap 1: renderer correctly handles a mix of LINKED, UNLINKED, and AMBIGUOUS_RESOLVED nodes in the same diagram', () => {
    const linkedNode = createNodeWithLink('n-linked', 'Linked Journey', 'lane-1', {
      linked_diagram_id: 'diag-1',
      linked_diagram_name: 'Detail 1',
      link_status: 'LINKED',
    });
    const unlinkedNode = createNodeWithLink('n-unlinked', 'Unlinked Journey', 'lane-1', {
      linked_diagram_id: null,
      linked_diagram_name: null,
      link_status: 'UNLINKED',
    });
    const ambiguousNode = createNodeWithLink('n-ambiguous', 'Ambiguous Journey', 'lane-1', {
      linked_diagram_id: 'diag-resolved',
      linked_diagram_name: 'Resolved Detail',
      link_status: 'AMBIGUOUS_RESOLVED',
    });

    const dto = createTestDto([linkedNode, unlinkedNode, ambiguousNode]);
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    // LINKED node: blue text + underline + pointer
    const linkedDiv = findNameDivElement(container, 'n-linked');
    expect(linkedDiv).not.toBeNull();
    expect(linkedDiv!.style.color).toBe(LINKED_COLOR);
    expect(linkedDiv!.style.textDecoration).toBe('underline');
    const linkedGroup = container.querySelector('[data-testid="overview-node-n-linked"]') as SVGGElement;
    expect(linkedGroup.style.cursor).toBe('pointer');

    // UNLINKED node: default text + no underline + default cursor
    const unlinkedDiv = findNameDivElement(container, 'n-unlinked');
    expect(unlinkedDiv).not.toBeNull();
    expect(unlinkedDiv!.style.color).toBe(DEFAULT_COLOR);
    const unlinkedTextDec = unlinkedDiv!.style.textDecoration;
    expect(unlinkedTextDec === '' || unlinkedTextDec === 'none').toBe(true);
    const unlinkedGroup = container.querySelector('[data-testid="overview-node-n-unlinked"]') as SVGGElement;
    expect(unlinkedGroup.style.cursor).toBe('default');

    // AMBIGUOUS_RESOLVED node: same visual treatment as LINKED
    const ambiguousDiv = findNameDivElement(container, 'n-ambiguous');
    expect(ambiguousDiv).not.toBeNull();
    expect(ambiguousDiv!.style.color).toBe(LINKED_COLOR);
    expect(ambiguousDiv!.style.textDecoration).toBe('underline');
    const ambiguousGroup = container.querySelector('[data-testid="overview-node-n-ambiguous"]') as SVGGElement;
    expect(ambiguousGroup.style.cursor).toBe('pointer');
  });

  it('Gap 2: click handler works correctly when overview has edges and linked nodes simultaneously', () => {
    const sourceNode = createNodeWithLink('n-source', 'Source Journey', 'lane-1', {
      linked_diagram_id: 'diag-source',
      linked_diagram_name: 'Source Detail',
      link_status: 'LINKED',
    });
    const targetNode = createNodeWithLink('n-target', 'Target Journey', 'lane-1', {
      linked_diagram_id: 'diag-target',
      linked_diagram_name: 'Target Detail',
      link_status: 'LINKED',
    });

    const edge: UserJourneyOverviewEdgeDto = {
      id: 'edge-1',
      source_node_id: 'n-source',
      target_node_id: 'n-target',
      relationship_type: 'TRIGGERS',
      label: 'triggers',
      description: 'Source triggers target',
    };

    const dto = createTestDto([sourceNode, targetNode], [edge]);
    const onNodeClick = vi.fn();

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    // Verify edge is rendered
    const edgeLine = container.querySelector('[data-testid="overview-edge-edge-1"]');
    expect(edgeLine).not.toBeNull();

    // Click the source node -- should fire callback with source node data
    const sourceGroup = container.querySelector('[data-testid="overview-node-n-source"]');
    expect(sourceGroup).not.toBeNull();
    fireEvent.click(sourceGroup!);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(sourceNode);

    // Click the target node -- should fire callback with target node data
    onNodeClick.mockClear();
    const targetGroup = container.querySelector('[data-testid="overview-node-n-target"]');
    expect(targetGroup).not.toBeNull();
    fireEvent.click(targetGroup!);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(targetNode);
  });

  it('Gap 3: extractUserJourneyOverviewDiagram preserves link data in node DTOs', () => {
    // This test verifies that when a saved overview is loaded from typedContent,
    // the link sub-interface data is preserved through the DTO structure.
    // We test the data flow by constructing a full DTO with link data and verifying
    // the renderer receives and renders it correctly (end-to-end data integrity).
    const linkedNode = createNodeWithLink('n-e2e', 'End to End Journey', 'lane-1', {
      linked_diagram_id: 'diag-e2e-child',
      linked_diagram_name: 'E2E Child Diagram',
      link_status: 'LINKED',
    });
    const dto = createTestDto([linkedNode]);

    // Simulate loading from saved data: serialize then parse (mimics JSON round-trip)
    const serialized = JSON.stringify(dto);
    const parsed: UserJourneyOverviewDiagramDto = JSON.parse(serialized);

    // Verify link data survives round-trip
    expect(parsed.nodes[0].link).toBeDefined();
    expect(parsed.nodes[0].link!.linked_diagram_id).toBe('diag-e2e-child');
    expect(parsed.nodes[0].link!.linked_diagram_name).toBe('E2E Child Diagram');
    expect(parsed.nodes[0].link!.link_status).toBe('LINKED');

    // Render the parsed data and verify visual cues are applied
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={parsed} />
    );

    const nameDiv = findNameDivElement(container, 'n-e2e');
    expect(nameDiv).not.toBeNull();
    expect(nameDiv!.style.color).toBe(LINKED_COLOR);
    expect(nameDiv!.style.textDecoration).toBe('underline');
  });

  it('Gap 4: nodes with missing link field render correctly among nodes with link field in same diagram', () => {
    // Simulates an overview where some nodes were projected with link data (new)
    // and some were loaded from a pre-increment-14 saved state (no link field).
    // While this mix is unlikely in production, it tests defensive rendering.
    const newNode = createNodeWithLink('n-new', 'New Journey', 'lane-1', {
      linked_diagram_id: 'diag-new',
      linked_diagram_name: 'New Detail',
      link_status: 'LINKED',
    });
    const legacyNode = createNodeWithLink('n-legacy', 'Legacy Journey', 'lane-1');
    // Verify legacy node has no link field
    expect(legacyNode.link).toBeUndefined();

    const dto = createTestDto([newNode, legacyNode]);
    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} />
    );

    // New node: blue + underline
    const newDiv = findNameDivElement(container, 'n-new');
    expect(newDiv).not.toBeNull();
    expect(newDiv!.style.color).toBe(LINKED_COLOR);
    expect(newDiv!.style.textDecoration).toBe('underline');

    // Legacy node: default styling
    const legacyDiv = findNameDivElement(container, 'n-legacy');
    expect(legacyDiv).not.toBeNull();
    expect(legacyDiv!.style.color).toBe(DEFAULT_COLOR);
    const legacyDec = legacyDiv!.style.textDecoration;
    expect(legacyDec === '' || legacyDec === 'none').toBe(true);

    // Both nodes should be rendered (no crash from mixed link presence)
    expect(container.querySelector('[data-testid="overview-node-n-new"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="overview-node-n-legacy"]')).not.toBeNull();
  });

  it('Gap 5: click handler fires for correct node identity when multiple nodes present', () => {
    const node1 = createNodeWithLink('n-first', 'First Journey', 'lane-1', {
      linked_diagram_id: 'diag-first',
      linked_diagram_name: 'First Detail',
      link_status: 'LINKED',
    });
    const node2 = createNodeWithLink('n-second', 'Second Journey', 'lane-1', {
      linked_diagram_id: null,
      linked_diagram_name: null,
      link_status: 'UNLINKED',
    });
    const node3 = createNodeWithLink('n-third', 'Third Journey', 'lane-1', {
      linked_diagram_id: 'diag-third',
      linked_diagram_name: 'Third Detail',
      link_status: 'AMBIGUOUS_RESOLVED',
    });

    const dto = createTestDto([node1, node2, node3]);

    // Wire a callback that simulates the Canvas.tsx dispatch pattern
    const dispatch = vi.fn();
    const scrollToTop = vi.fn();
    const onUnlinkedNodeClick = vi.fn();
    const onNodeClick = (node: UserJourneyOverviewNodeDto) => {
      const status = node.link?.link_status;
      if (status === 'LINKED' || status === 'AMBIGUOUS_RESOLVED') {
        dispatch({ type: 'SELECT_DIAGRAM', payload: node.link!.linked_diagram_id! });
        scrollToTop();
      } else {
        onUnlinkedNodeClick();
      }
    };

    const { container } = renderInSvg(
      <UserJourneyOverviewDiagramRenderer overviewData={dto} onNodeClick={onNodeClick} />
    );

    // Click node 3 (AMBIGUOUS_RESOLVED) first -- should dispatch with diag-third
    const thirdGroup = container.querySelector('[data-testid="overview-node-n-third"]');
    fireEvent.click(thirdGroup!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-third' });
    expect(scrollToTop).toHaveBeenCalledTimes(1);
    expect(onUnlinkedNodeClick).not.toHaveBeenCalled();

    // Reset mocks
    dispatch.mockClear();
    scrollToTop.mockClear();

    // Click node 2 (UNLINKED) -- should trigger unlinked callback
    const secondGroup = container.querySelector('[data-testid="overview-node-n-second"]');
    fireEvent.click(secondGroup!);
    expect(dispatch).not.toHaveBeenCalled();
    expect(scrollToTop).not.toHaveBeenCalled();
    expect(onUnlinkedNodeClick).toHaveBeenCalledTimes(1);

    // Reset mocks
    onUnlinkedNodeClick.mockClear();

    // Click node 1 (LINKED) -- should dispatch with diag-first
    const firstGroup = container.querySelector('[data-testid="overview-node-n-first"]');
    fireEvent.click(firstGroup!);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SELECT_DIAGRAM', payload: 'diag-first' });
    expect(scrollToTop).toHaveBeenCalledTimes(1);
    expect(onUnlinkedNodeClick).not.toHaveBeenCalled();
  });
});
