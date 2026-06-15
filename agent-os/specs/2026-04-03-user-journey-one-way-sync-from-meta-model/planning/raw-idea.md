# Raw Idea: User Journey One-Way Sync from Meta-Model

## Summary
Convert saved USER_JOURNEY diagrams from independent snapshots into meta-model-linked diagram artifacts that can detect drift and be refreshed/regenerated from authoritative USER_JOURNEY and ACTIVITY_STEP data via one-way sync (meta-model -> diagram only).

## Motivation
- Increments 5-8 now exist with authoritative meta-model entities, temporary projections, and saved diagram artifacts
- Current saved-diagram behavior causes drift: editing/saving breaks live relationship to meta-model
- Need one-way sync: meta-model -> diagram, with refresh/regeneration support

## Scope
- Add source-link metadata to saved USER_JOURNEY diagram typed content
- Backend sync status detection and refresh/regenerate endpoints
- Frontend save/load/view flows with sync status and "Refresh from Model"
- Strictly one-way: meta-model -> diagram

## Out of Scope
- XLSX upload/parsing, bidirectional sync, auto-refresh, meta-model editing from diagram
- Rich diff/conflict resolution, background jobs, live streaming
- Sync for non-USER_JOURNEY diagram types

## Key Design Decisions
- Typed content version 2 with sync metadata object
- Backend canonical hash for drift detection
- Explicit user-triggered refresh only
- Legacy v1 diagrams render but show as unlinked
- USER_JOURNEY diagrams are view-oriented linked projections, not editable working copies
