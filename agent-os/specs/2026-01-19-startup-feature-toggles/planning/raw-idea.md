# Raw Feature Description

## Title
Startup Configuration for Feature Toggles (Include Delivery, Include Database) Across Frontend and Backend

## Intent
Introduce a startup-time (runtime at boot) configuration mechanism that supports running the tool in:
  - Full mode (Delivery + Database enabled)
  - Architecture-only mode (Delivery disabled)
  - File-only mode (Database disabled: no JPA/DataSource initialization, no DB connection required)
The toggles must be applied at process startup (not hot-switched), with safe defaults enabled.

## Scope

### In Scope
- Define two startup config toggles with defaults = true:
    - includeDelivery
    - includeDatabase
- Provide a runtime config source for both frontend and backend at startup.
- Frontend:
    - Load config at startup and expose a typed AppConfig via context/hook.
- Backend (architecture-model-service and any other services that initialize persistence):
    - When includeDatabase=false, Spring Boot must start without attempting any DB connection
      and without initializing JPA/Hibernate/DataSource/Flyway/Liquibase (as applicable).
    - Use startup-time configuration (properties/profile/conditional auto-config exclusion) to
      silence DB wiring rather than removing dependencies at build-time.
- Ensure toggles remain independent and mixed-mode is allowed.

### Out of Scope
- UI gating (tabs/menus/routes) based on toggles (handled in a separate spec).
- Export "Project Name" modal behaviour (handled in a separate spec).
- Re-architecting persistence/file import-export logic (beyond introducing DB-off boot safety).
- Hot/runtime switching while the app is already running.

## Defaults
```
includeDelivery: true
includeDatabase: true
```

## Configuration Sources

### Frontend
```yaml
type: static_runtime_json
path: /runtime-config.json
schema:
  includeDelivery: boolean
  includeDatabase: boolean
fallback: defaults
```

### Backend
```yaml
type: spring_boot_startup_properties
supported_inputs:
  - application.yml / application.properties
  - environment variables
  - command-line args
  - spring profiles (e.g. "no-db")
canonical_property_names:
  includeDelivery: app.features.includeDelivery
  includeDatabase: app.features.includeDatabase
fallback: defaults
```

## Backend No-DB Mode

### Goal
If app.features.includeDatabase=false, the service must start cleanly with no DB present,
producing no startup failure due to DataSource/JPA initialization.

### Requirements
- DataSource auto-configuration must be disabled in this mode.
- JPA/Hibernate auto-configuration must be disabled in this mode.
- DB migration tooling auto-config (Flyway/Liquibase) must be disabled in this mode if present.
- Any beans that require EntityManager/JpaRepository must not be created in this mode.

### Implementation Constraints
- Achieve the above via startup-time config (profiles/properties/conditional config),
  not via build-time dependency removal.
- Keep the codebase compatible with includeDatabase=true unchanged.

## Frontend AppConfig API

### Requirements
- AppConfig must be loaded before rendering gated areas (a brief bootstrap/loading is acceptable).
- Provide:
    - AppConfig type/interface
    - AppConfigContext provider
    - useAppConfig() hook
- If runtime-config.json missing or invalid, log once and use defaults.

## Error Handling

### Frontend
- Missing/unreadable/malformed runtime-config.json -> log once -> continue with defaults.

### Backend
- Missing properties -> defaults apply.
- Invalid boolean values -> defaults apply (and log once).
- In includeDatabase=false mode, server must not crash due to missing DB connectivity.

## Acceptance Criteria
- With defaults (both true), behaviour is unchanged from today.
- Backend starts successfully with includeDatabase=false even when no DB is reachable/provided.
- Frontend can be configured at startup via /runtime-config.json to set includeDelivery/includeDatabase.
- Both toggles are independent; no coupling logic forces them to match.

## Notes
- A follow-up spec will apply these toggles to UI composition and route/menu gating.
- A follow-up spec will address export prompting for Project Name when unset.
