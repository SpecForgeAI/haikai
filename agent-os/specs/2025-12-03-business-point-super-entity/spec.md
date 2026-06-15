# Specification: Business Point Super-Entity

## Overview

**Title:** Introduce "Business Point" super-entity for Business Process & Process Activity, and refactor relationships to use Business Point

**Created:** 2025-12-03

**Status:** Draft

## Problem Statement

Currently, relationships like "User ↔ Process" and "App Point ↔ Process" only target Business Processes directly. This limits the ability to create relationships with Process Activities, which are also important business-level entities. The Application Point pattern has proven successful for unifying Applications, App Components, and Services under a single relationship target - a similar pattern is needed for the business process domain.

## Goals

1. Create a unified relationship target (Business Point) for both Business Processes and Process Activities
2. Mirror the proven Application Point implementation pattern
3. Update existing relationships to use Business Point instead of Business Process directly
4. Ensure seamless UI experience with proper dropdown formatting
5. Maintain backward compatibility with existing data through migration

## Non-Goals

- Changes to Application Point logic
- Changes to Business Process or Process Activity semantics beyond linking to Business Points
- New relationship types beyond updating the existing two

---

## Technical Specification

### 1. New Meta-Model Entity: BusinessPoint

#### 1.1 Type Definition

**File:** `frontend/src/types/model.ts`

```typescript
export type BusinessPointKind = 'BUSINESS_PROCESS' | 'PROCESS_ACTIVITY';

export interface BusinessPoint {
  id: string;
  name: string;
  description: string;
  kind: BusinessPointKind;
  business_process_id: string;        // FK for BUSINESS_PROCESS kind
  process_activity_id?: string;       // FK for PROCESS_ACTIVITY kind
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

#### 1.2 Entity Configuration

| Property | Value |
|----------|-------|
| Entity name | `business_point` |
| Collection name | `business_points` |
| Displayed in RHS? | No (hidden from user-facing sections) |
| Created by user? | No (system-created only) |
| ID pattern | `bp_{underlyingEntityId}` (deterministic) |

#### 1.3 Attributes

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | System-generated, format: `bp_{sourceEntityId}` |
| `name` | string | Yes | Mirrors underlying BP/PA name (source is canonical) |
| `description` | string | No | Inherited from source entity |
| `kind` | BusinessPointKind | Yes | `'BUSINESS_PROCESS'` or `'PROCESS_ACTIVITY'` |
| `business_process_id` | string | Yes* | FK to Business Process (required when kind is BUSINESS_PROCESS) |
| `process_activity_id` | string | Yes* | FK to Process Activity (required when kind is PROCESS_ACTIVITY) |
| `tags` | string | No | Inherited from source entity |
| `valid_from` | string | No | Temporal field (YYYY-Qn format) |
| `valid_to` | string | No | Temporal field (YYYY-Qn format) |

*One of `business_process_id` or `process_activity_id` is required depending on `kind`.

#### 1.4 Uniqueness Rules

- For every Business Process, there MUST be exactly one Business Point
- For every Process Activity, there MUST be exactly one Business Point
- Business Point IDs are deterministic: `bp_{sourceEntityId}`

---

### 2. Auto-Creation and Synchronization

**New File:** `frontend/src/utils/businessPointSync.ts`

This module mirrors the existing `applicationPointSync.ts` pattern.

#### 2.1 ID Generation

```typescript
export function generateBusinessPointId(sourceEntityId: string): string {
  return `bp_${sourceEntityId}`;
}
```

#### 2.2 Creation from Source Entity

```typescript
export function createBusinessPointFromEntity(
  sourceEntity: BusinessProcess | ProcessActivity,
  sourceType: 'business_processes' | 'process_activities'
): BusinessPoint {
  const id = generateBusinessPointId(sourceEntity.id);

  return {
    id,
    name: sourceEntity.name,
    description: sourceEntity.description || '',
    kind: sourceType === 'business_processes' ? 'BUSINESS_PROCESS' : 'PROCESS_ACTIVITY',
    business_process_id: sourceType === 'business_processes' ? sourceEntity.id :
      (sourceType === 'process_activities' ? (sourceEntity as ProcessActivity).business_process_id : ''),
    process_activity_id: sourceType === 'process_activities' ? sourceEntity.id : undefined,
    tags: sourceEntity.tags || '',
    valid_from: sourceEntity.valid_from,
    valid_to: sourceEntity.valid_to,
  };
}
```

#### 2.3 Lifecycle Rules

| Event | Action |
|-------|--------|
| **Business Process created** | Create BusinessPoint with `kind: 'BUSINESS_PROCESS'`, `business_process_id` = BP.id |
| **Process Activity created** | Create BusinessPoint with `kind: 'PROCESS_ACTIVITY'`, `process_activity_id` = PA.id, `business_process_id` = PA.business_process_id |
| **Business Process renamed** | Update corresponding BusinessPoint.name to match |
| **Process Activity renamed** | Update corresponding BusinessPoint.name to match |
| **Business Process deleted** | Delete BusinessPoint, cascade delete relationships referencing it |
| **Process Activity deleted** | Delete BusinessPoint, cascade delete relationships referencing it |

#### 2.4 Reconciliation on Load

```typescript
export function reconcileBusinessPoints(metaModel: MetaModel): MetaModel {
  // 1. For each Business Process: create missing BPs or force-update existing names
  // 2. For each Process Activity: create missing BPs or force-update existing names
  // 3. Run full name sync pass to catch edge cases
  // 4. Remove orphaned BPs that don't map to source entities
  return updatedMetaModel;
}
```

#### 2.5 Name Synchronization

```typescript
export function syncBusinessPointNames(
  businessPoints: BusinessPoint[],
  businessProcesses: BusinessProcess[],
  processActivities: ProcessActivity[]
): BusinessPoint[] {
  // Source entity name is canonical - always overwrite BP name with source name
}
```

#### 2.6 Cascade Delete

```typescript
export function cascadeDeleteBusinessPoint(
  businessPointId: string,
  relationships: MetaModelRelationships
): MetaModelRelationships {
  // Remove all business_user_business_points referencing this BP
  // Remove all application_point_business_points referencing this BP
  return updatedRelationships;
}
```

---

### 3. Relationship Refactoring

#### 3.1 User ↔ Business Point (formerly User ↔ Process)

**Old Relationship:** `BusinessUserProcess`
**New Relationship:** `BusinessUserBusinessPoint`

```typescript
export interface BusinessUserBusinessPoint {
  id: string;
  business_user_id: string;           // FK to BusinessUser
  business_point_id: string;          // FK to BusinessPoint (NEW)
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

**Grid Configuration:**

```typescript
business_user_business_points: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, autoGenerate: true },
  { field: 'business_user_id', displayName: 'Business User', cellType: 'fk_typeahead', required: true, fkTarget: 'business_users' },
  {
    field: 'business_point_id',
    displayName: 'Business Point',
    cellType: 'fk_typeahead',
    required: true,
    fkTarget: 'business_points',
    displayFormatter: businessPointDisplayFormatter,  // Shows "Name (Kind)"
  },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false },
]
```

#### 3.2 App Point ↔ Business Point (formerly App Point ↔ Process)

**Old Relationship:** `ApplicationPointBusinessProcess`
**New Relationship:** `ApplicationPointBusinessPoint`

```typescript
export interface ApplicationPointBusinessPoint {
  id: string;
  application_point_id: string;       // FK to ApplicationPoint
  business_point_id: string;          // FK to BusinessPoint (NEW)
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

**Grid Configuration:**

```typescript
application_point_business_points: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, autoGenerate: true },
  {
    field: 'application_point_id',
    displayName: 'Application Point',
    cellType: 'fk_typeahead',
    required: true,
    fkTarget: 'application_points',
    displayFormatter: applicationPointDisplayFormatter,
  },
  {
    field: 'business_point_id',
    displayName: 'Business Point',
    cellType: 'fk_typeahead',
    required: true,
    fkTarget: 'business_points',
    displayFormatter: businessPointDisplayFormatter,
  },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false },
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false },
]
```

---

### 4. Dropdown/Autocomplete UI

#### 4.1 Display Formatter

**File:** `frontend/src/utils/formatters.ts`

```typescript
export const BUSINESS_POINT_KIND_LABELS: Record<BusinessPointKind, string> = {
  'BUSINESS_PROCESS': 'Business Process',
  'PROCESS_ACTIVITY': 'Process Activity',
};

export function formatBusinessPointDisplay(businessPoint: BusinessPoint): string {
  const kindLabel = BUSINESS_POINT_KIND_LABELS[businessPoint.kind];
  return `${businessPoint.name} (${kindLabel})`;
}
```

#### 4.2 Display Examples

| Business Point Name | Kind | Formatted Display |
|---------------------|------|-------------------|
| Order Processing | BUSINESS_PROCESS | `Order Processing (Business Process)` |
| Validate Order | PROCESS_ACTIVITY | `Validate Order (Process Activity)` |
| Customer Onboarding | BUSINESS_PROCESS | `Customer Onboarding (Business Process)` |
| Send Welcome Email | PROCESS_ACTIVITY | `Send Welcome Email (Process Activity)` |

#### 4.3 Search/Autocomplete Matching

The typeahead must match on:
- Business Point name
- Kind label (e.g., searching "Activity" shows all Process Activity BPs)
- Combined formatted string

---

### 5. Diagram Behaviour

#### 5.1 No Dedicated Section

Business Points DO NOT appear as a meta-model section in the RHS, identical to Application Points:
- Users never directly create, edit, or delete Business Points
- Business Points are managed internally via their source entities

#### 5.2 Diagram Node Rendering

When rendering relationships that involve Business Points:

| Scenario | Node Displayed |
|----------|----------------|
| User ↔ Business Point relationship | Show Business Point node |
| App Point ↔ Business Point relationship | Show Business Point node |
| Business Process added directly to diagram | Show Business Process node (container) |
| Process Activity added directly to diagram | Show Process Activity node |

#### 5.3 Entity Presence Detection

**File:** `frontend/src/utils/relationshipUtils.ts`

Update `EntitiesOnDiagram` interface:

```typescript
export interface EntitiesOnDiagram {
  applicationPointsOnDiagram: Set<string>;
  businessUsersOnDiagram: Set<string>;
  businessProcessesOnDiagram: Set<string>;
  processActivitiesOnDiagram: Set<string>;        // NEW
  businessPointsOnDiagram: Set<string>;           // NEW
  logicalDataEntitiesOnDiagram: Set<string>;
  physicalDataEntitiesOnDiagram: Set<string>;
  logicalDataAttributesOnDiagram: Set<string>;
  physicalDataAttributesOnDiagram: Set<string>;
}
```

When building `businessPointsOnDiagram`, include:
- Direct BUSINESS_POINT nodes
- BUSINESS_PROCESS nodes (mapped via BP where business_process_id matches)
- PROCESS_ACTIVITY nodes (mapped via BP where process_activity_id matches)

#### 5.4 Relationship Eligibility

```typescript
function isUserBusinessPointEnabledWithSets(
  relationship: BusinessUserBusinessPoint,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  const userOnDiagram = entities.businessUsersOnDiagram.has(relationship.business_user_id);
  const bpOnDiagram = entities.businessPointsOnDiagram.has(relationship.business_point_id);

  if (userOnDiagram && bpOnDiagram) {
    return { enabled: true };
  }
  return { enabled: false, reason: 'Both Business User and Business Point must be on diagram' };
}

function isAppPointBusinessPointEnabledWithSets(
  relationship: ApplicationPointBusinessPoint,
  entities: EntitiesOnDiagram,
  diagramNodes: DiagramNode[]
): RelationshipEligibility {
  const apOnDiagram = entities.applicationPointsOnDiagram.has(relationship.application_point_id);
  const bpOnDiagram = entities.businessPointsOnDiagram.has(relationship.business_point_id);

  if (apOnDiagram && bpOnDiagram) {
    return { enabled: true };
  }
  return { enabled: false, reason: 'Both Application Point and Business Point must be on diagram' };
}
```

#### 5.5 Visual Styling

| Property | Value |
|----------|-------|
| Node shape | Same as Application Point |
| Node color | Distinct from Business Process and Process Activity (new color) |
| Label | Business Point `name` |
| Type indicator | Optional subtle indicator of underlying type |

**Suggested Colors (to be added to defaults.ts):**

```typescript
export const businessPointColors = {
  fill: '#E8D5B7',        // Warm beige/tan
  stroke: '#8B7355',      // Darker brown
  text: '#4A3728',        // Dark brown text
};
```

#### 5.6 Edge Styling

| Relationship | Line Style | Arrow | Multiplicity |
|--------------|------------|-------|--------------|
| User ↔ Business Point | DASHED | None | None |
| App Point ↔ Business Point | SOLID | None | None |

---

### 6. Advanced Add Integration

**File:** `frontend/src/utils/advancedAddRelationships.ts`

Add Business Point to the expandable relationships map:

```typescript
[ENTITY_TYPES.BUSINESS_POINT]: [
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_USER,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'business_user_business_points',
    foreignKeyField: 'business_point_id',
    displayLabel: 'Business Users',
  },
  {
    targetEntityType: ENTITY_TYPES.APPLICATION_POINT,
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'application_point_business_points',
    foreignKeyField: 'business_point_id',
    displayLabel: 'Application Points',
  },
],

// Update BUSINESS_USER to reference Business Point
[ENTITY_TYPES.BUSINESS_USER]: [
  {
    targetEntityType: ENTITY_TYPES.BUSINESS_POINT,      // Changed from BUSINESS_PROCESS
    relationshipKind: 'ASSOCIATION',
    direction: 'ASSOCIATION',
    relationshipTableName: 'business_user_business_points',
    foreignKeyField: 'business_user_id',
    displayLabel: 'Business Points',
  },
],

// Update APPLICATION (via Application Point) to reference Business Point
// Already handled through application_point_business_points
```

---

### 7. Persistence & JSON Model Updates

#### 7.1 MetaModelEntities Update

```typescript
export interface MetaModelEntities {
  // ... existing entities ...
  business_points: BusinessPoint[];    // NEW
}
```

#### 7.2 MetaModelRelationships Update

```typescript
export interface MetaModelRelationships {
  // ... existing relationships ...
  business_user_business_points: BusinessUserBusinessPoint[];       // NEW (replaces business_user_processes)
  application_point_business_points: ApplicationPointBusinessPoint[]; // NEW (replaces application_point_business_processes)
}
```

#### 7.3 Default Empty Arrays

```typescript
export const emptyMetaModelEntities: MetaModelEntities = {
  // ... existing ...
  business_points: [],
};

export const emptyMetaModelRelationships: MetaModelRelationships = {
  // ... existing ...
  business_user_business_points: [],
  application_point_business_points: [],
};
```

#### 7.4 JSON File Structure

The meta-model JSON file will include:

```json
{
  "entities": {
    "business_points": [
      {
        "id": "bp_proc_001",
        "name": "Order Processing",
        "description": "Main order processing workflow",
        "kind": "BUSINESS_PROCESS",
        "business_process_id": "proc_001",
        "tags": "",
        "valid_from": "2024-Q1",
        "valid_to": null
      },
      {
        "id": "bp_act_001",
        "name": "Validate Order",
        "description": "Validates order details",
        "kind": "PROCESS_ACTIVITY",
        "business_process_id": "proc_001",
        "process_activity_id": "act_001",
        "tags": "",
        "valid_from": "2024-Q1",
        "valid_to": null
      }
    ]
  },
  "relationships": {
    "business_user_business_points": [
      {
        "id": "ubp_001",
        "business_user_id": "user_001",
        "business_point_id": "bp_proc_001",
        "description": "User performs this process",
        "tags": "",
        "valid_from": null,
        "valid_to": null
      }
    ],
    "application_point_business_points": [
      {
        "id": "apbp_001",
        "application_point_id": "ap_app_001",
        "business_point_id": "bp_act_001",
        "description": "Application supports this activity",
        "tags": "",
        "valid_from": null,
        "valid_to": null
      }
    ]
  }
}
```

---

### 8. Data Migration

#### 8.1 Migration Strategy

When loading existing files that have the old relationship format:

1. **Detect old format:** Check for `business_user_processes` or `application_point_business_processes` arrays
2. **Generate Business Points:** Create Business Points for all referenced Business Processes
3. **Convert relationships:** Map old `business_process_id` to new `business_point_id`
4. **Preserve data:** Copy all metadata (description, tags, temporal fields)

#### 8.2 Migration Function

```typescript
export function migrateToBusinessPoints(metaModel: MetaModel): MetaModel {
  // 1. First, ensure all Business Points exist via reconciliation
  const reconciledModel = reconcileBusinessPoints(metaModel);

  // 2. Migrate business_user_processes -> business_user_business_points
  if (metaModel.relationships.business_user_processes?.length > 0) {
    reconciledModel.relationships.business_user_business_points =
      metaModel.relationships.business_user_processes.map(rel => ({
        id: rel.id,
        business_user_id: rel.business_user_id,
        business_point_id: generateBusinessPointId(rel.business_process_id),
        description: rel.description,
        tags: rel.tags,
        valid_from: rel.valid_from,
        valid_to: rel.valid_to,
      }));
  }

  // 3. Migrate application_point_business_processes -> application_point_business_points
  if (metaModel.relationships.application_point_business_processes?.length > 0) {
    reconciledModel.relationships.application_point_business_points =
      metaModel.relationships.application_point_business_processes.map(rel => ({
        id: rel.id,
        application_point_id: rel.application_point_id,
        business_point_id: generateBusinessPointId(rel.business_process_id),
        description: rel.description,
        tags: rel.tags,
        valid_from: rel.valid_from,
        valid_to: rel.valid_to,
      }));
  }

  return reconciledModel;
}
```

---

### 9. Constants and Enums

#### 9.1 ENTITY_TYPES Addition

```typescript
export const ENTITY_TYPES = {
  // ... existing ...
  BUSINESS_POINT: 'BUSINESS_POINT',
} as const;
```

#### 9.2 RELATIONSHIP_EDGE_TYPES Addition

```typescript
export const RELATIONSHIP_EDGE_TYPES = {
  // ... existing ...
  USER_BUSINESS_POINT: 'USER_BUSINESS_POINT',
  APP_POINT_BUSINESS_POINT: 'APP_POINT_BUSINESS_POINT',
} as const;
```

#### 9.3 Tab Names

```typescript
// Entity tabs (business_points hidden from UI, but defined for internal use)

// Relationship tabs
export const relationshipTabNames = {
  // ... existing ...
  business_user_business_points: 'User ↔ Business Point',
  application_point_business_points: 'App Point ↔ Business Point',
};
```

---

### 10. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add BusinessPoint interface, BusinessPointKind type, update MetaModelEntities, MetaModelRelationships, ENTITY_TYPES, RELATIONSHIP_EDGE_TYPES |
| `frontend/src/utils/businessPointSync.ts` | NEW FILE - Auto-creation, sync, reconciliation, cascade delete |
| `frontend/src/utils/formatters.ts` | Add formatBusinessPointDisplay(), BUSINESS_POINT_KIND_LABELS |
| `frontend/src/config/gridConfigs.ts` | Add business_points grid config, business_user_business_points config, application_point_business_points config |
| `frontend/src/config/defaults.ts` | Add businessPointColors, relationship color mappings |
| `frontend/src/utils/relationshipUtils.ts` | Update EntitiesOnDiagram, add BP eligibility functions, update getRelationshipEligibility |
| `frontend/src/utils/advancedAddRelationships.ts` | Add BUSINESS_POINT to EXPANDABLE_RELATIONSHIPS, update BUSINESS_USER relationships |
| `frontend/src/utils/validation.ts` | Add validation rules for new relationship types |
| `frontend/src/utils/paletteData.ts` | Add business_points section (hidden from palette) |
| `frontend/src/utils/fileOperations.ts` | Add migration logic, update reconciliation to include BP sync |
| `frontend/src/utils/rendering.ts` | Add Business Point node rendering, edge rendering for new relationships |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Update entity presence detection for BPs |
| `frontend/src/components/DiagramsView/MetaModelPanel.tsx` | Ensure business_points section is hidden |

---

## Testing Requirements

### Unit Tests

1. **Business Point creation from Business Process**
2. **Business Point creation from Process Activity**
3. **Business Point name synchronization on rename**
4. **Business Point deletion on source entity deletion**
5. **Relationship cascade delete on Business Point deletion**
6. **Orphaned Business Point cleanup**
7. **formatBusinessPointDisplay() output formatting**
8. **Migration from old relationship format**

### Integration Tests

1. **End-to-end: Create Business Process → Verify Business Point created**
2. **End-to-end: Create Process Activity → Verify Business Point created**
3. **End-to-end: Create User ↔ Business Point relationship → Verify diagram rendering**
4. **End-to-end: Create App Point ↔ Business Point relationship → Verify diagram rendering**
5. **Load file with old format → Verify migration to new format**

### Manual Testing

1. **Dropdown shows formatted Business Points with type indicator**
2. **Typeahead search matches on name and type**
3. **Diagram correctly renders Business Point nodes for relationships**
4. **Advanced Add correctly expands Business Point relationships**
5. **Business Points hidden from RHS meta-model sections**

---

## Acceptance Criteria

1. ✅ Business Points are automatically created for every Business Process
2. ✅ Business Points are automatically created for every Process Activity
3. ✅ Business Point names stay synchronized with source entity names
4. ✅ Business Points are deleted when source entities are deleted
5. ✅ User ↔ Business Point relationship works with dropdown showing all Business Points
6. ✅ App Point ↔ Business Point relationship works with dropdown showing all Business Points
7. ✅ Dropdown displays format: `"<Name> (<EntityType>)"`
8. ✅ Diagram renders Business Point nodes for relationships
9. ✅ Business Points do not appear in RHS meta-model sections
10. ✅ Existing data is migrated to new format on load
11. ✅ All existing tests pass
12. ✅ New unit and integration tests pass

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Data migration fails for complex files | High | Comprehensive migration testing, backup before migration |
| Performance impact from BP reconciliation | Medium | Efficient Set-based lookups, lazy reconciliation |
| Confusion between BP/PA and Business Point | Medium | Clear UI formatting with type indicators |
| Breaking existing integrations | High | Maintain backward compatibility in file format detection |

---

## Open Questions

1. **Q:** Should Business Point nodes have a distinct visual style from Application Points?
   **A:** Yes, use a distinct color (warm beige/tan suggested) to differentiate from Application Points.

2. **Q:** Should the dropdown show Business Processes and Process Activities in separate groups?
   **A:** Not required for initial implementation - single flat list with type indicators is sufficient.

3. **Q:** Should we maintain the old relationship table names for backward compatibility?
   **A:** Migration will convert old format to new format automatically on load.
