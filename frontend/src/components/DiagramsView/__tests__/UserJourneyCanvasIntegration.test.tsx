/**
 * UserJourneyCanvasIntegration Tests
 *
 * Spec 2026-04-03: User Journey Native Diagram Type and Renderer
 * Task Group 3, Task 3.1: 4 focused tests for Canvas dispatch and auto-sizing
 *
 * These tests verify:
 * Test 1: USER_JOURNEY diagram type dispatches UserJourneyDiagramRenderer (not General fallback)
 * Test 2: SVG viewBox dimensions match computed content bounds (not fixed defaults)
 * Test 3: General diagram type still dispatches the General renderer (no regression)
 * Test 4: UserJourneyDiagramRenderer receives correct diagram data and zoom prop
 *
 * Task Group 4, Task 4.3: Gap-filling tests
 * Test 5: Adapter returns null for missing/malformed journey data and Canvas handles gracefully
 *
 * Since Canvas.tsx has deep dependencies on ArchitectureContext and rendering utils,
 * these tests verify the integration via focused component rendering that exercises
 * the adapter function, type check, and renderer dispatch logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { useState, useEffect } from 'react';
import { getDiagramType } from '../../../types/diagramType';
import UserJourneyDiagramRenderer, { computeContentBounds } from '../UserJourneyDiagramRenderer';
import type { UserJourneyDiagramDto } from '../../../types/userJourneyDiagram';
import type { Diagram } from '../../../types/model';
import { appConfig } from '../../../config/defaults';

// ============================================================================
// Adapter function (mirrors extractUserJourneyDiagram from Canvas.tsx)
// ============================================================================

function isUserJourneyDiagramDto(value: unknown): value is UserJourneyDiagramDto {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.lanes) &&
    Array.isArray(obj.steps) &&
    Array.isArray(obj.edges) &&
    obj.journey != null &&
    typeof obj.journey === 'object'
  );
}

function extractUserJourneyDiagram(diagram: Diagram | null | undefined): UserJourneyDiagramDto | null {
  if (!diagram) return null;

  if (diagram.typedContent?.content) {
    const content = diagram.typedContent.content as unknown;
    if (isUserJourneyDiagramDto(content)) {
      return content;
    }
  }

  if (diagram.settings?.journeyDiagram) {
    const content = diagram.settings.journeyDiagram as unknown;
    if (isUserJourneyDiagramDto(content)) {
      return content;
    }
  }

  return null;
}

// ============================================================================
// Test Fixtures
// ============================================================================

const testJourneyData: UserJourneyDiagramDto = {
  diagram_type: 'USER_JOURNEY',
  version: '1',
  journey: {
    id: 'j-1',
    name: 'Test Journey',
    description: 'A test journey',
    user_role_id: 'ur-1',
    user_role_name: 'Tester',
    parent_business_process_id: 'bp-1',
    parent_business_process_name: 'Testing',
  },
  lanes: [
    { id: 'lane-1', name: 'Lane A', order: 0 },
    { id: 'lane-2', name: 'Lane B', order: 1 },
  ],
  steps: [
    {
      id: 'step-1',
      journey_id: 'j-1',
      order: 0,
      lane_id: 'lane-1',
      process_activity_id: 'pa-1',
      process_activity_name: 'Step 1',
      name: 'First Step',
      diagram_label: 'First Step',
      description: 'The first step',
      business_user_id: 'bu-1',
      business_user_name: 'User A',
      activity_issues: '', ui_issues: '',
    },
    {
      id: 'step-2',
      journey_id: 'j-1',
      order: 1,
      lane_id: 'lane-2',
      process_activity_id: 'pa-2',
      process_activity_name: 'Step 2',
      name: 'Second Step',
      diagram_label: 'Second Step',
      description: 'The second step',
      business_user_id: 'bu-2',
      business_user_name: 'User B',
      activity_issues: '', ui_issues: '',
    },
  ],
  edges: [
    { id: 'e-1', from_step_id: 'step-1', to_step_id: 'step-2', order: 0, is_cross_lane: true },
  ],
  render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
};

/**
 * Test harness that simulates the Canvas.tsx dispatch logic for User Journey diagrams.
 * This mirrors the actual Canvas.tsx conditional rendering chain and auto-sizing logic.
 */
function CanvasDispatchHarness({ diagram }: { diagram: Diagram }) {
  const isUserJourneyDiagram = getDiagramType(diagram) === 'USER_JOURNEY';
  const [journeyBounds, setJourneyBounds] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!isUserJourneyDiagram) {
      setJourneyBounds(null);
    }
  }, [isUserJourneyDiagram]);

  const canvasWidth = (isUserJourneyDiagram && journeyBounds) ? journeyBounds.width : appConfig.canvas.defaultWidth;
  const canvasHeight = (isUserJourneyDiagram && journeyBounds) ? journeyBounds.height : appConfig.canvas.defaultHeight;

  return (
    <svg
      data-testid="canvas-svg"
      width={canvasWidth * 1}
      height={canvasHeight * 1}
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
    >
      {isUserJourneyDiagram ? (
        (() => {
          const journeyData = extractUserJourneyDiagram(diagram);
          if (!journeyData) {
            return (
              <text data-testid="journey-missing-data" x={60} y={80} fontSize={14} fill="#666666">
                User Journey diagram data is not available.
              </text>
            );
          }
          return (
            <UserJourneyDiagramRenderer
              diagram={journeyData}
              zoom={1}
              onContentBounds={setJourneyBounds}
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

describe('UserJourneyCanvasIntegration', () => {
  it('dispatches UserJourneyDiagramRenderer when diagram_type is USER_JOURNEY', () => {
    const diagram: Diagram = {
      id: 'diag-uj-1',
      name: 'My Journey Diagram',
      description: '',
      diagram_type: 'USER_JOURNEY',
      settings: { journeyDiagram: testJourneyData },
      diagram_nodes: [],
      diagram_edges: [],
    };

    render(<CanvasDispatchHarness diagram={diagram} />);

    // Should render the UserJourneyDiagramRenderer (journey-diagram-renderer testid)
    expect(screen.getByTestId('journey-diagram-renderer')).toBeDefined();

    // Should NOT render the General fallback
    expect(screen.queryByTestId('general-renderer')).toBeNull();
  });

  it('auto-sizes SVG viewBox to content bounds for USER_JOURNEY diagrams', () => {
    const diagram: Diagram = {
      id: 'diag-uj-2',
      name: 'Auto-Sized Journey',
      description: '',
      diagram_type: 'USER_JOURNEY',
      settings: { journeyDiagram: testJourneyData },
      diagram_nodes: [],
      diagram_edges: [],
    };

    render(<CanvasDispatchHarness diagram={diagram} />);

    const svg = screen.getByTestId('canvas-svg');
    const viewBox = svg.getAttribute('viewBox');

    // The viewBox should NOT be the default canvas dimensions
    const defaultViewBox = `0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`;
    expect(viewBox).not.toBe(defaultViewBox);

    // The viewBox should contain positive dimensions derived from content bounds
    const parts = viewBox!.split(' ').map(Number);
    expect(parts[0]).toBe(0);
    expect(parts[1]).toBe(0);
    expect(parts[2]).toBeGreaterThan(0);
    expect(parts[3]).toBeGreaterThan(0);
    // The auto-sized dimensions should be smaller than the large default canvas
    expect(parts[2]).toBeLessThan(appConfig.canvas.defaultWidth);
    expect(parts[3]).toBeLessThan(appConfig.canvas.defaultHeight);
  });

  it('dispatches General renderer for General diagram type (no regression)', () => {
    const diagram: Diagram = {
      id: 'diag-gen-1',
      name: 'General Diagram',
      description: '',
      diagram_type: 'General',
      settings: {},
      diagram_nodes: [],
      diagram_edges: [],
    };

    render(<CanvasDispatchHarness diagram={diagram} />);

    // Should render the General fallback
    expect(screen.getByTestId('general-renderer')).toBeDefined();

    // Should NOT render the UserJourneyDiagramRenderer
    expect(screen.queryByTestId('journey-diagram-renderer')).toBeNull();

    // SVG viewBox should use default dimensions
    const svg = screen.getByTestId('canvas-svg');
    const viewBox = svg.getAttribute('viewBox');
    expect(viewBox).toBe(`0 0 ${appConfig.canvas.defaultWidth} ${appConfig.canvas.defaultHeight}`);
  });

  it('passes correct diagram data and zoom prop to UserJourneyDiagramRenderer', () => {
    const diagram: Diagram = {
      id: 'diag-uj-3',
      name: 'Journey Data Test',
      description: '',
      diagram_type: 'USER_JOURNEY',
      settings: { journeyDiagram: testJourneyData },
      diagram_nodes: [],
      diagram_edges: [],
    };

    render(<CanvasDispatchHarness diagram={diagram} />);

    // The renderer should receive and display the journey data
    // Verify by checking that journey title is rendered (from testJourneyData.journey.name)
    expect(screen.getByTestId('journey-header-block').textContent).toContain('Test Journey');

    // Verify lanes are rendered
    expect(screen.getByTestId('journey-lane-lane-1')).toBeDefined();
    expect(screen.getByTestId('journey-lane-lane-2')).toBeDefined();

    // Verify steps are rendered
    expect(screen.getByTestId('journey-step-step-1')).toBeDefined();
    expect(screen.getByTestId('journey-step-step-2')).toBeDefined();

    // Verify the edge is rendered
    expect(screen.getByTestId('journey-edge-e-1')).toBeDefined();
  });

  // Task Group 4 gap-filling test
  it('shows error message when USER_JOURNEY diagram has missing/malformed journey data', () => {
    const diagram: Diagram = {
      id: 'diag-uj-malformed',
      name: 'Malformed Journey',
      description: '',
      diagram_type: 'USER_JOURNEY',
      settings: { journeyDiagram: { invalid: 'data' } }, // Missing required fields
      diagram_nodes: [],
      diagram_edges: [],
    };

    render(<CanvasDispatchHarness diagram={diagram} />);

    // Should show the error message, not the renderer
    expect(screen.getByTestId('journey-missing-data')).toBeDefined();
    expect(screen.queryByTestId('journey-diagram-renderer')).toBeNull();
    expect(screen.queryByTestId('general-renderer')).toBeNull();
  });
});
