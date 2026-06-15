/**
 * SelectionInspector Component
 * Task Group 3: Selection Inspector for Created Entities
 * Task Group 5: Extended for StateTransition and ActivityFlow Edge Inspectors
 *
 * Shows editable fields when nodes with specific entity types are selected:
 * - STATE: name, description, state_kind dropdown
 * - ACTIVITY: name, description, activity_kind dropdown
 * - ACTIVITY_PARTITION: name, ref_kind, ref_id, description
 * - LOGICAL_DATA_ENTITY: name, description
 * - PHYSICAL_DATA_ENTITY: name, description
 *
 * Also shows editable fields when edges with specific relationship types are selected:
 * - STATE_TRANSITION: fromState (read-only), toState (read-only), trigger, guard, effect
 * - ACTIVITY_FLOW: fromActivity (read-only), toActivity (read-only), flowKind, trigger, condition
 *
 * Changes are saved on blur (text fields) or on change (dropdowns/mode selectors).
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  MetaModel,
  ENTITY_TYPES,
  StateKind,
  ActivityKind,
  ActivityPartitionRefKind,
  EntityType,
  AnyEntity,
  DiagramNode,
  DiagramEdge,
  StateTransition,
  ActivityFlow,
  ActivityFlowKind,
} from '../../types/model';
import {
  ModeSelector,
  STATE_TRANSITION_TRIGGER_MODES,
  ACTIVITY_FLOW_TRIGGER_MODES,
  GUARD_MODES,
  EFFECT_MODES,
  CONDITION_MODES,
  getStateTransitionTriggerMode,
  getActivityFlowTriggerMode,
  getGuardMode,
  getEffectMode,
  getConditionMode,
} from './ModeSelector';
import styles from './SelectionInspector.module.css';

// Entity types supported by the Selection Inspector for nodes
const INSPECTOR_ENTITY_TYPES = new Set<string>([
  ENTITY_TYPES.STATE,
  ENTITY_TYPES.ACTIVITY,
  ENTITY_TYPES.ACTIVITY_PARTITION,
  ENTITY_TYPES.LOGICAL_DATA_ENTITY,
  ENTITY_TYPES.PHYSICAL_DATA_ENTITY,
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 entity types
  // (SCREAMING_SNAKE_CASE matching InfrastructurePointKind discriminator values)
  'ENVIRONMENT',
  'CLOUD_ACCOUNT',
  'LOCATION',
  'NETWORK',
  'SUBNET',
  'COMPUTE_CLUSTER',
  'COMPUTE_RESOURCE',
  'DEPLOYMENT_UNIT',
  'LOAD_BALANCER',
  'LISTENER',
  'DATA_STORE_INSTANCE',
  'INFRASTRUCTURE_RESOURCE',
]);

// Edge types supported by the Selection Inspector
const INSPECTOR_EDGE_TYPES = new Set<string>([
  'STATE_TRANSITION',
  'ACTIVITY_FLOW',
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 relationship-edge types
  'resource_subnet_hostings',
  'deployment_unit_compute_resources',
  'load_balancer_resource_routes',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship-edge types
  'application_compute_deployments',
  'data_entity_data_store_hostings',
  'application_infrastructure_resource_uses',
  'application_load_balancer_exposures',
]);

/**
 * Check if an entity type should show editable fields in the inspector
 */
export function isInspectorEntityType(entityType: string): boolean {
  return INSPECTOR_ENTITY_TYPES.has(entityType);
}

/**
 * Check if an edge type should show editable fields in the inspector
 */
export function isInspectorEdgeType(relationshipType: string): boolean {
  return INSPECTOR_EDGE_TYPES.has(relationshipType);
}

// Dropdown options
const STATE_KIND_OPTIONS: StateKind[] = ['Initial', 'Normal', 'Final'];
const ACTIVITY_KIND_OPTIONS: ActivityKind[] = ['Initial', 'Action', 'Decision', 'Merge', 'Final'];
const ACTIVITY_PARTITION_REF_KIND_OPTIONS: (ActivityPartitionRefKind | '')[] = [
  '',
  'BusinessUser',
  'Application',
  'ApplicationComponent',
  'Service',
  'Interface',
  'Class',
];
const FLOW_KIND_OPTIONS: ActivityFlowKind[] = ['Control', 'Data'];

// Props interface
export interface SelectionInspectorProps {
  /** The selected diagram node (single selection only) */
  selectedNode: DiagramNode | null;
  /** The selected diagram edge (single selection only) - Task Group 5 */
  selectedEdge?: DiagramEdge | null;
  /** The meta-model for entity lookups */
  metaModel: MetaModel;
  /** Callback to update an entity via UPDATE_ENTITY dispatch */
  onUpdateEntity: (entityType: EntityType, entity: AnyEntity) => void;
}

/**
 * Lookup entity from meta-model based on entity type and ID
 */
// Spec 2026-05-05: Infrastructure Domain Diagram Support
// Maps SCREAMING_SNAKE_CASE entity_type to the matching MetaModelEntities array key (snake_case).
const INFRASTRUCTURE_ENTITY_TYPE_TO_COLLECTION: Record<string, keyof MetaModel['entities']> = {
  ENVIRONMENT: 'environments',
  CLOUD_ACCOUNT: 'cloud_accounts',
  LOCATION: 'locations',
  NETWORK: 'networks',
  SUBNET: 'subnets',
  COMPUTE_CLUSTER: 'compute_clusters',
  COMPUTE_RESOURCE: 'compute_resources',
  DEPLOYMENT_UNIT: 'deployment_units',
  LOAD_BALANCER: 'load_balancers',
  LISTENER: 'listeners',
  DATA_STORE_INSTANCE: 'data_store_instances',
  INFRASTRUCTURE_RESOURCE: 'infrastructure_resources',
};

// Spec 2026-05-05: Infrastructure Domain Diagram Support
// Display labels for the 12 entity types in the inspector header (matches spec 4 entityTabNames).
const INFRASTRUCTURE_ENTITY_TYPE_TO_LABEL: Record<string, string> = {
  ENVIRONMENT: 'Environment',
  CLOUD_ACCOUNT: 'Cloud Account',
  LOCATION: 'Location',
  NETWORK: 'Network',
  SUBNET: 'Subnet',
  COMPUTE_CLUSTER: 'Compute Cluster',
  COMPUTE_RESOURCE: 'Compute Resource',
  DEPLOYMENT_UNIT: 'Deployment Unit',
  LOAD_BALANCER: 'Load Balancer',
  LISTENER: 'Listener',
  DATA_STORE_INSTANCE: 'Data Store',
  INFRASTRUCTURE_RESOURCE: 'Infrastructure Resource',
};

// Spec 2026-05-05: Infrastructure Domain Diagram Support
// Display labels for the 3 relationship-edge types in the inspector header.
const INFRASTRUCTURE_RELATIONSHIP_TYPE_TO_LABEL: Record<string, string> = {
  resource_subnet_hostings: 'Resource <-> Subnet',
  deployment_unit_compute_resources: 'Deployment Unit <-> Compute',
  load_balancer_resource_routes: 'Load Balancer Routes',
  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship labels
  application_compute_deployments: 'App <-> Compute',
  data_entity_data_store_hostings: 'Data Entity <-> Data Store',
  application_infrastructure_resource_uses: 'App <-> Infrastructure Resource',
  application_load_balancer_exposures: 'App <-> Load Balancer',
};

function lookupEntity(
  metaModel: MetaModel,
  entityType: string,
  entityId: string
): AnyEntity | undefined {
  switch (entityType) {
    case ENTITY_TYPES.STATE:
      return metaModel.entities.states.find(e => e.id === entityId);
    case ENTITY_TYPES.ACTIVITY:
      return metaModel.entities.activities.find(e => e.id === entityId);
    case ENTITY_TYPES.ACTIVITY_PARTITION:
      return metaModel.entities.activity_partitions.find(e => e.id === entityId);
    case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
      return metaModel.entities.logical_data_entities.find(e => e.id === entityId);
    case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
      return metaModel.entities.physical_data_entities.find(e => e.id === entityId);
    default: {
      // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 infra entity types
      const collectionKey = INFRASTRUCTURE_ENTITY_TYPE_TO_COLLECTION[entityType];
      if (collectionKey) {
        const collection = metaModel.entities[collectionKey] as Array<{ id: string }> | undefined;
        return collection?.find(e => e.id === entityId) as AnyEntity | undefined;
      }
      return undefined;
    }
  }
}

/**
 * Get EntityType string for dispatch
 */
function getEntityTypeForDispatch(entityType: string): EntityType | null {
  switch (entityType) {
    case ENTITY_TYPES.STATE:
      return 'states';
    case ENTITY_TYPES.ACTIVITY:
      return 'activities';
    case ENTITY_TYPES.ACTIVITY_PARTITION:
      return 'activity_partitions';
    case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
      return 'logical_data_entities';
    case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
      return 'physical_data_entities';
    default: {
      // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 infra entity types
      const collectionKey = INFRASTRUCTURE_ENTITY_TYPE_TO_COLLECTION[entityType];
      return (collectionKey as EntityType | undefined) ?? null;
    }
  }
}

/**
 * Get reference options based on ref_kind for ActivityPartition or edge fields
 */
function getReferenceOptions(
  refKind: string,
  metaModel: MetaModel
): Array<{ id: string; name: string }> {
  if (!refKind) return [];

  switch (refKind) {
    case 'BusinessUser':
      return metaModel.entities.business_users.map(e => ({ id: e.id, name: e.name }));
    case 'Application':
      return metaModel.entities.applications.map(e => ({ id: e.id, name: e.name }));
    case 'ApplicationComponent':
      return metaModel.entities.app_components.map(e => ({ id: e.id, name: e.name }));
    case 'Service':
      return metaModel.entities.services.map(e => ({ id: e.id, name: e.name }));
    case 'Interface':
      return metaModel.entities.interfaces.map(e => ({ id: e.id, name: e.name }));
    case 'Class':
      return metaModel.entities.classes?.map(e => ({ id: e.id, name: e.name })) || [];
    case 'Event':
      return metaModel.entities.events.map(e => ({ id: e.id, name: e.name }));
    case 'Method':
      return metaModel.entities.methods.map(e => ({ id: e.id, name: e.name }));
    default:
      return [];
  }
}

/**
 * Get State name by ID
 */
function getStateName(metaModel: MetaModel, stateId: string): string {
  const state = metaModel.entities.states.find(s => s.id === stateId);
  return state?.name || 'Unknown';
}

/**
 * Get Activity name by ID
 */
function getActivityName(metaModel: MetaModel, activityId: string): string {
  const activity = metaModel.entities.activities.find(a => a.id === activityId);
  return activity?.name || 'Unknown';
}

/**
 * SelectionInspector Component
 */
export function SelectionInspector({
  selectedNode,
  selectedEdge,
  metaModel,
  onUpdateEntity,
}: SelectionInspectorProps) {
  // Track local form state for editing
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Determine if we should show the node inspector
  const shouldShowNodeInspector = useMemo(() => {
    if (!selectedNode) return false;
    return isInspectorEntityType(selectedNode.entity_type);
  }, [selectedNode]);

  // Determine if we should show the edge inspector
  const shouldShowEdgeInspector = useMemo(() => {
    if (!selectedEdge) return false;
    return isInspectorEdgeType(selectedEdge.relationship_type);
  }, [selectedEdge]);

  // Look up the node entity from meta-model
  const nodeEntity = useMemo(() => {
    if (!selectedNode) return undefined;
    return lookupEntity(metaModel, selectedNode.entity_type, selectedNode.entity_id);
  }, [selectedNode, metaModel]);

  // Look up the edge entity (StateTransition or ActivityFlow) from meta-model
  const edgeEntity = useMemo(() => {
    if (!selectedEdge) return undefined;

    if (selectedEdge.relationship_type === 'STATE_TRANSITION') {
      return metaModel.entities.state_transitions.find(
        t => t.id === selectedEdge.relationship_id
      ) as StateTransition | undefined;
    }

    if (selectedEdge.relationship_type === 'ACTIVITY_FLOW') {
      return metaModel.entities.activity_flows.find(
        f => f.id === selectedEdge.relationship_id
      ) as ActivityFlow | undefined;
    }

    // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 infra relationship-edge types.
    // The relationship_type IS the snake_case key into metaModel.relationships for these.
    if (
      selectedEdge.relationship_type === 'resource_subnet_hostings' ||
      selectedEdge.relationship_type === 'deployment_unit_compute_resources' ||
      selectedEdge.relationship_type === 'load_balancer_resource_routes' ||
      // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship-edge types.
      // The relationship_type IS the snake_case key into metaModel.relationships for these.
      selectedEdge.relationship_type === 'application_compute_deployments' ||
      selectedEdge.relationship_type === 'data_entity_data_store_hostings' ||
      selectedEdge.relationship_type === 'application_infrastructure_resource_uses' ||
      selectedEdge.relationship_type === 'application_load_balancer_exposures'
    ) {
      const collection = metaModel.relationships[selectedEdge.relationship_type] as Array<{ id: string }> | undefined;
      return collection?.find(r => r.id === selectedEdge.relationship_id) as AnyEntity | undefined;
    }

    return undefined;
  }, [selectedEdge, metaModel]);

  // Reset form data when entity changes
  useEffect(() => {
    if (nodeEntity) {
      setFormData({ ...(nodeEntity as unknown as Record<string, unknown>) });
    } else if (edgeEntity) {
      setFormData({ ...(edgeEntity as unknown as Record<string, unknown>) });
    } else {
      setFormData({});
    }
  }, [nodeEntity, edgeEntity]);

  // Reference options for ActivityPartition
  const referenceOptions = useMemo(() => {
    if (selectedNode?.entity_type === ENTITY_TYPES.ACTIVITY_PARTITION && formData.ref_kind) {
      return getReferenceOptions(String(formData.ref_kind), metaModel);
    }
    return [];
  }, [selectedNode?.entity_type, formData.ref_kind, metaModel]);

  // Event options for edge trigger
  const eventOptions = useMemo(() => {
    return getReferenceOptions('Event', metaModel);
  }, [metaModel]);

  // Method options for edge trigger/guard/effect/condition
  const methodOptions = useMemo(() => {
    return getReferenceOptions('Method', metaModel);
  }, [metaModel]);

  // Handle text field change (update local state only)
  const handleTextChange = useCallback((fieldName: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  }, []);

  // Handle text field blur (save to meta-model)
  const handleTextBlur = useCallback((fieldName: string) => {
    if (!selectedNode || !nodeEntity) return;

    const entityTypeForDispatch = getEntityTypeForDispatch(selectedNode.entity_type);
    if (!entityTypeForDispatch) return;

    // Build updated entity
    const updatedEntity = {
      ...(nodeEntity as unknown as Record<string, unknown>),
      [fieldName]: formData[fieldName],
    };

    onUpdateEntity(entityTypeForDispatch, updatedEntity as unknown as AnyEntity);
  }, [selectedNode, nodeEntity, formData, onUpdateEntity]);

  // Handle dropdown change (save immediately)
  const handleDropdownChange = useCallback((fieldName: string, value: string) => {
    if (!selectedNode || !nodeEntity) return;

    const entityTypeForDispatch = getEntityTypeForDispatch(selectedNode.entity_type);
    if (!entityTypeForDispatch) return;

    // Update local state
    setFormData(prev => ({ ...prev, [fieldName]: value || undefined }));

    // Build updated entity
    const updatedEntity = {
      ...(nodeEntity as unknown as Record<string, unknown>),
      [fieldName]: value || undefined,
    };

    // For ref_kind, if cleared, also clear ref_id
    if (fieldName === 'ref_kind' && !value) {
      updatedEntity.ref_id = undefined;
      setFormData(prev => ({ ...prev, ref_id: undefined }));
    }

    onUpdateEntity(entityTypeForDispatch, updatedEntity as unknown as AnyEntity);
  }, [selectedNode, nodeEntity, onUpdateEntity]);

  // ============================================================================
  // Edge-specific handlers (Task Group 5)
  // ============================================================================

  // Handle edge text field blur (save to meta-model)
  const handleEdgeTextBlur = useCallback((fieldName: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Spec 2026-05-05: Resolve dispatch key for the 3 infra relationship-edge types
    // (relationship_type IS the snake_case EntityType key).
    let entityTypeForDispatch: EntityType;
    if (selectedEdge.relationship_type === 'STATE_TRANSITION') {
      entityTypeForDispatch = 'state_transitions';
    } else if (selectedEdge.relationship_type === 'ACTIVITY_FLOW') {
      entityTypeForDispatch = 'activity_flows';
    } else if (
      selectedEdge.relationship_type === 'resource_subnet_hostings' ||
      selectedEdge.relationship_type === 'deployment_unit_compute_resources' ||
      selectedEdge.relationship_type === 'load_balancer_resource_routes' ||
      // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship-edge dispatch keys
      selectedEdge.relationship_type === 'application_compute_deployments' ||
      selectedEdge.relationship_type === 'data_entity_data_store_hostings' ||
      selectedEdge.relationship_type === 'application_infrastructure_resource_uses' ||
      selectedEdge.relationship_type === 'application_load_balancer_exposures'
    ) {
      entityTypeForDispatch = selectedEdge.relationship_type as EntityType;
    } else {
      return;
    }

    // Build updated entity
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      [fieldName]: formData[fieldName] || undefined,
    };

    onUpdateEntity(entityTypeForDispatch, updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, formData, onUpdateEntity]);

  // Handle edge dropdown change (save immediately)
  const handleEdgeDropdownChange = useCallback((fieldName: string, value: string) => {
    if (!selectedEdge || !edgeEntity) return;

    const entityTypeForDispatch: EntityType = selectedEdge.relationship_type === 'STATE_TRANSITION'
      ? 'state_transitions'
      : 'activity_flows';

    // Update local state
    setFormData(prev => ({ ...prev, [fieldName]: value || undefined }));

    // Build updated entity
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      [fieldName]: value || undefined,
    };

    onUpdateEntity(entityTypeForDispatch, updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Handle trigger mode change for StateTransition
  const handleStateTransitionTriggerModeChange = useCallback((mode: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Update local state first - clear all trigger fields
    const updates: Record<string, unknown> = {
      trigger_ref_kind: undefined,
      trigger_ref_id: undefined,
      trigger_label_text: undefined,
    };

    // Set the appropriate field based on mode
    if (mode === 'Event') {
      updates.trigger_ref_kind = 'Event';
    } else if (mode === 'Method') {
      updates.trigger_ref_kind = 'Method';
    }
    // For 'Text' mode, we leave trigger_label_text to be filled by user

    setFormData(prev => ({ ...prev, ...updates }));

    // Save to meta-model
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      ...updates,
    };

    onUpdateEntity('state_transitions', updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Handle trigger mode change for ActivityFlow
  const handleActivityFlowTriggerModeChange = useCallback((mode: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Update local state first - clear all trigger fields
    const updates: Record<string, unknown> = {
      trigger_ref_kind: undefined,
      trigger_ref_id: undefined,
      trigger_label_text: undefined,
    };

    // Set the appropriate field based on mode
    if (mode === 'Event') {
      updates.trigger_ref_kind = 'Event';
    } else if (mode === 'Method') {
      updates.trigger_ref_kind = 'Method';
    }
    // For 'Text' mode, we leave trigger_label_text to be filled by user
    // For 'None' mode, all fields stay undefined

    setFormData(prev => ({ ...prev, ...updates }));

    // Save to meta-model
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      ...updates,
    };

    onUpdateEntity('activity_flows', updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Handle guard mode change
  const handleGuardModeChange = useCallback((mode: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Update local state first - clear all guard fields
    const updates: Record<string, unknown> = {
      guard_ref_kind: undefined,
      guard_ref_id: undefined,
      guard_expression: undefined,
    };

    // Set the appropriate field based on mode
    if (mode === 'Method') {
      updates.guard_ref_kind = 'Method';
    }
    // For 'Expression' mode, we leave guard_expression to be filled by user
    // For 'None' mode, all fields stay undefined

    setFormData(prev => ({ ...prev, ...updates }));

    // Save to meta-model
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      ...updates,
    };

    onUpdateEntity('state_transitions', updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Handle effect mode change
  const handleEffectModeChange = useCallback((mode: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Update local state first - clear all effect fields
    const updates: Record<string, unknown> = {
      effect_ref_kind: undefined,
      effect_ref_id: undefined,
      effect_label_text: undefined,
    };

    // Set the appropriate field based on mode
    if (mode === 'Method') {
      updates.effect_ref_kind = 'Method';
    }
    // For 'Text' mode, we leave effect_label_text to be filled by user
    // For 'None' mode, all fields stay undefined

    setFormData(prev => ({ ...prev, ...updates }));

    // Save to meta-model
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      ...updates,
    };

    onUpdateEntity('state_transitions', updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Handle condition mode change for ActivityFlow
  const handleConditionModeChange = useCallback((mode: string) => {
    if (!selectedEdge || !edgeEntity) return;

    // Update local state first - clear all condition fields
    const updates: Record<string, unknown> = {
      condition_ref_kind: undefined,
      condition_ref_id: undefined,
      condition_expression: undefined,
    };

    // Set the appropriate field based on mode
    if (mode === 'Method') {
      updates.condition_ref_kind = 'Method';
    }
    // For 'Expression' mode, we leave condition_expression to be filled by user
    // For 'None' mode, all fields stay undefined

    setFormData(prev => ({ ...prev, ...updates }));

    // Save to meta-model
    const updatedEntity = {
      ...(edgeEntity as unknown as Record<string, unknown>),
      ...updates,
    };

    onUpdateEntity('activity_flows', updatedEntity as unknown as AnyEntity);
  }, [selectedEdge, edgeEntity, onUpdateEntity]);

  // Don't render if neither node nor edge inspector should be shown
  if (!shouldShowNodeInspector && !shouldShowEdgeInspector) {
    return null;
  }

  // Get entity label for header
  const getEntityLabel = (entityType: string): string => {
    switch (entityType) {
      case ENTITY_TYPES.STATE:
        return 'State';
      case ENTITY_TYPES.ACTIVITY:
        return 'Activity';
      case ENTITY_TYPES.ACTIVITY_PARTITION:
        return 'Activity Partition';
      case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
        return 'Logical Data Entity';
      case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
        return 'Physical Data Entity';
      default:
        // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 infra entity labels
        return INFRASTRUCTURE_ENTITY_TYPE_TO_LABEL[entityType] || 'Entity';
    }
  };

  // Get edge label for header
  const getEdgeLabel = (relationshipType: string): string => {
    switch (relationshipType) {
      case 'STATE_TRANSITION':
        return 'State Transition';
      case 'ACTIVITY_FLOW':
        return 'Activity Flow';
      default:
        // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 infra relationship labels
        return INFRASTRUCTURE_RELATIONSHIP_TYPE_TO_LABEL[relationshipType] || 'Edge';
    }
  };

  // ============================================================================
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - minimal entity arms
  // 12 entity types share an identical name + description form (LOGICAL_DATA_ENTITY pattern).
  // ============================================================================
  const renderInfrastructureEntityFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Name<span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.name || '')}
            onChange={(e) => handleTextChange('name', e.target.value)}
            onBlur={() => handleTextBlur('name')}
            data-testid="inspector-field-name"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // ============================================================================
  // Spec 2026-05-05: Infrastructure Domain Diagram Support - minimal relationship-edge arms
  // 3 relationship types share an identical description + tags form. Edits flow through
  // handleEdgeTextBlur extended below to dispatch to the matching relationship collection.
  // ============================================================================
  const renderInfrastructureRelationshipFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleEdgeTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Tags</label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.tags || '')}
            onChange={(e) => handleTextChange('tags', e.target.value)}
            onBlur={() => handleEdgeTextBlur('tags')}
            placeholder="Comma-separated tags"
            data-testid="inspector-field-tags"
          />
        </div>
      </>
    );
  };

  // Render State entity fields
  const renderStateFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Name<span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.name || '')}
            onChange={(e) => handleTextChange('name', e.target.value)}
            onBlur={() => handleTextBlur('name')}
            data-testid="inspector-field-name"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>State Kind</label>
          <select
            className={styles.select}
            value={String(formData.state_kind || 'Normal')}
            onChange={(e) => handleDropdownChange('state_kind', e.target.value)}
            data-testid="inspector-field-state_kind"
          >
            {STATE_KIND_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // Render Activity entity fields
  const renderActivityFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Name<span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.name || '')}
            onChange={(e) => handleTextChange('name', e.target.value)}
            onBlur={() => handleTextBlur('name')}
            data-testid="inspector-field-name"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Activity Kind</label>
          <select
            className={styles.select}
            value={String(formData.activity_kind || 'Action')}
            onChange={(e) => handleDropdownChange('activity_kind', e.target.value)}
            data-testid="inspector-field-activity_kind"
          >
            {ACTIVITY_KIND_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // Render ActivityPartition entity fields
  const renderActivityPartitionFields = () => {
    const hasRefKind = formData.ref_kind && String(formData.ref_kind).trim() !== '';

    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Reference Kind</label>
          <select
            className={styles.select}
            value={String(formData.ref_kind || '')}
            onChange={(e) => handleDropdownChange('ref_kind', e.target.value)}
            data-testid="inspector-field-ref_kind"
          >
            {ACTIVITY_PARTITION_REF_KIND_OPTIONS.map(option => (
              <option key={option} value={option}>{option || '-- None --'}</option>
            ))}
          </select>
        </div>
        {hasRefKind && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Reference<span className={styles.required}>*</span>
            </label>
            <select
              className={styles.select}
              value={String(formData.ref_id || '')}
              onChange={(e) => handleDropdownChange('ref_id', e.target.value)}
              data-testid="inspector-field-ref_id"
            >
              <option value="">-- Select --</option>
              {referenceOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}
        {!hasRefKind && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>
              Name<span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.name || '')}
              onChange={(e) => handleTextChange('name', e.target.value)}
              onBlur={() => handleTextBlur('name')}
              placeholder="Required if no reference"
              data-testid="inspector-field-name"
            />
          </div>
        )}
        {hasRefKind && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Name Override</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.name || '')}
              onChange={(e) => handleTextChange('name', e.target.value)}
              onBlur={() => handleTextBlur('name')}
              placeholder="Optional custom name"
              data-testid="inspector-field-name"
            />
          </div>
        )}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // Render LogicalDataEntity fields
  const renderLogicalDataEntityFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Name<span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.name || '')}
            onChange={(e) => handleTextChange('name', e.target.value)}
            onBlur={() => handleTextBlur('name')}
            data-testid="inspector-field-name"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // Render PhysicalDataEntity fields
  const renderPhysicalDataEntityFields = () => {
    return (
      <>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>
            Name<span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            className={styles.input}
            value={String(formData.name || '')}
            onChange={(e) => handleTextChange('name', e.target.value)}
            onBlur={() => handleTextBlur('name')}
            data-testid="inspector-field-name"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // ============================================================================
  // Task Group 5: Render StateTransition edge fields
  // ============================================================================
  const renderStateTransitionFields = () => {
    if (!edgeEntity) return null;

    const transition = edgeEntity as StateTransition;
    const triggerMode = getStateTransitionTriggerMode(transition);
    const guardMode = getGuardMode(transition);
    const effectMode = getEffectMode(transition);

    return (
      <>
        {/* Read-only fromState/toState display */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>From State</label>
          <div className={styles.readOnlyValue} data-testid="inspector-field-from_state">
            {getStateName(metaModel, transition.from_state_id)}
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>To State</label>
          <div className={styles.readOnlyValue} data-testid="inspector-field-to_state">
            {getStateName(metaModel, transition.to_state_id)}
          </div>
        </div>

        {/* Trigger fields */}
        <ModeSelector
          label="Trigger Mode"
          modes={STATE_TRANSITION_TRIGGER_MODES}
          currentMode={triggerMode}
          onModeChange={handleStateTransitionTriggerModeChange}
          testIdPrefix="trigger-mode"
        />

        {triggerMode === 'Event' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Event</label>
            <select
              className={styles.select}
              value={String(formData.trigger_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('trigger_ref_id', e.target.value)}
              data-testid="inspector-field-trigger_ref_id"
            >
              <option value="">-- Select Event --</option>
              {eventOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {triggerMode === 'Method' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Method</label>
            <select
              className={styles.select}
              value={String(formData.trigger_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('trigger_ref_id', e.target.value)}
              data-testid="inspector-field-trigger_ref_id"
            >
              <option value="">-- Select Method --</option>
              {methodOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {triggerMode === 'Text' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Trigger Text</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.trigger_label_text || '')}
              onChange={(e) => handleTextChange('trigger_label_text', e.target.value)}
              onBlur={() => handleEdgeTextBlur('trigger_label_text')}
              placeholder="Enter trigger description"
              data-testid="inspector-field-trigger_label_text"
            />
          </div>
        )}

        {/* Guard fields */}
        <ModeSelector
          label="Guard Mode"
          modes={GUARD_MODES}
          currentMode={guardMode}
          onModeChange={handleGuardModeChange}
          testIdPrefix="guard-mode"
        />

        {guardMode === 'Method' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Guard Method</label>
            <select
              className={styles.select}
              value={String(formData.guard_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('guard_ref_id', e.target.value)}
              data-testid="inspector-field-guard_ref_id"
            >
              <option value="">-- Select Method --</option>
              {methodOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {guardMode === 'Expression' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Guard Expression</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.guard_expression || '')}
              onChange={(e) => handleTextChange('guard_expression', e.target.value)}
              onBlur={() => handleEdgeTextBlur('guard_expression')}
              placeholder="e.g., order.total > 100"
              data-testid="inspector-field-guard_expression"
            />
          </div>
        )}

        {/* Effect fields */}
        <ModeSelector
          label="Effect Mode"
          modes={EFFECT_MODES}
          currentMode={effectMode}
          onModeChange={handleEffectModeChange}
          testIdPrefix="effect-mode"
        />

        {effectMode === 'Method' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Effect Method</label>
            <select
              className={styles.select}
              value={String(formData.effect_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('effect_ref_id', e.target.value)}
              data-testid="inspector-field-effect_ref_id"
            >
              <option value="">-- Select Method --</option>
              {methodOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {effectMode === 'Text' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Effect Text</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.effect_label_text || '')}
              onChange={(e) => handleTextChange('effect_label_text', e.target.value)}
              onBlur={() => handleEdgeTextBlur('effect_label_text')}
              placeholder="Enter effect description"
              data-testid="inspector-field-effect_label_text"
            />
          </div>
        )}

        {/* Description field */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleEdgeTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // ============================================================================
  // Task Group 5: Render ActivityFlow edge fields
  // ============================================================================
  const renderActivityFlowFields = () => {
    if (!edgeEntity) return null;

    const flow = edgeEntity as ActivityFlow;
    const triggerMode = getActivityFlowTriggerMode(flow);
    const conditionMode = getConditionMode(flow);

    return (
      <>
        {/* Read-only fromActivity/toActivity display */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>From Activity</label>
          <div className={styles.readOnlyValue} data-testid="inspector-field-from_activity">
            {getActivityName(metaModel, flow.from_activity_id)}
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>To Activity</label>
          <div className={styles.readOnlyValue} data-testid="inspector-field-to_activity">
            {getActivityName(metaModel, flow.to_activity_id)}
          </div>
        </div>

        {/* Flow Kind dropdown */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Flow Kind</label>
          <select
            className={styles.select}
            value={String(formData.flow_kind || 'Control')}
            onChange={(e) => handleEdgeDropdownChange('flow_kind', e.target.value)}
            data-testid="inspector-field-flow_kind"
          >
            {FLOW_KIND_OPTIONS.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        {/* Trigger fields */}
        <ModeSelector
          label="Trigger Mode"
          modes={ACTIVITY_FLOW_TRIGGER_MODES}
          currentMode={triggerMode}
          onModeChange={handleActivityFlowTriggerModeChange}
          testIdPrefix="trigger-mode"
        />

        {triggerMode === 'Event' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Event</label>
            <select
              className={styles.select}
              value={String(formData.trigger_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('trigger_ref_id', e.target.value)}
              data-testid="inspector-field-trigger_ref_id"
            >
              <option value="">-- Select Event --</option>
              {eventOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {triggerMode === 'Method' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Method</label>
            <select
              className={styles.select}
              value={String(formData.trigger_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('trigger_ref_id', e.target.value)}
              data-testid="inspector-field-trigger_ref_id"
            >
              <option value="">-- Select Method --</option>
              {methodOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {triggerMode === 'Text' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Trigger Text</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.trigger_label_text || '')}
              onChange={(e) => handleTextChange('trigger_label_text', e.target.value)}
              onBlur={() => handleEdgeTextBlur('trigger_label_text')}
              placeholder="Enter trigger description"
              data-testid="inspector-field-trigger_label_text"
            />
          </div>
        )}

        {/* Condition fields */}
        <ModeSelector
          label="Condition Mode"
          modes={CONDITION_MODES}
          currentMode={conditionMode}
          onModeChange={handleConditionModeChange}
          testIdPrefix="condition-mode"
        />

        {conditionMode === 'Method' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Condition Method</label>
            <select
              className={styles.select}
              value={String(formData.condition_ref_id || '')}
              onChange={(e) => handleEdgeDropdownChange('condition_ref_id', e.target.value)}
              data-testid="inspector-field-condition_ref_id"
            >
              <option value="">-- Select Method --</option>
              {methodOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </div>
        )}

        {conditionMode === 'Expression' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Condition Expression</label>
            <input
              type="text"
              className={styles.input}
              value={String(formData.condition_expression || '')}
              onChange={(e) => handleTextChange('condition_expression', e.target.value)}
              onBlur={() => handleEdgeTextBlur('condition_expression')}
              placeholder="e.g., isValid()"
              data-testid="inspector-field-condition_expression"
            />
          </div>
        )}

        {/* Description field */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Description</label>
          <textarea
            className={styles.textarea}
            value={String(formData.description || '')}
            onChange={(e) => handleTextChange('description', e.target.value)}
            onBlur={() => handleEdgeTextBlur('description')}
            data-testid="inspector-field-description"
          />
        </div>
      </>
    );
  };

  // Render fields based on entity type (for nodes)
  const renderNodeFields = () => {
    if (!selectedNode) return null;

    switch (selectedNode.entity_type) {
      case ENTITY_TYPES.STATE:
        return renderStateFields();
      case ENTITY_TYPES.ACTIVITY:
        return renderActivityFields();
      case ENTITY_TYPES.ACTIVITY_PARTITION:
        return renderActivityPartitionFields();
      case ENTITY_TYPES.LOGICAL_DATA_ENTITY:
        return renderLogicalDataEntityFields();
      case ENTITY_TYPES.PHYSICAL_DATA_ENTITY:
        return renderPhysicalDataEntityFields();
      default:
        // Spec 2026-05-05: Infrastructure Domain Diagram Support - 12 infra entity arms
        // share a single name + description form (LOGICAL_DATA_ENTITY pattern).
        if (INFRASTRUCTURE_ENTITY_TYPE_TO_COLLECTION[selectedNode.entity_type]) {
          return renderInfrastructureEntityFields();
        }
        return null;
    }
  };

  // Render fields based on relationship type (for edges)
  const renderEdgeFields = () => {
    if (!selectedEdge) return null;

    switch (selectedEdge.relationship_type) {
      case 'STATE_TRANSITION':
        return renderStateTransitionFields();
      case 'ACTIVITY_FLOW':
        return renderActivityFlowFields();
      // Spec 2026-05-05: Infrastructure Domain Diagram Support - 3 infra relationship-edge arms
      // share a single description + tags form. Even resource_subnet_hostings (containment-only)
      // surfaces in this branch defensively if the engine ever routes selection here.
      case 'resource_subnet_hostings':
      case 'deployment_unit_compute_resources':
      case 'load_balancer_resource_routes':
      // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 cross-domain relationship-edge arms
      // share the same minimal description + tags form (V1 minimum per Q10). Full attribute editing
      // remains via the relationship grid tabs.
      case 'application_compute_deployments':
      case 'data_entity_data_store_hostings':
      case 'application_infrastructure_resource_uses':
      case 'application_load_balancer_exposures':
        return renderInfrastructureRelationshipFields();
      default:
        return null;
    }
  };

  // Render node inspector
  if (shouldShowNodeInspector && selectedNode && nodeEntity) {
    return (
      <div className={styles.container} data-testid="selection-inspector">
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            {getEntityLabel(selectedNode.entity_type)}
          </span>
        </div>
        <div className={styles.content}>
          {renderNodeFields()}
        </div>
      </div>
    );
  }

  // Render edge inspector
  if (shouldShowEdgeInspector && selectedEdge && edgeEntity) {
    return (
      <div className={styles.container} data-testid="edge-inspector">
        <div className={styles.header}>
          <span className={styles.headerTitle}>
            {getEdgeLabel(selectedEdge.relationship_type)}
          </span>
        </div>
        <div className={styles.content}>
          {renderEdgeFields()}
        </div>
      </div>
    );
  }

  return null;
}
