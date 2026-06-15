# Idea: Frontend Backend File Integration

## Summary

Update the frontend File menu to use the new Java backend + PostgreSQL for opening and saving models via `/api/model` endpoints, while preserving existing local JSON/XLSX import/export flows under clearer menu labels.

## Current State

The File menu in `TopBar.tsx` currently has:
- **Open...** → Load JSON file from browser file picker
- **Save** → Download current model as JSON
- **Import Meta-Model...** → Load XLSX into meta-model
- **Export Meta-Model** → Download meta-model as XLSX

All operations are local (browser file system only).

## Desired State

New File menu structure:
```
File
├─ Open…              (NEW: backend-based, uses GET /api/model?filename=...)
├─ Save As…           (NEW: backend-based, uses PUT /api/model?filename=...)
├─ ─────────────
├─ Import as JSON…    (OLD "Open…" behaviour)
├─ Export as JSON…    (OLD "Save" behaviour)
├─ ─────────────
├─ Import as XLSX…    (OLD "Import Meta-Model…" behaviour)
└─ Export as XLSX…    (OLD "Export Meta-Model" behaviour)
```

## Key Components to Create

1. **API Client** (`src/api/modelApi.ts`)
   - `fetchModelFilenames()` → GET /api/model/filenames
   - `loadModelByFilename(filename)` → GET /api/model?filename=...
   - `saveModelByFilename(filename, model)` → PUT /api/model?filename=...

2. **ModelFileDialog** (`src/components/file/ModelFileDialog.tsx`)
   - Modal dialog for selecting/entering filenames
   - Two modes: "open" (select existing) and "saveAs" (select or enter new)
   - Shows list of available files from backend

3. **Updated FileMenu** (`src/components/TopBar/FileMenu.tsx`)
   - Add new menu items
   - Wire up dialog state and handlers

## Integration Points

- **ArchitectureContext**: Use existing `dispatch({ type: 'LOAD_MODEL', payload: model })` for loading
- **Model Store**: Use `state.model` for saving (already has metaModel + diagrams)
- **Existing Handlers**: Reuse `loadJsonFile`, `saveJsonFile`, `importMetaModelFromExcel`, `exportMetaModelToExcel`

## Backend API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/model/filenames` | GET | List available model files |
| `/api/model?filename={name}` | GET | Load model by filename |
| `/api/model?filename={name}` | PUT | Save model by filename |
