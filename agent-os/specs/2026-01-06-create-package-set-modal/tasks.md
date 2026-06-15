# Task Breakdown: Create Package Set Modal with Embedded Packages Builder

## Overview
Total Tasks: 18

This feature enables users to create new project-level Package Sets (and their Packages) via a dedicated modal from the "Package Sets" screen. The implementation follows an immutable creation model where Package Sets and Packages cannot be edited after creation.

## Task List

### Utilities Layer

#### Task Group 1: ID Generator Updates
**Dependencies:** None

- [x] 1.0 Complete ID generator updates
  - [x] 1.1 Write 2-4 focused tests for ID generation
    - Test `generateEntityId('package_sets')` returns prefixed ID with 'pkgset'
    - Test `generateEntityId('packages')` returns prefixed ID with 'pkg'
    - Test ID format follows existing pattern `{prefix}-{timestamp}-{random}`
  - [x] 1.2 Add entity prefixes to `getEntityPrefix()` function
    - File: `src/utils/idGenerator.ts`
    - Add entry: `package_sets: 'pkgset'`
    - Add entry: `packages: 'pkg'`
  - [x] 1.3 Ensure ID generator tests pass
    - Run ONLY the tests written in 1.1
    - Verify new prefixes work correctly

**Acceptance Criteria:**
- `generateEntityId('package_sets')` returns ID with 'pkgset' prefix
- `generateEntityId('packages')` returns ID with 'pkg' prefix
- Existing entity ID generation is not affected

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\idGenerator.ts`

---

### UI Components Layer

#### Task Group 2: Modal Component Structure
**Dependencies:** Task Group 1

- [x] 2.0 Complete modal component structure
  - [x] 2.1 Write 2-4 focused tests for modal structure
    - Test modal renders when isOpen is true
    - Test modal closes on Cancel button click
    - Test modal closes on overlay click
    - Test modal closes on Escape key press
  - [x] 2.2 Create `CreatePackageSetModal.tsx` component file
    - File: `src/components/MetaModelView/CreatePackageSetModal.tsx`
    - Define props interface: `isOpen`, `onClose`, `onSubmit`
    - Follow structure from `CreateBusinessLogicModal.tsx`
  - [x] 2.3 Implement modal overlay and container
    - Overlay with semi-transparent backdrop
    - Modal container with max-width 600px (wider than standard for table)
    - Click-outside to close functionality
  - [x] 2.4 Implement modal header
    - Title: "Create Package Set"
    - Close button (X) with hover styling
  - [x] 2.5 Implement modal footer
    - Cancel button (secondary styling)
    - Create button (primary styling)
    - Create button disabled when form is invalid
  - [x] 2.6 Add keyboard event handlers
    - Escape key to close modal
    - Optional: Ctrl+Enter to submit when valid
  - [x] 2.7 Ensure modal structure tests pass
    - Run ONLY the tests written in 2.1
    - Verify modal opens, closes, and keyboard shortcuts work

**Acceptance Criteria:**
- Modal renders correctly when isOpen is true
- Modal does not render when isOpen is false
- Close button, overlay click, and Escape key all close the modal
- Cancel and Create buttons are displayed in footer
- Modal follows existing design patterns

**Files to Create:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

**Reference Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\modals\CreateBusinessLogicModal.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\modals\CreateBusinessLogicModal.module.css`

---

#### Task Group 3: Modal Form Fields
**Dependencies:** Task Group 2

- [x] 3.0 Complete modal form fields
  - [x] 3.1 Write 2-4 focused tests for form fields
    - Test Package Set Name input renders with label and placeholder
    - Test Package Set Name validation error when empty on blur/submit
    - Test packages builder table renders with initial empty row
    - Test Add Package button adds new row
  - [x] 3.2 Implement Package Set Name field
    - Required text input with label "Name" and required asterisk
    - Placeholder: "Enter package set name"
    - Error state styling for validation failure
    - Error message: "Package set name is required"
  - [x] 3.3 Implement form state management
    - State for package set name (string)
    - State for packages array (array of { id, name, purpose })
    - State for validation errors object
    - State for isSubmitting flag
  - [x] 3.4 Implement field change handlers
    - Handle package set name changes
    - Clear validation errors on field modification
  - [x] 3.5 Reset form state when modal opens
    - Clear name field
    - Reset packages to single empty row
    - Clear all validation errors
  - [x] 3.6 Ensure form field tests pass
    - Run ONLY the tests written in 3.1
    - Verify form state management works correctly

**Acceptance Criteria:**
- Package Set Name field renders with correct label and placeholder
- Validation error appears when name is empty/whitespace on submit
- Form state resets when modal opens
- Field changes clear associated errors

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

#### Task Group 4: Packages Builder Table
**Dependencies:** Task Group 3

- [x] 4.0 Complete packages builder table
  - [x] 4.1 Write 2-4 focused tests for packages builder
    - Test initial state has one empty package row
    - Test Add Package button creates new row with empty fields
    - Test Remove button removes a package row
    - Test package name validation error when empty on submit
  - [x] 4.2 Implement packages builder table structure
    - Editable table/list embedded within modal content area
    - Column headers: Package Name, Purpose, Actions
    - Table styling consistent with existing tables in the app
  - [x] 4.3 Implement package row rendering
    - Package Name input (required) with placeholder "Enter package name"
    - Purpose input (optional) with placeholder "Enter purpose"
    - Remove button (trash icon or text button)
    - Generate temporary ID for each row using simple counter/uuid
  - [x] 4.4 Implement Add Package functionality
    - "Add Package" button below the table
    - Button adds new row with empty name and purpose
    - New row gets temporary ID for tracking
  - [x] 4.5 Implement Remove Package functionality
    - Remove button per row (unless only 1 row exists)
    - Remove row from packages array state
    - Prevent removal of last remaining row (minimum 1 package required)
  - [x] 4.6 Implement package field change handlers
    - Handle name changes for specific row
    - Handle purpose changes for specific row
    - Clear row-level validation errors on field modification
  - [x] 4.7 Ensure packages builder tests pass
    - Run ONLY the tests written in 4.1
    - Verify add/remove/edit functionality works

**Acceptance Criteria:**
- Initial state shows one empty package row ready for input
- Add Package button adds new blank rows
- Remove button removes rows (but at least 1 row remains)
- Package Name and Purpose fields are editable per row
- Each package row has a unique identifier for React keys

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

#### Task Group 5: Optional - Package Row Reordering
**Dependencies:** Task Group 4

- [x] 5.0 Complete package row reordering (optional - implement if time permits)
  - [x] 5.1 Write 2 focused tests for reordering
    - Test moving package row up updates order
    - Test moving package row down updates order
  - [x] 5.2 Implement reordering UI
    - Up arrow button per row (disabled on first row)
    - Down arrow button per row (disabled on last row)
    - Buttons positioned in Actions column alongside Remove
  - [x] 5.3 Implement reorder logic
    - Move up: swap with previous row
    - Move down: swap with next row
    - Update packages array state accordingly
  - [x] 5.4 Ensure reordering tests pass
    - Run ONLY the tests written in 5.1

**Fallback Behavior (if not implemented):**
- Assign sort_order based on insertion/display order

**Acceptance Criteria:**
- Up/Down arrows allow reordering package rows
- First row has disabled Up button
- Last row has disabled Down button
- Order is preserved in final submission

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

#### Task Group 6: Form Validation
**Dependencies:** Task Group 4

- [x] 6.0 Complete form validation
  - [x] 6.1 Write 2-4 focused tests for validation
    - Test Create button disabled when package set name is empty
    - Test Create button disabled when any package name is empty
    - Test Create button enabled when all required fields are valid
    - Test inline error messages display on validation failure
  - [x] 6.2 Implement isFormValid computed value
    - Check package set name is non-empty (trimmed)
    - Check at least 1 package row exists
    - Check all package names are non-empty (trimmed)
    - Return boolean for Create button disabled state
  - [x] 6.3 Implement validation error tracking
    - Track errors for package set name field
    - Track errors for each package row's name field
    - Display inline error messages per field
  - [x] 6.4 Implement validation on submit attempt
    - Validate all fields before submission
    - Set validation errors for any invalid fields
    - Prevent submission if any validation fails
  - [x] 6.5 Ensure validation tests pass
    - Run ONLY the tests written in 6.1
    - Verify Create button disabled state logic

**Acceptance Criteria:**
- Create button is disabled until all conditions are met
- Inline error messages appear for empty required fields
- Validation errors clear when fields are corrected
- Form cannot be submitted with invalid data

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

#### Task Group 7: Modal CSS Styling
**Dependencies:** Task Group 4

- [x] 7.0 Complete modal CSS styling
  - [x] 7.1 Create `CreatePackageSetModal.module.css` file
    - File: `src/components/MetaModelView/CreatePackageSetModal.module.css`
    - Follow patterns from `CreateBusinessLogicModal.module.css`
  - [x] 7.2 Implement overlay and modal container styles
    - Semi-transparent backdrop overlay
    - Modal container with max-width 600px
    - Border-radius, box-shadow consistent with existing modals
  - [x] 7.3 Implement header and footer styles
    - Header with title and close button
    - Footer with action buttons
    - Background colors matching existing modals
  - [x] 7.4 Implement form field styles
    - Text input styling for Package Set Name
    - Required field indicator (asterisk) styling
    - Error state styling for inputs
    - Error message text styling
  - [x] 7.5 Implement packages builder table styles
    - Table layout with proper column widths
    - Row styling with borders
    - Input fields within table cells
    - Add Package button styling below table
    - Remove button styling per row
    - Optional: Up/Down button styling if reordering is implemented
  - [x] 7.6 Implement responsive considerations
    - Content area scrollable if exceeds viewport height
    - Table maintains usability on smaller screens

**Acceptance Criteria:**
- Modal styling is consistent with existing modals in the app
- Form fields and table are visually clean and usable
- Error states are clearly visible
- Content scrolls properly when it exceeds viewport height

**Files to Create:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.module.css`

**Reference Files:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\modals\CreateBusinessLogicModal.module.css`

---

### Integration Layer

#### Task Group 8: Form Submission and Entity Creation
**Dependencies:** Task Groups 1, 6

- [x] 8.0 Complete form submission and entity creation
  - [x] 8.1 Write 2-4 focused tests for submission
    - Test handleSubmit creates PackageSet entity with correct fields
    - Test handleSubmit creates Package entities with correct fields and sort_order
    - Test onSubmit callback is called with new PackageSet
    - Test modal closes after successful submission
  - [x] 8.2 Implement handleSubmit function
    - Validate all fields before proceeding
    - Generate Package Set ID using `generateEntityId('package_sets')`
    - Generate Package IDs using `generateEntityId('packages')`
    - Create PackageSet object: `{ id, name }`
    - Create Package objects: `{ id, package_set_id, name, purpose, sort_order }`
    - Assign sort_order as consecutive integers starting at 1 based on display order
  - [x] 8.3 Call onSubmit callback with created entities
    - Pass PackageSet entity to onSubmit
    - Pass Packages array to onSubmit (or handle dispatch internally)
  - [x] 8.4 Handle isSubmitting state
    - Set isSubmitting true during submission
    - Disable buttons during submission
    - Reset isSubmitting after completion
  - [x] 8.5 Close modal after successful creation
    - Call onClose() after entities are created
  - [x] 8.6 Ensure submission tests pass
    - Run ONLY the tests written in 8.1
    - Verify entities are created correctly

**Acceptance Criteria:**
- PackageSet entity is created with generated ID and trimmed name
- Package entities are created with generated IDs, foreign key, and sort_order
- sort_order values are consecutive integers starting at 1
- Modal closes after successful creation
- onSubmit callback receives the new PackageSet (and/or Packages)

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`

---

#### Task Group 9: PackageSetsView Integration
**Dependencies:** Task Groups 7, 8

- [x] 9.0 Complete PackageSetsView integration
  - [x] 9.1 Write 2-4 focused tests for integration
    - Test "Create Package Set" button renders in header
    - Test clicking button opens CreatePackageSetModal
    - Test newly created Package Set is auto-selected
  - [x] 9.2 Add modal state management to PackageSetsView
    - Add `isModalOpen` state with useState
    - Add `setIsModalOpen` setter function
  - [x] 9.3 Add "Create Package Set" button to header
    - Position in masterHeader section, right-aligned
    - Primary button styling
    - onClick handler opens modal
  - [x] 9.4 Import and render CreatePackageSetModal
    - Import the modal component
    - Render modal with isOpen, onClose, onSubmit props
  - [x] 9.5 Implement onSubmit handler
    - Dispatch ADD_ENTITY for package_sets with PackageSet entity
    - Dispatch ADD_ENTITY for packages for each Package entity
    - Set selectedPackageSetId to the new Package Set ID (auto-select)
  - [x] 9.6 Update masterHeader styling for button placement
    - Update CSS to support header with title and button
    - Flexbox layout with space-between
  - [x] 9.7 Ensure integration tests pass
    - Run ONLY the tests written in 9.1
    - Verify button opens modal and auto-selection works

**Acceptance Criteria:**
- "Create Package Set" button appears in Package Sets header
- Button opens the CreatePackageSetModal
- After creation, PackageSet and Packages are added to model
- Newly created Package Set is auto-selected in the master grid

**Files to Modify:**
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.module.css`

---

### Testing

#### Task Group 10: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review tests from ID generator updates (Task 1.1)
    - Review tests from modal structure (Task 2.1)
    - Review tests from form fields (Task 3.1)
    - Review tests from packages builder (Task 4.1)
    - Review tests from validation (Task 6.1)
    - Review tests from submission (Task 8.1)
    - Review tests from integration (Task 9.1)
    - Total existing tests: approximately 16-24 tests
  - [x] 10.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Create Package Set Modal feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 10.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on integration points and end-to-end workflows
    - Example additional tests:
      - Test full workflow: open modal -> fill form -> create -> verify in model
      - Test multiple packages creation with correct sort_order
      - Test error recovery: fix validation error and submit successfully
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [x] 10.4 Run feature-specific tests only
    - Run ONLY tests related to Create Package Set Modal feature
    - Expected total: approximately 24-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-32 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on Create Package Set Modal feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Utilities Layer** (Task Group 1)
   - ID generator updates - foundation for entity creation

2. **UI Components Layer** (Task Groups 2-7)
   - Modal structure (Task Group 2)
   - Form fields (Task Group 3)
   - Packages builder table (Task Group 4)
   - Package row reordering - optional (Task Group 5)
   - Form validation (Task Group 6)
   - CSS styling (Task Group 7)

3. **Integration Layer** (Task Groups 8-9)
   - Form submission and entity creation (Task Group 8)
   - PackageSetsView integration (Task Group 9)

4. **Testing** (Task Group 10)
   - Test review and gap analysis

---

## Summary of Files to Create/Modify

### Files to Create:
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\CreatePackageSetModal.module.css`

### Files to Modify:
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\utils\idGenerator.ts`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\PackageSetsView.module.css`

### Reference Files (existing patterns):
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\modals\CreateBusinessLogicModal.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\DiagramsView\modals\CreateBusinessLogicModal.module.css`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx`
- `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts`

---

## Implementation Complete

All 10 task groups have been successfully implemented.

### Test Results Summary
- **Total tests:** 91 tests passing
- **Test files created:**
  - `frontend/src/__tests__/package-set-id-generator.test.ts` (6 tests)
  - `frontend/src/__tests__/create-package-set-modal.test.ts` (39 tests)
  - `frontend/src/__tests__/create-package-set-e2e.test.ts` (8 tests)
- **Existing tests also verified:**
  - `frontend/src/__tests__/package-sets-view.test.ts` (12 tests)
  - `frontend/src/__tests__/package-sets-integration.test.ts` (6 tests)
  - `frontend/src/__tests__/package-sets-config.test.ts` (8 tests)
  - `frontend/src/__tests__/package-sets-gaps.test.ts` (12 tests)

### Files Created
1. `frontend/src/components/MetaModelView/CreatePackageSetModal.tsx`
2. `frontend/src/components/MetaModelView/CreatePackageSetModal.module.css`

### Files Modified
1. `frontend/src/utils/idGenerator.ts` - Added `pkgset` and `pkg` prefixes
2. `frontend/src/components/MetaModelView/PackageSetsView.tsx` - Added modal integration
3. `frontend/src/components/MetaModelView/PackageSetsView.module.css` - Added header button styles
