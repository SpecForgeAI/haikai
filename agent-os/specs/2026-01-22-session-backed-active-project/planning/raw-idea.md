# Raw Idea

**Feature Name:** Session-Backed Active Project When DB Disabled

**Description:**
When `app.features.include-database=false`, the service must still:
- respond to `GET /api/projects/active` (return 404 if no active "session project")
- respond to `GET /api/projects/active/export` (return 404 if no active snapshot)
- respond to `POST /api/projects/import` (accept snapshot JSON, optionally set as active)

This ensures frontend boot and Import/Export continue to work without DB-backed CRUD.

Key components:
1. SessionProjectStore - singleton component for in-memory storage of active project/snapshot
2. Always-on controller routes for /api/projects/active, /api/projects/active/export, /api/projects/import
3. Conditional delegation: DB on = existing services, DB off = SessionProjectStore
4. Fix GlobalExceptionHandler to return 404 for NoResourceFoundException

SCOPE: Backend only (architecture-model-service). No frontend changes required.
