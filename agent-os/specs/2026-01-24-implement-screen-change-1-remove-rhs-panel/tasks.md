# Task Breakdown: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel

## Overview
Total Tasks: 25

This spec removes the redundant right-hand "Work Item" panel (WorkItemSummaryPanel) from ProductImplementPage and consolidates required elements (Epic display, Context selector) into the left Feature Definition area, producing a clean 2-column layout.

## Key Files Affected

### Primary Files
- `frontend/src/components/ProductView/ProductImplementPage.tsx` - Remove RHS panel, update props
- `frontend/src/components/ProductView/ProductImplementPage.module.css` - Remove rightPane styles
- `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` - Update 60/40 to 65/35 split
- `frontend/src/components/ProductView/FeatureHeader.tsx` - Add epicName prop and display
- `frontend/src/components/ProductView/FeatureHeader.module.css` - Add epic label styles
- `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` - Add Context section

### Secondary Files
- `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx` - Delete or leave unused
- `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css` - Delete or leave unused

## Task List

### Layout and Structure Changes

#### Task Group 1: Remove RHS Panel and Update Layout (65/35)
**Dependencies:** None

- [x] 1.0 Complete RHS panel removal and layout update
  - [x] 1.1 Write 4 focused tests for layout changes
    - Test that ProductImplementPage renders without rightPane div
    - Test that leftPane occupies full width when WorkItemSummaryPanel removed
    - Test that ImplementationAssistantPanel splitContainer uses 65/35 proportions
    - Test that onBackToBacklog prop is no longer required in ProductImplementPageProps
  - [x] 1.2 Update ProductImplementPage.tsx to remove RHS panel
    - Remove import statement for WorkItemSummaryPanel
    - Remove the `<div className={styles.rightPane}>` wrapper and its contents (lines 468-479)
    - Remove WorkItemSummaryPanel component invocation
    - Keep ContextPickerModal integration as-is (it stays in ProductImplementPage)
  - [x] 1.3 Update ProductImplementPageProps interface
    - Remove onBackToBacklog from ProductImplementPageProps interface
    - Remove onBackToBacklog from destructured props in component function
    - Update any parent components that pass onBackToBacklog (if any)
  - [x] 1.4 Update ProductImplementPage.module.css
    - Remove .rightPane style block (lines 29-37)
    - Update .leftPane to use `flex: 1` instead of `flex: 0 0 65%` (it becomes only pane)
    - Remove border-right from .leftPane since no right pane exists
  - [x] 1.5 Update ImplementationAssistantPanel.module.css layout
    - Change .featurePanel from `flex: 0 0 60%` to `flex: 0 0 65%`
    - Change .chatPanel from `flex: 0 0 40%` to `flex: 0 0 35%`
    - Update tablet breakpoint: keep 50/50 split
  - [x] 1.6 Clean up unused state/callbacks in ProductImplementPage
    - Review if any context handlers (handleRemoveEntityChip, handleRemoveDiagramChip) need relocation
    - Context handlers will be needed in FeatureDefinitionPanel (Task Group 3)
  - [x] 1.7 Ensure layout tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify two-column layout renders correctly
    - Verify responsive breakpoints still work

**Acceptance Criteria:**
- ProductImplementPage no longer renders WorkItemSummaryPanel
- No rightPane div in ProductImplementPage
- leftPane takes full width of ProductImplementPage
- Inner split is 65% Feature Definition / 35% Team Chat
- onBackToBacklog prop removed from interface
- The 4 tests from 1.1 pass

---

### Feature Header Enhancement

#### Task Group 2: Epic Display in Feature Header
**Dependencies:** Task Group 1

- [x] 2.0 Complete Epic display implementation
  - [x] 2.1 Write 4 focused tests for Epic display
    - Test FeatureHeader renders "Feature: [name]" when epicName is undefined/null
    - Test FeatureHeader renders "Epic: [name] -> Feature: [name]" when epicName provided
    - Test epicName truncation at 30 characters with ellipsis
    - Test epicLabel and arrowSeparator CSS classes applied correctly
  - [x] 2.2 Extend FeatureHeaderProps interface
    - Add optional `epicName?: string` prop to FeatureHeaderProps
    - Document prop with JSDoc comment
  - [x] 2.3 Implement Epic display logic in FeatureHeader.tsx
    - Add truncation helper function (30 char limit with "...")
    - Add conditional rendering: if epicName exists, show "Epic: [truncated] -> Feature: [title]"
    - If epicName is undefined/null/empty, show current behavior: "Feature: [title]"
    - Epic display is read-only with no interactivity
  - [x] 2.4 Update FeatureHeader.module.css
    - Add .epicLabel class matching .featureLabel styling (14px, 600 weight, #B0B0B0)
    - Add .epicName class for the truncated epic name (14px, 700 weight, #ffffff)
    - Add .arrowSeparator class with proper spacing and styling (e.g., " -> ")
    - Ensure layout flows correctly with flex/baseline alignment
  - [x] 2.5 Update FeatureDefinitionPanel to pass epicName
    - Add epicName prop to FeatureDefinitionPanelProps
    - Pass epicName to FeatureHeader component
  - [x] 2.6 Update ImplementationAssistantPanel to pass epicName
    - Add epicName prop to ImplementationAssistantPanelProps
    - Pass epicName to FeatureDefinitionPanel
    - Source: derive from parentChain (first parent with type="EPIC")
  - [x] 2.7 Update ProductImplementPage to pass epicName
    - Derive epicName from parentChain array (find first parent with type="EPIC")
    - Pass to ImplementationAssistantPanel
  - [x] 2.8 Ensure Epic display tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify truncation logic works correctly
    - Verify Epic -> Feature format displays correctly

**Acceptance Criteria:**
- FeatureHeader shows "Epic: [name max 30 chars] -> Feature: [name]" when epic exists
- Epic names longer than 30 characters are truncated with ellipsis
- FeatureHeader shows only "Feature: [name]" when no epic
- Epic display is read-only
- The 4 tests from 2.1 pass

---

### Context Selector Integration

#### Task Group 3: Context Selector Relocation and Styling
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete Context selector integration
  - [x] 3.1 Write 6 focused tests for Context section
    - Test Context section renders in FeatureDefinitionPanel
    - Test Context section positioned after Description, before Product Owner Understanding
    - Test Context header matches FeatureSectionCard styling (14px, 600 weight, #333333)
    - Test "Add context" button positioned on right side of header
    - Test entity/diagram/relationship chips render with existing styling
    - Test onAddContext, onRemoveEntityChip, onRemoveDiagramChip callbacks work
  - [x] 3.2 Extract Context section component from WorkItemSummaryPanel
    - Option A: Create new ContextSectionCard.tsx component with shared logic
    - Option B: Duplicate logic directly in FeatureDefinitionPanel (less DRY, simpler)
    - Include all chip components: EntityChip, DiagramChip, RelationshipChip
    - Include aggregation functions: aggregateEntityChips, aggregateDiagramChips, aggregateRelationshipChips
    - Include getChipDisplayLabel helper for fallback display
  - [x] 3.3 Update FeatureDefinitionPanelProps interface
    - Add contextState: ContextState | undefined
    - Add contextLoading: boolean
    - Add onAddContext: () => void
    - Add onRemoveEntityChip: (entityId: string) => void
    - Add onRemoveDiagramChip: (diagramId: string) => void
    - Add onRemoveRelationshipChip?: (relationshipId: string) => void (optional)
  - [x] 3.4 Add Context section to FeatureDefinitionPanel.tsx
    - Insert new FeatureSectionCard for "Context" after Description section
    - Position before Product Owner Understanding section
    - Render Context section content using extracted/duplicated logic
    - Handle empty state: "No context linked yet. Click 'Add context'..."
  - [x] 3.5 Style Context header to match feature headers
    - Use FeatureSectionCard pattern for card container
    - Customize header with flex layout: justify-content: space-between
    - "Context" label on left with sectionHeader styling
    - "Add context" button on right
    - Ensure button styling matches existing addContextButton from WorkItemSummaryPanel
  - [x] 3.6 Update ImplementationAssistantPanelProps and component
    - Add context-related props to pass down to FeatureDefinitionPanel
    - contextState, contextLoading, onAddContext, onRemoveEntityChip, onRemoveDiagramChip
    - Wire up from ProductImplementPage through ImplementationAssistantPanel to FeatureDefinitionPanel
  - [x] 3.7 Update ProductImplementPage to pass context props
    - Pass contextState, contextLoading, handleAddContext to ImplementationAssistantPanel
    - Pass handleRemoveEntityChip, handleRemoveDiagramChip handlers
    - These handlers already exist in ProductImplementPage
  - [x] 3.8 Ensure Context section tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify Context section renders in correct position
    - Verify chips display and removal works
    - Verify "Add context" opens modal

**Acceptance Criteria:**
- Context section appears in FeatureDefinitionPanel below Description
- Context section appears above Product Owner Understanding
- Context header uses FeatureSectionCard header styling (14px, 600, #333333)
- "Add context" button positioned on right side of header
- Chip styling unchanged from WorkItemSummaryPanel
- All context callbacks work correctly
- The 6 tests from 3.1 pass

---

### Cleanup and Verification

#### Task Group 4: Cleanup and Final Verification
**Dependencies:** Task Groups 1, 2, and 3

- [x] 4.0 Complete cleanup and verification
  - [x] 4.1 Review existing tests from Task Groups 1-3
    - Review 4 layout tests from Task Group 1
    - Review 4 Epic display tests from Task Group 2
    - Review 6 Context section tests from Task Group 3
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze critical workflow gaps
    - Identify any missing end-to-end workflow tests
    - Focus on user journeys: navigate to Implement, view context, add context
    - Prioritize integration points between components
  - [x] 4.3 Write up to 6 additional tests (if necessary)
    - Integration test: full ProductImplementPage renders with new layout
    - Integration test: Context section updates when context changes
    - Integration test: Epic display updates when parent chain changes
    - Verify empty states render correctly
    - Maximum 6 additional tests to fill critical gaps only
  - [x] 4.4 Handle WorkItemSummaryPanel cleanup
    - Option A (Recommended): Delete WorkItemSummaryPanel.tsx and WorkItemSummaryPanel.module.css
    - Option B: Leave files with deprecation comment at top
    - Remove any exports from index files if deleting
    - Ensure no other files import WorkItemSummaryPanel
  - [x] 4.5 Remove "Back to Backlog" button references
    - Verify onBackToBacklog removed from ProductImplementPage props
    - Verify no Back to Backlog button in empty states (update if present)
    - Check for any other references to Back to Backlog in codebase
  - [x] 4.6 Update empty states in ProductImplementPage
    - Remove "Go to Backlog" button from no-project-state (lines 391-396)
    - Remove "Go to Backlog" button from empty-state (lines 443-448)
    - Update empty state messaging if needed
  - [x] 4.7 Run feature-specific test suite
    - Run all tests from Tasks 1.1, 2.1, 3.1, and 4.3
    - Expected total: approximately 14-20 tests
    - Do NOT run entire application test suite
    - Verify all critical workflows pass
  - [x] 4.8 Final visual verification
    - Verify 65/35 split renders correctly on desktop
    - Verify responsive breakpoints work (tablet stacked, mobile tabs)
    - Verify Epic -> Feature display in header
    - Verify Context section in correct position with proper styling

**Acceptance Criteria:**
- All 14-20 feature-specific tests pass
- WorkItemSummaryPanel deleted or marked deprecated
- No Back to Backlog button anywhere in ProductImplementPage
- Empty states updated appropriately
- Visual layout matches spec requirements
- No broken imports or references

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Remove RHS Panel and Update Layout** (No dependencies)
   - Focus: Structural changes to ProductImplementPage and CSS
   - Result: Single-pane layout with 65/35 inner split

2. **Task Group 2: Epic Display in Feature Header** (Depends on TG1)
   - Focus: FeatureHeader enhancement with epic information
   - Result: Epic -> Feature breadcrumb in header

3. **Task Group 3: Context Selector Relocation and Styling** (Depends on TG1, TG2)
   - Focus: Move Context section into FeatureDefinitionPanel
   - Result: Context UI integrated into Feature Definition area

4. **Task Group 4: Cleanup and Final Verification** (Depends on TG1, TG2, TG3)
   - Focus: Delete unused code, verify all functionality
   - Result: Clean, tested implementation

---

## Technical Notes

### Prop Threading Path
```
ProductImplementPage
  -> ImplementationAssistantPanel (epicName, contextState, contextLoading, onAddContext, onRemove*)
    -> FeatureDefinitionPanel (epicName, contextState, contextLoading, onAddContext, onRemove*)
      -> FeatureHeader (epicName)
      -> ContextSectionCard (contextState, contextLoading, onAddContext, onRemove*)
```

### Epic Name Derivation
```typescript
// In ProductImplementPage, derive epicName from parentChain
const epicName = useMemo(() => {
  const epic = parentChain.find(parent => parent.type.toUpperCase() === 'EPIC');
  return epic?.title;
}, [parentChain]);
```

### Truncation Helper
```typescript
function truncateEpicName(name: string, maxLength = 30): string {
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
}
```

### Files to Delete (Task 4.4)
- `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`
- `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css`

### Empty State Updates (Task 4.6)
Remove "Go to Backlog" buttons from:
- No project loaded state (data-testid="no-project-state")
- Empty state with no workItemId (data-testid="empty-state")
