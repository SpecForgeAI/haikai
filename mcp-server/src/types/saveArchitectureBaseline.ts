/**
 * Type definitions for the save_architecture_baseline MCP tool.
 * Used to persist architecture baseline entities (services, interfaces, endpoints,
 * data entities, data attributes, business logic, data movements) into the architecture model.
 */

// ============================================================================
// Request Type
// ============================================================================

/**
 * Request body for the save_architecture_baseline MCP tool
 */
export interface SaveArchitectureBaselineRequest {
  /** The session ID for tracking state */
  sessionId: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the architecture baseline payload */
  architectureBaselineJson: string;
}

// ============================================================================
// Input Payload Types (parsed from architectureBaselineJson)
// ============================================================================

/**
 * Top-level parsed payload from architectureBaselineJson.
 * All arrays are optional and default to empty.
 */
export interface ArchitectureBaselineInput {
  services?: ServiceInput[];
  interfaces?: InterfaceInput[];
  interfaceEndpoints?: InterfaceEndpointInput[];
  logicalDataEntities?: LogicalDataEntityInput[];
  physicalDataEntities?: PhysicalDataEntityInput[];
  logicalDataAttributes?: LogicalDataAttributeInput[];
  physicalDataAttributes?: PhysicalDataAttributeInput[];
  businessLogic?: BusinessLogicInput[];
  dataMovements?: DataMovementInput[];
  /** FK-style relationships between data entities */
  dataEntityRelationships?: DataEntityRelationshipInput[];
  /** Entities to delete from the existing model */
  entitiesToDelete?: EntityDeleteInput[];
  /** Relationships to delete from the existing model */
  relationshipsToDelete?: RelationshipDeleteInput[];
}

/**
 * Input for a Service entity.
 * serviceType and coreTech are optional descriptors.
 */
export interface ServiceInput {
  /** Service name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional service type (e.g., "REST", "gRPC") */
  serviceType?: string;
  /** Optional core technology (e.g., "Java", "Node.js") */
  coreTech?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for an Interface entity.
 * serviceRef is a name-based reference resolved internally.
 */
export interface InterfaceInput {
  /** Interface name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Name of the service this interface belongs to (resolved to ID internally) */
  serviceRef: string;
  /** Optional interface type (e.g., "REST_API", "EVENT_STREAM") */
  interfaceType?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for an Interface Endpoint entity.
 * interfaceRef and data entity refs are name-based references resolved internally.
 */
export interface InterfaceEndpointInput {
  /** Endpoint name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Name of the interface this endpoint belongs to (resolved to ID internally) */
  interfaceRef: string;
  /** Optional endpoint type */
  endpointType?: string;
  /** Optional path or address (e.g., "/api/orders") */
  pathOrAddress?: string;
  /** Optional protocol (e.g., "HTTP", "gRPC") */
  protocol?: string;
  /** Optional HTTP operation verb (e.g., "GET", "POST") */
  operationVerb?: string;
  /** Optional direction (e.g., "INBOUND", "OUTBOUND") */
  direction?: string;
  /** Optional name of the request data entity (resolved to data_entity_point ID internally) */
  requestDataEntityRef?: string;
  /** Optional name of the response data entity (resolved to data_entity_point ID internally) */
  responseDataEntityRef?: string;
}

/**
 * Input for a Logical Data Entity.
 */
export interface LogicalDataEntityInput {
  /** Entity name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a Physical Data Entity.
 * logicalDataEntityRef is a name-based reference resolved internally.
 */
export interface PhysicalDataEntityInput {
  /** Entity name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional physical type (e.g., "TABLE", "COLLECTION") */
  physicalType?: string;
  /** Optional database name */
  database?: string;
  /** Optional name of the logical data entity this maps to (resolved to ID internally) */
  logicalDataEntityRef?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a Logical Data Attribute.
 * logicalEntityRef is a name-based reference to the parent logical data entity,
 * resolved to the entity's ID internally.
 */
export interface LogicalDataAttributeInput {
  /** Attribute name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Name of the parent logical data entity (resolved to ID internally) */
  logicalEntityRef: string;
  /** Optional data type (e.g., "string", "number", "boolean") */
  dataType?: string;
  /** Optional flag indicating if this attribute is a primary key */
  isPrimaryKey?: boolean;
  /** Optional flag indicating if this attribute is nullable */
  isNullable?: boolean;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a Physical Data Attribute.
 * physicalEntityRef is a name-based reference to the parent physical data entity,
 * resolved to the entity's ID internally.
 */
export interface PhysicalDataAttributeInput {
  /** Attribute name (required, must be non-empty) */
  name: string;
  /** Optional description */
  description?: string;
  /** Name of the parent physical data entity (resolved to ID internally) */
  physicalEntityRef: string;
  /** Optional data type (e.g., "VARCHAR(255)", "INTEGER", "TIMESTAMP") */
  dataType?: string;
  /** Optional flag indicating if this attribute is a primary key */
  isPrimaryKey?: boolean;
  /** Optional flag indicating if this attribute is nullable */
  isNullable?: boolean;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a Business Logic entity.
 * ownerServiceRef is a name-based reference resolved internally.
 */
export interface BusinessLogicInput {
  /** Business logic name (required, must be non-empty) */
  name: string;
  /** Optional markdown description */
  descriptionMd?: string;
  /** Optional type text */
  typeText?: string;
  /** Optional name of the owning service (resolved to ID internally) */
  ownerServiceRef?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a Data Movement relationship.
 * Service and entity refs are name-based references resolved internally.
 * Exactly one of dataEntityRef or interfaceWithSchemaRef must be provided (XOR constraint).
 */
export interface DataMovementInput {
  /** Name of the source service (resolved to application_point ID internally) */
  sourceServiceRef: string;
  /** Name of the target service (resolved to application_point ID internally) */
  targetServiceRef: string;
  /** Optional name of the data entity being moved (resolved to data_entity_point ID) */
  dataEntityRef?: string;
  /** Optional name of the interface with schema (resolved to interface ID) */
  interfaceWithSchemaRef?: string;
  /** Optional movement type */
  movementType?: string;
  /** Optional description */
  description?: string;
  /** Optional bi-directional flag */
  biDirectional?: boolean;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for a FK-style relationship between data entities.
 * Entity refs are name-based references resolved to data_entity_point IDs internally.
 */
export interface DataEntityRelationshipInput {
  /** Name of the source entity (resolved to data_entity_point ID internally) */
  fromEntityRef: string;
  /** Type of the source entity */
  fromEntityType: 'logical' | 'physical';
  /** Name of the target entity (resolved to data_entity_point ID internally) */
  toEntityRef: string;
  /** Type of the target entity */
  toEntityType: 'logical' | 'physical';
  /** Optional cardinality (e.g., "1:N", "M:N") */
  cardinality?: string;
  /** Optional relationship type (e.g., "ASSOCIATION", "COMPOSITION") */
  relationship?: string;
  /** Optional description */
  description?: string;
  /** Optional comma-separated tags */
  tags?: string;
}

/**
 * Input for deleting an entity from the existing model.
 * Deletion cascades to remove related attributes, data_entity_points, and relationships.
 */
export interface EntityDeleteInput {
  /** The entity type array to delete from */
  entityType: 'logical_data_entities' | 'physical_data_entities';
  /** The name of the entity to delete */
  name: string;
}

/**
 * Input for deleting a relationship from the existing model.
 */
export interface RelationshipDeleteInput {
  /** The relationship type array to delete from */
  relationshipType: string;
  /** The ID of the relationship to delete */
  id: string;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Successful response from the save_architecture_baseline operation.
 */
export interface SaveArchitectureBaselineResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** The project UUID */
  projectId: string;
  /** The model filename (derived from project name) */
  filename: string;
  /** Counts of each entity type created */
  summary: {
    applications: number;
    appComponents: number;
    services: number;
    interfaces: number;
    interfaceEndpoints: number;
    logicalDataEntities: number;
    physicalDataEntities: number;
    logicalDataAttributes: number;
    physicalDataAttributes: number;
    businessLogic: number;
    dataMovements: number;
    applicationPoints: number;
    dataEntityPoints: number;
    interfaceLogicalEntities: number;
    logicalPhysicalMappings: number;
    applicationPointBusinessLogics: number;
    dataEntityRelationships: number;
    deletedEntities: number;
    deletedRelationships: number;
  };
  /** Map of entity type to array of created entities with name and id */
  createdEntities: Record<string, Array<{ name: string; id: string }>>;
}

/**
 * Error response from the save_architecture_baseline operation.
 */
export interface SaveArchitectureBaselineErrorResponse {
  /** Whether the operation succeeded (always false) */
  success: boolean;
  /** Array of validation errors */
  errors: ValidationError[];
}

/**
 * Structured validation error for individual field/entity issues.
 */
export interface ValidationError {
  /** The field that failed validation */
  field: string;
  /** The entity type (e.g., "services", "interfaces") */
  entityType: string;
  /** The entity name that caused the error (if applicable) */
  entityName: string;
  /** Human-readable error message */
  message: string;
}
