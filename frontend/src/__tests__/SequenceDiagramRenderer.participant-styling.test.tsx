/**
 * Tests for Sequence Diagram Renderer Participant Styling
 * Spec: Sequence Diagram Participant Colour and Icons for Services and Components
 * Task Group 6: Sequence Diagram Renderer UI Updates
 *
 * Tests the visual rendering of participant headers with classification-based
 * fill colours and icons.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { SequenceDiagram, SequenceParticipant } from '../types/sequenceDiagram';
import type { MetaModel, Service, ApplicationComponent, Application } from '../types/model';
import {
  SequenceDiagramRenderer,
  PARTICIPANT_FILL_COLOURS,
  PARTICIPANT_ICON_SIZE,
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

describe('SequenceDiagramRenderer participant styling', () => {
  // ============================================================================
  // Test 1: External Service participant renders with light blue fill (#E3F2FD)
  // ============================================================================
  it('should render external Service participant with light blue fill', () => {
    const metaModel = createMockMetaModel({
      services: [
        { id: 'svc-external', name: 'External Service', is_internal: false },
      ],
    });

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'Service', ref_id: 'svc-external', order_index: 0 },
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

    // Find the participant group and rect
    const participantGroup = container.querySelector('[data-participant-id="p1"]');
    expect(participantGroup).not.toBeNull();

    const rect = participantGroup?.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.EXTERNAL);
  });

  // ============================================================================
  // Test 2: Internal UI Tier Service renders with light green fill (#E8F5E9)
  // ============================================================================
  it('should render internal UI Tier Service with light green fill', () => {
    const metaModel = createMockMetaModel({
      services: [
        { id: 'svc-ui', name: 'UI Service', is_internal: true, app_component_id: 'comp-ui' },
      ],
      app_components: [
        { id: 'comp-ui', name: 'UI Component', is_internal: true, tech_type: 'UI Tier' },
      ],
    });

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'Service', ref_id: 'svc-ui', order_index: 0 },
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

    const rect = participantGroup?.querySelector('rect');
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_UI);
  });

  // ============================================================================
  // Test 3: External Service participant renders external-link icon
  // ============================================================================
  it('should render external-link icon for external Service participant', () => {
    const metaModel = createMockMetaModel({
      services: [
        { id: 'svc-external', name: 'External Service', is_internal: false },
      ],
    });

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'Service', ref_id: 'svc-external', order_index: 0 },
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

    // Check for foreignObject which embeds the React icon component
    const participantGroup = container.querySelector('[data-participant-id="p1"]');
    expect(participantGroup).not.toBeNull();

    const foreignObject = participantGroup?.querySelector('foreignObject');
    expect(foreignObject).not.toBeNull();

    // Verify icon dimensions
    expect(foreignObject?.getAttribute('width')).toBe(String(PARTICIPANT_ICON_SIZE));
    expect(foreignObject?.getAttribute('height')).toBe(String(PARTICIPANT_ICON_SIZE));
  });

  // ============================================================================
  // Test 4: Application participant renders with default white fill (unchanged)
  // ============================================================================
  it('should render Application participant with default white fill (unchanged)', () => {
    const metaModel = createMockMetaModel({
      applications: [
        { id: 'app-1', name: 'Test Application' },
      ],
    });

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'Application', ref_id: 'app-1', order_index: 0 },
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

    const rect = participantGroup?.querySelector('rect');
    expect(rect).not.toBeNull();
    // Application participants should have white fill (default, not classified)
    expect(rect?.getAttribute('fill')).toBe('#FFFFFF');

    // Should NOT have a foreignObject (no icon for Application)
    const foreignObject = participantGroup?.querySelector('foreignObject');
    expect(foreignObject).toBeNull();
  });

  // ============================================================================
  // Test 5: BusinessUser participant renders as stickman (unchanged)
  // ============================================================================
  it('should render BusinessUser participant as stickman (unchanged)', () => {
    const metaModel = createMockMetaModel({});

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'BusinessUser', ref_id: 'user-1', order_index: 0 },
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

    // Stickman has a circle (head) instead of a rect
    const circle = participantGroup?.querySelector('circle');
    expect(circle).not.toBeNull();

    // Stickman should have lines for body, arms, and legs
    const lines = participantGroup?.querySelectorAll('line');
    // Expected lines: body (1), arms (1), legs (2), lifeline (1) = 5 total
    expect(lines?.length).toBeGreaterThanOrEqual(4);

    // Should NOT have a rect (stickman, not box)
    const rect = participantGroup?.querySelector('rect');
    expect(rect).toBeNull();
  });

  // ============================================================================
  // Test 6: Icon and text layout within header box bounds
  // ============================================================================
  it('should layout icon and text within header box bounds', () => {
    const metaModel = createMockMetaModel({
      services: [
        { id: 'svc-persistence', name: 'Database Service', is_internal: true, app_component_id: 'comp-db' },
      ],
      app_components: [
        { id: 'comp-db', name: 'DB Component', is_internal: true, tech_type: 'Persistence Tier' },
      ],
    });

    const sequenceDiagram = createMockSequenceDiagram([
      { id: 'p1', ref_kind: 'Service', ref_id: 'svc-persistence', order_index: 0 },
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

    // Get the rect (header box)
    const rect = participantGroup?.querySelector('rect');
    expect(rect).not.toBeNull();

    const rectX = parseFloat(rect?.getAttribute('x') || '0');
    const rectY = parseFloat(rect?.getAttribute('y') || '0');
    const rectWidth = parseFloat(rect?.getAttribute('width') || '0');
    const rectHeight = parseFloat(rect?.getAttribute('height') || '0');

    // Get the foreignObject (icon container)
    const foreignObject = participantGroup?.querySelector('foreignObject');
    expect(foreignObject).not.toBeNull();

    const iconX = parseFloat(foreignObject?.getAttribute('x') || '0');
    const iconY = parseFloat(foreignObject?.getAttribute('y') || '0');
    const iconWidth = parseFloat(foreignObject?.getAttribute('width') || '0');
    const iconHeight = parseFloat(foreignObject?.getAttribute('height') || '0');

    // Icon should be within the header box bounds
    expect(iconX).toBeGreaterThanOrEqual(rectX);
    expect(iconY).toBeGreaterThanOrEqual(rectY);
    expect(iconX + iconWidth).toBeLessThanOrEqual(rectX + rectWidth);
    expect(iconY + iconHeight).toBeLessThanOrEqual(rectY + rectHeight);

    // Get the text elements
    const textElements = participantGroup?.querySelectorAll('text');
    expect(textElements?.length).toBeGreaterThan(0);

    // Text should be positioned to the right of the icon or centered considering the icon
    const textX = parseFloat(textElements?.[0]?.getAttribute('x') || '0');

    // Text X should be approximately at the center of the remaining space after icon
    // Since we can't perfectly verify centering without knowing exact widths,
    // just verify text is within bounds
    expect(textX).toBeGreaterThan(rectX);
    expect(textX).toBeLessThan(rectX + rectWidth);

    // Verify the fill colour for Persistence Tier (light purple)
    expect(rect?.getAttribute('fill')).toBe(PARTICIPANT_FILL_COLOURS.INTERNAL_PERSISTENCE);
  });
});
