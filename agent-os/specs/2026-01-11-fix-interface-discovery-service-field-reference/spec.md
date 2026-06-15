# Specification: Fix InterfaceDiscoveryService Field Name Reference

## Goal
Fix Java compilation error in `InterfaceDiscoveryService.java` caused by reference to renamed field `getLogicalEntityId()` which is now `getDataEntityPointId()`.

## User Stories
- As a developer, I want the codebase to compile successfully so that I can build and deploy the application
- As a system user, I want interface discovery to correctly resolve logical entity references so that OAS context generation works properly

## Specific Requirements

**Fix compilation error at line 198**
- Replace `ile.getLogicalEntityId()` with `ile.getDataEntityPointId()`
- The new field returns a prefixed ID format (e.g., `dep_log_<entityId>` or `dep_phy_<entityId>`)
- Extract the raw entity ID by stripping the prefix before calling the repository

**Parse dataEntityPointId prefix format**
- Check for `dep_log_` prefix to identify logical data entities
- Check for `dep_phy_` prefix to identify physical data entities
- Use `substring()` to extract the raw entity ID after the prefix
- Handle null values by returning `Optional.empty()`

**Handle logical entities (dep_log_ prefix)**
- Strip the `dep_log_` prefix to get the raw logical entity ID
- Call `logicalDataEntityRepository.findById(rawId)` with the extracted ID
- Continue with existing logic to build `LogicalEntitySchemaDto`

**Handle physical entities (dep_phy_ prefix) gracefully**
- Physical entity support is out of scope for this bugfix
- Return `Optional.empty()` for physical entity references (filtered out by existing `.filter(Objects::nonNull)`)
- Log a debug message indicating the physical entity was skipped

**Handle unknown prefix format**
- Log a warning for unexpected `dataEntityPointId` formats
- Return `Optional.empty()` to filter out malformed references
- Do not throw exceptions to avoid breaking the entire endpoint response

## Visual Design
No visual assets provided - this is a backend code fix only.

## Existing Code to Leverage

**DataEntityPointEnsureService prefix constants**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DataEntityPointEnsureService.java`
- Defines `LOGICAL_PREFIX = "dep_log_"` and `PHYSICAL_PREFIX = "dep_phy_"` constants
- Follow the same prefix naming convention for consistency
- Can inline the prefix strings directly in InterfaceDiscoveryService (no shared utility exists)

**InterfaceLogicalEntityEntity.getDataEntityPointId()**
- File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/InterfaceLogicalEntityEntity.java`
- The new getter method that returns the prefixed ID format
- Column: `data_entity_point_id`, non-nullable
- Already has Lombok-generated getter via `@Getter` annotation

**Existing stream processing pattern in InterfaceDiscoveryService**
- Lines 194-243 already use a stream with `.map()` returning null for missing entities
- Existing `.filter(Objects::nonNull)` removes nulls from the result
- Physical entities can safely return null to be filtered out

## Out of Scope
- Adding full physical entity support to OAS context (would require new PhysicalEntitySchemaDto, PhysicalAttributeDto DTOs)
- Adding physicalEntities field to InterfaceOasContextDto
- Creating shared utility methods for prefix parsing
- Changes to other services
- Frontend changes
- New repository methods for physical entities
- Database schema changes
- Unit test updates (existing tests should pass with the fix)
- API response format changes
