# JSON Load Validation Fix - Specification

## Overview

The JSON load validation implemented in v0.1 has incorrect behavior that must be fixed. The current implementation uses a flat structure and requires all arrays to be present, but the correct schema uses a nested structure and all arrays should be optional.

## Problem Statement

The current implementation has the following issues:

1. **Wrong schema structure** - Uses flat arrays at root level instead of nested `metaModel.entities.*` and `metaModel.relationships.*`
2. **Wrong key names** - Uses incorrect keys like `application_components` instead of `app_components`, and `attributes` instead of the separate logical/physical attribute arrays
3. **Over-aggressive validation** - Requires all arrays to be present and shows errors for missing arrays
4. **Missing default values** - Does not default missing arrays to empty arrays

## Requirements

### 1. Correct Schema Structure

The JSON file structure must be:

```json
{
  "metaModel": {
    "entities": {
      "business_users": [],
      "business_processes": [],
      "applications": [],
      "app_components": [],
      "services": [],
      "application_points": [],
      "logical_data_entities": [],
      "logical_data_attributes": [],
      "physical_data_entities": [],
      "physical_data_attributes": []
    },
    "relationships": {
      "business_user_processes": [],
      "application_point_business_processes": [],
      "logical_data_entity_relationships": [],
      "logical_data_entity_physical_data_entities": [],
      "logical_data_attribute_physical_data_attributes": [],
      "data_movements": []
    }
  },
  "diagrams": []
}
```

### 2. All Arrays Are Optional

- Nothing in the meta-model is required in v0.1
- If any expected array is missing, default it to an empty array
- No validation errors for missing arrays

### 3. Permissive Structure Validation

Validation should only reject:
- Totally invalid JSON (malformed syntax)
- Non-array types where arrays are expected (e.g., if `business_users` is an object instead of an array)

### 4. FK Reference Validation Remains Active

- FK validation must still check that referenced entities exist
- If a foreign key references a non-existent primary key, show a validation error
- This applies during editing and before save

### 5. In-Memory Model Structure

After loading, the in-memory model must always contain the complete structure with all arrays present (defaulting to empty if not in the file).

## Implementation Changes

### Files to Modify

1. **`frontend/src/types/model.ts`**
   - Update `ArchitectureModel` interface to use nested structure
   - Add `MetaModel` interface with `entities` and `relationships`

2. **`frontend/src/utils/validation.ts`**
   - Update `validateJsonStructure` to:
     - Accept the nested schema
     - Default missing arrays to empty
     - Only reject malformed JSON or non-array types
   - Update FK validation to use correct key paths

3. **`frontend/src/utils/fileOperations.ts`**
   - Update JSON parsing to handle nested structure
   - Default all missing arrays to empty
   - Update serialization to output nested structure

4. **`frontend/src/contexts/ArchitectureContext.tsx`**
   - Update initial state to use nested structure
   - Update reducer to work with nested paths

5. **`frontend/src/components/Grid/Grid.tsx`**
   - Update entity access to use nested paths
   - Update `createEmptyEntity` for correct entity types

6. **`frontend/src/config/gridConfigs.ts`**
   - Update entity type mappings to use correct key names

7. **`frontend/public/sample-architecture.json`**
   - Update to use correct nested structure

### Type Definitions

```typescript
// New nested structure
interface MetaModelEntities {
  business_users: BusinessUser[];
  business_processes: BusinessProcess[];
  applications: Application[];
  app_components: ApplicationComponent[];
  services: Service[];
  application_points: ApplicationPoint[];
  logical_data_entities: LogicalDataEntity[];
  logical_data_attributes: LogicalDataAttribute[];
  physical_data_entities: PhysicalDataEntity[];
  physical_data_attributes: PhysicalDataAttribute[];
}

interface MetaModelRelationships {
  business_user_processes: BusinessUserProcess[];
  application_point_business_processes: ApplicationPointBusinessProcess[];
  logical_data_entity_relationships: LogicalDataEntityRelationship[];
  logical_data_entity_physical_data_entities: LogicalDataEntityPhysicalDataEntity[];
  logical_data_attribute_physical_data_attributes: LogicalDataAttributePhysicalDataAttribute[];
  data_movements: DataMovement[];
}

interface MetaModel {
  entities: MetaModelEntities;
  relationships: MetaModelRelationships;
}

interface ArchitectureModel {
  metaModel: MetaModel;
  diagrams: Diagram[];
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  edge_points: EdgePoint[];
}
```

### Entity Type Updates

The `EntityType` union must use the correct keys:

```typescript
export type EntityType =
  | 'business_users'
  | 'business_processes'
  | 'applications'
  | 'app_components'  // NOT 'application_components'
  | 'services'
  | 'application_points'
  | 'logical_data_entities'
  | 'logical_data_attributes'  // NOT 'attributes'
  | 'physical_data_entities'
  | 'physical_data_attributes';
```

### JSON Load Logic

```typescript
function loadModel(data: unknown): ArchitectureModel {
  // Parse JSON if string
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;

  // Validate it's an object
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid JSON: must be an object');
  }

  const obj = parsed as Record<string, unknown>;

  // Build model with defaults
  const metaModel = (obj.metaModel as Record<string, unknown>) || {};
  const entities = (metaModel.entities as Record<string, unknown>) || {};
  const relationships = (metaModel.relationships as Record<string, unknown>) || {};

  return {
    metaModel: {
      entities: {
        business_users: getArrayOrDefault(entities.business_users),
        business_processes: getArrayOrDefault(entities.business_processes),
        applications: getArrayOrDefault(entities.applications),
        app_components: getArrayOrDefault(entities.app_components),
        services: getArrayOrDefault(entities.services),
        application_points: getArrayOrDefault(entities.application_points),
        logical_data_entities: getArrayOrDefault(entities.logical_data_entities),
        logical_data_attributes: getArrayOrDefault(entities.logical_data_attributes),
        physical_data_entities: getArrayOrDefault(entities.physical_data_entities),
        physical_data_attributes: getArrayOrDefault(entities.physical_data_attributes),
      },
      relationships: {
        business_user_processes: getArrayOrDefault(relationships.business_user_processes),
        application_point_business_processes: getArrayOrDefault(relationships.application_point_business_processes),
        logical_data_entity_relationships: getArrayOrDefault(relationships.logical_data_entity_relationships),
        logical_data_entity_physical_data_entities: getArrayOrDefault(relationships.logical_data_entity_physical_data_entities),
        logical_data_attribute_physical_data_attributes: getArrayOrDefault(relationships.logical_data_attribute_physical_data_attributes),
        data_movements: getArrayOrDefault(relationships.data_movements),
      },
    },
    diagrams: getArrayOrDefault(obj.diagrams),
    diagram_nodes: getArrayOrDefault(obj.diagram_nodes),
    diagram_edges: getArrayOrDefault(obj.diagram_edges),
    edge_points: getArrayOrDefault(obj.edge_points),
  };
}

function getArrayOrDefault(value: unknown): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value !== undefined && value !== null) {
    throw new Error(`Expected array but got ${typeof value}`);
  }
  return [];
}
```

## Acceptance Criteria

1. **Empty JSON loads successfully**
   - `{}` loads without errors, creating empty model

2. **Partial JSON loads successfully**
   - JSON with only some arrays present loads without errors
   - Missing arrays default to empty

3. **Correct structure accepted**
   - JSON with `metaModel.entities.*` and `metaModel.relationships.*` structure loads correctly

4. **Invalid structure rejected**
   - Malformed JSON shows parse error
   - Non-array where array expected shows type error

5. **FK validation works**
   - Invalid FK references (e.g., `application_id` pointing to non-existent application) show validation errors
   - Valid FK references pass validation

6. **Sample JSON loads**
   - The sample-architecture.json file loads without validation errors

7. **Save produces correct structure**
   - Saved JSON uses the nested `metaModel` structure

## Out of Scope

- Cascading delete validation (deleting a PK that has FK references) - deferred to later version
- Migration of existing JSON files from flat to nested structure

## Testing

1. Load empty JSON `{}`
2. Load JSON with only `metaModel.entities.applications`
3. Load JSON with full nested structure
4. Attempt to load malformed JSON (should error)
5. Attempt to load JSON with object instead of array (should error)
6. Create entity with invalid FK (should show validation error)
7. Save model and verify nested structure
