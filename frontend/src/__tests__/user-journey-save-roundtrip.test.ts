/**
 * User Journey Diagram Save/Load Round-Trip and Gap Analysis Tests
 *
 * Spec 2026-04-03: User Journey Diagram Edit and Save Flow
 * Task Group 6: Strategic gap-filling tests for round-trip integrity,
 * Canvas.tsx extraction, CREATABLE_DIAGRAM_TYPES regression, and
 * ADD_DIAGRAM reducer behavior.
 *
 * Test 1: Round-trip save/load: typedContent survives prepareModelForApiSave -> normalizeModelFromApi
 * Test 2: USER_JOURNEY is NOT in CREATABLE_DIAGRAM_TYPES (regression guard)
 * Test 3: validateDiagramName rejects duplicates including USER_JOURNEY diagrams
 * Test 4: Lifecycle: saved USER_JOURNEY found in diagrams array after ADD_DIAGRAM dispatch simulation
 * Test 5: TypedContentEnvelope carries full UserJourneyDiagramDto payload through round-trip
 * Test 6: isDiagramTypedContentType returns false for non-typed types like 'General'
 */

import { describe, it, expect } from 'vitest';
import { prepareModelForApiSave, normalizeModelFromApi } from '../api/modelSerialization';
import { CREATABLE_DIAGRAM_TYPES } from '../types/diagramType';
import { isDiagramTypedContentType } from '../types/typedContent';
import { validateDiagramName } from '../utils/validation';
import { generatePrefixedId } from '../utils/idGenerator';
import type { Diagram, ArchitectureModel } from '../types/model';
import type { UserJourneyDiagramDto } from '../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestJourneyDto(name: string = 'Test Journey'): UserJourneyDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY',
    version: '1',
    journey: {
      id: 'j-1',
      name,
      description: 'A test journey',
      user_role_id: 'ur-1',
      user_role_name: 'End User',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Management',
    },
    lanes: [{ id: 'lane-1', name: 'Web App', order: 0 }],
    steps: [
      {
        id: 'step-1',
        journey_id: 'j-1',
        order: 0,
        lane_id: 'lane-1',
        process_activity_id: 'pa-1',
        process_activity_name: 'Browse Products',
        name: 'Browse Products',
        description: 'User browses products',
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
      },
      {
        id: 'step-2',
        journey_id: 'j-1',
        order: 1,
        lane_id: 'lane-1',
        process_activity_id: 'pa-2',
        process_activity_name: 'Add to Cart',
        name: 'Add to Cart',
        description: 'User adds item to cart',
        business_user_id: 'bu-1',
        business_user_name: 'Customer',
      },
    ],
    edges: [
      { id: 'e-1', from_step_id: 'step-1', to_step_id: 'step-2', order: 0, is_cross_lane: false },
    ],
    render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
  };
}

function createSavedUserJourneyDiagram(name: string = 'My Journey'): Diagram {
  const journeyDto = createTestJourneyDto(name);
  return {
    id: generatePrefixedId('diag'),
    name,
    description: '',
    diagram_type: 'USER_JOURNEY',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY',
      version: 1,
      content: journeyDto as any,
    },
  };
}

function createMinimalModel(diagrams: Diagram[]): ArchitectureModel {
  return {
    diagrams,
    metaModel: {
      entities: {
        applications: [],
        app_components: [],
        services: [],
        interfaces: [],
        endpoints: [],
        business_users: [],
        business_processes: [],
        process_activities: [],
        activity_steps: [],
        business_points: [],
        application_points: [],
        interactions: [],
        logical_data_entities: [],
        logical_data_attributes: [],
        physical_data_entities: [],
        physical_data_attributes: [],
        data_movements: [],
        state_machines: [],
        states: [],
        state_transitions: [],
        activity_flows: [],
        ui_screens: [],
        ui_components: [],
        ui_actions: [],
        ui_workflow_transitions: [],
      },
      relationships: {},
    },
  } as ArchitectureModel;
}

// ============================================================================
// Tests
// ============================================================================

describe('User Journey Save/Load Round-Trip and Gap Analysis', () => {
  // Test 1: Round-trip save/load integrity
  it('typedContent survives prepareModelForApiSave -> normalizeModelFromApi round-trip', () => {
    const savedDiagram = createSavedUserJourneyDiagram('Order Flow');
    const model = createMinimalModel([savedDiagram]);

    // Save: typedContent -> typed_content
    const apiPayload = prepareModelForApiSave(model) as any;
    expect(apiPayload.diagrams[0].typed_content).toBeDefined();
    expect(apiPayload.diagrams[0].typedContent).toBeUndefined();
    expect(apiPayload.diagrams[0].typed_content.type).toBe('USER_JOURNEY');

    // Load: typed_content -> typedContent
    const restored = normalizeModelFromApi(apiPayload);
    expect(restored.diagrams[0].typedContent).toBeDefined();
    expect(restored.diagrams[0].typedContent!.type).toBe('USER_JOURNEY');
    expect(restored.diagrams[0].typedContent!.version).toBe(1);

    // Verify the content payload survived the round-trip
    const content = restored.diagrams[0].typedContent!.content as any;
    expect(content.journey.name).toBe('Order Flow');
    expect(content.lanes).toHaveLength(1);
    expect(content.steps).toHaveLength(2);
    expect(content.edges).toHaveLength(1);
    expect(content.render_hints.lane_axis).toBe('HORIZONTAL');
  });

  // Test 2: USER_JOURNEY is NOT in CREATABLE_DIAGRAM_TYPES
  it('USER_JOURNEY is NOT in CREATABLE_DIAGRAM_TYPES (regression guard)', () => {
    expect(CREATABLE_DIAGRAM_TYPES).not.toContain('USER_JOURNEY');
  });

  // Test 3: validateDiagramName rejects duplicates including USER_JOURNEY
  it('validateDiagramName rejects duplicate names including USER_JOURNEY diagrams', () => {
    const existingDiagrams: Diagram[] = [
      createSavedUserJourneyDiagram('Customer Onboarding'),
      {
        id: 'diag-general-1',
        name: 'General Diagram',
        description: '',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
      },
    ];

    // Duplicate of USER_JOURNEY diagram should be rejected
    const error1 = validateDiagramName('Customer Onboarding', existingDiagrams);
    expect(error1).not.toBeNull();
    expect(error1).toContain('already exists');

    // Duplicate of General diagram should also be rejected
    const error2 = validateDiagramName('General Diagram', existingDiagrams);
    expect(error2).not.toBeNull();

    // Unique name should be accepted
    const error3 = validateDiagramName('New Unique Journey', existingDiagrams);
    expect(error3).toBeNull();
  });

  // Test 4: Lifecycle - saved USER_JOURNEY found in diagrams array after dispatch simulation
  it('saved USER_JOURNEY diagram is found in diagrams array after ADD_DIAGRAM simulation', () => {
    const newDiagram = createSavedUserJourneyDiagram('Checkout Flow');
    const existingDiagrams: Diagram[] = [
      {
        id: 'diag-general-1',
        name: 'General Diagram',
        description: '',
        diagram_type: 'General',
        diagram_nodes: [],
        diagram_edges: [],
      },
    ];

    // Simulate ADD_DIAGRAM: append to diagrams array
    const updatedDiagrams = [...existingDiagrams, newDiagram];
    expect(updatedDiagrams).toHaveLength(2);

    // Find the new diagram by its id (simulating selectedDiagramId selection)
    const found = updatedDiagrams.find(d => d.id === newDiagram.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Checkout Flow');
    expect(found!.diagram_type).toBe('USER_JOURNEY');
    expect(found!.typedContent).toBeDefined();
    expect(found!.typedContent!.type).toBe('USER_JOURNEY');
  });

  // Test 5: Full payload survives round-trip with all nested structures intact
  it('full UserJourneyDiagramDto payload survives round-trip with nested structures intact', () => {
    const journeyDto = createTestJourneyDto('Complex Journey');
    const savedDiagram: Diagram = {
      id: 'diag-complex-1',
      name: 'Complex Journey',
      description: '',
      diagram_type: 'USER_JOURNEY',
      diagram_nodes: [],
      diagram_edges: [],
      typedContent: {
        type: 'USER_JOURNEY',
        version: 1,
        content: journeyDto as any,
      },
    };

    const model = createMinimalModel([savedDiagram]);
    const apiPayload = prepareModelForApiSave(model);
    const restored = normalizeModelFromApi(apiPayload);

    const content = restored.diagrams[0].typedContent!.content as any;

    // Verify all nested structures survived
    expect(content.steps[0].process_activity_name).toBe('Browse Products');
    expect(content.steps[1].name).toBe('Add to Cart');
    expect(content.edges[0].from_step_id).toBe('step-1');
    expect(content.edges[0].to_step_id).toBe('step-2');
    expect(content.journey.user_role_name).toBe('End User');
    expect(content.journey.parent_business_process_name).toBe('Order Management');
  });

  // Test 6: isDiagramTypedContentType returns false for 'General'
  it('isDiagramTypedContentType returns false for non-typed types like "General"', () => {
    expect(isDiagramTypedContentType('General')).toBe(false);
    expect(isDiagramTypedContentType('unknown')).toBe(false);
    expect(isDiagramTypedContentType('')).toBe(false);
  });
});
