# Raw Idea: Phase 4 — Finalize DB/Session Separation

## Goal
Complete the refactor so that:
- `/api/projects/**` is strictly **DB-backed project CRUD + DB active project**
- `/api/project-session/**` is strictly **session (file/import) project state**
- No endpoint multiplexes DB and session behavior
- Frontend uses the correct API based on bootstrap capabilities, with no legacy fallbacks

## User Decisions
1. **ActiveProjectController handling:** Make DB-conditional with @ConditionalOnProperty so it only loads when DB is enabled
2. **DB snapshot endpoints:** Keep for DB mode - ensure they only work when includeDatabase=true
3. **Testing level:** Minimal smoke tests - verify 404s in no-DB mode and correct routing

## Key Changes Required

### Backend
- Add @ConditionalOnProperty to ActiveProjectController (DB-only)
- Ensure /api/projects/active returns 404 when DB disabled
- Remove multiplexing logic from ActiveProjectController
- Keep DB snapshot endpoints but make them DB-conditional
- Session endpoints via ProjectSessionController remain always-on

### Frontend
- Remove any legacy fallback patterns
- Ensure clean mode-based routing (already mostly done in Phase 3)
- Stabilize activeProjectSource state

### Testing
- Add smoke tests for 404 behavior in no-DB mode
- Verify endpoint routing works correctly in both modes
