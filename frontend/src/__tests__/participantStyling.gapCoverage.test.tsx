/**
 * Gap Coverage Tests for Participant Styling Feature
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 * Task Group 7: Test Review and Gap Analysis
 *
 * These tests cover edge cases and scenarios identified during gap analysis
 * that were not covered by Task Groups 3-6 tests.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { SequenceDiagram, SequenceParticipant } from '../types/sequenceDiagram';
import type { MetaModel, Service, ApplicationComponent, Application } from '../types/model';
import {
  SequenceDiagramRenderer,
  PARTICIPANT_FILL_COLOURS,
  PARTICIPANT_ICON_SIZE,
  classifyServiceParticipant,
  classifyAppComponentParticipant,
} from '../components/DiagramsView/SequenceDiagramRenderer';

/**
 * Helper to create a minimal MetaModel with specified entities
 */
function createMockMetaModel(overrides: {
  services?: Partial<Service>[];
  app_components?: Partial<ApplicationComponent>[];
  applications?: Partial<Application>[];
}): MetaModel {
  const defaultService: Service = {
    id: 'default-svc',
    name: 'Default Service',
    description: '',
    application_id: 'app-1',
    service_type: 'REST',
    tags: '',
  };

  const defaultComponent: ApplicationComponent = {
    id: 'default-comp',
    name: 'Default Component',
    description: '',
    application_id: 'app-1',
    tags: '',
  };

  const defaultApplication: Application = {
    id: 'app-1',
    name: 'Test App',
    description: '',
    app_type: 'Web',
    status: 'Active',
    tags: '',
  };

  return {
    entities: {
      business_users: [
        { id: 'user-1', name: 'Test User', description: '', tags: '' },
      ],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: (overrides.applications || [defaultApplication]).map(a => ({
        ...defaultApplication,
        ...a,
      })) as Application[],
      app_components: (overrides.app_components || []).map(c => ({
        ...defaultComponent,
        ...c,
      })) as ApplicationComponent[],
      services: (overrides.services || []).map(s => ({
        ...defaultService,
        ...s,
      })) as Service[],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      business_logics: [],
      ui_screens: [],
      ui_components: [],
      ui_actions: [],
      ui_characteristics: [],
      package_sets: [],
      packages: [],
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      application_point_business_logics: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

/**
 * Helper to create a minimal SequenceDiagram with specified participants
 */
function createMockSequenceDiagram(participants: SequenceParticipant[]): SequenceDiagram {
  return {
    id: 'seq-diagram-1',
    model_file_id: 'model-1',
    name: 'Test Sequence Diagram',
    type: 'Sequence',
    participants,
    messages: [],
    fragments: [],
    operands: [],
    sequence_nodes: [],
  };
}

describe('Participant Styling Gap Coverage Tests', () => {
  // ============================================================================
  // Gap Test 1: Mixed participant types rendering
  // Verifies that a sequence diagram with multiple participant types renders
  // each with the correct styling (colours) based on their classification.
  // ============================================================================
  describe('Mixed participant types in single diagram', () => {
    it('should render diagram with external, internal UI, internal service, and internal persistence participants correctly', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-external', name: 'External Payment API', is_internal: false },
          { id: 'svc-ui', name: 'UI Service', is_internal: true, app_component_id: 'comp-ui' },
          { id: 'svc-backend', name: 'Order Service', is_internal: true, app_component_id: 'comp-backend' },
          { id: 'svc-db', name: 'Data Service', is_internal: true, app_component_id: 'comp-db' },
        ],
        app_components: [
          { id: 'comp-ui', name: 'Frontend', is_internal: true, tech_type: 'UI Tier' },
          { id: 'comp-backend', name: 'Backend', is_internal: true, tech_type: 'Service Tier' },
          { id: 'comp-db', name: 'Database', is_internal: true, tech_type: 'Persistence Tier' },
        ],
      });

      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'Service', ref_id: 'svc-external', order_index: 0 },
        { id: 'p2', ref_kind: 'Service', ref_id: 'svc-ui', order_index: 1 },
        { id: 'p3', ref_kind: 'Service', ref_id: 'svc-backend', order_index: 2 },
        { id: 'p4', ref_kind: 'Service', ref_id: 'svc-db', order_index: 3 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      // Verify external participant (light blue)
      const p1Group = container.querySelector('[data-participant-id="p1"]');
      expect(p1Group).not.toBeNull();
      const p1Rect = p1Group?.querySelector('rect');
      expect(p1Rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.EXTERNAL);

      // Verify UI tier participant (light green)
      const p2Group = container.querySelector('[data-participant-id="p2"]');
      expect(p2Group).not.toBeNull();
      const p2Rect = p2Group?.querySelector('rect');
      expect(p2Rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_UI);

      // Verify Service tier participant (light yellow)
      const p3Group = container.querySelector('[data-participant-id="p3"]');
      expect(p3Group).not.toBeNull();
      const p3Rect = p3Group?.querySelector('rect');
      expect(p3Rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_SERVICE);

      // Verify Persistence tier participant (light purple)
      const p4Group = container.querySelector('[data-participant-id="p4"]');
      expect(p4Group).not.toBeNull();
      const p4Rect = p4Group?.querySelector('rect');
      expect(p4Rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_PERSISTENCE);
    });
  });

  // ============================================================================
  // Gap Test 2: Internal Service Tier specific icon rendering
  // Verifies that internal Service Tier participants render with file-code icon
  // ============================================================================
  describe('Internal Service Tier icon rendering', () => {
    it('should render file-code icon for internal Service Tier participant', () => {
      const metaModel = createMockMetaModel({
        services: [
          { id: 'svc-backend', name: 'Order Service', is_internal: true, app_component_id: 'comp-backend' },
        ],
        app_components: [
          { id: 'comp-backend', name: 'Backend Service', is_internal: true, tech_type: 'Service Tier' },
        ],
      });

      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'Service', ref_id: 'svc-backend', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const participantGroup = container.querySelector('[data-participant-id="p1"]');
      expect(participantGroup).not.toBeNull();

      // Verify fill colour for Service Tier (light yellow)
      const rect = participantGroup?.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_SERVICE);

      // Verify icon is rendered (foreignObject contains the icon)
      const foreignObject = participantGroup?.querySelector('foreignObject');
      expect(foreignObject).not.toBeNull();
      expect(foreignObject?.getAttribute('width')).toBe(String(PARTICIPANT_ICON_SIZE));
    });
  });

  // ============================================================================
  // Gap Test 3: Internal persistence tier specific icon rendering
  // Verifies that database icon renders for Persistence Tier participants
  // ============================================================================
  describe('Internal Persistence Tier icon rendering', () => {
    it('should render database icon for internal Persistence Tier ApplicationComponent', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-db', name: 'Database Layer', is_internal: true, tech_type: 'Persistence Tier' },
        ],
      });

      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'ApplicationComponent', ref_id: 'comp-db', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const participantGroup = container.querySelector('[data-participant-id="p1"]');
      expect(participantGroup).not.toBeNull();

      // Verify fill colour for Persistence Tier (light purple)
      const rect = participantGroup?.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_PERSISTENCE);

      // Verify icon is rendered
      const foreignObject = participantGroup?.querySelector('foreignObject');
      expect(foreignObject).not.toBeNull();
    });
  });

  // ============================================================================
  // Gap Test 4: Backward compatibility - Service with null is_internal treated as internal
  // This is a critical backward compatibility test
  // ============================================================================
  describe('Backward compatibility with missing fields', () => {
    it('should treat Service with undefined is_internal as internal (default true)', () => {
      const metaModel = createMockMetaModel({
        services: [
          // Legacy service without is_internal field set
          { id: 'svc-legacy', name: 'Legacy Service', app_component_id: 'comp-svc' },
        ],
        app_components: [
          { id: 'comp-svc', name: 'Service Component', tech_type: 'Service Tier' },
        ],
      });

      // Classification should be INTERNAL_SERVICE (not EXTERNAL)
      const classification = classifyServiceParticipant('svc-legacy', metaModel);
      expect(classification).toBe('INTERNAL_SERVICE');

      // Render test to verify the visual output
      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'Service', ref_id: 'svc-legacy', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const rect = container.querySelector('[data-participant-id="p1"] rect');
      // Should be Service Tier colour (light yellow), not external
      expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_SERVICE);
    });

    it('should treat ApplicationComponent with undefined tech_type as OTHER', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          // Legacy component without tech_type field set
          { id: 'comp-legacy', name: 'Legacy Component', is_internal: true },
        ],
      });

      // Classification should be OTHER (white fill, no icon)
      const classification = classifyAppComponentParticipant('comp-legacy', metaModel);
      expect(classification).toBe('OTHER');

      // Render test
      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'ApplicationComponent', ref_id: 'comp-legacy', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const rect = container.querySelector('[data-participant-id="p1"] rect');
      // Should be white (OTHER classification)
      expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.OTHER);

      // Should NOT have icon for OTHER classification
      const foreignObject = container.querySelector('[data-participant-id="p1"] foreignObject');
      expect(foreignObject).toBeNull();
    });
  });

  // ============================================================================
  // Gap Test 5: External ApplicationComponent renders correctly
  // Tests that external app component gets external styling
  // ============================================================================
  describe('External ApplicationComponent styling', () => {
    it('should render external ApplicationComponent with light blue fill and external-link icon', () => {
      const metaModel = createMockMetaModel({
        app_components: [
          { id: 'comp-external', name: 'Third-party Component', is_internal: false, tech_type: 'Service Tier' },
        ],
      });

      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'ApplicationComponent', ref_id: 'comp-external', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const participantGroup = container.querySelector('[data-participant-id="p1"]');
      expect(participantGroup).not.toBeNull();

      // Even though tech_type is Service Tier, is_internal=false means EXTERNAL
      const rect = participantGroup?.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.EXTERNAL);

      // Should have external-link icon
      const foreignObject = participantGroup?.querySelector('foreignObject');
      expect(foreignObject).not.toBeNull();
    });
  });

  // ============================================================================
  // Gap Test 6: Interface participant remains unchanged (white fill, no icon)
  // Verifies that non-styled participant kinds are not affected
  // ============================================================================
  describe('Non-styled participant kinds remain unchanged', () => {
    it('should render Interface participant with default white fill and no icon', () => {
      const metaModel = createMockMetaModel({});
      // Add an interface to the metamodel
      (metaModel.entities.interfaces as any[]).push({
        id: 'int-1',
        name: 'OrderAPI',
        description: 'Order management interface',
        tags: '',
      });

      const sequenceDiagram = createMockSequenceDiagram([
        { id: 'p1', ref_kind: 'Interface', ref_id: 'int-1', order_index: 0 },
      ]);

      const { container } = render(
        <svg>
          <SequenceDiagramRenderer
            sequenceDiagram={sequenceDiagram}
            participantSpacing={220}
            metaModel={metaModel}
          />
        </svg>
      );

      const participantGroup = container.querySelector('[data-participant-id="p1"]');
      expect(participantGroup).not.toBeNull();

      // Should have white fill (default, unchanged)
      const rect = participantGroup?.querySelector('rect');
      expect(rect?.getAttribute('fill')).toBe('#FFFFFF');

      // Should NOT have an icon (Interface is not a styled participant kind)
      const foreignObject = participantGroup?.querySelector('foreignObject');
      expect(foreignObject).toBeNull();
    });
  });
});
