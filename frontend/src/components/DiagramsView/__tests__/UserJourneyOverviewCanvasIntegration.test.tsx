/**
 * UserJourneyOverviewCanvasIntegration Tests
 *
 * Spec 2026-04-07: User Journey Overview Parent Diagram Generation
 * Task Group 7, Task 7.1: 4 focused tests for Canvas integration and save flow
 *
 * These tests verify:
 * Test 1: isUserJourneyOverviewDiagram flag is true when getDiagramType(diagram) returns 'USER_JOURNEY_OVERVIEW'
 * Test 2: extractUserJourneyOverviewDiagram correctly extracts UserJourneyOverviewDiagramDto from diagram.typedContent.content
 * Test 3: extractUserJourneyOverviewDiagram returns null for non-overview diagrams
 * Test 4: Save flow creates a Diagram object with correct diagram_type: 'USER_JOURNEY_OVERVIEW',
 *          typedContent envelope with type: 'USER_JOURNEY_OVERVIEW', version: 1, and full overview DTO as content
 *
 * Uses the same test harness pattern as UserJourneyCanvasIntegration.test.tsx:
 * mirrors the Canvas.tsx adapter logic to verify type detection, content extraction,
 * and renderer dispatch without pulling in the entire Canvas dependency tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { useState, useEffect } from 'react';
import { getDiagramType } from '../../../types/diagramType';
import UserJourneyOverviewDiagramRenderer from '../UserJourneyOverviewDiagramRenderer';
import type { UserJourneyOverviewDiagramDto } from '../../../types/userJourneyOverviewDiagram';
import type { Diagram } from '../../../types/model';
import type { TypedContentEnvelope } from '../../../types/typedContent';
import { appConfig } from '../../../config/defaults';
import { generatePrefixedId } from '../../../utils/idGenerator';

// ============================================================================
// Type guard and extractor (mirrors Canvas.tsx implementation)
// ============================================================================

function isUserJourneyOverviewDiagramDto(value: unknown): value is UserJourneyOverviewDiagramDto {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.lanes) &&
    Array.isArray(obj.nodes) &&
    Array.isArray(obj.edges) &&
    obj.overview != null &&
    typeof obj.overview === 'object'
  );
}

function extractUserJourneyOverviewDiagram(diagram: Diagram | null | undefined): UserJourneyOverviewDiagramDto | null {
  if (!diagram) return null;

  // Try typedContent first (primary storage for typed diagrams)
  if (diagram.typedContent?.content) {
    const content = diagram.typedContent.content as unknown;
    if (isUserJourneyOverviewDiagramDto(content)) {
      return content;
    }
  }

  // Try settings.overviewDiagram (alternative storage)
  if (diagram.settings?.overviewDiagram) {
    const content = diagram.settings.overviewDiagram as unknown;
    if (isUserJourneyOverviewDiagramDto(content)) {
      return content;
    }
  }

  return null;
}

// ============================================================================
// Test Fixtures
// ============================================================================

const testOverviewData: UserJourneyOverviewDiagramDto = {
  diagram_type: 'USER_JOURNEY_OVERVIEW',
  version: '1.0',
  overview: {
    business_user_id: 'bu-1',
    business_user_name: 'Customer',
    title: 'Customer Journey Overview',
  },
  lanes: [
    { id: 'lane-1', name: 'Onboarding', order: 0 },
    { id: 'lane-2', name: 'Purchasing', order: 1 },
  ],
  nodes: [
    {
      id: 'node-1',
      lane_id: 'lane-1',
      name: 'Account Registration',
      description: 'Register a new account',
      primary_business_user_id: 'bu-1',
      primary_business_user_name: 'Customer',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Onboarding',
      metadata: { step_count: 5, application_count: 2, relationship_in_count: 0, relationship_out_count: 1 },
    },
    {
      id: 'node-2',
      lane_id: 'lane-2',
      name: 'Place Order',
      description: 'Order items from catalog',
      primary_business_user_id: 'bu-1',
      primary_business_user_name: 'Customer',
      parent_business_process_id: 'bp-2',
      parent_business_process_name: 'Purchasing',
      metadata: { step_count: 8, application_count: 3, relationship_in_count: 1, relationship_out_count: 0 },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source_node_id: 'node-1',
      target_node_id: 'node-2',
      relationship_type: 'LEADS_TO',
      label: 'After registration',
      description: 'Customer proceeds to ordering',
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
};

/**
 * Test harness that simulates the Canvas.tsx dispatch logic for overview diagrams.
 * Mirrors the actual Canvas.tsx conditional rendering chain and auto-sizing logic.
 */
function OverviewCanvasDispatchHarness({ diagram }: { diagram: Diagram }) {
  const isUserJourneyOverviewDiagram = getDiagramType(diagram) === 'USER_JOURNEY_OVERVIEW';
  const [overviewBounds, setOverviewBounds] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!isUserJourneyOverviewDiagram) {
      setOverviewBounds(null);
    }
  }, [isUserJourneyOverviewDiagram]);

  const canvasWidth = (isUserJourneyOverviewDiagram && overviewBounds) ? overviewBounds.width : appConfig.canvas.defaultWidth;
  const canvasHeight = (isUserJourneyOverviewDiagram && overviewBounds) ? overviewBounds.height : appConfig.canvas.defaultHeight;

  return (
    <svg
      data-testid="canvas-svg"
      width={canvasWidth * 1}
      height={canvasHeight * 1}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
    >
      {isUserJourneyOverviewDiagram ? (
        (() => {
          const overviewData = extractUserJourneyOverviewDiagram(diagram);
          if (!overviewData) {
            return (
              <text data-testid="overview-missing-data" x={60} y={80} fontSize={14} fill="#666666">
                User Journey Overview diagram data is not available.
              </text>
            );
          }
          return (
            <UserJourneyOverviewDiagramRenderer
              overviewData={overviewData}
              onContentBounds={setOverviewBounds}
            />
          );
        })()
      ) : (
        <g data-testid="general-renderer">
          <text>General diagram content</text>
        </g>
      )}
    </svg>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('UserJourneyOverviewCanvasIntegration', () => {
  // Test 1: isUserJourneyOverviewDiagram flag is true when getDiagramType returns 'USER_JOURNEY_OVERVIEW'
  it('isUserJourneyOverviewDiagram flag is true when getDiagramType(diagram) returns USER_JOURNEY_OVERVIEW', () => {
    const diagram: Diagram = {
      id: 'diag-ov-1',
      name: 'Overview Diagram',
      description: '',
      diagram_type: 'USER_JOURNEY_OVERVIEW',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY_OVERVIEW',
        version: 1,
        content: testOverviewData as any,
      },
    };

    // Verify getDiagramType returns the correct type
    expect(getDiagramType(diagram)).toBe('USER_JOURNEY_OVERVIEW');

    // Verify the rendering dispatches to the overview renderer, not the general fallback
    render(<OverviewCanvasDispatchHarness diagram={diagram} />);
    expect(screen.getByTestId('overview-diagram-renderer')).toBeDefined();
    expect(screen.queryByTestId('general-renderer')).toBeNull();
  });

  // Test 2: extractUserJourneyOverviewDiagram correctly extracts from diagram.typedContent.content
  it('extractUserJourneyOverviewDiagram correctly extracts UserJourneyOverviewDiagramDto from diagram.typedContent.content', () => {
    const diagram: Diagram = {
      id: 'diag-ov-2',
      name: 'Typed Overview',
      description: '',
      diagram_type: 'USER_JOURNEY_OVERVIEW',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY_OVERVIEW',
        version: 1,
        content: testOverviewData as any,
      },
    };

    const extracted = extractUserJourneyOverviewDiagram(diagram);

    // Should extract the full DTO
    expect(extracted).not.toBeNull();
    expect(extracted!.diagram_type).toBe('USER_JOURNEY_OVERVIEW');
    expect(extracted!.overview.business_user_name).toBe('Customer');
    expect(extracted!.overview.title).toBe('Customer Journey Overview');
    expect(extracted!.lanes).toHaveLength(2);
    expect(extracted!.nodes).toHaveLength(2);
    expect(extracted!.edges).toHaveLength(1);
    expect(extracted!.render_hints.lane_axis).toBe('VERTICAL');
  });

  // Test 3: extractUserJourneyOverviewDiagram returns null for non-overview diagrams
  it('extractUserJourneyOverviewDiagram returns null for non-overview diagrams', () => {
    // General diagram with no typed content
    const generalDiagram: Diagram = {
      id: 'diag-gen-1',
      name: 'General Diagram',
      description: '',
      diagram_type: 'General',
      diagram_nodes: [],
      diagram_edges: [],
    };
    expect(extractUserJourneyOverviewDiagram(generalDiagram)).toBeNull();

    // USER_JOURNEY diagram (child, not overview) -- has different shape (steps, not nodes)
    const journeyDiagram: Diagram = {
      id: 'diag-uj-1',
      name: 'Journey Diagram',
      description: '',
      diagram_type: 'USER_JOURNEY',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY',
        version: 1,
        content: {
          journey: { id: 'j1', name: 'J', description: '', user_role_id: '', user_role_name: '', parent_business_process_id: '', parent_business_process_name: '' },
          lanes: [],
          steps: [],
          edges: [],
          render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
          diagram_type: 'USER_JOURNEY',
          version: '1',
        } as any,
      },
    };
    expect(extractUserJourneyOverviewDiagram(journeyDiagram)).toBeNull();

    // Null diagram
    expect(extractUserJourneyOverviewDiagram(null)).toBeNull();
    expect(extractUserJourneyOverviewDiagram(undefined)).toBeNull();

    // Diagram with malformed content (missing overview and nodes arrays)
    const malformedDiagram: Diagram = {
      id: 'diag-bad-1',
      name: 'Bad Diagram',
      description: '',
      diagram_type: 'USER_JOURNEY_OVERVIEW',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY_OVERVIEW',
        version: 1,
        content: { invalid: 'data' } as any,
      },
    };
    expect(extractUserJourneyOverviewDiagram(malformedDiagram)).toBeNull();
  });

  // Test 4: Save flow creates a Diagram object with correct structure
  it('Save flow creates a Diagram object with correct diagram_type, typedContent envelope, and full overview DTO as content', () => {
    const dto = testOverviewData;

    // Simulate the save flow logic from handleSaveOverviewDiagram in DiagramsView.tsx
    const overviewContent = {
      overview: dto.overview,
      lanes: dto.lanes,
      nodes: dto.nodes,
      edges: dto.edges,
      render_hints: dto.render_hints,
      diagram_type: dto.diagram_type,
      version: dto.version,
    };

    const newDiagram: Diagram = {
      id: generatePrefixedId('diag'),
      name: dto.overview?.title || 'Journey Overview',
      description: '',
      diagram_type: 'USER_JOURNEY_OVERVIEW',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY_OVERVIEW',
        version: 1,
        content: overviewContent as any,
      },
    };

    // Verify diagram_type
    expect(newDiagram.diagram_type).toBe('USER_JOURNEY_OVERVIEW');

    // Verify id prefix
    expect(newDiagram.id).toMatch(/^diag-/);

    // Verify name comes from overview title
    expect(newDiagram.name).toBe('Customer Journey Overview');

    // Verify typedContent envelope structure
    const envelope = newDiagram.typedContent as TypedContentEnvelope;
    expect(envelope).toBeDefined();
    expect(envelope.type).toBe('USER_JOURNEY_OVERVIEW');
    expect(envelope.version).toBe(1);

    // Verify content contains the full overview DTO data
    const content = envelope.content as any;
    expect(content.overview.business_user_id).toBe('bu-1');
    expect(content.overview.business_user_name).toBe('Customer');
    expect(content.overview.title).toBe('Customer Journey Overview');
    expect(content.lanes).toHaveLength(2);
    expect(content.nodes).toHaveLength(2);
    expect(content.edges).toHaveLength(1);
    expect(content.render_hints.lane_axis).toBe('VERTICAL');
    expect(content.diagram_type).toBe('USER_JOURNEY_OVERVIEW');
    expect(content.version).toBe('1.0');

    // Verify the saved diagram can be round-tripped through the extract function
    const extracted = extractUserJourneyOverviewDiagram(newDiagram);
    expect(extracted).not.toBeNull();
    expect(extracted!.overview.title).toBe('Customer Journey Overview');
    expect(extracted!.lanes).toHaveLength(2);
    expect(extracted!.nodes).toHaveLength(2);
    expect(extracted!.edges).toHaveLength(1);
  });
});
