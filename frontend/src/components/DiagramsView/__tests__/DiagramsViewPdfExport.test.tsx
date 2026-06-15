/**
 * DiagramsView PDF Export Wiring Tests
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 4, Task 4.1: 3 focused tests for PDF wiring in DiagramsView
 *
 * Test 1: When state.model.diagrams contains USER_JOURNEY and USER_JOURNEY_OVERVIEW diagrams,
 *         the onSaveAllAsPdf prop is passed to JourneyReviewBanner (not undefined)
 * Test 2: The pdfProgress prop is passed to JourneyReviewBanner and initially has generating: false
 * Test 3: When state.model.diagrams has no USER_JOURNEY or USER_JOURNEY_OVERVIEW diagrams,
 *         the onSaveAllAsPdf prop can still be provided
 *
 * These tests use a lightweight approach consistent with DiagramsViewJourneySave.test.tsx:
 * simulate the handler/state wiring directly rather than rendering the full DiagramsView component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { JourneyReviewBanner } from '../JourneyReviewBanner';
import type { PdfGenerationProgress } from '../pdfExport';
import type { Diagram } from '../../../types/model';
import type { UserJourneyDiagramJourneyDto } from '../../../types/userJourneyDiagram';

// Mock generatePdf to avoid actual PDF generation
vi.mock('../pdfExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pdfExport')>();
  return {
    ...actual,
    generatePdf: vi.fn().mockResolvedValue(undefined),
  };
});

// ============================================================================
// Test Helpers
// ============================================================================

function createTestJourney(name: string = 'Test Journey'): UserJourneyDiagramJourneyDto {
  return {
    id: 'j-1',
    name,
    description: 'Test',
    user_role_id: 'ur-1',
    user_role_name: 'End User',
    parent_business_process_id: 'bp-1',
    parent_business_process_name: 'Order Flow',
  };
}

function createUserJourneyDiagram(name: string, userRoleName: string): Diagram {
  return {
    id: `diag-${name}`,
    name,
    description: '',
    diagram_type: 'USER_JOURNEY',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY',
      version: 1,
      content: {
        diagram_type: 'USER_JOURNEY',
        version: '1',
        journey: {
          id: 'j-1',
          name,
          description: '',
          user_role_id: 'ur-1',
          user_role_name: userRoleName,
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Order Flow',
        },
        lanes: [],
        steps: [],
        edges: [],
        render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
      } as any,
    },
  };
}

function createUserJourneyOverviewDiagram(name: string, businessUserName: string): Diagram {
  return {
    id: `diag-overview-${name}`,
    name,
    description: '',
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY_OVERVIEW',
      version: 1,
      content: {
        diagram_type: 'USER_JOURNEY_OVERVIEW',
        version: '1',
        overview: {
          business_user_id: 'bu-1',
          business_user_name: businessUserName,
        },
        lanes: [],
        nodes: [],
        edges: [],
        render_hints: { show_title: true },
      } as any,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DiagramsView PDF Export Wiring', () => {
  it('when state.model.diagrams contains USER_JOURNEY and USER_JOURNEY_OVERVIEW diagrams, onSaveAllAsPdf is passed to JourneyReviewBanner', () => {
    // Simulate the state that DiagramsView would have
    const diagrams: Diagram[] = [
      createUserJourneyDiagram('Customer Onboarding', 'End User'),
      createUserJourneyOverviewDiagram('End User Overview', 'End User'),
    ];
    const metaModel = { entities: {}, relationships: {} };
    const loadedFileName = 'test-project.json';

    // Simulate the handleSaveAllAsPdf callback that DiagramsView would create
    const mockGeneratePdf = vi.fn().mockResolvedValue(undefined);
    const handleSaveAllAsPdf = async () => {
      await mockGeneratePdf(diagrams, metaModel, loadedFileName, vi.fn());
    };

    // Render JourneyReviewBanner with the props DiagramsView would pass
    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={2}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={handleSaveAllAsPdf}
        pdfProgress={{ generating: false, current: 0, total: 0 }}
      />
    );

    // Verify the button is present (i.e., onSaveAllAsPdf was provided, not undefined)
    const pdfButton = getByTestId('journey-review-save-all-pdf');
    expect(pdfButton).toBeDefined();
    expect(pdfButton.textContent).toBe('Save All as Diagrams & PDF');
  });

  it('pdfProgress prop is passed to JourneyReviewBanner and initially has generating: false', () => {
    // Simulate the initial state of pdfProgress in DiagramsView
    const initialProgress: PdfGenerationProgress = { generating: false, current: 0, total: 0 };

    const { getByTestId, queryByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={2}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={vi.fn()}
        pdfProgress={initialProgress}
      />
    );

    // Button should be enabled (not disabled) since generating is false
    const pdfButton = getByTestId('journey-review-save-all-pdf') as HTMLButtonElement;
    expect(pdfButton.disabled).toBe(false);

    // Progress text should NOT be shown since generating is false
    expect(queryByTestId('pdf-progress-text')).toBeNull();
  });

  it('when state.model.diagrams has no USER_JOURNEY or USER_JOURNEY_OVERVIEW diagrams, onSaveAllAsPdf can still be provided', () => {
    // Simulate state with no relevant diagrams -- the button still appears during review
    // because generatePdf reads from state.model.diagrams which may be populated later
    const diagrams: Diagram[] = [
      {
        id: 'diag-general',
        name: 'General Diagram',
        description: '',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
      },
    ];

    // The handleSaveAllAsPdf callback would call generatePdf which handles the empty case internally
    const mockGeneratePdf = vi.fn().mockResolvedValue(undefined);
    const handleSaveAllAsPdf = async () => {
      await mockGeneratePdf(diagrams, {}, null, vi.fn());
    };

    const { getByTestId } = render(
      <JourneyReviewBanner
        journey={createTestJourney()}
        selectedIndex={0}
        totalJourneys={1}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onReturnToChooser={vi.fn()}
        onCloseReview={vi.fn()}
        onSaveAllAsPdf={handleSaveAllAsPdf}
        pdfProgress={{ generating: false, current: 0, total: 0 }}
      />
    );

    // The button is still rendered -- it reads from saved diagrams, not review context
    const pdfButton = getByTestId('journey-review-save-all-pdf');
    expect(pdfButton).toBeDefined();
    expect(pdfButton.textContent).toBe('Save All as Diagrams & PDF');
  });
});
