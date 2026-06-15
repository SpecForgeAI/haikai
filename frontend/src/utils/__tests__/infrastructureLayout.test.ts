/**
 * infrastructureLayout.test.ts
 *
 * Spec 2026-05-05: Infrastructure Diagram V2 -- Auto-Layout & Cross-Domain Overlay
 * Task 1.1: 6 focused tests for the pure-function layout helper.
 *
 * Test 1 -- Lenient hierarchy walk skips undefined intermediate levels: sparse model with only
 *           Environment + Compute Resource attaches CR directly under Environment; empty
 *           Cloud Account / Location / Network / Subnet containers are NOT in the result.
 * Test 2 -- Compute Cluster renders as dashed-border container with `cluster_id` nesting.
 * Test 3 -- Cluster spans subnets => placed at parent Network level (not duplicated).
 * Test 4 -- Cross-domain Service card placement: 1 Service deployed to 2 Compute Resources
 *           produces 2 Service-card layout nodes (one per CR), each marked `isCrossDomain`.
 * Test 5 -- `data_entity_data_store_hostings` renders Data entity chips inside Data Stores.
 * Test 6 -- Cross-domain edge resolution: Service-card -> LB edge emitted from
 *           `application_load_balancer_exposures`.
 */

import { describe, it, expect } from 'vitest';
import { layoutInfrastructureDiagram, defaultInfrastructureFilters } from '../infrastructureLayout';
import type { MetaModel, MetaModelEntities, MetaModelRelationships } from '../../types/model';

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

// ============================================================================
// Tests
// ============================================================================

describe('layoutInfrastructureDiagram', () => {
  it('lenient hierarchy walk: sparse model with Environment + Compute Resource only attaches CR under Environment', () => {
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
      // intentionally NO cloud_account_id, location_id, network_id, cluster_id, no rsh row
      tags: '',
    });

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    // Environment is the root and present
    expect(result.root).not.toBeNull();
    expect(result.root!.kind).toBe('environment');
    expect(result.root!.id).toBe('env-1');

    // Compute Resource is attached directly under Environment
    const cr = result.nodes.find((n) => n.id === 'cr-1');
    expect(cr).toBeDefined();
    expect(cr!.parent_id).toBe('env-1');

    // Empty Cloud Account / Location / Network / Subnet containers are NOT in the result
    const containers = result.nodes.filter((n) =>
      ['cloud_account', 'location', 'network', 'subnet'].includes(n.kind),
    );
    expect(containers.length).toBe(0);
  });

  it('Compute Cluster renders as dashed-border container with cluster_id nesting', () => {
    const model = makeModel();
    model.entities.environments.push({
      id: 'env-1',
      name: 'prod',
      description: '',
      tags: '',
    });
    model.entities.networks.push({
      id: 'net-1',
      name: 'vpc-prod',
      description: '',
      environment_id: 'env-1',
      tags: '',
    });
    model.entities.subnets.push({
      id: 'sn-1',
      name: 'private-1',
      description: '',
      environment_id: 'env-1',
      network_id: 'net-1',
      tags: '',
    });
    model.entities.compute_clusters.push({
      id: 'cl-1',
      name: 'gke-cluster',
      description: '',
      environment_id: 'env-1',
      network_id: 'net-1',
      platform_type: 'GKE',
      version: '1.28',
      tags: '',
    });
    model.entities.compute_resources.push(
      {
        id: 'cr-1',
        name: 'pod-1',
        description: '',
        environment_id: 'env-1',
        cluster_id: 'cl-1',
        tags: '',
      },
      {
        id: 'cr-2',
        name: 'pod-2',
        description: '',
        environment_id: 'env-1',
        cluster_id: 'cl-1',
        tags: '',
      },
    );
    // Both pods hosted in subnet sn-1 via rsh
    model.entities.infrastructure_points.push(
      { id: 'ip-1', name: 'pod-1', description: '', point_kind: 'COMPUTE_RESOURCE', compute_resource_id: 'cr-1', tags: '' },
      { id: 'ip-2', name: 'pod-2', description: '', point_kind: 'COMPUTE_RESOURCE', compute_resource_id: 'cr-2', tags: '' },
    );
    model.relationships.resource_subnet_hostings.push(
      { id: 'rsh-1', description: '', infrastructure_point_id: 'ip-1', subnet_id: 'sn-1', environment_id: 'env-1', tags: '' },
      { id: 'rsh-2', description: '', infrastructure_point_id: 'ip-2', subnet_id: 'sn-1', environment_id: 'env-1', tags: '' },
    );

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    // Cluster present, dashed, with platform_type/version sublabel
    const cluster = result.nodes.find((n) => n.id === 'cl-1');
    expect(cluster).toBeDefined();
    expect(cluster!.kind).toBe('compute_cluster');
    expect(cluster!.isDashed).toBe(true);
    expect(cluster!.sublabel).toContain('GKE');
    // Cluster nested inside the single subnet (since both members hosted there)
    expect(cluster!.parent_id).toBe('sn-1');

    // Both pods nested inside the cluster
    const pod1 = result.nodes.find((n) => n.id === 'cr-1');
    const pod2 = result.nodes.find((n) => n.id === 'cr-2');
    expect(pod1).toBeDefined();
    expect(pod2).toBeDefined();
    expect(pod1!.parent_id).toBe('cl-1');
    expect(pod2!.parent_id).toBe('cl-1');
  });

  it('cluster spans subnets => placed at parent Network level (not duplicated)', () => {
    const model = makeModel();
    model.entities.environments.push({ id: 'env-1', name: 'prod', description: '', tags: '' });
    model.entities.networks.push({ id: 'net-1', name: 'vpc', description: '', environment_id: 'env-1', tags: '' });
    model.entities.subnets.push(
      { id: 'sn-1', name: 'sn1', description: '', environment_id: 'env-1', network_id: 'net-1', tags: '' },
      { id: 'sn-2', name: 'sn2', description: '', environment_id: 'env-1', network_id: 'net-1', tags: '' },
    );
    model.entities.compute_clusters.push({
      id: 'cl-1',
      name: 'gke-multi',
      description: '',
      environment_id: 'env-1',
      network_id: 'net-1',
      platform_type: 'GKE',
      tags: '',
    });
    model.entities.compute_resources.push(
      { id: 'cr-1', name: 'pod-1', description: '', environment_id: 'env-1', cluster_id: 'cl-1', tags: '' },
      { id: 'cr-2', name: 'pod-2', description: '', environment_id: 'env-1', cluster_id: 'cl-1', tags: '' },
    );
    model.entities.infrastructure_points.push(
      { id: 'ip-1', name: 'pod-1', description: '', point_kind: 'COMPUTE_RESOURCE', compute_resource_id: 'cr-1', tags: '' },
      { id: 'ip-2', name: 'pod-2', description: '', point_kind: 'COMPUTE_RESOURCE', compute_resource_id: 'cr-2', tags: '' },
    );
    // Pod-1 in sn-1, pod-2 in sn-2 -- cluster spans subnets
    model.relationships.resource_subnet_hostings.push(
      { id: 'rsh-1', description: '', infrastructure_point_id: 'ip-1', subnet_id: 'sn-1', environment_id: 'env-1', tags: '' },
      { id: 'rsh-2', description: '', infrastructure_point_id: 'ip-2', subnet_id: 'sn-2', environment_id: 'env-1', tags: '' },
    );

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    const cluster = result.nodes.find((n) => n.id === 'cl-1');
    expect(cluster).toBeDefined();
    // Cluster parented to the Network, NOT a Subnet
    expect(cluster!.parent_id).toBe('net-1');

    // Cluster appears exactly once (not duplicated across subnets)
    expect(result.nodes.filter((n) => n.id === 'cl-1').length).toBe(1);
  });

  it('cross-domain Service card placement: multi-deployment renders one card per Compute Resource', () => {
    const model = makeModel();
    model.entities.environments.push({ id: 'env-1', name: 'prod', description: '', tags: '' });
    model.entities.compute_resources.push(
      { id: 'cr-1', name: 'web-1', description: '', environment_id: 'env-1', tags: '' },
      { id: 'cr-2', name: 'web-2', description: '', environment_id: 'env-1', tags: '' },
    );
    model.entities.applications.push({
      id: 'app-1',
      name: 'OrderApp',
      description: '',
      tags: '',
    } as never);
    model.entities.services.push({
      id: 'svc-1',
      name: 'OrderService',
      description: '',
      application_id: 'app-1',
      service_type: 'REST',
      tags: '',
    } as never);
    model.entities.application_points.push({
      id: 'ap-1',
      name: 'OrderService',
      description: '',
      kind: 'SERVICE',
      application_id: 'app-1',
      service_id: 'svc-1',
      target_type: 'SERVICE',
      target_ref_id: 'svc-1',
      point_type: 'service',
      tags: '',
    } as never);
    model.relationships.application_compute_deployments.push(
      {
        id: 'dep-1',
        application_point_id: 'ap-1',
        compute_resource_id: 'cr-1',
        environment_id: 'env-1',
        description: '',
        tags: '',
      },
      {
        id: 'dep-2',
        application_point_id: 'ap-1',
        compute_resource_id: 'cr-2',
        environment_id: 'env-1',
        description: '',
        tags: '',
      },
    );

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    const cards = result.nodes.filter((n) => n.kind === 'service_card');
    expect(cards.length).toBe(2);
    const parentIds = cards.map((c) => c.parent_id).sort();
    expect(parentIds).toEqual(['cr-1', 'cr-2']);
    // Both cards reference the same underlying Service entity
    expect(cards.every((c) => c.entity_id === 'svc-1')).toBe(true);
    expect(cards.every((c) => c.entity_type === 'SERVICE')).toBe(true);
    // Cross-domain marker present
    expect(cards.every((c) => c.isCrossDomain === true)).toBe(true);
  });

  it('data_entity_data_store_hostings renders Data entity chips inside Data Stores', () => {
    const model = makeModel();
    model.entities.environments.push({ id: 'env-1', name: 'prod', description: '', tags: '' });
    model.entities.data_store_instances.push({
      id: 'ds-1',
      name: 'orders-db',
      description: '',
      environment_id: 'env-1',
      engine: 'postgres',
      tags: '',
    });
    model.entities.logical_data_entities.push(
      { id: 'lde-1', name: 'Order', description: '', tags: '' } as never,
      { id: 'lde-2', name: 'Customer', description: '', tags: '' } as never,
    );
    model.relationships.data_entity_data_store_hostings.push(
      {
        id: 'h-1',
        data_entity_point_id: 'lde-1',
        data_store_instance_id: 'ds-1',
        environment_id: 'env-1',
        description: '',
        tags: '',
      },
      {
        id: 'h-2',
        data_entity_point_id: 'lde-2',
        data_store_instance_id: 'ds-1',
        environment_id: 'env-1',
        description: '',
        tags: '',
      },
    );

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    const chips = result.nodes.filter((n) => n.kind === 'data_entity_chip');
    expect(chips.length).toBe(2);
    expect(chips.every((c) => c.parent_id === 'ds-1')).toBe(true);
    const labels = chips.map((c) => c.label).sort();
    expect(labels).toEqual(['Customer', 'Order']);
  });

  it('cross-domain edge resolution: Service-card -> LB edge emitted from application_load_balancer_exposures', () => {
    const model = makeModel();
    model.entities.environments.push({ id: 'env-1', name: 'prod', description: '', tags: '' });
    model.entities.compute_resources.push({
      id: 'cr-1',
      name: 'web-1',
      description: '',
      environment_id: 'env-1',
      tags: '',
    });
    model.entities.load_balancers.push({
      id: 'lb-1',
      name: 'edge-lb',
      description: '',
      environment_id: 'env-1',
      tags: '',
    });
    model.entities.applications.push({ id: 'app-1', name: 'OrderApp', description: '', tags: '' } as never);
    model.entities.services.push({
      id: 'svc-1',
      name: 'OrderService',
      description: '',
      application_id: 'app-1',
      service_type: 'REST',
      tags: '',
    } as never);
    model.entities.application_points.push({
      id: 'ap-1',
      name: 'OrderService',
      description: '',
      kind: 'SERVICE',
      application_id: 'app-1',
      service_id: 'svc-1',
      target_type: 'SERVICE',
      target_ref_id: 'svc-1',
      point_type: 'service',
      tags: '',
    } as never);
    model.relationships.application_compute_deployments.push({
      id: 'dep-1',
      application_point_id: 'ap-1',
      compute_resource_id: 'cr-1',
      environment_id: 'env-1',
      description: '',
      tags: '',
    });
    model.relationships.application_load_balancer_exposures.push({
      id: 'exp-1',
      application_point_id: 'ap-1',
      load_balancer_id: 'lb-1',
      environment_id: 'env-1',
      description: '',
      tags: '',
    });

    const result = layoutInfrastructureDiagram(model, 'env-1', defaultInfrastructureFilters());

    expect(result.edges.length).toBe(1);
    const edge = result.edges[0];
    expect(edge.kind).toBe('service_to_lb');
    expect(edge.target_node_id).toBe('lb-1');
    expect(edge.source_node_id).toMatch(/^service_card::svc-1::cr-1$/);
    expect(edge.relationship_type).toBe('application_load_balancer_exposures');
    expect(edge.relationship_id).toBe('exp-1');
  });
});
