# Spec Requirements: Fix InterfaceDiscoveryService Field Name Reference

## Initial Description
Fix Java compile error in `InterfaceDiscoveryService.java` caused by reference to renamed field `getLogicalEntityId()` which is now `getDataEntityPointId()`.

The Interface Entity Relationship Refactor spec renamed `logicalEntityId` to `dataEntityPointId` in `InterfaceLogicalEntityEntity.java`, but `InterfaceDiscoveryService.java` still references the old getter method `getLogicalEntityId()`, causing a compilation failure.

## Requirements Discussion

### First Round Questions

**Q1:** What is the current behavior and where is the compilation error?
**Answer:** The error occurs at line 198 of `InterfaceDiscoveryService.java`:
```
[ERROR] /C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java:[198,69] cannot find symbol
  symbol:   method getLogicalEntityId()
  location: variable ile of type com.example.architecturemodel.model.entity.InterfaceLogicalEntityEntity
```

**Q2:** What is the new field name and format in InterfaceLogicalEntityEntity?
**Answer:** Based on code analysis of `InterfaceLogicalEntityEntity.java`:
- Field name: `dataEntityPointId` (replaces `logicalEntityId`)
- Getter method: `getDataEntityPointId()`
- Database column: `data_entity_point_id`
- Format:
  - `dep_log_<entityId>` for logical data entities
  - `dep_phy_<entityId>` for physical data entities

**Q3:** How does InterfaceDiscoveryService use the logical entity ID?
**Answer:** At line 197-198, the service:
1. Retrieves `InterfaceLogicalEntityEntity` objects for an interface
2. Uses the entity ID to look up the corresponding `LogicalDataEntityEntity` via `logicalDataEntityRepository.findById(ile.getLogicalEntityId())`
3. Builds a `LogicalEntitySchemaDto` with the entity's attributes

The current code ONLY supports logical entities - it passes the ID directly to `logicalDataEntityRepository.findById()`.

**Q4:** Does the service need the raw entity ID or can it use the prefixed format?
**Answer:** The service needs the RAW entity ID (without prefix) to call `logicalDataEntityRepository.findById()`. The repository method expects a plain entity ID, not the prefixed `dep_log_<id>` format.

### Existing Code to Reference

**Similar Features Identified:**
- The `dataEntityPointId` format follows the same pattern used in DataMovements elsewhere in the codebase
- Prefix parsing logic may exist in other services that handle the `dep_log_` / `dep_phy_` format

### Follow-up Questions

**Follow-up 1:** Should the fix also add support for physical entities (dep_phy_ prefix)?
**Answer:** Based on the scope defined in the raw idea, this is a MINIMAL fix to restore compilation. However, the current implementation has a limitation:
- The service currently ONLY loads `LogicalEntitySchemaDto` objects
- The `InterfaceOasContextDto` only has a `logicalEntities` field (no `physicalEntities`)
- Adding full physical entity support would require:
  1. New `PhysicalEntitySchemaDto` and `PhysicalAttributeDto` DTOs
  2. New field in `InterfaceOasContextDto` for physical entities
  3. Adding `findByPhysicalEntityId` method to `PhysicalDataAttributeRepository`
  4. Logic to distinguish and load both entity types

For this bugfix, we will:
1. Parse the prefix to extract the raw entity ID
2. For `dep_log_` prefixes: load logical entity (current behavior)
3. For `dep_phy_` prefixes: skip for now (return null, filtered out)
4. Log a warning for physical entities indicating future support needed

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a code-level bugfix, no UI changes required.

## Requirements Summary

### Functional Requirements
- Fix compilation error by updating field reference from `getLogicalEntityId()` to `getDataEntityPointId()`
- Parse the `dataEntityPointId` value to extract the raw entity ID (strip `dep_log_` or `dep_phy_` prefix)
- For logical entities (`dep_log_` prefix): continue current behavior - load entity and attributes
- For physical entities (`dep_phy_` prefix): gracefully skip (log warning, return null to be filtered)
- Maintain existing sorting and response structure

### Reusability Opportunities
- Check if a utility method exists for parsing `dep_log_`/`dep_phy_` prefixes that could be reused

### Scope Boundaries
**In Scope:**
- Update `InterfaceDiscoveryService.java` line 198 to use `getDataEntityPointId()`
- Add prefix parsing logic to extract raw entity ID
- Handle both `dep_log_` and `dep_phy_` prefixes gracefully

**Out of Scope:**
- Full physical entity support in OAS context (would require new DTOs and API changes)
- Changes to other services
- Frontend changes
- New functionality beyond the bugfix

### Technical Considerations

**Exact Code Change Location:**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java`
- Method: `getInterfaceOasContext(String interfaceId)`
- Lines 194-243 (the stream processing of `interfaceLogicalEntities`)

**Current Code (line 197-198):**
```java
Optional<LogicalDataEntityEntity> entityOpt =
        logicalDataEntityRepository.findById(ile.getLogicalEntityId());
```

**Required Change:**
Replace with logic that:
1. Gets the prefixed ID: `ile.getDataEntityPointId()`
2. Parses the prefix to determine entity type
3. Extracts the raw entity ID
4. For `dep_log_<id>`: calls `logicalDataEntityRepository.findById(rawId)`
5. For `dep_phy_<id>`: returns null (to be filtered) with optional warning log

**Suggested Implementation Approach:**
```java
String dataEntityPointId = ile.getDataEntityPointId();
Optional<LogicalDataEntityEntity> entityOpt;

if (dataEntityPointId != null && dataEntityPointId.startsWith("dep_log_")) {
    String rawId = dataEntityPointId.substring("dep_log_".length());
    entityOpt = logicalDataEntityRepository.findById(rawId);
} else if (dataEntityPointId != null && dataEntityPointId.startsWith("dep_phy_")) {
    // Physical entity support not yet implemented in OAS context
    log.debug("Skipping physical entity reference: {}", dataEntityPointId);
    entityOpt = Optional.empty();
} else {
    log.warn("Unknown dataEntityPointId format: {}", dataEntityPointId);
    entityOpt = Optional.empty();
}
```

### Acceptance Criteria
1. `mvn compile` succeeds without errors in the architecture-model-service module
2. Interface discovery functionality continues to work for logical entity references
3. Physical entity references are gracefully skipped (not causing errors)
4. Existing unit/integration tests pass
