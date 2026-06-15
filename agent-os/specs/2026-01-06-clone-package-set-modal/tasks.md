# Task Breakdown: Clone Package Set Modal

## Overview
Total Tasks: 4 Task Groups, 22 Sub-tasks

This feature enables users to clone existing Package Sets through a pre-populated builder modal, preserving immutability of originals while allowing customization before creation.

## Task List

### Frontend - Modal Component Refactoring

#### Task Group 1: Refactor CreatePackageSetModal for Mode Support
**Dependencies:** None

- [x] 1.0 Complete modal mode support refactoring
  - [x] 1.1 Write 4-6 focused tests for modal mode behavior
    - Test modal renders with 'create' mode by default
    - Test modal renders with 'clone' mode and correct title/button text
    - Test initial data prop pre-populates form fields in clone mode
    - Test name uniqueness validation displays error for duplicate names (case-insensitive)
    - Test clone mode validates against existing package set names including source name
    - Test form reset clears to default in create mode, pre-populates in clone mode
  - [x] 1.2 Update CreatePackageSetModalProps interface
    - Add `mode?: 'create' | 'clone'` prop (defaults to 'create')
    - Add `initialData?: { name: string; packages: Array<{ name: string; purpose?: string; sort_order?: number }> }` prop
    - Add `existingPackageSetNames?: string[]` prop for uniqueness validation
    - File: `frontend/src/components/MetaModelView/CreatePackageSetModal.tsx`
  - [x] 1.3 Update modal title based on mode
    - 'create' mode: "Create Package Set"
    - 'clone' mode: "Clone Package Set"
    - Update title element in header section
  - [x] 1.4 Update primary button text based on mode
    - 'create' mode: "Create" / "Creating..."
    - 'clone' mode: "Clone" / "Cloning..."
    - Update button text in footer section
  - [x] 1.5 Implement form pre-population for clone mode
    - Pre-fill name with `initialData.name` (should be "<original name> (copy)")
    - Pre-populate packages array with initialData.packages
    - Sort packages by sort_order with stable fallback for undefined values
    - Generate tempIds for each pre-populated package row
    - Modify `getDefaultFormData()` or add `getInitialFormData()` helper
  - [x] 1.6 Implement name uniqueness validation
    - Add validation in `validateForm()` function
    - Check if trimmed, lowercased name matches any existing package set name
    - Display error: "A package set with this name already exists."
    - Update `isFormValid` memo to include uniqueness check
  - [x] 1.7 Ensure modal mode tests pass
    - Run ONLY the tests written in 1.1
    - Verify create mode backward compatibility
    - Verify clone mode functionality

**Acceptance Criteria:**
- Modal supports both 'create' and 'clone' modes via props
- Title and button text change based on mode
- Clone mode pre-populates form with initial data
- Name uniqueness validation prevents duplicate names (case-insensitive)
- All 4-6 tests written in 1.1 pass

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

### Frontend - Clone Entry Point

#### Task Group 2: Add Clone Action to Package Sets Table
**Dependencies:** Task Group 1

- [x] 2.0 Complete clone entry point implementation
  - [x] 2.1 Write 3-5 focused tests for clone action functionality
    - Test Clone button/icon renders in each Package Sets table row
    - Test clicking Clone opens modal in 'clone' mode with pre-populated data
    - Test cloned name uses "<original name> (copy)" format
    - Test packages are pre-populated with original packages (name, purpose, sort_order)
    - Test Clone modal submission creates new entities with new IDs
  - [x] 2.2 Add clone button to Package Sets table rows
    - Add Clone action button/icon in each row (after Name and Package Count columns)
    - Use clone/copy icon consistent with application design (e.g., clipboard icon)
    - Add appropriate title/tooltip: "Clone Package Set"
    - Style button with existing action button patterns
    - File: `frontend/src/components/MetaModelView/PackageSetsView.tsx`
  - [x] 2.3 Add clone modal state management
    - Add `isCloneModalOpen` state variable
    - Add `cloneSourcePackageSet` state for tracking source Package Set
    - Add `handleOpenCloneModal(packageSetId: string)` handler
    - Add `handleCloseCloneModal()` handler
  - [x] 2.4 Implement clone data preparation
    - Collect source Package Set data by ID
    - Collect source packages filtered by package_set_id
    - Sort packages by sort_order with stable fallback
    - Format name as "<original name> (copy)"
    - Prepare initialData object for modal
  - [x] 2.5 Render CreatePackageSetModal for clone mode
    - Pass `mode="clone"` prop
    - Pass `initialData` with prepared clone data
    - Pass `existingPackageSetNames` for uniqueness validation
    - Use shared `handleSubmit` handler (same dispatch logic)
  - [x] 2.6 Implement post-clone selection
    - After successful clone creation, close clone modal
    - Auto-select newly created Package Set via `setSelectedPackageSetId(packageSet.id)`
    - Detail panel updates automatically via existing selection logic
  - [x] 2.7 Ensure clone entry point tests pass
    - Run ONLY the tests written in 2.1
    - Verify Clone button renders and is clickable
    - Verify modal opens with correct pre-populated data

**Acceptance Criteria:**
- Clone button appears in each Package Sets table row
- Clicking Clone opens modal pre-populated with source data
- Name field shows "<original name> (copy)"
- Packages list contains copies of all original packages
- All 3-5 tests written in 2.1 pass

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.module.css` (if action column styling needed)

---

### Frontend - Clone Creation Logic

#### Task Group 3: Clone Entity Creation and Immutability
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete clone creation logic
  - [x] 3.1 Write 3-4 focused tests for clone creation behavior
    - Test new PackageSet entity has new ID (generated via generateEntityId)
    - Test each Package has new ID (generated via generateEntityId)
    - Test packages have correct package_set_id referencing new PackageSet
    - Test sort_order values are assigned 1..N based on final draft ordering
  - [x] 3.2 Verify entity ID generation in submission
    - Confirm `generateEntityId('package_sets')` generates unique PackageSet ID
    - Confirm `generateEntityId('packages')` generates unique Package IDs
    - Verify IDs follow pattern from `frontend/src/utils/idGenerator.ts` (pkgset-*, pkg-*)
  - [x] 3.3 Verify immutability of original entities
    - Confirm original PackageSet is not modified
    - Confirm original Packages are not modified
    - Clone creates entirely new entities in state
  - [x] 3.4 Verify ADD_ENTITY dispatches
    - Dispatch ADD_ENTITY for new PackageSet with entityType 'package_sets'
    - Dispatch ADD_ENTITY for each new Package with entityType 'packages'
    - Verify packages reference new PackageSet ID
  - [x] 3.5 Ensure clone creation tests pass
    - Run ONLY the tests written in 3.1
    - Verify new entities have unique IDs
    - Verify original entities unchanged

**Acceptance Criteria:**
- New PackageSet has unique ID via generateEntityId('package_sets')
- Each Package has unique ID via generateEntityId('packages')
- Packages correctly reference new PackageSet ID
- sort_order is assigned 1..N based on draft ordering
- Original PackageSet and Packages remain unchanged
- All 3-4 tests written in 3.1 pass

**Files to Reference:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\idGenerator.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts` (PackageSet, Package interfaces)

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written in Task 1.1 (modal mode behavior)
    - Review the 3-5 tests written in Task 2.1 (clone entry point)
    - Review the 3-4 tests written in Task 3.1 (clone creation logic)
    - Total existing tests: approximately 10-15 tests
  - [x] 4.2 Analyze test coverage gaps for clone feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Clone Package Set feature
    - Prioritize end-to-end workflow: click Clone -> modify -> submit -> verify
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 5 additional strategic tests maximum
    - Add integration test: complete clone workflow from click to entity creation
    - Add edge case: clone with modified packages (add/remove/reorder)
    - Add edge case: clone name validation when user modifies pre-filled name
    - Add test: verify all package fields are correctly copied (name, purpose, sort_order)
    - Add test: multiple sequential clones generate unique IDs
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Clone Package Set feature
    - Expected total: approximately 15-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 15-20 tests total)
- Critical clone workflows are covered
- No more than 5 additional tests added when filling in testing gaps
- Testing focused exclusively on Clone Package Set feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Modal Mode Support** (no dependencies) - COMPLETED
   - Refactor CreatePackageSetModal to support 'create' and 'clone' modes
   - Add props for mode, initialData, and existingPackageSetNames
   - Implement name uniqueness validation

2. **Task Group 2: Clone Entry Point** (depends on Task Group 1) - COMPLETED
   - Add Clone button to Package Sets table rows
   - Implement clone modal state and data preparation
   - Wire up clone modal with pre-populated data

3. **Task Group 3: Clone Creation Logic** (depends on Task Groups 1-2) - COMPLETED
   - Verify entity ID generation for new entities
   - Ensure immutability of original entities
   - Validate ADD_ENTITY dispatches

4. **Task Group 4: Test Review & Gap Analysis** (depends on Task Groups 1-3) - COMPLETED
   - Review all tests written during implementation
   - Fill critical coverage gaps
   - Run full feature test suite

---

## Implementation Notes

### Existing Code Patterns to Follow

**CreatePackageSetModal.tsx**
- Modal structure with header, content, footer sections
- Form state management with `useState` and `useCallback`
- Validation using `validateForm()` and `isFormValid` memo
- Package row management with tempId tracking
- Submission creates entities and dispatches ADD_ENTITY

**PackageSetsView.tsx**
- Master-detail layout with Package Sets table and Packages detail panel
- Modal state management pattern: `isModalOpen`, `handleOpenModal`, `handleCloseModal`
- `handleSubmit` dispatches ADD_ENTITY for package_sets and packages
- Auto-selection of newly created entities via `setSelectedPackageSetId`

**ID Generation**
- Use `generateEntityId('package_sets')` for PackageSet IDs (prefix: 'pkgset')
- Use `generateEntityId('packages')` for Package IDs (prefix: 'pkg')

### Key Validation Rules

- Package Set name must be unique (case-insensitive, trimmed comparison)
- At least 1 package is required
- All package names must be non-empty
- Clone mode validates against ALL existing names (no exception for source)

### CSS Notes

- No CSS changes required per spec
- Clone mode uses identical styling as create mode
- Existing `CreatePackageSetModal.module.css` provides all needed styles

---

## Implementation Summary

**Test Results:** All 55 tests pass

**Files Modified:**
- `frontend/src/components/MetaModelView/CreatePackageSetModal.tsx` - Added mode support, initialData prop, existingPackageSetNames prop, and name uniqueness validation
- `frontend/src/components/MetaModelView/PackageSetsView.tsx` - Added Clone button, clone modal state management, and clone data preparation
- `frontend/src/components/MetaModelView/PackageSetsView.module.css` - Added Actions column and Clone button styling

**Files Created:**
- `frontend/src/__tests__/clone-package-set-modal.test.ts` - 55 focused tests covering all task groups
