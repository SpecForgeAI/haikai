// Generate a unique ID using UUID v4 pattern
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate a prefixed ID for better readability
export function generatePrefixedId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `${prefix}-${timestamp}-${random}`;
}

// Get prefix based on entity type
export function getEntityPrefix(entityType: string): string {
  const prefixMap: Record<string, string> = {
    // Entity types
    business_users: 'user',
    business_processes: 'process',
    process_activities: 'pa',
    business_points: 'bp',
    applications: 'app',
    app_components: 'comp',
    services: 'svc',
    interfaces: 'ifc',
    endpoints: 'ep',
    application_points: 'point',
    logical_data_entities: 'lde',
    logical_data_attributes: 'lattr',
    physical_data_entities: 'pde',
    physical_data_attributes: 'pattr',
    interactions: 'int',  // New: Interactions entity type prefix
    // Package Set and Package entity types
    package_sets: 'pkgset',
    packages: 'pkg',
    // Business Point relationship types
    business_user_business_points: 'bubp',
    application_point_business_points: 'apbpt',
    // Other relationship types
    logical_data_entity_relationships: 'lder',
    logical_data_entity_physical_data_entities: 'ldepde',
    logical_data_attribute_physical_data_attributes: 'ldapda',
    interface_logical_entities: 'ile',
    data_movements: 'dm',
    // Diagram types
    diagrams: 'diag',
    diagram_nodes: 'node',
    diagram_edges: 'edge',
    edge_points: 'edgept',
  };
  return prefixMap[entityType] || 'id';
}

// Generate entity-specific ID
export function generateEntityId(entityType: string): string {
  const prefix = getEntityPrefix(entityType);
  return generatePrefixedId(prefix);
}

// Generate relationship-specific ID
export function generateRelationshipId(relationshipType: string): string {
  const prefix = getEntityPrefix(relationshipType);
  return generatePrefixedId(prefix);
}
