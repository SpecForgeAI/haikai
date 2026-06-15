/**
 * Diagram Extraction Utilities Tests
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 1, Task 1.1: 4 focused tests for the shared diagram extraction utility
 *
 * Test 1: extractUserJourneyDiagram returns typed DTO when typedContent.content contains valid journey data
 * Test 2: extractUserJourneyDiagram returns null when diagram is null or content is malformed
 * Test 3: extractUserJourneyOverviewDiagram returns typed DTO when typedContent.content contains valid overview data
 * Test 4: isUserJourneyDiagramDto and isUserJourneyOverviewDiagramDto type guards correctly distinguish journey vs overview shapes
 */

import { describe, it, expect } from 'vitest';
import {
  extractUserJourneyDiagram,
  extractUserJourneyOverviewDiagram,
  isUserJourneyDiagramDto,
  isUserJourneyOverviewDiagramDto,
} from '../diagramExtractionUtils';
import type { Diagram } from '../../../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

function createValidJourneyContent() {
  return {
    diagram_type: 'USER_JOURNEY',
    version: '1.0',
    journey: {
      id: 'j-1',
      name: 'Order Placement',
      description: 'User places an order',
      user_role_id: 'ur-1',
      user_role_name: 'End User',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Flow',
    },
    lanes: [{ id: 'l-1', name: 'Web App', order: 0 }],
    steps: [{ id: 's-1', journey_id: 'j-1', order: 0, lane_id: 'l-1', process_activity_id: 'pa-1', process_activity_name: 'Login', name: 'Login Step', diagram_label: 'Login', description: '', business_user_id: 'bu-1', business_user_name: 'End User', activity_issues: '', ui_issues: '' }],
    edges: [{ id: 'e-1', from_step_id: 's-1', to_step_id: 's-2', order: 0, is_cross_lane: false }],
    render_hints: { lane_axis: 'vertical', flow_direction: 'left-to-right', show_title: true },
  };
}

function createValidOverviewContent() {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'End User',
      title: 'End User Overview',
    },
    lanes: [{ id: 'l-1', name: 'Order Process', order: 0 }],
    nodes: [{ id: 'n-1', lane_id: 'l-1', name: 'Place Order', description: '', primary_business_user_id: 'bu-1', primary_business_user_name: 'End User', parent_business_process_id: 'bp-1', parent_business_process_name: 'Order Flow', metadata: { step_count: 3, application_count: 2, relationship_in_count: 1, relationship_out_count: 0 } }],
    edges: [{ id: 'e-1', source_node_id: 'n-1', target_node_id: 'n-2', relationship_type: 'USER_JOURNEY_LINK', label: 'leads to', description: '' }],
    render_hints: { lane_axis: 'vertical', flow_direction: 'left-to-right', show_title: true, show_lane_headers: true, show_node_description: true, show_relationship_labels: true },
  };
}

function createDiagramWithTypedContent(content: unknown): Diagram {
  return {
    id: 'd-1',
    name: 'Test Diagram',
    description: '',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY',
      version: '1.0',
      content,
    },
  };
}

function createDiagramWithSettings(settingsKey: string, content: unknown): Diagram {
  return {
    id: 'd-1',
    name: 'Test Diagram',
    description: '',
    diagram_nodes: [],
    diagram_edges: [],
    settings: { [settingsKey]: content },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('diagramExtractionUtils', () => {
  describe('extractUserJourneyDiagram', () => {
    it('returns typed DTO when typedContent.content contains valid journey data', () => {
      const journeyContent = createValidJourneyContent();
      const diagram = createDiagramWithTypedContent(journeyContent);

      const result = extractUserJourneyDiagram(diagram);

      expect(result).not.toBeNull();
      expect(result!.journey.name).toBe('Order Placement');
      expect(result!.lanes).toHaveLength(1);
      expect(result!.steps).toHaveLength(1);
      expect(result!.edges).toHaveLength(1);
    });

    it('returns null when diagram is null or content is malformed', () => {
      // null diagram
      expect(extractUserJourneyDiagram(null)).toBeNull();

      // undefined diagram
      expect(extractUserJourneyDiagram(undefined)).toBeNull();

      // Diagram with malformed content (missing required fields)
      const malformedDiagram = createDiagramWithTypedContent({
        lanes: [],
        // missing steps, edges, journey
      });
      expect(extractUserJourneyDiagram(malformedDiagram)).toBeNull();

      // Diagram with no typedContent and no settings
      const emptyDiagram: Diagram = {
        id: 'd-1',
        name: 'Empty',
        description: '',
        diagram_nodes: [],
        diagram_edges: [],
      };
      expect(extractUserJourneyDiagram(emptyDiagram)).toBeNull();
    });
  });

  describe('extractUserJourneyOverviewDiagram', () => {
    it('returns typed DTO when typedContent.content contains valid overview data', () => {
      const overviewContent = createValidOverviewContent();
      const diagram = createDiagramWithTypedContent(overviewContent);

      const result = extractUserJourneyOverviewDiagram(diagram);

      expect(result).not.toBeNull();
      expect(result!.overview.business_user_name).toBe('End User');
      expect(result!.lanes).toHaveLength(1);
      expect(result!.nodes).toHaveLength(1);
      expect(result!.edges).toHaveLength(1);
    });
  });

  describe('type guards', () => {
    it('isUserJourneyDiagramDto and isUserJourneyOverviewDiagramDto correctly distinguish journey vs overview shapes', () => {
      const journeyContent = createValidJourneyContent();
      const overviewContent = createValidOverviewContent();

      // Journey type guard accepts journey, rejects overview
      expect(isUserJourneyDiagramDto(journeyContent)).toBe(true);
      expect(isUserJourneyDiagramDto(overviewContent)).toBe(false);

      // Overview type guard accepts overview, rejects journey
      expect(isUserJourneyOverviewDiagramDto(overviewContent)).toBe(true);
      expect(isUserJourneyOverviewDiagramDto(journeyContent)).toBe(false);

      // Both reject null, undefined, and non-objects
      expect(isUserJourneyDiagramDto(null)).toBe(false);
      expect(isUserJourneyDiagramDto(undefined)).toBe(false);
      expect(isUserJourneyDiagramDto('string')).toBe(false);
      expect(isUserJourneyOverviewDiagramDto(null)).toBe(false);
      expect(isUserJourneyOverviewDiagramDto(undefined)).toBe(false);
      expect(isUserJourneyOverviewDiagramDto(42)).toBe(false);
    });
  });
});
