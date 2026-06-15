/**
 * InfrastructureDiagramRenderer.test.tsx
 *
 * Spec 2026-05-05: Infrastructure Diagram V2 -- Auto-Layout & Cross-Domain Overlay
 * Task 2.1: 4 focused renderer smoke tests.
 *
 * Test 1 -- Mounts and renders Environment dropdown + 5 layer chips + 2 edge-overlay chips
 *           + Re-layout button.
 * Test 2 -- Empty-state when zero environments (no SVG render).
 * Test 3 -- Default Environment selection: first by name ascending.
 * Test 4 -- Filter chip toggle dispatches `UPDATE_DIAGRAM` with merged settings.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { InfrastructureDiagramRenderer } from '../InfrastructureDiagramRenderer';
import type { Diagram, MetaModel, MetaModelEntities, MetaModelRelationships } from '../../../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

function makeEmptyEntities(): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
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
    user_journeys: [],
    activity_steps: [],
    environments: [],
    cloud_accounts: [],
    locations: [],
    networks: [],
    subnets: [],
    compute_clusters: [],
    compute_resources: [],
    deployment_units: [],
    load_balancers: [],
    listeners: [],
    data_store_instances: [],
    infrastructure_resources: [],
    infrastructure_points: [],
    iac_sources: [],
  } as MetaModelEntities;
}

function makeEmptyRelationships(): MetaModelRelationships {
  return {
    business_user_business_points: [],
    application_point_business_points: [],
    application_point_business_logics: [],
    logical_data_entity_relationships: [],
    logical_data_entity_physical_data_entities: [],
    logical_data_attribute_physical_data_attributes: [],
    data_movements: [],
    interface_logical_entities: [],
    ui_workflow_transitions: [],
    user_journey_links: [],
    resource_subnet_hostings: [],
    deployment_unit_compute_resources: [],
    load_balancer_resource_routes: [],
    application_compute_deployments: [],
    data_entity_data_store_hostings: [],
    application_infrastructure_resource_uses: [],
    application_load_balancer_exposures: [],
    iac_resource_bindings: [],
  } as MetaModelRelationships;
}

function makeModel(): MetaModel {
  return { entities: makeEmptyEntities(), relationships: makeEmptyRelationships() };
}

function makeDiagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: 'diag-1',
    name: 'Infrastructure',
    description: '',
    diagram_type: 'Infrastructure',
    diagram_nodes: [],
    diagram_edges: [],
    settings: {},
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('InfrastructureDiagramRenderer', () => {
  it('mounts and renders Environment dropdown + 5 layer chips + 2 edge-overlay chips + Re-layout button', () => {
    const model = makeModel();
    model.entities.environments.push({
      id: 'env-1',
      name: 'prod',
      description: '',
      tags: '',
    });
    model.entities.compute_resources.push({
      id: 'cr-1',
      name: 'web-1',
      description: '',
      environment_id: 'env-1',
      tags: '',
    });

    const dispatch = vi.fn();
    const diagram = makeDiagram({ settings: { infrastructure: { environment_id: 'env-1' } } });

    const { getByTestId } = render(
      <InfrastructureDiagramRenderer diagram={diagram} metaModel={model} dispatch={dispatch} />,
    );

    // Environment dropdown present and includes the env
    const select = getByTestId('infrastructure-env-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('env-1');
    expect(select.options.length).toBe(1);
    expect(select.options[0].textContent).toBe('prod');

    // 5 layer chips
    expect(getByTestId('infrastructure-chip-compute')).toBeTruthy();
    expect(getByTestId('infrastructure-chip-data_stores')).toBeTruthy();
    expect(getByTestId('infrastructure-chip-load_balancers')).toBeTruthy();
    expect(getByTestId('infrastructure-chip-infrastructure_resources')).toBeTruthy();
    expect(getByTestId('infrastructure-chip-services')).toBeTruthy();

    // 2 edge-overlay chips
    expect(getByTestId('infrastructure-chip-service_to_lb_edges')).toBeTruthy();
    expect(getByTestId('infrastructure-chip-service_to_ir_edges')).toBeTruthy();

    // Re-layout button
    expect(getByTestId('infrastructure-relayout-btn')).toBeTruthy();

    // SVG was rendered
    expect(getByTestId('infrastructure-svg')).toBeTruthy();
  });

  it('renders empty-state when zero environments (no SVG)', () => {
    const model = makeModel();
    const dispatch = vi.fn();
    const diagram = makeDiagram();

    const { getByTestId, queryByTestId } = render(
      <InfrastructureDiagramRenderer diagram={diagram} metaModel={model} dispatch={dispatch} />,
    );

    expect(getByTestId('infrastructure-empty-state')).toBeTruthy();
    expect(queryByTestId('infrastructure-svg')).toBeNull();
    expect(queryByTestId('infrastructure-env-select')).toBeNull();
  });

  it('defaults Environment to first by name ascending when settings.environment_id is undefined', () => {
    const model = makeModel();
    // Insert in non-alphabetical order to verify name-ascending sort
    model.entities.environments.push(
      { id: 'env-prod', name: 'prod', description: '', tags: '' },
      { id: 'env-dev', name: 'dev', description: '', tags: '' },
      { id: 'env-staging', name: 'staging', description: '', tags: '' },
    );
    const dispatch = vi.fn();
    const diagram = makeDiagram(); // settings empty, no environment_id

    const { getByTestId } = render(
      <InfrastructureDiagramRenderer diagram={diagram} metaModel={model} dispatch={dispatch} />,
    );

    const select = getByTestId('infrastructure-env-select') as HTMLSelectElement;
    // First by name ascending => 'dev'
    expect(select.value).toBe('env-dev');
  });

  it('clicking the Compute layer chip dispatches UPDATE_DIAGRAM with filters.compute === false', () => {
    const model = makeModel();
    model.entities.environments.push({ id: 'env-1', name: 'prod', description: '', tags: '' });
    const dispatch = vi.fn();
    const diagram = makeDiagram({ settings: { infrastructure: { environment_id: 'env-1' } } });

    const { getByTestId } = render(
      <InfrastructureDiagramRenderer diagram={diagram} metaModel={model} dispatch={dispatch} />,
    );

    const chip = getByTestId('infrastructure-chip-compute') as HTMLButtonElement;
    fireEvent.click(chip);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('UPDATE_DIAGRAM');
    expect(action.diagramId).toBe('diag-1');
    const settings = action.updates.settings as Record<string, unknown>;
    expect(settings).toBeDefined();
    const infra = settings.infrastructure as Record<string, unknown>;
    expect(infra).toBeDefined();
    expect((infra.filters as Record<string, unknown>).compute).toBe(false);
    // environment_id preserved
    expect(infra.environment_id).toBe('env-1');
  });
});
