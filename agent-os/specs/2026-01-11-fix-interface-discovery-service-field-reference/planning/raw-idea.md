title: Fix InterfaceDiscoveryService Field Name Reference
date: 2026-01-11
owner: architecture-meta-model
type: bugfix

## Goal
Fix Java compile error in `InterfaceDiscoveryService.java` caused by reference to renamed field `getLogicalEntityId()` which is now `getDataEntityPointId()`.

## Rationale
The Interface Entity Relationship Refactor spec renamed `logicalEntityId` to `dataEntityPointId` in `InterfaceLogicalEntityEntity.java`, but `InterfaceDiscoveryService.java` still references the old getter method `getLogicalEntityId()`, causing a compilation failure.

## Error Details

```
[ERROR] /C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java:[198,69] cannot find symbol
  symbol:   method getLogicalEntityId()
  location: variable ile of type com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity
```

## Scope
### In-scope
- Update `InterfaceDiscoveryService.java` to use `getDataEntityPointId()` instead of `getLogicalEntityId()`
- Handle the new ID format (`dep_log_<id>` or `dep_phy_<id>` prefix) if needed

### Out-of-scope
- Changes to other services
- Frontend changes
- New functionality

## Required Changes

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java`

**Line 198:** Replace `ile.getLogicalEntityId()` with appropriate handling for the new `dataEntityPointId` field.

The new field format is:
- `dep_log_<logicalEntityId>` for logical data entities
- `dep_phy_<physicalEntityId>` for physical data entities

If the service needs the raw entity ID, it should:
1. Call `ile.getDataEntityPointId()`
2. Strip the `dep_log_` or `dep_phy_` prefix to get the actual entity ID
3. Or use the full prefixed ID if that's what downstream logic expects

## Acceptance Criteria
1. `mvn compile` succeeds without errors
2. Interface discovery functionality continues to work correctly
3. The service correctly handles both logical and physical data entity references
