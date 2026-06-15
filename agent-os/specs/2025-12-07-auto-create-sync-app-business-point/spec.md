# Specification: Auto-Create + Sync App_Business_Point Entity

## Goal
Transform App_Business_Point from a virtual/polymorphic concept into a real indirect entity that is automatically created, synced, and deleted in lockstep with its 7 source entity types (Application, App Component, Service, Interface, Endpoint, Business Process, Process Activity).

## User Stories
- As a user editing Interactions, I want the Primary Point and Secondary Point dropdowns to show a single unified list of all business and application points, so that I can quickly select interaction targets without understanding the underlying entity structure.
- As a user creating/renaming/deleting entities, I want App_Business_Point records to be automatically maintained, so that dropdown options are always current without manual intervention.

## Specific Requirements

**New AppBusinessPoint Interface**
- Add `AppBusinessPoint` interface to `model.ts` with fields: `id`, `name`, `kind` (AppBusinessPointEntityType), `source_entity_id`
- Add `app_business_points: AppBusinessPoint[]` to `MetaModelEntities`
- The `kind` field uses the existing `AppBusinessPointEntityType` union (APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, ENDPOINT, BUSINESS_PROCESS, PROCESS_ACTIVITY)
- ID generation uses deterministic pattern: `abp_{source_entity_id}` for idempotent reconciliation

**Auto-Creation on Entity Add**
- Hook into ArchitectureContext reducer's `ADD_ENTITY` case
- When entityType is one of the 7 ABP source types, call `createAppBusinessPointFromEntity()`
- Create new utility file `appBusinessPointSync.ts` following the pattern from `applicationPointSync.ts`
- The created ABP copies `name` from source entity (name is derived, never user-authored)

**Sync on Rename (UPDATE_ENTITY)**
- Hook into reducer's `UPDATE_ENTITY` case
- When source entity name changes, call `syncAppBusinessPointNameForEntity()`
- If ABP exists, update its name to match the new source entity name
- If ABP is missing (edge case), create it with the new name

**Delete Cascade (DELETE_ENTITY)**
- Hook into reducer's `DELETE_ENTITY` case
- When source entity is deleted, call `cascadeDeleteForABPSourceEntity()`
- Delete the corresponding AppBusinessPoint record
- Clear orphan references in `Interaction.primary_app_business_point_id` and `Interaction.secondary_app_business_point_id` by setting them to empty string

**Reconciliation on JSON Load (LOAD_MODEL)**
- Call `reconcileAppBusinessPoints(metaModel)` after existing `reconcileApplicationPoints` and `reconcileBusinessPoints`
- For each source entity: create missing ABP or force-update existing ABP name
- Remove orphaned ABPs that don't map to any source entity
- Clear orphan Interaction FK references pointing to deleted ABPs

**TypeaheadCell for Interaction Dropdowns**
- Update `getTargetEntities()` in `TypeaheadCell.tsx` to handle `fkTarget: 'app_business_points'`
- Return `model.metaModel.entities.app_business_points` directly (single collection)
- Remove or deprecate `getAllAppBusinessPointEntities()` from `formatters.ts` (no longer needed)

**Display Formatter for Interaction Grid**
- Create `appBusinessPointDisplayFormatter` in `formatters.ts`
- Format: `"<name> (<kind>)"` using `APP_BUSINESS_POINT_KIND_LABELS` mapping
- Apply to `primary_app_business_point_id` and `secondary_app_business_point_id` columns in gridConfigs

**No UI Tab or Section**
- ABP entity is not added to `entityTabNames` or `tabToEntityType` in gridConfigs
- No RHS section in DiagramsView for App_Business_Point
- Users never directly view or edit ABP records

**Entity Type Constants Update**
- Add `APP_BUSINESS_POINT: 'APP_BUSINESS_POINT'` to `ENTITY_TYPES` constant in `model.ts`
- Add `'app_business_points'` to `EntityType` union

## Existing Code to Leverage

**applicationPointSync.ts Pattern**
- Replicate the complete structure: ID generation, entity creation, name sync, orphan detection, cascade delete, reconciliation
- Functions to replicate: `generateApplicationPointId`, `createApplicationPointFromEntity`, `syncApplicationPointNameForEntity`, `findApplicationPointForEntity`, `cascadeDeleteForSourceEntity`, `reconcileApplicationPoints`
- Adapt naming convention from `ap_` prefix to `abp_` prefix

**businessPointSync.ts Pattern**
- Same structural pattern as applicationPointSync but for business entities
- Useful reference for handling Process Activity which has parent FK (business_process_id)

**ArchitectureContext.tsx Reducer Hooks**
- Existing hooks for `isSyncEntityType` (applications, app_components, services) and `isBPSyncEntityType` (business_processes, process_activities)
- Add new `isABPSyncEntityType` check covering all 7 source entity types
- Follow same pattern: check entity type, call sync/create/cascade functions

**formatters.ts Display Utilities**
- Existing `APP_BUSINESS_POINT_KIND_LABELS` mapping already defined
- Existing `formatAppBusinessPointDisplay()` function can be adapted
- `createAppBusinessPointDisplayFormatter()` pattern already exists but uses polymorphic approach

**gridConfigs.ts Interaction Configuration**
- `fkTarget: 'app_business_points'` already set on Interaction columns
- `displayFormatter` property pattern already used for application_points and business_points

## Out of Scope
- Adding App_Business_Point as a visible tab in the meta-model grid view
- Allowing users to manually create, edit, or delete App_Business_Point records
- Creating diagram nodes directly for App_Business_Point entities (they are lookup-only)
- Migrating existing Interaction records that reference source entity IDs directly (assume clean slate or separate migration script)
- Adding validation rules for App_Business_Point entity (it's system-managed)
- Adding temporal validity fields (valid_from, valid_to) to App_Business_Point
- Creating relationships that reference App_Business_Point as source or target (only Interaction FK fields use it)
- Adding tags or description fields to App_Business_Point
- Exposing App_Business_Point in the palette panel
- Creating tests for App_Business_Point sync logic (covered by existing ApplicationPoint and BusinessPoint test patterns)
