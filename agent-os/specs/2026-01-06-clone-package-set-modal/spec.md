# Specification: Clone Package Set Modal

## Goal
Enable users to create customized copies of existing Package Sets through a "Clone" flow that opens a pre-populated builder modal, preserving immutability of original Package Sets while allowing customization before creation.

## User Stories
- As a user, I want to clone an existing Package Set so that I can customize its packages without modifying the original.
- As a user, I want validation to prevent creating a clone with a duplicate name so that I avoid confusing duplicates in my model.

## Specific Requirements

**Clone Entry Point in Package Sets List**
- Add a "Clone" action button or icon in each row of the Package Sets table
- Clicking Clone opens the builder modal pre-populated with the selected Package Set's data
- The row action is preferred for discoverability over a detail panel button
- Use a clone/copy icon consistent with other action icons in the application

**Clone Modal Pre-population**
- Package Set Name field pre-filled with "<original name> (copy)" format
- Packages list populated with copies of all original packages (name, purpose, sort_order)
- All fields remain editable - user can modify before creating
- Packages sorted by sort_order with stable fallback for undefined values

**Builder Modal Mode Support**
- Support two modes via props: 'create' and 'clone'
- Modal title changes based on mode: "Create Package Set" vs "Clone Package Set"
- Primary button text changes: "Create" vs "Clone"
- Both modes use identical UI layout and form structure

**Name Uniqueness Validation**
- Validate that new Package Set name does not match any existing Package Set name
- Comparison must be case-insensitive and trimmed
- Display inline error message: "A package set with this name already exists."
- Validation applies in both create and clone modes - no exceptions for the source name

**Package Customization in Clone Modal**
- Users can add new packages to the cloned list
- Users can remove packages from the cloned list (minimum 1 required)
- Users can reorder packages using up/down controls
- Users can edit package names and purposes
- All standard validation rules apply (package set name required, at least one package, all package names required)

**Clone Creation Logic**
- Generate new PackageSet id using generateEntityId('package_sets')
- Generate new Package ids for each package using generateEntityId('packages')
- Assign sort_order 1..N based on final draft ordering
- Dispatch ADD_ENTITY for the new PackageSet
- Dispatch ADD_ENTITY for each new Package with package_set_id referencing the new set

**Post-Clone Selection**
- After successful clone creation, close the modal
- Auto-select the newly created Package Set in the list view
- The detail panel updates to show the new Package Set's packages

**Immutability Preservation**
- Original Package Set and its packages must remain completely unchanged
- Clone operation creates entirely new entities with new IDs
- Future modifications to cloned sets require cloning again (no edit-in-place)

## Existing Code to Leverage

**CreatePackageSetModal.tsx**
- Located at `frontend/src/components/MetaModelView/CreatePackageSetModal.tsx`
- Complete modal implementation with packages builder table, validation, and submission
- Refactor to accept mode prop ('create' | 'clone') and optional initial data props
- Reuse all form handlers, validation logic, and submission flow

**PackageSetsView.tsx**
- Located at `frontend/src/components/MetaModelView/PackageSetsView.tsx`
- Contains Package Sets table with row rendering and selection logic
- Add Clone action button to each row in the table body
- Reuse existing handleSubmit callback pattern for clone submission

**generateEntityId utility**
- Located at `frontend/src/utils/idGenerator.ts`
- Use generateEntityId('package_sets') and generateEntityId('packages')
- Ensures consistent ID generation with 'pkgset' and 'pkg' prefixes

**CreatePackageSetModal.module.css**
- Located at `frontend/src/components/MetaModelView/CreatePackageSetModal.module.css`
- Complete styling for modal, form fields, packages builder table, and buttons
- No CSS changes required - clone mode uses identical styling

**PackageSet and Package types**
- Defined in `frontend/src/types/model.ts`
- PackageSet: { id, name }
- Package: { id, package_set_id, name, purpose?, sort_order? }

## Out of Scope
- Editing existing Package Sets or Packages in-place after creation
- Backend API calls or schema changes - persist via File -> Save only
- Assigning Package Sets to Services (future Iteration 5)
- Company/project standards import functionality
- Bulk clone operations (clone multiple Package Sets at once)
- Clone history or audit trail tracking
- Undo/redo for clone operations
- Package Set versioning or comparison views
- Detail panel Clone button (row action is sufficient for MVP)
- Keyboard shortcut for triggering clone action
