# Specification: Service Package Set Assignment Dropdown

## Goal
Allow a Service to explicitly reference a Package Set via a dropdown in the Service editor, with shortcuts to create a new Package Set or clone-and-customize an existing one, enabling package structure to be part of the architecture model.

## User Stories
- As an architect, I want to assign a Package Set to a Service so that the intended package structure is documented as part of the architecture model.
- As an architect, I want to quickly create or clone a Package Set from the Service editor so that I can define custom package structures without leaving the context.

## Specific Requirements

**Service Package Set Field**
- Add a "Package Set" column to the services grid in MetaModelView
- Field binds to Service.package_set_id (nullable string, already in model.ts)
- Use a custom cell renderer/editor for the dropdown behavior
- Position after "Core Tech" column in the services grid config

**Dropdown Structure and Options**
- First option: "Default (Auto)" - displayed when package_set_id is null
- Divider line after "Default (Auto)"
- List of existing Package Sets by name from metaModel.entities.package_sets
- Divider line after package set list
- "Create new..." action item
- "Clone and customize..." action item (disabled when no concrete package set selected)

**Default (Auto) Behavior**
- Selecting "Default (Auto)" sets service.package_set_id = null
- When service.package_set_id is null, display "Default (Auto)" in the dropdown
- Do NOT implement actual default resolution logic (deferred to future iteration)
- No standards-based matching rules in this iteration

**Create New Shortcut**
- Clicking "Create new..." opens CreatePackageSetModal in create mode
- On successful creation: set service.package_set_id to the new package set id
- User remains in Service editor after creation (no navigation)
- Pass existingPackageSetNames for uniqueness validation

**Clone and Customize Shortcut**
- Enabled only when service.package_set_id references a concrete package set
- Clicking opens CreatePackageSetModal in clone mode with initialData
- Resolve source package set and packages (ordered by sort_order)
- Prepare CloneInitialData with name: "<source name> (copy)" and packages array
- On successful creation: set service.package_set_id to the new package set id

**Read-Only Preview (Optional)**
- When a concrete package set is selected, show a compact preview below/near the dropdown
- Display packages as a list showing name and purpose
- Order packages by sort_order ascending
- Purely informational to help users confirm their selection

**Persistence**
- Service.package_set_id persists via File -> Save/Open round-trip
- No auto-save required; use existing model save flow
- Ensure package_set_id is not dropped during save serialization

## Visual Design
No mockups provided. The selector should follow existing grid cell patterns with action items styled consistently with the application.

## Existing Code to Leverage

**CreatePackageSetModal Component**
- Located at: frontend/src/components/MetaModelView/CreatePackageSetModal.tsx
- Supports mode: 'create' | 'clone' prop
- Accepts initialData: CloneInitialData for clone mode pre-population
- Accepts existingPackageSetNames for uniqueness validation
- Exports CloneInitialData interface for type-safe clone data preparation

**PackageSetsView Implementation Pattern**
- Located at: frontend/src/components/MetaModelView/PackageSetsView.tsx
- Demonstrates how to prepare cloneInitialData from source package set
- Shows dispatch pattern for ADD_ENTITY to package_sets and packages
- Provides callback pattern for handleSubmit with PackageSet and Package[] params

**Service Type Definition**
- Located at: frontend/src/types/model.ts (lines 281-296)
- Service already has package_set_id?: string field defined
- PackageSet and Package types defined at lines 264-279

**gridConfigs Services Configuration**
- Located at: frontend/src/config/gridConfigs.ts (lines 99-110)
- Currently has 10 columns for services grid
- New Package Set column should be added after 'core_tech' field
- Use cellType pattern similar to fk_typeahead but with custom dropdown

**TypeaheadCell Component Pattern**
- Located at: frontend/src/components/Grid/TypeaheadCell.tsx
- Provides reusable dropdown cell pattern with search and selection
- Can be extended or used as reference for custom PackageSetCell

## Out of Scope
- Implementing standards-based default matching logic for "Default (Auto)"
- Auto-import of company/project package-sets.json files
- Editing existing package sets from the Service screen (immutability preserved)
- Backend API changes or schema modifications
- Automatic package set assignment based on core_tech or service_type
- Inline editing of package names/purposes from the preview
- Navigation away from Service editor after create/clone operations
- Validation rules for package set compatibility with service type
- Delete or unassign package set functionality beyond selecting "Default (Auto)"
