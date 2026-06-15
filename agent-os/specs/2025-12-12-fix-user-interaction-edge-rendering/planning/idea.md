# Idea: Fix Rendering of USER_INTERACTION Edges in getEdgesForDiagram

## Summary

User Interaction edges are being created correctly in the diagram state, but are never rendered on the canvas. The bug is in the edge-filtering logic in `getEdgesForDiagram`, which assumes all relationship-backed edges can be resolved via `relationshipTypeMap` → `metaModel.relationships`. USER_INTERACTION, however, is stored in `metaModel.entities.interactions`, so the lookup fails and the edge is filtered out.

This spec defines how USER_INTERACTION edges MUST be resolved during rendering so they are included in `getEdgesForDiagram()` and drawn as dotted lines.

## Root Cause

When `getEdgesForDiagram()` processes edges:
1. It calls `getRelationship("USER_INTERACTION", relationship_id, model)`
2. `getRelationship()` uses `relationshipTypeMap["USER_INTERACTION"]` to find the collection
3. `USER_INTERACTION` is NOT in `relationshipTypeMap`
4. Returns `undefined`, edge filtered out with `relationship_not_found`

## The Fix

Either:
1. Extend `relationshipTypeMap` to support both `relationships` and `entities` collections
2. Or add special-case handling for `USER_INTERACTION` in `getRelationship()`

## Acceptance Criteria

1. `getRelationship("USER_INTERACTION", id, model)` returns the Interaction from `model.metaModel.entities.interactions`
2. USER_INTERACTION edges are included in `getEdgesForDiagram()` results
3. Dotted lines appear on the canvas when User Interactions are added
4. No regression for existing relationship types
