# Specification: Startup Configuration for Feature Toggles

## Goal
Introduce startup-time configuration toggles (`includeDelivery`, `includeDatabase`) that allow the application to run in different modes: full mode, architecture-only mode (delivery disabled), or file-only mode (database disabled), with both toggles independent and defaulting to true.

## User Stories
- As an operator, I want to disable database connectivity at startup so that I can run the tool in a lightweight file-only mode without requiring a PostgreSQL instance.
- As an operator, I want to disable delivery features at startup so that I can run the tool in architecture-only mode for users who do not need roadmap/delivery functionality.

## Specific Requirements

**Frontend: Load runtime-config.json at startup**
- Fetch `/runtime-config.json` from the public folder before rendering the application
- Parse JSON with schema: `{ includeDelivery: boolean, includeDatabase: boolean }`
- If fetch fails (404, network error) or JSON is malformed, log a single warning and use defaults
- Defaults: `includeDelivery: true`, `includeDatabase: true`
- Loading should block app render briefly (display a minimal loading state if needed)

**Frontend: AppConfig context and hook**
- Create `AppConfigContext` with typed `AppConfig` interface containing both toggle values
- Create `AppConfigProvider` component that wraps the app and provides config state
- Expose `useAppConfig()` hook that returns the full config object
- Expose `useIncludeDelivery()` and `useIncludeDatabase()` convenience hooks
- Follow existing context pattern from `ProjectContext.tsx` (createContext, provider, hooks with error on missing provider)

**Frontend: Place runtime-config.json in public folder**
- Create `/public/runtime-config.json` with default values `{ "includeDelivery": true, "includeDatabase": true }`
- This file is served statically and can be replaced at deployment time
- Document that operators can override by replacing this file in the deployed build

**Backend: Feature toggle properties**
- Add properties `app.features.includeDelivery` (default: true) and `app.features.includeDatabase` (default: true)
- Support all standard Spring Boot configuration sources: application.yml, environment variables, command-line args
- Create `@ConfigurationProperties` class `AppFeaturesProperties` bound to `app.features` prefix
- Invalid boolean values should fall back to defaults with a single log warning

**Backend: Disable database auto-configuration when includeDatabase=false**
- When `app.features.includeDatabase=false`, exclude DataSource auto-configuration
- Exclude JPA and Hibernate auto-configuration in this mode
- Exclude Liquibase auto-configuration in this mode
- Use `@ConditionalOnProperty` or Spring profile activation to achieve this
- Do not remove dependencies at build-time; keep the JAR identical regardless of mode

**Backend: Conditional bean creation for DB-dependent components**
- Mark all repository beans and services that depend on EntityManager/JpaRepository as conditional
- Use `@ConditionalOnProperty(name = "app.features.includeDatabase", havingValue = "true", matchIfMissing = true)`
- Ensure controllers that depend on these services are also conditional or handle missing dependencies gracefully
- The application must start cleanly with no DB present when `includeDatabase=false`

**Backend: No-DB profile alternative approach**
- Create `application-no-db.yml` profile that sets `app.features.includeDatabase=false` and excludes auto-configs
- Support running with `--spring.profiles.active=no-db` as an alternative to property-based configuration
- Both approaches (property and profile) should achieve identical behavior

**Error handling: Frontend**
- If `/runtime-config.json` is missing, unreachable, or contains invalid JSON, log once using `console.warn`
- Continue application startup with defaults; do not show error to user
- If individual properties are missing or invalid type, use default for that property

**Error handling: Backend**
- Missing properties use defaults (both true)
- Invalid boolean string values (not "true"/"false") use defaults and log a warning once
- When `includeDatabase=false`, server must not crash due to missing DB connectivity
- All DB-related beans should simply not be instantiated in no-db mode

## Visual Design
No visual mockups provided for this specification. This is a configuration/infrastructure feature with no UI changes.

## Existing Code to Leverage

**`frontend/src/contexts/ProjectContext.tsx`**
- Provides the established pattern for React context with provider and hooks
- Shows how to handle async initialization in useEffect with loading state
- Demonstrates error handling pattern (log and continue with fallback)
- Use the same createContext/useContext pattern for AppConfigContext

**`frontend/src/main.tsx` and `frontend/src/App.tsx`**
- Entry point where AppConfigProvider should wrap the entire application
- AppConfigProvider should be the outermost provider (before ProjectProvider and ArchitectureProvider)
- Follow the existing provider nesting pattern

**`architecture-model-service/src/main/resources/application.yml`**
- Existing configuration structure under `app:` namespace
- Add `features:` section under `app:` to maintain consistent organization
- Follow the existing pattern for property defaults using `${ENV_VAR:default}` syntax

**`architecture-model-service/pom.xml`**
- Shows spring-boot-starter-data-jpa and liquibase-core as dependencies
- These dependencies must remain; only auto-configuration should be conditionally disabled
- No build-time changes needed; runtime configuration only

**`architecture-model-service/src/main/java/.../config/WebConfig.java`**
- Existing configuration class pattern in the config package
- Create new `AppFeaturesConfig.java` in the same package for feature toggle beans
- Follow the same `@Configuration` annotation style

## Out of Scope
- UI gating of tabs, menus, or routes based on these toggles (handled in a separate spec)
- Export "Project Name" modal behavior changes (handled in a separate spec)
- Re-architecting persistence or file import/export logic beyond no-db boot safety
- Hot/runtime switching of toggles while the application is running
- Build-time dependency removal or conditional Maven profiles
- Any changes to the actual delivery or database feature functionality
- User-facing indication of which mode the app is running in
- API endpoints to query current toggle state
- Automatic toggle detection based on environment
- Toggle persistence or configuration UI
