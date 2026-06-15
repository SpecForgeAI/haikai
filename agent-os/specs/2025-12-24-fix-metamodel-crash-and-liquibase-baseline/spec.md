# Specification: Fix MetaModelView Crash and Liquibase Baseline Robustness

## Goal
Fix two distinct issues: (1) prevent MetaModelView from crashing when computing relationship tabs for a domain due to undefined array access, and (2) make Liquibase changelogs resilient to "table already exists" errors when the database contains pre-existing tables.

## User Stories
- As a developer, I want MetaModelView to never crash when switching domains so that I can navigate the application without interruption.
- As a developer, I want the backend service to start successfully even when the database already contains tables so that I can iterate quickly in development without manual cleanup.

## Specific Requirements

**A1: Ensure domain config exports are complete and never return undefined**
- Verify `ALL_DOMAINS` array in `architectureDomain.ts` contains all four domains: 'business', 'application', 'data', 'behavioural'
- Verify `DOMAIN_ENTITY_TYPES` in `gridConfigs.ts` has entries for all four domains with non-empty arrays
- Ensure hidden super-entities (`business_points`, `application_points`) are included in their respective domains for relationship filtering
- Each domain key must map to an array (even if empty) to prevent undefined access errors

**A2: Make getRelationshipTabsForDomain null-safe**
- Add nullish coalescing when accessing `DOMAIN_ENTITY_TYPES[domain]`: use `?? []` fallback
- Add nullish coalescing when extracting fkTargets from config columns: use `?? []` fallback
- Filter logic must use `fkTargets.some(t => domainEntityTypes.includes(t))` with guaranteed arrays
- Add guard clause at function start: if domain is not in `ALL_DOMAINS`, return empty array or fallback to 'business'
- Ensure config lookup `gridConfigs[relTypeKey]` returns early with `false` if config is undefined

**A3: Ensure selectedDomain always initializes to a valid value**
- In `ArchitectureContext.tsx`, verify `initialState` does not include `selectedDomain` (currently it does not, which is correct)
- If `selectedDomain` state is added in future, default to 'business' and validate against `ALL_DOMAINS`
- On any SET_DOMAIN action (if implemented), normalize invalid inputs to 'business' or ignore them
- The domain state is currently managed by DomainSelector component locally; ensure local state also defaults safely

**B1: Add Liquibase preConditions to prevent duplicate table creation**
- Modify `db.changelog-master.yaml` to add `preConditions` block to each changeSet
- Use `onFail: MARK_RAN` and `onError: HALT` for preConditions
- Use `not: tableExists: tableName: <anchor_table>` pattern to skip changeSet if anchor table exists
- Anchor tables: `model_files` (001), `classes` (002), `events` (003), `states` (004)

**B2: Preserve existing SQL files unchanged**
- Do NOT modify `schema.sql`, `002-classes-methods.sql`, `003-events.sql`, or `004-states-state-transitions.sql`
- PreConditions approach avoids checksum changes and maintains migration history stability
- MARK_RAN records the changeSet as executed without running the SQL when precondition fails

**B3: Document dev reset guidance**
- When Liquibase state and tables are out of sync, the deterministic fix is: `docker compose down -v && docker compose up --build`
- This removes the Postgres volume and ensures Liquibase applies from scratch
- Use this when encountering "partial schema exists" scenarios (some tables present, some not)

## Existing Code to Leverage

**DOMAIN_ENTITY_TYPES in gridConfigs.ts (lines 411-416)**
- Already defines complete domain-to-entity-type mapping including hidden super-entities
- Already includes `business_points` in business domain and `application_points` in application domain
- This is the authoritative mapping for relationship filtering; no changes needed to this constant

**getRelationshipTabsForDomain in MetaModelView.tsx (lines 38-59)**
- Current implementation accesses `DOMAIN_ENTITY_TYPES[domain]` directly without null check (line 41)
- Needs defensive coding: add `?? []` fallback to prevent crash when domain key is missing
- Uses `relationshipTabNames`, `relationshipTabToType`, and `gridConfigs` for FK target extraction

**ALL_DOMAINS in architectureDomain.ts (line 25)**
- Already exports complete array of all four domains
- Can be used for validation guard in relationship filtering function

**isArchitectureDomain type guard in architectureDomain.ts (lines 54-56)**
- Existing utility to validate if a string is a valid domain
- Can be used for domain validation in filtering function

**Existing test file domain-relationship-filtering.test.ts**
- Contains comprehensive tests for relationship filtering logic
- Tests verify DOMAIN_ENTITY_TYPES includes hidden super-entities
- Tests verify cross-domain relationships appear in both relevant domains

## Out of Scope
- Adding new features or functionality beyond the fixes described
- Schema redesign or migrations beyond making baseline idempotent
- Converting DDL SQL to use `CREATE TABLE IF NOT EXISTS` (would require checksum management)
- Adding new entity types or relationship types
- Modifying the domain selector UI component behavior
- Adding SET_DOMAIN action to ArchitectureContext (selectedDomain is managed locally in DomainSelector)
- Production data migration logic
- Modifying existing SQL DDL files (schema.sql, 002, 003, 004)
- Adding new Liquibase changeSets
- Changing table definitions or column structures
