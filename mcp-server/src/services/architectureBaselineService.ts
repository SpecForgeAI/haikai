/**
 * Architecture Baseline Service
 *
 * Core business logic for the save_architecture_baseline MCP tool.
 * Handles validation, ID generation, ref resolution, entity building,
 * relationship building, and merge with existing model data.
 *
 * All functions are exported as named exports for testability.
 */

import { generateId } from '../utils/generateId';
import { ensureAbbreviations } from '../utils/abbreviationUtils';
import {
  ArchitectureBaselineInput,
  DataEntityRelationshipInput,
  EntityDeleteInput,
  RelationshipDeleteInput,
  SaveArchitectureBaselineResponse,
  ValidationError,
} from '../types/saveArchitectureBaseline';
import { archModelClient } from './archModelClient';
import { createHttpError } from '../middleware/errorHandler';

// ============================================================================
// Type Definitions for Internal Use
// ============================================================================

/**
 * Maps entity type to a map of entity name -> generated ID.
 * Example: { services: { "OrderService": "svc-abc123-def45" } }
 *
 * For attributes, composite keys are used: {parentEntityName}::{attributeName}
 */
export interface IdMaps {
  services: Record<string, string>;
  interfaces: Record<string, string>;
  interfaceEndpoints: Record<string, string>;
  logicalDataEntities: Record<string, string>;
  physicalDataEntities: Record<string, string>;
  logicalDataAttributes: Record<string, string>;
  physicalDataAttributes: Record<string, string>;
  businessLogic: Record<string, string>;
  dataMovements: Record<string, string>;
  application: { id: string; name: string };
  appComponent: { id: string; name: string };
}

/**
 * Resolved references for all ref fields in the input payload.
 * Maps from input array index or key to the resolved ID.
 */
export interface ResolvedRefs {
  /** interfaces[i].serviceRef -> resolved service ID */
  interfaceServiceIds: Record<number, string>;
  /** interfaceEndpoints[i].interfaceRef -> resolved interface ID */
  endpointInterfaceIds: Record<number, string>;
  /** interfaceEndpoints[i].requestDataEntityRef -> resolved data_entity_point ID */
  endpointRequestDepIds: Record<number, string>;
  /** interfaceEndpoints[i].responseDataEntityRef -> resolved data_entity_point ID */
  endpointResponseDepIds: Record<number, string>;
  /** physicalDataEntities[i].logicalDataEntityRef -> resolved logical data entity ID */
  physicalLogicalEntityIds: Record<number, string>;
  /** businessLogic[i].ownerServiceRef -> resolved service ID */
  businessLogicOwnerServiceIds: Record<number, string>;
  /** dataMovements[i].sourceServiceRef -> resolved service ID */
  dataMovementSourceServiceIds: Record<number, string>;
  /** dataMovements[i].targetServiceRef -> resolved service ID */
  dataMovementTargetServiceIds: Record<number, string>;
  /** dataMovements[i].dataEntityRef -> resolved data_entity_point ID */
  dataMovementDataEntityPointIds: Record<number, string>;
  /** dataMovements[i].interfaceWithSchemaRef -> resolved interface ID */
  dataMovementInterfaceWithSchemaIds: Record<number, string>;
  /** logicalDataAttributes[i].logicalEntityRef -> resolved logical data entity ID */
  logicalAttributeEntityIds: Record<number, string>;
  /** physicalDataAttributes[i].physicalEntityRef -> resolved physical data entity ID */
  physicalAttributeEntityIds: Record<number, string>;
  /** Validation errors encountered during resolution */
  errors: ValidationError[];
}

/**
 * Result of buildEntities containing all entity arrays ready for merge.
 */
export interface BuiltEntities {
  applications: any[];
  app_components: any[];
  services: any[];
  interfaces: any[];
  endpoints: any[];
  logical_data_entities: any[];
  physical_data_entities: any[];
  logical_data_attributes: any[];
  physical_data_attributes: any[];
  business_logics: any[];
  application_points: any[];
  data_entity_points: any[];
}

/**
 * Result of buildRelationships containing all relationship arrays ready for merge.
 */
export interface BuiltRelationships {
  data_movements: any[];
  interface_logical_entities: any[];
  logical_data_entity_physical_data_entities: any[];
  application_point_business_logics: any[];
}

/**
 * Resolved data entity relationship ref pair.
 */
export interface ResolvedDataEntityRelationship {
  fromDepId: string;
  toDepId: string;
  input: DataEntityRelationshipInput;
}

/**
 * Result of applyDeletions.
 */
export interface DeletionResult {
  deletedEntities: number;
  deletedRelationships: number;
  warnings: string[];
}

/**
 * Result of mergeWithExisting, including the merged model and deletion counts.
 */
export interface MergeResult {
  model: any;
  deletedEntities: number;
  deletedRelationships: number;
}

// ============================================================================
// parseAndValidate
// ============================================================================

/**
 * Parses the architectureBaselineJson string and validates the payload.
 * Collects all validation errors before returning.
 *
 * @param architectureBaselineJson - The raw JSON string from the request
 * @returns Object with parsed input and any validation errors
 */
export function parseAndValidate(architectureBaselineJson: string): {
  input: ArchitectureBaselineInput;
  errors: ValidationError[];
} {
  // Step 1: Parse JSON
  let parsed: any;
  try {
    parsed = JSON.parse(architectureBaselineJson);
  } catch (e: any) {
    return {
      input: {} as ArchitectureBaselineInput,
      errors: [
        {
          field: 'architectureBaselineJson',
          entityType: 'root',
          entityName: '',
          message: `Invalid JSON: ${e.message}`,
        },
      ],
    };
  }

  const input: ArchitectureBaselineInput = {
    services: parsed.services || [],
    interfaces: parsed.interfaces || [],
    interfaceEndpoints: parsed.interfaceEndpoints || [],
    logicalDataEntities: parsed.logicalDataEntities || [],
    physicalDataEntities: parsed.physicalDataEntities || [],
    logicalDataAttributes: parsed.logicalDataAttributes || [],
    physicalDataAttributes: parsed.physicalDataAttributes || [],
    businessLogic: parsed.businessLogic || [],
    dataMovements: parsed.dataMovements || [],
    dataEntityRelationships: parsed.dataEntityRelationships || [],
    entitiesToDelete: parsed.entitiesToDelete || [],
    relationshipsToDelete: parsed.relationshipsToDelete || [],
  };

  const errors: ValidationError[] = [];

  // Step 2: Validate non-empty names for all entity types
  const entityArrays: Array<{ key: string; items: Array<{ name?: string }> }> = [
    { key: 'services', items: input.services || [] },
    { key: 'interfaces', items: input.interfaces || [] },
    { key: 'interfaceEndpoints', items: input.interfaceEndpoints || [] },
    { key: 'logicalDataEntities', items: input.logicalDataEntities || [] },
    { key: 'physicalDataEntities', items: input.physicalDataEntities || [] },
    { key: 'logicalDataAttributes', items: input.logicalDataAttributes || [] },
    { key: 'physicalDataAttributes', items: input.physicalDataAttributes || [] },
    { key: 'businessLogic', items: input.businessLogic || [] },
  ];

  for (const { key, items } of entityArrays) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
        errors.push({
          field: 'name',
          entityType: key,
          entityName: item.name || '',
          message: `Empty or missing name at ${key}[${i}]`,
        });
      }
    }
  }

  // Step 3: Validate no duplicate names within each entity type
  // For attributes, uniqueness is per parent entity (composite key: parentRef::name)
  const attributeKeys = new Set(['logicalDataAttributes', 'physicalDataAttributes']);
  for (const { key, items } of entityArrays) {
    const nameSet = new Map<string, number>();
    const isAttribute = attributeKeys.has(key);
    for (let i = 0; i < items.length; i++) {
      const name = items[i].name;
      if (name && typeof name === 'string' && name.trim() !== '') {
        let uniqueKey = name;
        if (isAttribute) {
          const parentRef = (items[i] as any).logicalEntityRef || (items[i] as any).physicalEntityRef || '';
          uniqueKey = `${parentRef}::${name}`;
        }
        if (nameSet.has(uniqueKey)) {
          errors.push({
            field: 'name',
            entityType: key,
            entityName: name,
            message: `Duplicate name "${name}" in ${key} (first at index ${nameSet.get(uniqueKey)}, duplicate at index ${i})`,
          });
        } else {
          nameSet.set(uniqueKey, i);
        }
      }
    }
  }

  // Step 4: Build name sets for ref validation
  const serviceNames = new Set((input.services || []).map((s) => s.name).filter(Boolean));
  const interfaceNames = new Set((input.interfaces || []).map((i) => i.name).filter(Boolean));
  const logicalDataEntityNames = new Set(
    (input.logicalDataEntities || []).map((e) => e.name).filter(Boolean)
  );
  const physicalDataEntityNames = new Set(
    (input.physicalDataEntities || []).map((e) => e.name).filter(Boolean)
  );
  const allDataEntityNames = new Set([...logicalDataEntityNames, ...physicalDataEntityNames]);

  // Step 5: Validate ref fields

  // interfaces[].serviceRef
  for (let i = 0; i < (input.interfaces || []).length; i++) {
    const iface = input.interfaces![i];
    if (iface.serviceRef && !serviceNames.has(iface.serviceRef)) {
      errors.push({
        field: 'serviceRef',
        entityType: 'interfaces',
        entityName: iface.name || '',
        message: `Unresolvable serviceRef "${iface.serviceRef}" on interface "${iface.name}"`,
      });
    }
  }

  // interfaceEndpoints[].interfaceRef
  for (let i = 0; i < (input.interfaceEndpoints || []).length; i++) {
    const ep = input.interfaceEndpoints![i];
    if (ep.interfaceRef && !interfaceNames.has(ep.interfaceRef)) {
      errors.push({
        field: 'interfaceRef',
        entityType: 'interfaceEndpoints',
        entityName: ep.name || '',
        message: `Unresolvable interfaceRef "${ep.interfaceRef}" on endpoint "${ep.name}"`,
      });
    }
    if (ep.requestDataEntityRef && !allDataEntityNames.has(ep.requestDataEntityRef)) {
      errors.push({
        field: 'requestDataEntityRef',
        entityType: 'interfaceEndpoints',
        entityName: ep.name || '',
        message: `Unresolvable requestDataEntityRef "${ep.requestDataEntityRef}" on endpoint "${ep.name}"`,
      });
    }
    if (ep.responseDataEntityRef && !allDataEntityNames.has(ep.responseDataEntityRef)) {
      errors.push({
        field: 'responseDataEntityRef',
        entityType: 'interfaceEndpoints',
        entityName: ep.name || '',
        message: `Unresolvable responseDataEntityRef "${ep.responseDataEntityRef}" on endpoint "${ep.name}"`,
      });
    }
  }

  // physicalDataEntities[].logicalDataEntityRef
  for (let i = 0; i < (input.physicalDataEntities || []).length; i++) {
    const pde = input.physicalDataEntities![i];
    if (pde.logicalDataEntityRef && !logicalDataEntityNames.has(pde.logicalDataEntityRef)) {
      errors.push({
        field: 'logicalDataEntityRef',
        entityType: 'physicalDataEntities',
        entityName: pde.name || '',
        message: `Unresolvable logicalDataEntityRef "${pde.logicalDataEntityRef}" on physical entity "${pde.name}"`,
      });
    }
  }

  // Note: logicalDataAttributes[].logicalEntityRef and physicalDataAttributes[].physicalEntityRef
  // are NOT validated at parse time because they may reference existing model entities that are
  // not in the input payload. They are resolved during resolveRefs with fallback to existing model.

  // businessLogic[].ownerServiceRef
  for (let i = 0; i < (input.businessLogic || []).length; i++) {
    const bl = input.businessLogic![i];
    if (bl.ownerServiceRef && !serviceNames.has(bl.ownerServiceRef)) {
      errors.push({
        field: 'ownerServiceRef',
        entityType: 'businessLogic',
        entityName: bl.name || '',
        message: `Unresolvable ownerServiceRef "${bl.ownerServiceRef}" on business logic "${bl.name}"`,
      });
    }
  }

  // dataMovements[].sourceServiceRef, targetServiceRef, dataEntityRef, interfaceWithSchemaRef
  for (let i = 0; i < (input.dataMovements || []).length; i++) {
    const dm = input.dataMovements![i];
    if (dm.sourceServiceRef && !serviceNames.has(dm.sourceServiceRef)) {
      errors.push({
        field: 'sourceServiceRef',
        entityType: 'dataMovements',
        entityName: `dataMovements[${i}]`,
        message: `Unresolvable sourceServiceRef "${dm.sourceServiceRef}" on dataMovement[${i}]`,
      });
    }
    if (dm.targetServiceRef && !serviceNames.has(dm.targetServiceRef)) {
      errors.push({
        field: 'targetServiceRef',
        entityType: 'dataMovements',
        entityName: `dataMovements[${i}]`,
        message: `Unresolvable targetServiceRef "${dm.targetServiceRef}" on dataMovement[${i}]`,
      });
    }
    if (dm.dataEntityRef && !allDataEntityNames.has(dm.dataEntityRef)) {
      errors.push({
        field: 'dataEntityRef',
        entityType: 'dataMovements',
        entityName: `dataMovements[${i}]`,
        message: `Unresolvable dataEntityRef "${dm.dataEntityRef}" on dataMovement[${i}]`,
      });
    }
    if (dm.interfaceWithSchemaRef && !interfaceNames.has(dm.interfaceWithSchemaRef)) {
      errors.push({
        field: 'interfaceWithSchemaRef',
        entityType: 'dataMovements',
        entityName: `dataMovements[${i}]`,
        message: `Unresolvable interfaceWithSchemaRef "${dm.interfaceWithSchemaRef}" on dataMovement[${i}]`,
      });
    }

    // XOR constraint: exactly one of dataEntityRef or interfaceWithSchemaRef
    const hasDataEntity = !!dm.dataEntityRef;
    const hasInterface = !!dm.interfaceWithSchemaRef;
    if (hasDataEntity === hasInterface) {
      errors.push({
        field: 'dataEntityRef/interfaceWithSchemaRef',
        entityType: 'dataMovements',
        entityName: `dataMovements[${i}]`,
        message: `dataMovement[${i}] must have exactly one of dataEntityRef or interfaceWithSchemaRef (XOR constraint)`,
      });
    }
  }

  // Step 6: Validate entitiesToDelete
  for (let i = 0; i < (input.entitiesToDelete || []).length; i++) {
    const del = input.entitiesToDelete![i];
    if (!del.name || typeof del.name !== 'string' || del.name.trim() === '') {
      errors.push({
        field: 'name',
        entityType: 'entitiesToDelete',
        entityName: '',
        message: `Empty or missing name at entitiesToDelete[${i}]`,
      });
    }
    if (!del.entityType || (del.entityType !== 'logical_data_entities' && del.entityType !== 'physical_data_entities')) {
      errors.push({
        field: 'entityType',
        entityType: 'entitiesToDelete',
        entityName: del.name || '',
        message: `Invalid entityType "${del.entityType}" at entitiesToDelete[${i}]; must be "logical_data_entities" or "physical_data_entities"`,
      });
    }
  }

  // Step 7: Validate relationshipsToDelete
  for (let i = 0; i < (input.relationshipsToDelete || []).length; i++) {
    const del = input.relationshipsToDelete![i];
    if (!del.id || typeof del.id !== 'string' || del.id.trim() === '') {
      errors.push({
        field: 'id',
        entityType: 'relationshipsToDelete',
        entityName: '',
        message: `Empty or missing id at relationshipsToDelete[${i}]`,
      });
    }
    if (!del.relationshipType || typeof del.relationshipType !== 'string' || del.relationshipType.trim() === '') {
      errors.push({
        field: 'relationshipType',
        entityType: 'relationshipsToDelete',
        entityName: '',
        message: `Empty or missing relationshipType at relationshipsToDelete[${i}]`,
      });
    }
  }

  // Step 8: Validate dataEntityRelationships
  for (let i = 0; i < (input.dataEntityRelationships || []).length; i++) {
    const rel = input.dataEntityRelationships![i];
    if (!rel.fromEntityRef || typeof rel.fromEntityRef !== 'string' || rel.fromEntityRef.trim() === '') {
      errors.push({
        field: 'fromEntityRef',
        entityType: 'dataEntityRelationships',
        entityName: '',
        message: `Empty or missing fromEntityRef at dataEntityRelationships[${i}]`,
      });
    }
    if (!rel.toEntityRef || typeof rel.toEntityRef !== 'string' || rel.toEntityRef.trim() === '') {
      errors.push({
        field: 'toEntityRef',
        entityType: 'dataEntityRelationships',
        entityName: '',
        message: `Empty or missing toEntityRef at dataEntityRelationships[${i}]`,
      });
    }
    const validTypes = ['logical', 'physical'];
    if (!validTypes.includes(rel.fromEntityType)) {
      errors.push({
        field: 'fromEntityType',
        entityType: 'dataEntityRelationships',
        entityName: '',
        message: `Invalid fromEntityType "${rel.fromEntityType}" at dataEntityRelationships[${i}]; must be "logical" or "physical"`,
      });
    }
    if (!validTypes.includes(rel.toEntityType)) {
      errors.push({
        field: 'toEntityType',
        entityType: 'dataEntityRelationships',
        entityName: '',
        message: `Invalid toEntityType "${rel.toEntityType}" at dataEntityRelationships[${i}]; must be "logical" or "physical"`,
      });
    }
    // Cross-type validation: fromEntityType must equal toEntityType
    if (rel.fromEntityType !== rel.toEntityType) {
      errors.push({
        field: 'fromEntityType/toEntityType',
        entityType: 'dataEntityRelationships',
        entityName: '',
        message: `Cross-type FK links not allowed at dataEntityRelationships[${i}]: fromEntityType="${rel.fromEntityType}" !== toEntityType="${rel.toEntityType}"`,
      });
    }
  }

  return { input, errors };
}

// ============================================================================
// generateIds
// ============================================================================

/**
 * Generates unique IDs for all entities in the input payload,
 * including placeholder Application and AppComponent.
 *
 * @param input - The validated ArchitectureBaselineInput
 * @returns IdMaps with name-to-ID mappings for each entity type
 */
export function generateIds(input: ArchitectureBaselineInput): IdMaps {
  const services: Record<string, string> = {};
  for (const svc of input.services || []) {
    services[svc.name] = generateId('svc-');
  }

  const interfaces: Record<string, string> = {};
  for (const ifc of input.interfaces || []) {
    interfaces[ifc.name] = generateId('ifc-');
  }

  const interfaceEndpoints: Record<string, string> = {};
  for (const ep of input.interfaceEndpoints || []) {
    interfaceEndpoints[ep.name] = generateId('ep-');
  }

  const logicalDataEntities: Record<string, string> = {};
  for (const lde of input.logicalDataEntities || []) {
    logicalDataEntities[lde.name] = generateId('lde-');
  }

  const physicalDataEntities: Record<string, string> = {};
  for (const pde of input.physicalDataEntities || []) {
    physicalDataEntities[pde.name] = generateId('pde-');
  }

  // Logical Data Attributes - composite key: {parentEntityName}::{attributeName}
  const logicalDataAttributes: Record<string, string> = {};
  for (const lda of input.logicalDataAttributes || []) {
    const compositeKey = `${lda.logicalEntityRef}::${lda.name}`;
    logicalDataAttributes[compositeKey] = generateId('lda-');
  }

  // Physical Data Attributes - composite key: {parentEntityName}::{attributeName}
  const physicalDataAttributes: Record<string, string> = {};
  for (const pda of input.physicalDataAttributes || []) {
    const compositeKey = `${pda.physicalEntityRef}::${pda.name}`;
    physicalDataAttributes[compositeKey] = generateId('pda-');
  }

  const businessLogic: Record<string, string> = {};
  for (const bl of input.businessLogic || []) {
    businessLogic[bl.name] = generateId('bl-');
  }

  const dataMovements: Record<string, string> = {};
  for (let i = 0; i < (input.dataMovements || []).length; i++) {
    const dm = input.dataMovements![i];
    const key = `dm_${i}_${dm.sourceServiceRef}_${dm.targetServiceRef}`;
    dataMovements[key] = generateId('dm-');
  }

  const application = {
    id: generateId('app-'),
    name: 'Core Application',
  };

  const appComponent = {
    id: generateId('comp-'),
    name: 'Core Component',
  };

  return {
    services,
    interfaces,
    interfaceEndpoints,
    logicalDataEntities,
    physicalDataEntities,
    logicalDataAttributes,
    physicalDataAttributes,
    businessLogic,
    dataMovements,
    application,
    appComponent,
  };
}

// ============================================================================
// resolveRefs
// ============================================================================

/**
 * Resolves all name-based *Ref fields in the input to their generated IDs.
 *
 * For requestDataEntityRef and responseDataEntityRef, resolves to
 * data_entity_point IDs (dep_log_ or dep_phy_ prefix).
 *
 * For attribute parent references (logicalEntityRef, physicalEntityRef),
 * resolves by looking up name in idMaps first (new entities), then falling
 * back to existing model entities.
 *
 * @param input - The validated ArchitectureBaselineInput
 * @param idMaps - The ID maps from generateIds
 * @param existingModel - The existing model data (optional, for attribute ref fallback)
 * @returns ResolvedRefs with all resolved IDs and any resolution errors
 */
export function resolveRefs(
  input: ArchitectureBaselineInput,
  idMaps: IdMaps,
  existingModel?: any | null
): ResolvedRefs {
  const resolved: ResolvedRefs = {
    interfaceServiceIds: {},
    endpointInterfaceIds: {},
    endpointRequestDepIds: {},
    endpointResponseDepIds: {},
    physicalLogicalEntityIds: {},
    businessLogicOwnerServiceIds: {},
    dataMovementSourceServiceIds: {},
    dataMovementTargetServiceIds: {},
    dataMovementDataEntityPointIds: {},
    dataMovementInterfaceWithSchemaIds: {},
    logicalAttributeEntityIds: {},
    physicalAttributeEntityIds: {},
    errors: [],
  };

  // Helper: resolve a data entity name to its data_entity_point ID
  const resolveDataEntityToPoint = (name: string): string | null => {
    if (idMaps.logicalDataEntities[name]) {
      return `dep_log_${idMaps.logicalDataEntities[name]}`;
    }
    if (idMaps.physicalDataEntities[name]) {
      return `dep_phy_${idMaps.physicalDataEntities[name]}`;
    }
    return null;
  };

  // Resolve interfaces[].serviceRef
  for (let i = 0; i < (input.interfaces || []).length; i++) {
    const iface = input.interfaces![i];
    if (iface.serviceRef && idMaps.services[iface.serviceRef]) {
      resolved.interfaceServiceIds[i] = idMaps.services[iface.serviceRef];
    }
  }

  // Resolve interfaceEndpoints[].interfaceRef
  for (let i = 0; i < (input.interfaceEndpoints || []).length; i++) {
    const ep = input.interfaceEndpoints![i];
    if (ep.interfaceRef && idMaps.interfaces[ep.interfaceRef]) {
      resolved.endpointInterfaceIds[i] = idMaps.interfaces[ep.interfaceRef];
    }

    // Resolve requestDataEntityRef -> data_entity_point ID
    if (ep.requestDataEntityRef) {
      const depId = resolveDataEntityToPoint(ep.requestDataEntityRef);
      if (depId) {
        resolved.endpointRequestDepIds[i] = depId;
      }
    }

    // Resolve responseDataEntityRef -> data_entity_point ID
    if (ep.responseDataEntityRef) {
      const depId = resolveDataEntityToPoint(ep.responseDataEntityRef);
      if (depId) {
        resolved.endpointResponseDepIds[i] = depId;
      }
    }
  }

  // Resolve physicalDataEntities[].logicalDataEntityRef
  for (let i = 0; i < (input.physicalDataEntities || []).length; i++) {
    const pde = input.physicalDataEntities![i];
    if (pde.logicalDataEntityRef && idMaps.logicalDataEntities[pde.logicalDataEntityRef]) {
      resolved.physicalLogicalEntityIds[i] = idMaps.logicalDataEntities[pde.logicalDataEntityRef];
    }
  }

  // Resolve logicalDataAttributes[].logicalEntityRef -> parent logical entity ID
  const existingLogicalEntities = existingModel?.metaModel?.entities?.logical_data_entities || [];
  for (let i = 0; i < (input.logicalDataAttributes || []).length; i++) {
    const lda = input.logicalDataAttributes![i];
    if (lda.logicalEntityRef) {
      // First check new entities in this input
      if (idMaps.logicalDataEntities[lda.logicalEntityRef]) {
        resolved.logicalAttributeEntityIds[i] = idMaps.logicalDataEntities[lda.logicalEntityRef];
      } else {
        // Fallback to existing model entities
        const existingEntity = existingLogicalEntities.find(
          (e: any) => e.name === lda.logicalEntityRef
        );
        if (existingEntity) {
          resolved.logicalAttributeEntityIds[i] = existingEntity.id;
        } else {
          resolved.errors.push({
            field: 'logicalEntityRef',
            entityType: 'logicalDataAttributes',
            entityName: lda.name,
            message: `Unresolvable logicalEntityRef "${lda.logicalEntityRef}" on logical attribute "${lda.name}"`,
          });
        }
      }
    }
  }

  // Resolve physicalDataAttributes[].physicalEntityRef -> parent physical entity ID
  const existingPhysicalEntities = existingModel?.metaModel?.entities?.physical_data_entities || [];
  for (let i = 0; i < (input.physicalDataAttributes || []).length; i++) {
    const pda = input.physicalDataAttributes![i];
    if (pda.physicalEntityRef) {
      // First check new entities in this input
      if (idMaps.physicalDataEntities[pda.physicalEntityRef]) {
        resolved.physicalAttributeEntityIds[i] = idMaps.physicalDataEntities[pda.physicalEntityRef];
      } else {
        // Fallback to existing model entities
        const existingEntity = existingPhysicalEntities.find(
          (e: any) => e.name === pda.physicalEntityRef
        );
        if (existingEntity) {
          resolved.physicalAttributeEntityIds[i] = existingEntity.id;
        } else {
          resolved.errors.push({
            field: 'physicalEntityRef',
            entityType: 'physicalDataAttributes',
            entityName: pda.name,
            message: `Unresolvable physicalEntityRef "${pda.physicalEntityRef}" on physical attribute "${pda.name}"`,
          });
        }
      }
    }
  }

  // Resolve businessLogic[].ownerServiceRef
  for (let i = 0; i < (input.businessLogic || []).length; i++) {
    const bl = input.businessLogic![i];
    if (bl.ownerServiceRef && idMaps.services[bl.ownerServiceRef]) {
      resolved.businessLogicOwnerServiceIds[i] = idMaps.services[bl.ownerServiceRef];
    }
  }

  // Resolve dataMovements refs
  for (let i = 0; i < (input.dataMovements || []).length; i++) {
    const dm = input.dataMovements![i];

    if (dm.sourceServiceRef && idMaps.services[dm.sourceServiceRef]) {
      resolved.dataMovementSourceServiceIds[i] = idMaps.services[dm.sourceServiceRef];
    }
    if (dm.targetServiceRef && idMaps.services[dm.targetServiceRef]) {
      resolved.dataMovementTargetServiceIds[i] = idMaps.services[dm.targetServiceRef];
    }
    if (dm.dataEntityRef) {
      const depId = resolveDataEntityToPoint(dm.dataEntityRef);
      if (depId) {
        resolved.dataMovementDataEntityPointIds[i] = depId;
      }
    }
    if (dm.interfaceWithSchemaRef && idMaps.interfaces[dm.interfaceWithSchemaRef]) {
      resolved.dataMovementInterfaceWithSchemaIds[i] = idMaps.interfaces[dm.interfaceWithSchemaRef];
    }
  }

  return resolved;
}

// ============================================================================
// resolveDataEntityRelationshipRefs
// ============================================================================

/**
 * Resolves entity name refs in dataEntityRelationships to data_entity_point IDs.
 * First checks idMaps (new entities in this input), then falls back to existing model.
 *
 * @param relationships - The data entity relationship inputs
 * @param idMaps - The ID maps from generateIds
 * @param existingModel - The existing model data (optional)
 * @returns Array of resolved pairs + errors
 */
export function resolveDataEntityRelationshipRefs(
  relationships: DataEntityRelationshipInput[],
  idMaps: IdMaps,
  existingModel?: any | null
): { resolved: ResolvedDataEntityRelationship[]; errors: ValidationError[] } {
  const result: ResolvedDataEntityRelationship[] = [];
  const errors: ValidationError[] = [];

  const existingLogicalEntities = existingModel?.metaModel?.entities?.logical_data_entities || [];
  const existingPhysicalEntities = existingModel?.metaModel?.entities?.physical_data_entities || [];

  // Helper: resolve entity name to data_entity_point ID
  const resolveToDepId = (entityRef: string, entityType: 'logical' | 'physical'): string | null => {
    if (entityType === 'logical') {
      // Check new entities first
      if (idMaps.logicalDataEntities[entityRef]) {
        return `dep_log_${idMaps.logicalDataEntities[entityRef]}`;
      }
      // Fallback to existing model
      const existing = existingLogicalEntities.find((e: any) => e.name === entityRef);
      if (existing) {
        return `dep_log_${existing.id}`;
      }
    } else {
      // Check new entities first
      if (idMaps.physicalDataEntities[entityRef]) {
        return `dep_phy_${idMaps.physicalDataEntities[entityRef]}`;
      }
      // Fallback to existing model
      const existing = existingPhysicalEntities.find((e: any) => e.name === entityRef);
      if (existing) {
        return `dep_phy_${existing.id}`;
      }
    }
    return null;
  };

  for (let i = 0; i < relationships.length; i++) {
    const rel = relationships[i];
    const fromDepId = resolveToDepId(rel.fromEntityRef, rel.fromEntityType);
    const toDepId = resolveToDepId(rel.toEntityRef, rel.toEntityType);

    if (!fromDepId) {
      errors.push({
        field: 'fromEntityRef',
        entityType: 'dataEntityRelationships',
        entityName: rel.fromEntityRef,
        message: `Unresolvable fromEntityRef "${rel.fromEntityRef}" (type: ${rel.fromEntityType}) at dataEntityRelationships[${i}]`,
      });
    }
    if (!toDepId) {
      errors.push({
        field: 'toEntityRef',
        entityType: 'dataEntityRelationships',
        entityName: rel.toEntityRef,
        message: `Unresolvable toEntityRef "${rel.toEntityRef}" (type: ${rel.toEntityType}) at dataEntityRelationships[${i}]`,
      });
    }

    if (fromDepId && toDepId) {
      result.push({ fromDepId, toDepId, input: rel });
    }
  }

  return { resolved: result, errors };
}

// ============================================================================
// buildDataEntityRelationships
// ============================================================================

/**
 * Builds logical_data_entity_relationship DTOs from resolved refs.
 *
 * @param resolvedRels - The resolved data entity relationship pairs
 * @returns Array of relationship DTOs ready for merge
 */
export function buildDataEntityRelationships(
  resolvedRels: ResolvedDataEntityRelationship[]
): any[] {
  return resolvedRels.map((rel) => ({
    id: generateId('lder-'),
    fromDataEntityPointId: rel.fromDepId,
    toDataEntityPointId: rel.toDepId,
    cardinality: rel.input.cardinality || '',
    relationship: rel.input.relationship || 'ASSOCIATION',
    description: rel.input.description || '',
    tags: rel.input.tags || '',
    valid_from: null,
    valid_to: null,
  }));
}

// ============================================================================
// buildEntities
// ============================================================================

/**
 * Constructs all entity DTOs matching the ArchitectureModelDto field shapes.
 * Creates placeholder Application and AppComponent, generates application_points
 * and data_entity_points.
 *
 * @param input - The validated ArchitectureBaselineInput
 * @param idMaps - The ID maps from generateIds
 * @param resolvedRefs - The resolved references from resolveRefs
 * @returns BuiltEntities containing all entity arrays ready for merge
 */
export function buildEntities(
  input: ArchitectureBaselineInput,
  idMaps: IdMaps,
  resolvedRefs: ResolvedRefs
): BuiltEntities {
  const appId = idMaps.application.id;
  const compId = idMaps.appComponent.id;

  // Placeholder Application
  const applications = [
    {
      id: appId,
      name: idMaps.application.name,
      description: '',
      app_type: '',
      status: '',
      tags: '',
      valid_from: null,
      valid_to: null,
      is_internal: null,
    },
  ];

  // Placeholder AppComponent
  const app_components = [
    {
      id: compId,
      name: idMaps.appComponent.name,
      description: '',
      application_id: appId,
      tags: '',
      valid_from: null,
      valid_to: null,
      is_internal: null,
      tech_type: null,
    },
  ];

  // Services
  const services = (input.services || []).map((svc) => ({
    id: idMaps.services[svc.name],
    name: svc.name,
    description: svc.description || '',
    application_id: appId,
    app_component_id: compId,
    service_type: svc.serviceType || '',
    core_tech: svc.coreTech || null,
    tags: svc.tags || '',
    valid_from: null,
    valid_to: null,
    package_set_id: null,
    is_internal: null,
  }));

  // Interfaces
  const interfaces = (input.interfaces || []).map((ifc, i) => ({
    id: idMaps.interfaces[ifc.name],
    name: ifc.name,
    description: ifc.description || '',
    service_id: resolvedRefs.interfaceServiceIds[i] || null,
    interface_type: ifc.interfaceType || '',
    spec_link: null,
    tags: ifc.tags || '',
    valid_from: null,
    valid_to: null,
  }));

  // Endpoints
  const endpoints = (input.interfaceEndpoints || []).map((ep, i) => ({
    id: idMaps.interfaceEndpoints[ep.name],
    name: ep.name,
    description: ep.description || '',
    interface_id: resolvedRefs.endpointInterfaceIds[i] || null,
    endpoint_type: ep.endpointType || null,
    path_or_address: ep.pathOrAddress || null,
    protocol: ep.protocol || null,
    operation_verb: ep.operationVerb || null,
    direction: ep.direction || null,
    valid_from: null,
    valid_to: null,
    request_data_entity_point_id: resolvedRefs.endpointRequestDepIds[i] || null,
    response_data_entity_point_id: resolvedRefs.endpointResponseDepIds[i] || null,
  }));

  // Logical Data Entities
  const logical_data_entities = (input.logicalDataEntities || []).map((lde) => ({
    id: idMaps.logicalDataEntities[lde.name],
    name: lde.name,
    description: lde.description || '',
    tags: lde.tags || '',
    valid_from: null,
    valid_to: null,
  }));

  // Physical Data Entities
  const physical_data_entities = (input.physicalDataEntities || []).map((pde) => ({
    id: idMaps.physicalDataEntities[pde.name],
    name: pde.name,
    description: pde.description || '',
    physical_type: pde.physicalType || '',
    database: pde.database || '',
    tags: pde.tags || '',
    valid_from: null,
    valid_to: null,
  }));

  // Logical Data Attributes
  const logical_data_attributes = (input.logicalDataAttributes || []).map((lda, i) => ({
    id: idMaps.logicalDataAttributes[`${lda.logicalEntityRef}::${lda.name}`],
    name: lda.name,
    description: lda.description || '',
    logical_entity_id: resolvedRefs.logicalAttributeEntityIds[i] || null,
    data_type: lda.dataType || '',
    is_primary_key: lda.isPrimaryKey != null ? lda.isPrimaryKey : null,
    is_nullable: lda.isNullable != null ? lda.isNullable : null,
    tags: lda.tags || '',
  }));

  // Physical Data Attributes
  const physical_data_attributes = (input.physicalDataAttributes || []).map((pda, i) => ({
    id: idMaps.physicalDataAttributes[`${pda.physicalEntityRef}::${pda.name}`],
    name: pda.name,
    description: pda.description || '',
    physical_entity_id: resolvedRefs.physicalAttributeEntityIds[i] || null,
    data_type: pda.dataType || '',
    is_primary_key: pda.isPrimaryKey != null ? pda.isPrimaryKey : null,
    is_nullable: pda.isNullable != null ? pda.isNullable : null,
    tags: pda.tags || '',
  }));

  // Business Logics
  const business_logics = (input.businessLogic || []).map((bl) => ({
    id: idMaps.businessLogic[bl.name],
    name: bl.name,
    type_text: bl.typeText || '',
    description_md: bl.descriptionMd || '',
    tags: bl.tags || '',
    valid_from: null,
    valid_to: null,
  }));

  // ---- Auto-generated Application Points ----
  const application_points: any[] = [];

  // Application point for the placeholder Application
  application_points.push({
    id: `ap_${appId}`,
    name: idMaps.application.name,
    description: '',
    kind: 'APPLICATION',
    application_id: appId,
    application_component_id: null,
    service_id: null,
    interface_id: null,
    target_type: null,
    target_ref_id: null,
    point_type: '',
    tags: '',
    valid_from: null,
    valid_to: null,
  });

  // Application point for the placeholder AppComponent
  application_points.push({
    id: `ap_${compId}`,
    name: idMaps.appComponent.name,
    description: '',
    kind: 'APP_COMPONENT',
    application_id: appId,
    application_component_id: compId,
    service_id: null,
    interface_id: null,
    target_type: null,
    target_ref_id: null,
    point_type: '',
    tags: '',
    valid_from: null,
    valid_to: null,
  });

  // Application points for each Service
  for (const svc of input.services || []) {
    const svcId = idMaps.services[svc.name];
    application_points.push({
      id: `ap_${svcId}`,
      name: svc.name,
      description: '',
      kind: 'SERVICE',
      application_id: appId,
      application_component_id: null,
      service_id: svcId,
      interface_id: null,
      target_type: null,
      target_ref_id: null,
      point_type: '',
      tags: '',
      valid_from: null,
      valid_to: null,
    });
  }

  // Application points for each Interface
  for (const ifc of input.interfaces || []) {
    const ifcId = idMaps.interfaces[ifc.name];
    application_points.push({
      id: `ap_${ifcId}`,
      name: ifc.name,
      description: '',
      kind: 'INTERFACE',
      application_id: appId,
      application_component_id: null,
      service_id: null,
      interface_id: ifcId,
      target_type: null,
      target_ref_id: null,
      point_type: '',
      tags: '',
      valid_from: null,
      valid_to: null,
    });
  }

  // ---- Auto-generated Data Entity Points ----
  const data_entity_points: any[] = [];

  // Logical entity points
  for (const lde of input.logicalDataEntities || []) {
    const ldeId = idMaps.logicalDataEntities[lde.name];
    data_entity_points.push({
      id: `dep_log_${ldeId}`,
      point_kind: 'LOGICAL_ENTITY',
      logical_entity_id: ldeId,
      physical_entity_id: null,
      description: null,
      tags: null,
      valid_from: null,
      valid_to: null,
    });
  }

  // Physical entity points
  for (const pde of input.physicalDataEntities || []) {
    const pdeId = idMaps.physicalDataEntities[pde.name];
    data_entity_points.push({
      id: `dep_phy_${pdeId}`,
      point_kind: 'PHYSICAL_ENTITY',
      logical_entity_id: null,
      physical_entity_id: pdeId,
      description: null,
      tags: null,
      valid_from: null,
      valid_to: null,
    });
  }

  return {
    applications,
    app_components,
    services,
    interfaces,
    endpoints,
    logical_data_entities,
    physical_data_entities,
    logical_data_attributes,
    physical_data_attributes,
    business_logics,
    application_points,
    data_entity_points,
  };
}

// ============================================================================
// buildRelationships
// ============================================================================

/**
 * Builds relationship arrays from the input payload.
 *
 * Generates:
 * - data_movements: from input dataMovements with resolved application_point IDs
 * - interface_logical_entities: from endpoint requestDataEntityRef/responseDataEntityRef
 * - logical_data_entity_physical_data_entities: from logicalDataEntityRef on physical entities
 * - application_point_business_logics: from ownerServiceRef on business logic items
 *
 * @param input - The validated ArchitectureBaselineInput
 * @param idMaps - The ID maps from generateIds
 * @param resolvedRefs - The resolved references from resolveRefs
 * @param applicationPoints - The generated application_points array from buildEntities
 * @returns BuiltRelationships containing all relationship arrays ready for merge
 */
export function buildRelationships(
  input: ArchitectureBaselineInput,
  idMaps: IdMaps,
  resolvedRefs: ResolvedRefs,
  _applicationPoints: any[]
): BuiltRelationships {
  // ---- data_movements ----
  const data_movements: any[] = [];
  const dmKeys = Object.keys(idMaps.dataMovements);
  for (let i = 0; i < (input.dataMovements || []).length; i++) {
    const dm = input.dataMovements![i];
    const dmId = idMaps.dataMovements[dmKeys[i]];

    // Resolve source and target to application_point IDs using ap_{svcId} pattern
    const sourceSvcId = resolvedRefs.dataMovementSourceServiceIds[i];
    const targetSvcId = resolvedRefs.dataMovementTargetServiceIds[i];
    const sourceApId = sourceSvcId ? `ap_${sourceSvcId}` : null;
    const targetApId = targetSvcId ? `ap_${targetSvcId}` : null;

    // Resolve dataEntityPointId or interfaceWithSchemaId (XOR)
    const dataEntityPointId = resolvedRefs.dataMovementDataEntityPointIds[i] || null;
    const interfaceWithSchemaId = resolvedRefs.dataMovementInterfaceWithSchemaIds[i] || null;

    data_movements.push({
      id: dmId,
      source_application_point_id: sourceApId,
      target_application_point_id: targetApId,
      dataEntityPointId: dataEntityPointId,
      interfaceWithSchemaId: interfaceWithSchemaId,
      biDirectional: dm.biDirectional != null ? dm.biDirectional : null,
      movement_type: dm.movementType || '',
      description: dm.description || '',
      tags: dm.tags || '',
      valid_from: null,
      valid_to: null,
    });
  }

  // ---- interface_logical_entities ----
  // For each endpoint with requestDataEntityRef or responseDataEntityRef,
  // create an ILE linking the endpoint's interface to the data entity point.
  // Deduplicate by (interface_id, dataEntityPointId) pair.
  const interface_logical_entities: any[] = [];
  const ileDedupeSet = new Set<string>();

  for (let i = 0; i < (input.interfaceEndpoints || []).length; i++) {
    const ep = input.interfaceEndpoints![i];
    const interfaceId = resolvedRefs.endpointInterfaceIds[i];
    if (!interfaceId) continue;

    // Process requestDataEntityRef
    const requestDepId = resolvedRefs.endpointRequestDepIds[i];
    if (requestDepId) {
      const dedupeKey = `${interfaceId}::${requestDepId}`;
      if (!ileDedupeSet.has(dedupeKey)) {
        ileDedupeSet.add(dedupeKey);
        interface_logical_entities.push({
          id: generateId('ile-'),
          interface_id: interfaceId,
          dataEntityPointId: requestDepId,
          description: '',
          tags: '',
          valid_from: null,
          valid_to: null,
        });
      }
    }

    // Process responseDataEntityRef
    const responseDepId = resolvedRefs.endpointResponseDepIds[i];
    if (responseDepId) {
      const dedupeKey = `${interfaceId}::${responseDepId}`;
      if (!ileDedupeSet.has(dedupeKey)) {
        ileDedupeSet.add(dedupeKey);
        interface_logical_entities.push({
          id: generateId('ile-'),
          interface_id: interfaceId,
          dataEntityPointId: responseDepId,
          description: '',
          tags: '',
          valid_from: null,
          valid_to: null,
        });
      }
    }
  }

  // ---- logical_data_entity_physical_data_entities ----
  // For each physical data entity with logicalDataEntityRef, create a mapping record.
  const logical_data_entity_physical_data_entities: any[] = [];
  for (let i = 0; i < (input.physicalDataEntities || []).length; i++) {
    const pde = input.physicalDataEntities![i];
    const logicalEntityId = resolvedRefs.physicalLogicalEntityIds[i];
    if (!logicalEntityId) continue;

    const physicalEntityId = idMaps.physicalDataEntities[pde.name];

    logical_data_entity_physical_data_entities.push({
      id: generateId('ldepe-'),
      logical_entity_id: logicalEntityId,
      physical_entity_id: physicalEntityId,
      description: '',
      tags: '',
      valid_from: null,
      valid_to: null,
    });
  }

  // ---- application_point_business_logics ----
  // For each business logic item with ownerServiceRef, link the service's
  // application_point (ap_{svcId}) to the business logic entity.
  const application_point_business_logics: any[] = [];
  for (let i = 0; i < (input.businessLogic || []).length; i++) {
    const bl = input.businessLogic![i];
    const ownerSvcId = resolvedRefs.businessLogicOwnerServiceIds[i];
    if (!ownerSvcId) continue;

    const businessLogicId = idMaps.businessLogic[bl.name];
    const applicationPointId = `ap_${ownerSvcId}`;

    application_point_business_logics.push({
      id: generateId('apbl-'),
      application_point_id: applicationPointId,
      business_logic_id: businessLogicId,
      description: '',
      tags: '',
      valid_from: null,
      valid_to: null,
    });
  }

  return {
    data_movements,
    interface_logical_entities,
    logical_data_entity_physical_data_entities,
    application_point_business_logics,
  };
}

// ============================================================================
// applyDeletions
// ============================================================================

/**
 * Applies entity and relationship deletions to an already-deep-cloned model.
 * Mutates the model in place.
 *
 * For entity deletions, cascades to remove:
 * - Related attributes (logical_data_attributes or physical_data_attributes)
 * - The entity's data_entity_point
 * - Any logical_data_entity_relationships referencing the entity's data_entity_point
 * - Any logical_data_entity_physical_data_entities referencing the entity
 * - Any data_movements referencing the entity's data_entity_point
 * - The entity itself
 *
 * @param model - The deep-cloned model to mutate
 * @param entitiesToDelete - Entities to delete
 * @param relationshipsToDelete - Relationships to delete
 * @returns DeletionResult with counts and warnings
 */
export function applyDeletions(
  model: any,
  entitiesToDelete: EntityDeleteInput[],
  relationshipsToDelete: RelationshipDeleteInput[]
): DeletionResult {
  let deletedEntities = 0;
  let deletedRelationships = 0;
  const warnings: string[] = [];

  const entities = model.metaModel?.entities || {};
  const relationships = model.metaModel?.relationships || {};

  // --- Entity Deletions ---
  for (const del of entitiesToDelete) {
    const entityArray: any[] = entities[del.entityType] || [];
    const entityIdx = entityArray.findIndex((e: any) => e.name === del.name);

    if (entityIdx < 0) {
      warnings.push(`Entity "${del.name}" not found in ${del.entityType}; skipping deletion.`);
      continue;
    }

    const entity = entityArray[entityIdx];
    const entityId = entity.id;

    // Determine attribute type and data_entity_point ID
    const isLogical = del.entityType === 'logical_data_entities';
    const attrType = isLogical ? 'logical_data_attributes' : 'physical_data_attributes';
    const parentIdField = isLogical ? 'logical_entity_id' : 'physical_entity_id';
    const depId = isLogical ? `dep_log_${entityId}` : `dep_phy_${entityId}`;

    // Remove attributes belonging to this entity
    if (Array.isArray(entities[attrType])) {
      entities[attrType] = entities[attrType].filter(
        (a: any) => a[parentIdField] !== entityId
      );
    }

    // Remove the data_entity_point
    if (Array.isArray(entities.data_entity_points)) {
      entities.data_entity_points = entities.data_entity_points.filter(
        (dep: any) => dep.id !== depId
      );
    }

    // Remove any logical_data_entity_relationships referencing this entity's DEP
    if (Array.isArray(relationships.logical_data_entity_relationships)) {
      relationships.logical_data_entity_relationships = relationships.logical_data_entity_relationships.filter(
        (r: any) => r.fromDataEntityPointId !== depId && r.toDataEntityPointId !== depId
      );
    }

    // Remove any logical_data_entity_physical_data_entities referencing this entity
    if (Array.isArray(relationships.logical_data_entity_physical_data_entities)) {
      const mappingField = isLogical ? 'logical_entity_id' : 'physical_entity_id';
      relationships.logical_data_entity_physical_data_entities = relationships.logical_data_entity_physical_data_entities.filter(
        (r: any) => r[mappingField] !== entityId
      );
    }

    // Remove any data_movements referencing this entity's DEP
    if (Array.isArray(relationships.data_movements)) {
      relationships.data_movements = relationships.data_movements.filter(
        (r: any) => r.dataEntityPointId !== depId
      );
    }

    // Remove the entity itself
    entityArray.splice(entityIdx, 1);
    deletedEntities++;
  }

  // --- Relationship Deletions ---
  for (const del of relationshipsToDelete) {
    const relArray: any[] = relationships[del.relationshipType];
    if (!Array.isArray(relArray)) {
      warnings.push(`Relationship type "${del.relationshipType}" not found; skipping deletion of "${del.id}".`);
      continue;
    }

    const relIdx = relArray.findIndex((r: any) => r.id === del.id);
    if (relIdx < 0) {
      warnings.push(`Relationship "${del.id}" not found in ${del.relationshipType}; skipping deletion.`);
      continue;
    }

    relArray.splice(relIdx, 1);
    deletedRelationships++;
  }

  return { deletedEntities, deletedRelationships, warnings };
}

// ============================================================================
// mergeWithExisting
// ============================================================================

/**
 * Creates an empty model shell with all entity and relationship arrays initialized
 * to empty arrays, used when no existing model is found (GET returned 404).
 */
function createEmptyModelShell(): any {
  return {
    metaModel: {
      entities: {
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
        data_entity_points: [],
        interactions: [],
        app_business_points: [],
        events: [],
        states: [],
        state_transitions: [],
        activities: [],
        activity_flows: [],
        activity_partitions: [],
        ui_screens: [],
        ui_contracts: [],
        ui_components: [],
        ui_actions: [],
        ui_characteristics: [],
        business_logics: [],
        package_sets: [],
        packages: [],
        package_set_default_rules: [],
      },
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
        application_point_business_logics: [],
      },
    },
    diagrams: [],
  };
}

/**
 * Merges new entities and relationships with the existing model.
 *
 * If existingModel is null (GET returned 404), starts with an empty shell.
 * Appends new entities to existing arrays. Preserves diagrams unchanged.
 * Handles "Core Application" reuse to prevent duplicate placeholders.
 *
 * For attributes, applies upsert deduplication: if an attribute with the same
 * name AND same parent entity ID already exists, its fields are overwritten
 * instead of appending a duplicate.
 *
 * @param existingModel - The existing ArchitectureModelDto or null
 * @param newEntities - The built entities from buildEntities
 * @param newRelationships - The built relationships from buildRelationships
 * @param deletions - Optional deletions to apply before adding new entities
 * @param newDataEntityRelationships - Optional FK-style relationships to upsert
 * @returns MergeResult with the full merged model and deletion counts
 */
export function mergeWithExisting(
  existingModel: any | null,
  newEntities: BuiltEntities,
  newRelationships: BuiltRelationships,
  deletions?: { entitiesToDelete: EntityDeleteInput[]; relationshipsToDelete: RelationshipDeleteInput[] },
  newDataEntityRelationships?: any[]
): MergeResult {
  // Start with existing model or empty shell
  const base = existingModel ? JSON.parse(JSON.stringify(existingModel)) : createEmptyModelShell();

  // Ensure metaModel structure exists
  if (!base.metaModel) {
    base.metaModel = createEmptyModelShell().metaModel;
  }
  if (!base.metaModel.entities) {
    base.metaModel.entities = createEmptyModelShell().metaModel.entities;
  }
  if (!base.metaModel.relationships) {
    base.metaModel.relationships = createEmptyModelShell().metaModel.relationships;
  }

  // Apply deletions BEFORE adding new entities (delete-then-add pattern)
  let deletedEntities = 0;
  let deletedRelationships = 0;
  if (deletions && (deletions.entitiesToDelete.length > 0 || deletions.relationshipsToDelete.length > 0)) {
    const deletionResult = applyDeletions(base, deletions.entitiesToDelete, deletions.relationshipsToDelete);
    deletedEntities = deletionResult.deletedEntities;
    deletedRelationships = deletionResult.deletedRelationships;
    // Warnings are logged but not surfaced as errors (idempotent behavior)
  }

  const entities = base.metaModel.entities;
  const relationships = base.metaModel.relationships;

  // Helper: ensure array exists on the entity/relationship object
  const ensureArray = (obj: any, key: string): any[] => {
    if (!Array.isArray(obj[key])) {
      obj[key] = [];
    }
    return obj[key];
  };

  // ---- Handle "Core Application" reuse ----
  // If the existing model already contains an application named "Core Application",
  // do not add a duplicate. Skip the new "Core Application" and its "Core Component".
  const existingApps = ensureArray(entities, 'applications');
  const existingCoreApp = existingApps.find((app: any) => app.name === 'Core Application');

  let applicationsToAdd = newEntities.applications;
  let appComponentsToAdd = newEntities.app_components;
  let applicationPointsToAdd = newEntities.application_points;

  if (existingCoreApp) {
    // Filter out the new "Core Application" and its related entities
    applicationsToAdd = newEntities.applications.filter(
      (app: any) => app.name !== 'Core Application'
    );
    appComponentsToAdd = newEntities.app_components.filter(
      (comp: any) => comp.name !== 'Core Component'
    );
    // Also filter out the application_points for the Core Application and Core Component
    const newAppId = newEntities.applications.find((a: any) => a.name === 'Core Application')?.id;
    const newCompId = newEntities.app_components.find((c: any) => c.name === 'Core Component')?.id;
    applicationPointsToAdd = newEntities.application_points.filter((ap: any) => {
      if (ap.kind === 'APPLICATION' && ap.application_id === newAppId) return false;
      if (ap.kind === 'APP_COMPONENT' && ap.application_component_id === newCompId) return false;
      return true;
    });
  }

  // ---- Append new entities to existing arrays ----
  ensureArray(entities, 'applications').push(...applicationsToAdd);
  ensureArray(entities, 'app_components').push(...appComponentsToAdd);
  ensureArray(entities, 'services').push(...newEntities.services);
  ensureArray(entities, 'interfaces').push(...newEntities.interfaces);
  ensureArray(entities, 'endpoints').push(...newEntities.endpoints);
  ensureArray(entities, 'logical_data_entities').push(...newEntities.logical_data_entities);
  ensureArray(entities, 'physical_data_entities').push(...newEntities.physical_data_entities);
  ensureArray(entities, 'business_logics').push(...newEntities.business_logics);
  ensureArray(entities, 'application_points').push(...applicationPointsToAdd);
  ensureArray(entities, 'data_entity_points').push(...newEntities.data_entity_points);

  // ---- Upsert logical_data_attributes ----
  // If an attribute with the same name AND same parent entity ID already exists,
  // overwrite its fields instead of appending a duplicate.
  const existingLogicalAttrs = ensureArray(entities, 'logical_data_attributes');
  for (const newAttr of newEntities.logical_data_attributes) {
    const existingIdx = existingLogicalAttrs.findIndex(
      (a: any) => a.name === newAttr.name && a.logical_entity_id === newAttr.logical_entity_id
    );
    if (existingIdx >= 0) {
      // Overwrite existing attribute fields
      existingLogicalAttrs[existingIdx] = { ...existingLogicalAttrs[existingIdx], ...newAttr };
    } else {
      existingLogicalAttrs.push(newAttr);
    }
  }

  // ---- Upsert physical_data_attributes ----
  const existingPhysicalAttrs = ensureArray(entities, 'physical_data_attributes');
  for (const newAttr of newEntities.physical_data_attributes) {
    const existingIdx = existingPhysicalAttrs.findIndex(
      (a: any) => a.name === newAttr.name && a.physical_entity_id === newAttr.physical_entity_id
    );
    if (existingIdx >= 0) {
      // Overwrite existing attribute fields
      existingPhysicalAttrs[existingIdx] = { ...existingPhysicalAttrs[existingIdx], ...newAttr };
    } else {
      existingPhysicalAttrs.push(newAttr);
    }
  }

  // ---- Append new relationships to existing arrays ----
  ensureArray(relationships, 'data_movements').push(...newRelationships.data_movements);
  ensureArray(relationships, 'interface_logical_entities').push(
    ...newRelationships.interface_logical_entities
  );
  ensureArray(relationships, 'logical_data_entity_physical_data_entities').push(
    ...newRelationships.logical_data_entity_physical_data_entities
  );
  ensureArray(relationships, 'application_point_business_logics').push(
    ...newRelationships.application_point_business_logics
  );

  // ---- Upsert logical_data_entity_relationships ----
  if (newDataEntityRelationships && newDataEntityRelationships.length > 0) {
    const existingLderArray = ensureArray(relationships, 'logical_data_entity_relationships');
    for (const newRel of newDataEntityRelationships) {
      const existingIdx = existingLderArray.findIndex(
        (r: any) =>
          r.fromDataEntityPointId === newRel.fromDataEntityPointId &&
          r.toDataEntityPointId === newRel.toDataEntityPointId
      );
      if (existingIdx >= 0) {
        // Overwrite existing relationship
        existingLderArray[existingIdx] = { ...existingLderArray[existingIdx], ...newRel };
      } else {
        existingLderArray.push(newRel);
      }
    }
  }

  // ---- Preserve diagrams unchanged ----
  // diagrams are already in `base` from the existing model or empty from the shell

  return { model: base, deletedEntities, deletedRelationships };
}

// ============================================================================
// saveArchitectureBaseline (main orchestrator)
// ============================================================================

/**
 * Main orchestrator function for saving an architecture baseline.
 *
 * Orchestration flow:
 * 1. getProjectById -> derive filename from project name
 * 2. parseAndValidate -> validate the JSON payload
 * 3. generateIds -> assign IDs to all entities
 * 4. getModel -> fetch existing model (or null on 404)
 * 5. resolveRefs -> resolve name-based references to generated IDs (with existing model for fallback)
 * 5a. resolveDataEntityRelationshipRefs -> resolve FK relationship refs
 * 6. Check for "Core Application" reuse and adjust idMaps
 * 7. buildEntities -> construct entity DTOs
 * 8. buildRelationships -> construct relationship DTOs
 * 8a. buildDataEntityRelationships -> construct FK relationship DTOs
 * 9. mergeWithExisting -> merge new data with existing model (with deletions and FK rels)
 * 10. putModel -> save the merged model
 * 11. Return response with summary and created entities
 *
 * @param projectId - The project UUID
 * @param architectureBaselineJson - The raw JSON string of the baseline payload
 * @returns Promise resolving to the save response
 */
export async function saveArchitectureBaseline(
  projectId: string,
  architectureBaselineJson: string
): Promise<SaveArchitectureBaselineResponse> {
  // Step 1: Look up project to get filename
  let project;
  try {
    project = await archModelClient.getProjectById(projectId);
  } catch (err: any) {
    if (err.message && err.message.includes('Project not found')) {
      throw createHttpError(404, `Project not found: ${projectId}`);
    }
    throw err;
  }
  const filename = project.name;

  // Resolve the project's default architecture so we can call the
  // architecture-scoped model endpoints. The baseline route does not
  // accept an explicit architectureId; it always targets the default.
  const architectureId = await archModelClient.getDefaultArchitectureId(projectId);

  // Step 2: Parse and validate the input
  const { input, errors: validationErrors } = parseAndValidate(architectureBaselineJson);
  if (validationErrors.length > 0) {
    throw createHttpError(400, JSON.stringify({ success: false, errors: validationErrors }));
  }

  // Step 3: Generate IDs for all entities
  const idMaps = generateIds(input);

  // Step 4: Get existing model (null if 404) - needed before resolveRefs for attribute fallback
  let existingModel;
  try {
    existingModel = await archModelClient.getModel(projectId, architectureId, filename);
  } catch (err: any) {
    throw createHttpError(502, `Failed to fetch existing model: ${err.message}`);
  }

  // Step 5: Resolve name-based refs to generated IDs (pass existingModel for attribute ref fallback)
  const resolvedRefs = resolveRefs(input, idMaps, existingModel);
  if (resolvedRefs.errors.length > 0) {
    throw createHttpError(
      400,
      JSON.stringify({ success: false, errors: resolvedRefs.errors })
    );
  }

  // Step 5a: Resolve data entity relationship refs
  let builtDataEntityRelationships: any[] = [];
  if (input.dataEntityRelationships && input.dataEntityRelationships.length > 0) {
    const { resolved: resolvedDerRefs, errors: derErrors } = resolveDataEntityRelationshipRefs(
      input.dataEntityRelationships,
      idMaps,
      existingModel
    );
    if (derErrors.length > 0) {
      throw createHttpError(
        400,
        JSON.stringify({ success: false, errors: derErrors })
      );
    }
    builtDataEntityRelationships = buildDataEntityRelationships(resolvedDerRefs);
  }

  // Step 6: Check for "Core Application" reuse and adjust idMaps if existing model has one
  if (existingModel) {
    const existingApps = existingModel?.metaModel?.entities?.applications || [];
    const existingCoreApp = existingApps.find((app: any) => app.name === 'Core Application');
    if (existingCoreApp) {
      // Reuse the existing Core Application ID
      idMaps.application.id = existingCoreApp.id;

      // Find the existing Core Component associated with the existing Core Application
      const existingComps = existingModel?.metaModel?.entities?.app_components || [];
      const existingCoreComp = existingComps.find(
        (c: any) => c.name === 'Core Component' && c.application_id === existingCoreApp.id
      );
      if (existingCoreComp) {
        idMaps.appComponent.id = existingCoreComp.id;
      }
    }
  }

  // Step 7: Build entities (uses potentially-updated idMaps for Core Application reuse)
  const builtEntities = buildEntities(input, idMaps, resolvedRefs);

  // Step 8: Build relationships
  const builtRelationships = buildRelationships(
    input,
    idMaps,
    resolvedRefs,
    builtEntities.application_points
  );

  // Step 9: Merge with existing model (with deletions and FK relationships)
  const deletions = (input.entitiesToDelete && input.entitiesToDelete.length > 0) ||
                    (input.relationshipsToDelete && input.relationshipsToDelete.length > 0)
    ? { entitiesToDelete: input.entitiesToDelete || [], relationshipsToDelete: input.relationshipsToDelete || [] }
    : undefined;

  const { model: mergedModel, deletedEntities, deletedRelationships } = mergeWithExisting(
    existingModel,
    builtEntities,
    builtRelationships,
    deletions,
    builtDataEntityRelationships.length > 0 ? builtDataEntityRelationships : undefined
  );

  // Step 10: Ensure abbreviations before save
  ensureAbbreviations(mergedModel);

  // Step 11: Save the merged model
  try {
    await archModelClient.putModel(projectId, architectureId, filename, mergedModel);
  } catch (err: any) {
    const statusCode = err.response?.status || 502;
    const responseBody = err.response?.data;
    const detail = responseBody
      ? (typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody))
      : err.message;
    throw createHttpError(502, `Failed to save model (upstream ${statusCode}): ${detail}`);
  }

  // Step 11: Build and return the response
  const response: SaveArchitectureBaselineResponse = {
    success: true,
    projectId,
    filename,
    summary: {
      applications: builtEntities.applications.length,
      appComponents: builtEntities.app_components.length,
      services: builtEntities.services.length,
      interfaces: builtEntities.interfaces.length,
      interfaceEndpoints: builtEntities.endpoints.length,
      logicalDataEntities: builtEntities.logical_data_entities.length,
      physicalDataEntities: builtEntities.physical_data_entities.length,
      logicalDataAttributes: builtEntities.logical_data_attributes.length,
      physicalDataAttributes: builtEntities.physical_data_attributes.length,
      businessLogic: builtEntities.business_logics.length,
      dataMovements: builtRelationships.data_movements.length,
      applicationPoints: builtEntities.application_points.length,
      dataEntityPoints: builtEntities.data_entity_points.length,
      interfaceLogicalEntities: builtRelationships.interface_logical_entities.length,
      logicalPhysicalMappings:
        builtRelationships.logical_data_entity_physical_data_entities.length,
      applicationPointBusinessLogics:
        builtRelationships.application_point_business_logics.length,
      dataEntityRelationships: builtDataEntityRelationships.length,
      deletedEntities,
      deletedRelationships,
    },
    createdEntities: {
      applications: builtEntities.applications.map((a: any) => ({ name: a.name, id: a.id })),
      appComponents: builtEntities.app_components.map((c: any) => ({ name: c.name, id: c.id })),
      services: builtEntities.services.map((s: any) => ({ name: s.name, id: s.id })),
      interfaces: builtEntities.interfaces.map((i: any) => ({ name: i.name, id: i.id })),
      interfaceEndpoints: builtEntities.endpoints.map((e: any) => ({ name: e.name, id: e.id })),
      logicalDataEntities: builtEntities.logical_data_entities.map((l: any) => ({
        name: l.name,
        id: l.id,
      })),
      physicalDataEntities: builtEntities.physical_data_entities.map((p: any) => ({
        name: p.name,
        id: p.id,
      })),
      logicalDataAttributes: builtEntities.logical_data_attributes.map((a: any) => ({
        name: a.name,
        id: a.id,
      })),
      physicalDataAttributes: builtEntities.physical_data_attributes.map((a: any) => ({
        name: a.name,
        id: a.id,
      })),
      businessLogic: builtEntities.business_logics.map((b: any) => ({ name: b.name, id: b.id })),
      dataMovements: builtRelationships.data_movements.map((d: any) => ({
        name: `${d.source_application_point_id} -> ${d.target_application_point_id}`,
        id: d.id,
      })),
    },
  };

  return response;
}
