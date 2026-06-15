# Specification: Interaction Entity + App_Business_Point Super-type + Diagram Integration

## Overview

This specification introduces:
1. A new **Interaction** entity representing user interactions with one or two application/business points
2. A new **App_Business_Point** polymorphic super-type that unifies Application-side and Business-side entities
3. Diagram integration with dotted-line rendering for user interactions
4. Advanced Add support for Interaction entities

## 1. New Meta-Model Entity: Interaction

### 1.1 Entity Definition

**File**: `frontend/src/types/model.ts`

```typescript
export interface Interaction {
  id: string;                              // UUID
  name: string;                            // Required
  description?: string;                    // Optional
  user_id: string;                         // FK → BusinessUser (required)
  primary_app_business_point_id: string;   // FK → App_Business_Point (required)
  secondary_app_business_point_id?: string; // FK → App_Business_Point (optional)
}
```

### 1.2 ENTITY_TYPES Addition

```typescript
export const ENTITY_TYPES = {
  // ... existing types
  INTERACTION: 'INTERACTION',
} as const;
```

### 1.3 MetaModelEntities Update

```typescript
export interface MetaModelEntities {
  // ... existing entities
  interactions: Interaction[];
}
```

### 1.4 EntityType Union Update

```typescript
export type EntityType =
  | // ... existing types
  | 'interactions';
```

### 1.5 Display Names

| Context | Label |
|---------|-------|
| Meta-model tab | "Interactions" |
| Palette section | "User Interactions" |
| Entity type display | "Interaction" |

### 1.6 Tab Position

Insert after Process Activities, before Applications:

```
[Business Users] [Business Processes] [Process Activities] [Interactions] | [Applications] ...
```

## 2. App_Business_Point Super-Type

### 2.1 Concept

App_Business_Point is a **polymorphic super-type** that does NOT exist as a separate entity table or UI section. It represents a union of entity types that can be referenced as interaction points.

### 2.2 Member Entity Types

The following entity types are App_Business_Points:

| Entity Type | Collection Key |
|-------------|----------------|
| APPLICATION | applications |
| APP_COMPONENT | app_components |
| SERVICE | services |
| INTERFACE | interfaces |
| ENDPOINT | endpoints |
| BUSINESS_PROCESS | business_processes |
| PROCESS_ACTIVITY | process_activities |

### 2.3 Type Definition

**File**: `frontend/src/types/model.ts`

```typescript
// App_Business_Point is a polymorphic reference that can point to any of these entity types
export type AppBusinessPointEntityType =
  | 'APPLICATION'
  | 'APP_COMPONENT'
  | 'SERVICE'
  | 'INTERFACE'
  | 'ENDPOINT'
  | 'BUSINESS_PROCESS'
  | 'PROCESS_ACTIVITY';

export const APP_BUSINESS_POINT_TYPES: AppBusinessPointEntityType[] = [
  'APPLICATION',
  'APP_COMPONENT',
  'SERVICE',
  'INTERFACE',
  'ENDPOINT',
  'BUSINESS_PROCESS',
  'PROCESS_ACTIVITY',
];

// Helper function to check if an entity type is an App_Business_Point
export function isAppBusinessPointType(entityType: string): boolean {
  return APP_BUSINESS_POINT_TYPES.includes(entityType as AppBusinessPointEntityType);
}
```

### 2.4 Resolution Helper

```typescript
// Resolves an App_Business_Point ID to its concrete entity
export function resolveAppBusinessPoint(
  id: string,
  metaModel: MetaModel
): { entityType: AppBusinessPointEntityType; entity: AnyEntity } | null {
  // Search each collection for the matching ID
  const collections: [keyof MetaModelEntities, AppBusinessPointEntityType][] = [
    ['applications', 'APPLICATION'],
    ['app_components', 'APP_COMPONENT'],
    ['services', 'SERVICE'],
    ['interfaces', 'INTERFACE'],
    ['endpoints', 'ENDPOINT'],
    ['business_processes', 'BUSINESS_PROCESS'],
    ['process_activities', 'PROCESS_ACTIVITY'],
  ];

  for (const [key, type] of collections) {
    const entity = metaModel.entities[key]?.find((e: AnyEntity) => e.id === id);
    if (entity) {
      return { entityType: type, entity };
    }
  }
  return null;
}
```

### 2.5 Autocomplete Display Format

When an App_Business_Point autocomplete is displayed:

```
<entity_name> (<entity_type_display>)
```

Examples:
- "Customer Portal (Application)"
- "User Service (Service)"
- "Login Process (Business Process)"
- "GET /users (Endpoint)"

## 3. Diagram Integration

### 3.1 User Interactions Section in Palette

**File**: `frontend/src/utils/paletteData.ts`

Add a new section for User Interactions:

```typescript
{
  id: 'user_interactions',
  label: 'User Interactions',
  items: metaModel.entities.interactions || [],
  type: 'entity' as const,
}
```

Position: After `process_activities`, before `applications`.

### 3.2 Diagram JSON Schema Extension

**File**: `frontend/src/types/model.ts`

```typescript
export interface DiagramUserInteraction {
  id: string;                    // Diagram-specific ID
  interaction_id: string;        // FK → Interaction entity
  primary_node_id: string;       // FK → DiagramNode for primary App_Business_Point
  secondary_node_id?: string;    // FK → DiagramNode for secondary App_Business_Point (nullable)
  user_node_id?: string;         // FK → DiagramNode for user (nullable)
  line_style: 'dotted' | 'solid'; // Visual style (default: 'dotted')
}

export interface Diagram {
  // ... existing fields
  diagram_nodes: DiagramNode[];
  diagram_edges: DiagramEdge[];
  decorations?: Decoration[];
  user_interactions?: DiagramUserInteraction[]; // NEW
}
```

### 3.3 Rendering Rules

When a User Interaction is added to the diagram:

#### Case 1: Two App_Business_Points Referenced

```
┌─────────────┐                    ┌─────────────┐
│   Primary   │←- - - - - - - - - →│  Secondary  │
│  App Point  │                    │  App Point  │
└─────────────┘         ↑         └─────────────┘
                        ╎
                  ┌─────┴─────┐
                  │   User    │
                  └───────────┘

Legend:
- - - →  Dotted line between primary and secondary App_Business_Points
   ╎     Dotted line from user to midpoint of main line
```

#### Case 2: One App_Business_Point Referenced

```
┌─────────────┐
│    User     │
└──────┬──────┘
       ╎
       ╎ (dotted line)
       ↓
┌─────────────┐
│  App Point  │
└─────────────┘
```

If the user node is not yet on the diagram, prompt the user to add it.

### 3.4 Z-Index Handling

- User Interaction dotted lines use the same z-index rendering pipeline as diagram edges
- They are rendered after nodes but respect the unified z-index ordering
- Use `getSortedRenderOrder()` pattern from existing edge rendering

## 4. Advanced Add Integration

### 4.1 Expandable Relationships

**File**: `frontend/src/utils/advancedAddRelationships.ts`

```typescript
[ENTITY_TYPES.INTERACTION]: [
  {
    relationshipType: 'user',
    childEntityType: ENTITY_TYPES.BUSINESS_USER,
    labelPrefix: 'User: ',
    getChildren: (entity: Interaction, metaModel: MetaModel) => {
      const user = metaModel.entities.business_users.find(u => u.id === entity.user_id);
      return user ? [user] : [];
    },
  },
  {
    relationshipType: 'primary_app_business_point',
    childEntityType: null, // Polymorphic - resolved at runtime
    labelPrefix: 'Primary: ',
    getChildren: (entity: Interaction, metaModel: MetaModel) => {
      const resolved = resolveAppBusinessPoint(entity.primary_app_business_point_id, metaModel);
      return resolved ? [resolved.entity] : [];
    },
  },
  {
    relationshipType: 'secondary_app_business_point',
    childEntityType: null, // Polymorphic - resolved at runtime
    labelPrefix: 'Secondary: ',
    getChildren: (entity: Interaction, metaModel: MetaModel) => {
      if (!entity.secondary_app_business_point_id) return [];
      const resolved = resolveAppBusinessPoint(entity.secondary_app_business_point_id, metaModel);
      return resolved ? [resolved.entity] : [];
    },
  },
],
```

### 4.2 Tree Display

The Advanced Add dialog tree for an Interaction shows:

```
▸ Login Interaction
  ├── User: John Smith (Business User)
  ├── Primary: Login Page (Interface)
  └── Secondary: Auth Service (Service)
```

### 4.3 Selection and Rendering

When nodes are selected and added:
1. Create DiagramNodes for each selected entity
2. If Interaction is selected with its children:
   - Create a DiagramUserInteraction record
   - Link node IDs for primary, secondary, and user
   - Render dotted lines according to rules in Section 3.3

## 5. Validation Rules

### 5.1 Interaction Validation

A valid Interaction MUST have:
- `user_id` (required FK to BusinessUser)
- `primary_app_business_point_id` (required FK to App_Business_Point)
- `secondary_app_business_point_id` (optional FK to App_Business_Point)

### 5.2 Validation Errors

| Condition | Error Message |
|-----------|---------------|
| Missing user_id | "Interaction '{name}' is missing a user" |
| Missing primary_app_business_point_id | "Interaction '{name}' is missing primary point" |
| Invalid user_id reference | "Interaction '{name}' references non-existent user" |
| Invalid primary reference | "Interaction '{name}' references non-existent primary point" |
| Invalid secondary reference | "Interaction '{name}' references non-existent secondary point" |

## 6. Show/Hide Toggle (Optional Enhancement)

### 6.1 Palette Toggle

Add a toggle in the palette panel:

```
☑ Show User Interactions
```

When unchecked, all dotted interaction lines are hidden but the underlying data is preserved.

### 6.2 State Storage

Store in diagram view state (not persisted):

```typescript
interface DiagramViewState {
  showUserInteractions: boolean; // default: true
}
```

## 7. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add Interaction interface, AppBusinessPointEntityType, DiagramUserInteraction, update unions |
| `frontend/src/utils/paletteData.ts` | Add 'user_interactions' section, update getEntityTypeConstant |
| `frontend/src/utils/advancedAddRelationships.ts` | Add INTERACTION expandable relationships |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add user interaction line rendering |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Handle Interaction entity type, add toggle |
| `frontend/src/utils/validation.ts` | Add Interaction validation rules |
| `frontend/src/utils/rendering.ts` | Register INTERACTION in entityTypeMap |

## 8. Acceptance Criteria

### AC1: Interaction Entity
- [ ] Interaction interface defined in model.ts
- [ ] ENTITY_TYPES.INTERACTION added
- [ ] MetaModelEntities includes interactions array
- [ ] EntityType union includes 'interactions'

### AC2: App_Business_Point Super-Type
- [ ] AppBusinessPointEntityType union defined
- [ ] APP_BUSINESS_POINT_TYPES array defined
- [ ] isAppBusinessPointType() helper works correctly
- [ ] resolveAppBusinessPoint() resolves to correct entity

### AC3: Palette Integration
- [ ] "User Interactions" section appears in palette
- [ ] Section positioned after Process Activities, before Applications
- [ ] Interactions can be clicked to add to diagram
- [ ] Context menu works for Interactions

### AC4: Diagram Rendering
- [ ] DiagramUserInteraction stored in diagram JSON
- [ ] Dotted lines render between nodes
- [ ] User-to-midpoint line renders when applicable
- [ ] Lines respect z-index ordering

### AC5: Advanced Add
- [ ] Interaction appears in Advanced Add tree
- [ ] User, primary, and secondary children shown
- [ ] Polymorphic resolution displays correct entity types
- [ ] Selection creates correct node and interaction records

### AC6: Validation
- [ ] Missing user_id produces error
- [ ] Missing primary point produces error
- [ ] Invalid references produce errors
- [ ] Error messages include entity names

### AC7: Show/Hide Toggle (Optional)
- [ ] Toggle present in palette
- [ ] Toggling hides/shows interaction lines
- [ ] State not persisted (view-only)

## 9. Implementation Order

1. **Phase 1: Type Definitions**
   - Add Interaction interface
   - Add App_Business_Point types and helpers
   - Add DiagramUserInteraction interface

2. **Phase 2: Palette Integration**
   - Add user_interactions section
   - Update getEntityTypeConstant
   - Register in rendering.ts

3. **Phase 3: Diagram Rendering**
   - Add user interaction line rendering
   - Implement z-index integration
   - Handle edge cases (missing nodes)

4. **Phase 4: Advanced Add**
   - Add expandable relationships
   - Handle polymorphic resolution
   - Create interaction records on add

5. **Phase 5: Validation**
   - Add validation rules
   - Integrate with validation dialog

6. **Phase 6: Show/Hide Toggle** (Optional)
   - Add toggle UI
   - Implement visibility filtering
