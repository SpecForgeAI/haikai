# Raw Idea: File Mode Blank Start UX

## Goal
In non-DB "File Mode" (`includeDatabase=false`):
1. App starts on a blank Architecture & Design workspace (no forced import screen)
2. Import is optional and only via Project menu
3. Export works immediately on blank project (no import prerequisite)
4. Import reliably loads previously exported snapshots

## User Decisions
1. **Backend Init:** Auto-init on first GET - GET /api/project-session auto-creates blank project if none exists
2. **Project Name:** "Untitled" as default blank project name
3. **UX Hint:** No hint, just blank workspace - clean UI, import discoverable via Project menu

## Key Changes Required

### Backend
- Modify SessionProjectStore to auto-create blank project on first access
- Modify GET /api/project-session to return 200 with blank project (never 404 in practice)
- Modify GET /api/project-session/export to build blank snapshot if none exists
- Ensure import properly syncs project identity

### Frontend
- Remove NoProjectEmptyState from MetaModelView and ProductView for File Mode
- Remove export toast guard that blocks export without prior import
- Show blank workspace on startup
