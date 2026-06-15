# Raw Idea: File Mode JSON Export/Import Fix

## Problem
In File Mode (`includeDatabase=false`):
1. JSON Export returns blank/stale data - exports from backend session store instead of current UI state
2. JSON Import doesn't load model - tries `loadModelByFilename()` which fails in File Mode

## Root Cause
- Export calls `exportSessionSnapshot()` which returns backend's stored snapshot, not `ArchitectureContext.state.model`
- Import's `handleImportSuccess()` tries DB-mode `loadModelByFilename()`, silently fails, never loads model

## User Decisions
1. **Export Source:** Build snapshot from ArchitectureContext only (state.model with metaModel + diagrams)
2. **Import Load:** Pass full snapshot through modal callback to handleImportSuccess

## Solution
### Export Fix
- In File Mode, build snapshot locally from `ArchitectureContext.state.model`
- Don't call backend `exportSessionSnapshot()`

### Import Fix
- Change `ImportProjectSnapshotModal.onImported` callback to pass full snapshot
- In File Mode, dispatch `LOAD_MODEL` with snapshot.model instead of calling `loadModelByFilename()`
