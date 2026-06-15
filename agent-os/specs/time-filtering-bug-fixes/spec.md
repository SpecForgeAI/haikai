# Specification: Time-Filtering Bug Fixes

## Goal
Fix two critical bugs in the time-based filtering implementation that cause objects to incorrectly appear or disappear when filtering diagrams by quarter.

## User Stories
- As a user, when I set a diagram to "End of 2026" (2026-Q4), any entity or relationship with valid_to = "2026-Q4" should disappear because the exclusive end date has been reached
- As a user, entities and relationships with no valid_from/valid_to fields should always remain visible across all time periods since they are timeless

## Specific Requirements

**Quarter parsing must be case-insensitive and robust**
- Modify parseQuarter() in quarterUtils.ts to accept both uppercase and lowercase "Q" (e.g., "2026-Q4" and "2026-q4")
- Change regex pattern from /^(\d{4})-Q([1-4])$/ to /^(\d{4})-[Qq]([1-4])$/
- When parsing fails, treat the field as null (timeless) rather than throwing an error
- Add optional non-blocking warning logging for unparseable values that can be displayed in UI later
- Ensure objects with unparseable dates are never silently hidden

**Fix exclusive valid_to comparison logic**
- Current bug: compareQuarters(valid_to, viewQuarter) <= 0 hides objects when valid_to equals viewQuarter
- Correct logic: valid_to > viewQuarter means object is still visible
- In isEntityVisibleInPeriod() and isRelationshipVisibleInPeriod(), change the valid_to check from compareQuarters(valid_to, viewQuarter) <= 0 to compareQuarters(valid_to, viewQuarter) <= 0
- The condition should return false (not visible) when valid_to <= viewQuarter
- This ensures objects disappear at the end of their valid_to quarter, not one quarter later

**Objects with no temporal fields must always be visible**
- Add early-exit check in isEntityVisibleInPeriod() and isRelationshipVisibleInPeriod()
- If both valid_from and valid_to are null or undefined, immediately return true before any comparison logic
- This ensures timeless objects are never filtered out by time-based logic
- Apply same logic for edges: if the underlying relationship has no temporal fields, the edge should remain visible (subject only to node visibility)

**Edge visibility depends on relationship AND node visibility**
- In getEdgesForDiagram(), when checking relationship visibility, if relationship is not found in model, treat as timeless (return true for visibility) rather than hiding the edge
- Continue to check that both source_node and target_node are in the visibleNodeIds set
- An edge is only rendered if: relationship is time-visible AND both endpoint nodes are time-visible
- For relationships with no valid_* fields, skip time filtering entirely (treat as always valid)

**Update compareQuarters to handle case-insensitive input**
- Since parseQuarter() now accepts case-insensitive input, compareQuarters() will automatically work with lowercase quarter strings
- No changes needed to compareQuarters() logic itself, as it delegates to parseQuarter()

**Add validation warnings without blocking visibility**
- When parseQuarter() encounters an invalid format, log a console warning with the invalid value
- Store these warnings in a way that could be displayed in the UI later (future enhancement)
- Never let validation warnings cause objects to be hidden

## Existing Code to Leverage

**C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\quarterUtils.ts**
- parseQuarter() function at lines 13-21 needs case-insensitive regex update
- isEntityVisibleInPeriod() at lines 61-98 needs valid_to comparison fix and null-check optimization
- isRelationshipVisibleInPeriod() at lines 108-145 needs valid_to comparison fix and null-check optimization
- compareQuarters() at lines 30-50 handles the comparison logic correctly once parsing is fixed

**C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\rendering.ts**
- getNodesInRenderOrder() at lines 470-520 correctly filters nodes by entity temporal validity
- getEdgesForDiagram() at lines 531-570 needs fix for relationship lookup failure handling (treat missing relationship as timeless)
- getEntity() and getRelationship() helper functions at lines 62-88 are used for looking up temporal data

**C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\Canvas.tsx**
- Lines 207-217 show how time-filtering is applied to nodes and edges using view_quarter from diagram
- Uses getNodesInRenderOrder() and getEdgesForDiagram() with viewQuarter parameter
- No changes needed to Canvas.tsx, fixes are isolated to utility functions

**C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts**
- Entity types with temporal fields: BusinessProcess, Application, ApplicationComponent, Service, ApplicationPoint, LogicalDataEntity, PhysicalDataEntity, DataMovement
- All have optional valid_from and valid_to as string fields
- Relationship types: most do NOT have temporal fields except DataMovement which has valid_from and valid_to

## Out of Scope
- Adding temporal fields to relationships that currently do not have them
- Changing the quarter format from strings to structured objects
- Adding UI for displaying validation warnings
- Implementing quarter validation in the grid view or forms
- Adding time-filtering to other views beyond the Canvas diagram view
- Modifying the period selector or time navigation controls
- Changes to how view_quarter is stored or updated in diagrams
- Performance optimization of time-filtering logic
- Adding tests for edge cases beyond the two reported bugs
- Backward compatibility with invalid quarter formats in existing data
