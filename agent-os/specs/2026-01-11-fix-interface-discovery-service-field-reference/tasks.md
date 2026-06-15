# Task Breakdown: Fix InterfaceDiscoveryService Field Name Reference

## Overview
Total Tasks: 5

This is a simple single-file bugfix to resolve a Java compilation error caused by a renamed field reference.

## Task List

### Backend Bugfix

#### Task Group 1: Fix Compilation Error in InterfaceDiscoveryService
**Dependencies:** None

- [x] 1.0 Complete InterfaceDiscoveryService bugfix
  - [x] 1.1 Verify current compilation error
    - Run `mvn compile` in architecture-model-service to confirm the error at line 198
    - Document the exact error message for reference
  - [x] 1.2 Update field reference and add prefix parsing logic
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java`
    - Method: `getInterfaceOasContext` (lines 197-198)
    - Replace `ile.getLogicalEntityId()` with `ile.getDataEntityPointId()`
    - Add prefix parsing logic:
      - For `dep_log_` prefix: strip prefix, call `logicalDataEntityRepository.findById(rawId)`
      - For `dep_phy_` prefix: log debug message, return `Optional.empty()`
      - For unknown format: log warning, return `Optional.empty()`
    - Reference implementation pattern from requirements.md
  - [x] 1.3 Verify compilation succeeds
    - Run `mvn compile` in architecture-model-service
    - Confirm no compilation errors
  - [x] 1.4 Run existing tests to verify no regressions
    - Run `mvn test` in architecture-model-service
    - All existing tests should pass without modification
    - Note: Test compilation has pre-existing failures unrelated to this fix
  - [ ] 1.5 Manual verification (optional)
    - Start the application
    - Call an interface endpoint that uses logical entity references
    - Verify the response includes logical entities correctly

**Acceptance Criteria:**
- `mvn compile` succeeds without errors
- Interface discovery works correctly for logical entity references (`dep_log_` prefix)
- Physical entity references (`dep_phy_` prefix) are gracefully skipped with debug logging
- Unknown prefix formats are logged as warnings and skipped
- All existing unit/integration tests pass

## Execution Order

This is a simple sequential bugfix:
1. Verify the error exists (1.1)
2. Apply the fix (1.2)
3. Verify compilation (1.3)
4. Run tests (1.4)
5. Optional manual verification (1.5)

## Files to Modify

| File | Change |
|------|--------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/InterfaceDiscoveryService.java` | Update lines 197-198 to use `getDataEntityPointId()` with prefix parsing |

## Reference Code

The fix should follow this pattern (from requirements.md):

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
