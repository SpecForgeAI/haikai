# Task Breakdown: Service Package Set Assignment Dropdown

## Overview
Total Tasks: 21

This feature adds a "Package Set" dropdown column to the Services grid in MetaModelView, allowing architects to assign Package Sets to Services with shortcuts for creating new or cloning existing Package Sets.

## Task List

### UI Components Layer

#### Task Group 1: PackageSetCell Custom Cell Component
**Dependencies:** None

- [x] 1.0 Complete PackageSetCell component
  - [x] 1.1 Write 2-6 focused tests for PackageSetCell functionality
    - Test renders "Default (Auto)" when package_set_id is null
    - Test renders Package Set name when package_set_id is set
    - Test dropdown opens with correct options structure
    - Test "Create new..." action item triggers callback
    - Test "Clone and customize..." disabled state when no concrete selection
    - Test selecting "Default (Auto)" sets value to null
  - [x] 1.2 Create PackageSetCell component file
    - Location: `frontend/src/components/Grid/PackageSetCell.tsx`
    - Import types: PackageSet, Package, AnyEntity from model.ts
    - Import styles from Grid.module.css
    - Define props interface: value (string | null), packageSets (PackageSet[]), packages (Package[]), onChange, onCreateNew, onClone
  - [x] 1.3 Implement dropdown structure and options
    - First option: "Default (Auto)" with visual emphasis
    - Divider line (CSS border or separator element)
    - Map existing Package Sets by name
    - Divider line before actions
    - "Create new..." action item (always enabled)
    - "Clone and customize..." action item (conditionally disabled)
  - [x] 1.4 Implement "Default (Auto)" selection behavior
    - Selecting sets value to null via onChange(null)
    - Display "Default (Auto)" when value is null or undefined
  - [x] 1.5 Implement Package Set selection behavior
    - Selecting a Package Set calls onChange with package_set_id
    - Highlight currently selected item in dropdown
  - [x] 1.6 Implement action item click handlers
    - "Create new..." calls onCreateNew callback
    - "Clone and customize..." calls onClone callback (only when enabled)
    - Disable "Clone and customize..." when value is null
  - [x] 1.7 Add CSS styles for dropdown
    - Style divider lines between sections
    - Style action items differently from regular options
    - Add disabled styling for "Clone and customize..."
    - Match existing TypeaheadCell dropdown styling patterns
  - [x] 1.8 Ensure PackageSetCell tests pass
    - Run ONLY the 2-6 tests written in 1.1
    - Verify dropdown renders correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 1.1 pass
- Dropdown displays "Default (Auto)" when package_set_id is null
- Package Sets are listed by name
- Action items are styled and positioned correctly
- "Clone and customize..." is disabled when appropriate

---

#### Task Group 2: Optional Read-Only Preview Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete PackageSetPreview component (optional feature)
  - [x] 2.1 Write 2-4 focused tests for preview functionality
    - Test renders packages list when concrete Package Set is selected
    - Test displays package name and purpose for each item
    - Test packages are ordered by sort_order ascending
    - Test preview hidden when no concrete selection
  - [x] 2.2 Create PackageSetPreview component file
    - Location: `frontend/src/components/Grid/PackageSetPreview.tsx`
    - Props: packageSetId (string | null), packageSets (PackageSet[]), packages (Package[])
  - [x] 2.3 Implement preview rendering logic
    - Return null if packageSetId is null (no preview for Default)
    - Filter packages by package_set_id
    - Sort by sort_order ascending
    - Render compact list showing name and purpose
  - [x] 2.4 Add CSS styles for preview
    - Compact layout (inline or below dropdown)
    - Subtle styling to not distract from main grid
    - Truncate long purpose text with ellipsis
  - [x] 2.5 Ensure preview tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify preview renders correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Preview shows packages when concrete Package Set selected
- Preview is hidden when "Default (Auto)" is selected
- Packages are correctly ordered

---

### Grid Configuration Layer

#### Task Group 3: Services Grid Configuration Update
**Dependencies:** Task Group 1

- [x] 3.0 Complete grid configuration updates
  - [x] 3.1 Write 2-4 focused tests for grid config
    - Test services grid config has package_set column after core_tech
    - Test column uses custom cell type (package_set_dropdown)
    - Test column configuration is nullable (required: false)
    - Test field binds to package_set_id
  - [x] 3.2 Update gridConfigs.ts for services
    - Location: `frontend/src/config/gridConfigs.ts`
    - Add new column after 'core_tech' field (line 106)
    - Field: 'package_set_id'
    - DisplayName: 'Package Set'
    - CellType: 'package_set_dropdown' (custom cell type)
    - Required: false
    - Width: 160 (or appropriate width for dropdown)
  - [x] 3.3 Register custom cell type in Grid component
    - Location: `frontend/src/components/Grid/Grid.tsx`
    - Add case for 'package_set_dropdown' cellType
    - Render PackageSetCell with appropriate props
    - Pass packageSets and packages from model
  - [x] 3.4 Ensure grid config tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify column appears in correct position
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Package Set column appears after Core Tech in services grid
- Column uses custom PackageSetCell renderer
- Field binds correctly to service.package_set_id

---

### Modal Integration Layer

#### Task Group 4: Create/Clone Modal Integration from Cell
**Dependencies:** Task Groups 1, 3

- [x] 4.0 Complete modal integration with PackageSetCell
  - [x] 4.1 Write 2-6 focused tests for modal integration
    - Test "Create new..." opens CreatePackageSetModal in create mode
    - Test "Clone and customize..." opens modal in clone mode with correct initialData
    - Test service.package_set_id updates to new Package Set id after create
    - Test service.package_set_id updates to new Package Set id after clone
    - Test modal receives existingPackageSetNames for uniqueness validation
    - Test user remains in Services grid after modal closes
  - [x] 4.2 Add modal state management to Grid component
    - Add state: isPackageSetModalOpen, packageSetModalMode, cloneInitialData
    - Pass modal open callbacks to PackageSetCell
  - [x] 4.3 Implement "Create new..." workflow
    - Open CreatePackageSetModal with mode: 'create'
    - Pass existingPackageSetNames from metaModel.entities.package_sets
    - On submit: dispatch ADD_ENTITY for package_set and packages
    - Update service.package_set_id to new package set id via UPDATE_ENTITY
  - [x] 4.4 Implement "Clone and customize..." workflow
    - Resolve source Package Set from current package_set_id
    - Filter and sort source packages by sort_order
    - Prepare CloneInitialData with name: "<source name> (copy)"
    - Open CreatePackageSetModal with mode: 'clone' and initialData
    - On submit: dispatch ADD_ENTITY for package_set and packages
    - Update service.package_set_id to new package set id
  - [x] 4.5 Wire modal callbacks in Grid render
    - Render CreatePackageSetModal conditionally based on state
    - Pass onClose to reset modal state
    - Pass onSubmit handler that dispatches and updates service
  - [x] 4.6 Ensure modal integration tests pass
    - Run ONLY the 2-6 tests written in 4.1
    - Verify create and clone workflows complete correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 4.1 pass
- "Create new..." opens modal and creates new Package Set
- "Clone and customize..." clones existing Package Set
- Service's package_set_id updates correctly after modal submission
- User stays in Services grid context

---

### Persistence Layer

#### Task Group 5: Save/Load Round-Trip Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete persistence verification
  - [x] 5.1 Write 2-4 focused tests for persistence
    - Test service.package_set_id included in save serialization
    - Test service.package_set_id loaded correctly from saved file
    - Test null package_set_id persists correctly (not dropped)
    - Test package_set_id reference survives File -> Save/Open round-trip
  - [x] 5.2 Verify fileOperations.ts handles package_set_id
    - Location: `frontend/src/utils/fileOperations.ts`
    - Check Service serialization includes package_set_id
    - Confirm field is not filtered out during save
    - Confirm field is preserved during load
  - [x] 5.3 Verify sanitize.ts preserves package_set_id
    - Location: `frontend/src/utils/sanitize.ts`
    - Check Service sanitization does not drop package_set_id
    - Ensure null/undefined values handled correctly
  - [x] 5.4 Ensure persistence tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify save/load round-trip works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- package_set_id persists through File -> Save
- package_set_id loads correctly through File -> Open
- Null values are preserved (not converted to empty string)

---

### Testing

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-6 tests from PackageSetCell (Task 1.1)
    - Review the 2-4 tests from PackageSetPreview (Task 2.1)
    - Review the 2-4 tests from grid config (Task 3.1)
    - Review the 2-6 tests from modal integration (Task 4.1)
    - Review the 2-4 tests from persistence (Task 5.1)
    - Total existing tests: approximately 10-24 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Package Set Assignment feature
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 6 additional strategic tests maximum
    - Add maximum of 6 new tests to fill identified critical gaps
    - Consider integration test: complete create flow from cell to modal to grid update
    - Consider integration test: complete clone flow from cell to modal to grid update
    - Consider edge case: rapid dropdown interactions
    - Consider edge case: modal cancel does not update service
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to Package Set Assignment feature
    - Expected total: approximately 16-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-30 tests total)
- Critical user workflows for Package Set Assignment are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this feature's requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: PackageSetCell Component** - Build the core dropdown cell component
2. **Task Group 2: PackageSetPreview Component** (Optional) - Add read-only preview capability
3. **Task Group 3: Grid Configuration** - Wire up the column in services grid
4. **Task Group 4: Modal Integration** - Connect create/clone workflows
5. **Task Group 5: Persistence Verification** - Ensure save/load works correctly
6. **Task Group 6: Test Review & Gap Analysis** - Verify complete feature coverage

---

## Files to Modify/Create

### New Files
- `frontend/src/components/Grid/PackageSetCell.tsx` - Custom dropdown cell component
- `frontend/src/components/Grid/PackageSetCell.module.css` - Styles for dropdown (optional, can use Grid.module.css)
- `frontend/src/components/Grid/PackageSetPreview.tsx` - Optional preview component
- `frontend/src/__tests__/package-set-cell.test.ts` - Unit tests for PackageSetCell
- `frontend/src/__tests__/package-set-assignment.test.ts` - Integration tests

### Modified Files
- `frontend/src/config/gridConfigs.ts` - Add Package Set column to services config (line ~106)
- `frontend/src/components/Grid/Grid.tsx` - Register package_set_dropdown cell type
- `frontend/src/components/Grid/Grid.module.css` - Add styles for dropdown sections/dividers

### Reference Files (Existing Code to Leverage)
- `frontend/src/components/MetaModelView/CreatePackageSetModal.tsx` - Existing modal with create/clone modes
- `frontend/src/components/MetaModelView/PackageSetsView.tsx` - Pattern for clone data preparation
- `frontend/src/components/Grid/TypeaheadCell.tsx` - Pattern for dropdown cell implementation
- `frontend/src/types/model.ts` - Service.package_set_id field (line 295)

---

## Out of Scope (Per Spec)

- Implementing standards-based default matching logic for "Default (Auto)"
- Auto-import of company/project package-sets.json files
- Editing existing package sets from the Service screen
- Backend API changes or schema modifications
- Automatic package set assignment based on core_tech or service_type
- Inline editing of package names/purposes from the preview
- Navigation away from Service editor after create/clone operations
- Validation rules for package set compatibility with service type
- Delete or unassign package set functionality beyond selecting "Default (Auto)"
