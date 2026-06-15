# Raw Idea

## Title
Fix Interactions relationship configuration to avoid RelationshipGrid crash

## Summary
After reclassifying Interactions as a relationship and adding it to the Relationships top bar, clicking the "Interactions" tab causes a white screen and this error:

  RelationshipGrid.tsx:78 Uncaught TypeError: Cannot read properties of undefined (reading 'map')

This indicates that RelationshipGrid is expecting relationship data at `metaModel.relationships["interactions"]`, but Interactions data is actually stored in `metaModel.entities.interactions`.

## Solution Implemented

**Route Interactions through EntityGrid instead of RelationshipGrid:**

1. Remove "Interactions" from `relationshipTabNames` array
2. Remove "Interactions" from `relationshipTabToType` mapping
3. Add "Interactions" to `entityTabNames` array (after "Activities")
4. Add "Interactions" to `domainGroupings.business` array
5. Keep existing `tabToEntityType["Interactions"]` mapping for EntityGrid data access

**Add defensive handling in RelationshipGrid:**
- Guard against missing columns configuration
- Guard against missing relationships data
- Return friendly error message instead of crashing

## Key Changes

### 1. gridConfigs.ts - Tab Configuration
- `entityTabNames`: Added "Interactions" after "Activities"
- `domainGroupings.business`: Now includes "Interactions"
- `relationshipTabNames`: Removed "Interactions"
- `relationshipTabToType`: Removed "Interactions" mapping

### 2. RelationshipGrid.tsx - Defensive Handling
- Added null check for `columns` before rendering
- Added null check for `relationships` before mapping
- Returns styled error UI with relationship type name

## Acceptance Criteria
- AC1: No more white screen when clicking Interactions tab
- AC2: Interactions tab appears in Business domain (Entities row)
- AC3: Interactions grid shows correctly with all columns via EntityGrid
- AC4: RelationshipGrid is robust against missing configs
- AC5: Other relationship tabs continue to work correctly

## Context
Working directory: C:\Workspaces\SSD\architecture-store-and-diagrams
