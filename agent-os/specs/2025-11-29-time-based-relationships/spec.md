# Specification: Time-Based Relationships and Diagram Filtering

## Goal

Extend the time-based behaviour of the SDD Architecture Store so that:
1. Relationships (not just entities) can change over time via `valid_from`/`valid_to` fields
2. Diagrams correctly show/hide nodes and edges based on a selected "architecture date"
3. Temporal disappearance (via `valid_to`) is clearly separated from actual deletion in the meta-model

## User Stories

- As an architect, I want relationships to have validity periods so I can model process migrations between applications over time.
- As a user, I want diagrams to automatically filter nodes and edges based on the selected time period so I see the correct architecture for any point in time.
- As a user, I want temporal disappearance (out-of-scope for current date) to be distinct from deletion (removed from model) so I can view historical and future architectures.

## Design Principle

**Unified temporal semantics across entities and relationships.**

- All relationship types gain optional `valid_from`/`valid_to` fields
- Same quarter format as entities: `"YYYY-Qn"` (e.g., `"2026-Q3"`)
- Diagram filtering applies to both nodes (entities) and edges (relationships)
- Cascade delete on entity removal maintains referential integrity
- No schema version changes - fields are optional for backward compatibility

## Current State

### Entities with Temporal Fields
The following entities already have `valid_from`/`valid_to`:
- `BusinessProcess`
- `Application`
- `ApplicationComponent`
- `Service`
- `ApplicationPoint`
- `LogicalDataEntity`
- `PhysicalDataEntity`
- `DataMovement` (this is the ONLY relationship with temporal fields currently)

### Relationships WITHOUT Temporal Fields (to be added)
- `BusinessUserProcess`
- `ApplicationPointBusinessProcess`
- `LogicalDataEntityRelationship`
- `LogicalDataEntityPhysicalDataEntity`
- `LogicalDataAttributePhysicalDataAttribute`

### Existing Utilities
- `quarterUtils.ts`: `compareQuarters()`, `isEntityVisibleInPeriod()`, `isRelationshipVisibleInPeriod()`
- `rendering.ts`: `getNodesInRenderOrder()`, `getEdgesForDiagram()` with viewQuarter filtering
- `applicationPointSync.ts`: `cascadeDeleteApplicationPoint()`, `cascadeDeleteForSourceEntity()`

## Specific Requirements

### 1. Add valid_from / valid_to to All Relationship Types

#### 1.1 Type Definitions

Add optional temporal fields to all relationship interfaces in `model.ts`:

```typescript
// BusinessUserProcess
export interface BusinessUserProcess {
  id: string;
  business_user_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// ApplicationPointBusinessProcess
export interface ApplicationPointBusinessProcess {
  id: string;
  application_point_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// LogicalDataEntityRelationship
export interface LogicalDataEntityRelationship {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// LogicalDataEntityPhysicalDataEntity
export interface LogicalDataEntityPhysicalDataEntity {
  id: string;
  logical_entity_id: string;
  physical_entity_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}

// LogicalDataAttributePhysicalDataAttribute
export interface LogicalDataAttributePhysicalDataAttribute {
  id: string;
  logical_attribute_id: string;
  physical_attribute_id: string;
  description: string;
  tags: string;
  // Temporal validity fields - format: "YYYY-Qn" (e.g., "2026-Q2")
  valid_from?: string;
  valid_to?: string;
}
```

#### 1.2 Temporal Semantics

Same conventions as existing entity temporal fields:

- **Format:** `"YYYY-Qn"` where n is 1, 2, 3, or 4 (e.g., `"2026-Q3"`)
- **Interpretation:** The diagram date T is "end of the selected period"
  - Period = Year, value "2026" → T = end of 2026 (= `"2026-Q4"`)
  - Period = Half, value "H1 2026" → T = end of H1 2026 (= `"2026-Q2"`)
  - Period = Quarter, "Q3 2026" → T = end of Q3 2026 (= `"2026-Q3"`)
- **Null/omitted:** Relationship is valid at all dates (timeless)

#### 1.3 JSON Examples

**business_user_processes:**
```json
{
  "id": "bup_1",
  "business_user_id": "bu_trader",
  "business_process_id": "bp_quote",
  "description": "Trader executes quote process",
  "tags": "",
  "valid_from": "2024-Q1",
  "valid_to": null
}
```

**application_point_business_processes:**
```json
{
  "id": "apbp_1",
  "application_point_id": "ap_oms_legacy",
  "business_process_id": "bp_pricing",
  "description": "Legacy OMS supports pricing",
  "tags": "",
  "valid_from": null,
  "valid_to": "2026-Q2"
}
```

**data_movements:** (already has temporal fields)
```json
{
  "id": "dm_trade_oms_to_risk",
  "source_application_id": "ap_oms_legacy",
  "target_application_id": "ap_risk_store",
  "data_entity_id": "lde_trade",
  "movement_type": "ASYNC",
  "description": "Trade flow to risk",
  "tags": "",
  "valid_from": "2025-Q1",
  "valid_to": "2027-Q4"
}
```

### 2. Representing Changes Over Time

#### 2.1 Multiple Rows Pattern

To model a relationship that changes over time (e.g., a process moves from one application to another), use multiple rows with different time windows. Do NOT mutate existing rows.

**Example: Business process `bp_pricing` moves from legacy OMS to target OMS in 2026-Q3:**

```json
[
  {
    "id": "apbp_legacy",
    "application_point_id": "ap_oms_legacy",
    "business_process_id": "bp_pricing",
    "description": "Legacy OMS supports pricing (until migration)",
    "tags": "",
    "valid_from": null,
    "valid_to": "2026-Q2"
  },
  {
    "id": "apbp_target",
    "application_point_id": "ap_oms_target",
    "business_process_id": "bp_pricing",
    "description": "Target OMS supports pricing (after migration)",
    "tags": "",
    "valid_from": "2026-Q3",
    "valid_to": null
  }
]
```

**Diagram views at different dates:**
- End of 2025 → Edge between `ap_oms_legacy` and `bp_pricing`
- End of 2027 → Edge between `ap_oms_target` and `bp_pricing`

#### 2.2 No Edit-Over-Time Logic

This is purely filter-based:
- No special UI for "edit relationship at time T"
- Users manually create multiple relationship rows with appropriate validity windows
- Diagram filtering shows the correct row(s) for the selected date

### 3. Diagram Filtering Rules

#### 3.1 Determine Effective Diagram Date T

From the existing Period controls:
- **Quarter:** `view_quarter` value directly (e.g., `"2026-Q3"`)
- **Half:** Normalise to end-of-half quarter (Q2 or Q4)
- **Year:** Normalise to end-of-year quarter (Q4)

All `valid_from`/`valid_to` comparisons use this T.

#### 3.2 Entity Visibility (Nodes)

For an entity E with `valid_from` and `valid_to`:

**E is valid at T if:**
```
(valid_from is null OR valid_from <= T) AND
(valid_to is null OR valid_to > T)
```

**Important:** Using existing `isEntityVisibleInPeriod()` logic:
- `valid_from` is **inclusive** (entity appears at this quarter)
- `valid_to` is **exclusive** (entity disappears after this quarter, i.e., visible up to but not including this quarter)

**Diagram Node Visibility:**
- A `diagram_node` referencing entity E (via `entity_type`/`entity_id`) is drawn only if E is valid at T
- If entity is not valid at T → node is not rendered for that time slice

#### 3.3 Relationship Visibility (Edges)

For a relationship R with `valid_from` and `valid_to`:

**R is valid at T if:**
```
(valid_from is null OR valid_from <= T) AND
(valid_to is null OR valid_to > T)
```

**PLUS all endpoints must be valid at T.**

**Endpoint Validation by Relationship Type:**

| Relationship Type | Endpoints to Validate |
|---|---|
| `business_user_processes` | `business_user_id` (BusinessUser), `business_process_id` (BusinessProcess) |
| `application_point_business_processes` | `application_point_id` (ApplicationPoint), `business_process_id` (BusinessProcess) |
| `logical_data_entity_relationships` | `source_entity_id` (LogicalDataEntity), `target_entity_id` (LogicalDataEntity) |
| `logical_data_entity_physical_data_entities` | `logical_entity_id` (LogicalDataEntity), `physical_entity_id` (PhysicalDataEntity) |
| `logical_data_attribute_physical_data_attributes` | `logical_attribute_id` (LogicalDataAttribute), `physical_attribute_id` (PhysicalDataAttribute) |
| `data_movements` | `source_application_id` (Application), `target_application_id` (Application), optionally `data_entity_id` (LogicalDataEntity) |

**Note:** `BusinessUser`, `LogicalDataAttribute`, and `PhysicalDataAttribute` do not have temporal fields, so they are always considered valid (timeless).

#### 3.4 Diagram Edge Rendering

`diagram_edges` are layout metadata referencing relationships via `relationship_type` + `relationship_id`.

**At render time for date T:**
1. Look up the underlying relationship R by `relationship_id`
2. Check if R is valid at T using `isRelationshipVisibleInPeriod()`
3. Check if all endpoint entities are valid at T using `isEntityVisibleInPeriod()`
4. If R is not valid OR any endpoint is not valid → **skip drawing** the edge
5. Layout data remains stored but is unused for that time slice

**Same principle for `diagram_nodes` referencing entities.**

### 4. Temporal Disappearance vs Actual Deletion

#### 4.1 Temporal Disappearance

When an entity or relationship has a `valid_to` in the past relative to T:
- It does not appear in the diagram for T (filtered out by rules above)
- **Nothing is deleted** from the JSON model
- Viewing different dates shows different architectures
- Historical information remains intact

#### 4.2 Actual Deletion from Meta-Model

When the user explicitly deletes an entity from the meta-model grid:

**Cascade Delete Rules:**

| Entity Type | Cascade Deletes |
|---|---|
| BusinessUser | All `business_user_processes` where `business_user_id` = deleted ID |
| BusinessProcess | All `business_user_processes` where `business_process_id` = deleted ID |
| | All `application_point_business_processes` where `business_process_id` = deleted ID |
| Application | All `data_movements` where `source_application_id` or `target_application_id` = deleted ID |
| | Derived ApplicationPoint (and its cascade deletes) |
| ApplicationComponent | Derived ApplicationPoint (and its cascade deletes) |
| Service | Derived ApplicationPoint (and its cascade deletes) |
| ApplicationPoint | All `application_point_business_processes` where `application_point_id` = deleted ID |
| LogicalDataEntity | All `logical_data_entity_relationships` where `source_entity_id` or `target_entity_id` = deleted ID |
| | All `logical_data_entity_physical_data_entities` where `logical_entity_id` = deleted ID |
| | All `data_movements` where `data_entity_id` = deleted ID |
| PhysicalDataEntity | All `logical_data_entity_physical_data_entities` where `physical_entity_id` = deleted ID |
| LogicalDataAttribute | All `logical_data_attribute_physical_data_attributes` where `logical_attribute_id` = deleted ID |
| PhysicalDataAttribute | All `logical_data_attribute_physical_data_attributes` where `physical_attribute_id` = deleted ID |

**Key Distinction:**
- **Temporal:** Controlled by `valid_from`/`valid_to`, handled at render-time
- **Deletion:** Row removed from JSON, relationships referencing it are also removed

### 5. Implementation Approach

#### Phase 1: Type Definitions
- Add `valid_from`/`valid_to` to all relationship interfaces in `model.ts`
- No changes to existing utilities (already handle optional temporal fields)

#### Phase 2: Enhanced Diagram Filtering
- Update `getEdgesForDiagram()` in `rendering.ts` to validate endpoint entities
- Ensure all relationship types are filtered correctly by time
- Add endpoint validation for each relationship type

#### Phase 3: Cascade Delete Enhancement
- Extend `cascadeDeleteForSourceEntity()` to handle all entity types
- Add cascade delete for BusinessProcess, LogicalDataEntity, etc.
- Ensure FK consistency after any entity deletion

#### Phase 4: Testing
- Test relationship temporal filtering
- Test endpoint validation (relationship hidden when endpoint is hidden)
- Test cascade delete for all entity types
- Test combined scenarios (temporal + actual deletion)

### 6. Existing Code to Leverage

**model.ts - Type Definitions**
- Add temporal fields to relationship interfaces

**quarterUtils.ts - Temporal Utilities**
- `isRelationshipVisibleInPeriod()` - already exists, handles optional temporal fields
- `isEntityVisibleInPeriod()` - already exists, used for endpoint validation

**rendering.ts - Diagram Rendering**
- `getNodesInRenderOrder()` - already filters nodes by viewQuarter
- `getEdgesForDiagram()` - needs enhancement for endpoint validation

**applicationPointSync.ts - Cascade Delete**
- `cascadeDeleteApplicationPoint()` - extend to other relationship types
- `cascadeDeleteForSourceEntity()` - extend to all entity types

**ArchitectureContext.tsx - State Management**
- `DELETE_ENTITY` action - ensure cascade delete is called for all types

## Acceptance Criteria

### Relationship Temporal Fields
- [ ] All relationship types include optional `valid_from` and `valid_to` fields
- [ ] Temporal fields use same format as entities: `"YYYY-Qn"`
- [ ] Existing data without temporal fields continues to work (timeless)

### Diagram Filtering - Nodes
- [ ] Nodes are shown only if their entity's validity window contains T
- [ ] Nodes with timeless entities are always shown
- [ ] Changing the view quarter immediately updates node visibility

### Diagram Filtering - Edges
- [ ] Edges are shown only if the relationship's validity window contains T
- [ ] Edges are hidden if ANY endpoint entity is not valid at T
- [ ] Edges with timeless relationships AND timeless endpoints are always shown
- [ ] Changing the view quarter immediately updates edge visibility

### Time-Based Changes
- [ ] Multiple relationship rows with different validity windows work correctly
- [ ] Process migration scenario: edge shows with legacy app before changeover, target app after
- [ ] No overlap errors when validity windows are adjacent (e.g., `valid_to: "2026-Q2"` and `valid_from: "2026-Q3"`)

### Cascade Delete
- [ ] Deleting BusinessUser cascades to `business_user_processes`
- [ ] Deleting BusinessProcess cascades to `business_user_processes` and `application_point_business_processes`
- [ ] Deleting Application/AppComponent/Service cascades through ApplicationPoint
- [ ] Deleting LogicalDataEntity cascades to relationships and data_movements
- [ ] Deleting PhysicalDataEntity cascades to mapping relationships
- [ ] Deleting LogicalDataAttribute/PhysicalDataAttribute cascades to mapping relationships

### Temporal vs Deletion Distinction
- [ ] Setting `valid_to` to past quarter hides element but keeps it in JSON
- [ ] Actually deleting an entity removes it and its relationships from JSON
- [ ] Changing view quarter shows/hides elements based on temporal fields
- [ ] Deleted elements cannot be recovered by changing view quarter

## Out of Scope

- Validation panel warning for non-overlapping validity windows
- UI for "edit relationship at specific time T"
- Undo/redo for cascade deletes
- Batch temporal updates
- Import/export with temporal field transformations

## TypeScript Types Summary

### New/Modified Types

```typescript
// All relationship interfaces gain these optional fields:
interface TemporalFields {
  valid_from?: string;  // Format: "YYYY-Qn"
  valid_to?: string;    // Format: "YYYY-Qn"
}

// BusinessUserProcess extends with TemporalFields
// ApplicationPointBusinessProcess extends with TemporalFields
// LogicalDataEntityRelationship extends with TemporalFields
// LogicalDataEntityPhysicalDataEntity extends with TemporalFields
// LogicalDataAttributePhysicalDataAttribute extends with TemporalFields
// DataMovement already has these fields
```

### No New Helper Types Required

Existing utilities handle optional temporal fields gracefully.
