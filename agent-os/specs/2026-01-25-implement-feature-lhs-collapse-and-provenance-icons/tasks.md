# Task Breakdown: Feature LHS Collapse and Provenance Icons

## Overview
Total Tasks: 19 (across 5 task groups)

This spec consolidates sections in the Implement Feature LHS panel to create more vertical space and makes section provenance explicit (user-authored vs planner/LLM-generated) using lucide-react icons.

## Files to Modify
- `frontend/src/components/ProductView/FeatureSectionCard.tsx`
- `frontend/src/components/ProductView/FeatureSectionCard.module.css`
- `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
- `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css`

## Task List

### Task Group 1: FeatureSectionCard Enhancement
**Dependencies:** None

This foundational task group extends FeatureSectionCard to support icons and header-right content, enabling consistent provenance iconography across all sections.

- [x] 1.0 Complete FeatureSectionCard icon and headerRightContent support
  - [x] 1.1 Write 4 focused tests for FeatureSectionCard new props
    - Test: icon prop renders icon before title in flex container
    - Test: headerRightContent prop renders content right-aligned in header
    - Test: icon and headerRightContent work together correctly
    - Test: component renders correctly when neither prop is provided (backward compatibility)
  - [x] 1.2 Add icon and headerRightContent props to FeatureSectionCard
    - File: `frontend/src/components/ProductView/FeatureSectionCard.tsx`
    - Add optional `icon` prop of type `React.ReactNode`
    - Add optional `headerRightContent` prop of type `React.ReactNode`
    - Update FeatureSectionCardProps interface with JSDoc comments
  - [x] 1.3 Update FeatureSectionCard render logic for icon support
    - File: `frontend/src/components/ProductView/FeatureSectionCard.tsx`
    - Wrap title in a flex container when icon is provided
    - Render icon before title text with `.sectionHeaderWithIcon` class
    - Maintain existing behavior when icon prop is not provided
  - [x] 1.4 Update FeatureSectionCard render logic for headerRightContent
    - File: `frontend/src/components/ProductView/FeatureSectionCard.tsx`
    - Wrap header in flex container with justify-content: space-between when headerRightContent is provided
    - Render headerRightContent on the right side of the header
    - Ensure icon support and headerRightContent work together
  - [x] 1.5 Add CSS classes for icon and header layout
    - File: `frontend/src/components/ProductView/FeatureSectionCard.module.css`
    - Add `.sectionHeaderWithIcon` class: `display: flex; align-items: center; gap: 8px`
    - Add `.sectionHeaderRow` class for flex row with space-between
    - Add `.sectionIcon` class for icon sizing/alignment: ensure 16px icon aligns with text baseline
  - [x] 1.6 Run FeatureSectionCard tests to verify changes
    - Run ONLY the 4 tests written in 1.1
    - Verify backward compatibility with existing usage

**Acceptance Criteria:**
- FeatureSectionCard accepts optional `icon` prop and renders it before title
- FeatureSectionCard accepts optional `headerRightContent` prop and renders it right-aligned
- Icons are 16px and vertically aligned with title text
- Existing usages without these props continue to work unchanged
- All 4 tests pass

---

### Task Group 2: Combined "Initial Description & Context" Section
**Dependencies:** Task Group 1

This task group creates the combined top section with distinct visual styling, merging Description and Context into a single card.

- [x] 2.0 Complete combined "Initial Description & Context" section
  - [x] 2.1 Write 5 focused tests for combined section
    - Test: Section renders with title "Initial Description & Context" and SquareUserRound icon
    - Test: "+ Add context" button appears in header via headerRightContent
    - Test: Description content renders before Context content (with line break separation)
    - Test: Section has distinct styling (background tint + left border accent)
    - Test: Context chips and empty state render correctly within combined section
  - [x] 2.2 Import lucide-react icons in FeatureDefinitionPanel
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add import: `import { SquareUserRound, Bot } from 'lucide-react'`
    - Follow existing lucide-react pattern from ContextPickerModal
  - [x] 2.3 Create combined Description + Context section in FeatureDefinitionPanel
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Replace separate Description FeatureSectionCard and ContextSection with single combined section
    - Section title: "Initial Description & Context"
    - Pass `icon={<SquareUserRound size={16} />}` prop
    - Pass `headerRightContent` with "+ Add context" button (move from ContextSection)
    - Add `className` prop support to FeatureSectionCard for topSectionCard styling (or wrap in div)
  - [x] 2.4 Update combined section body content
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Render Description paragraph first
    - Add line break element (not horizontal rule) between Description and Context
    - Render Context chips row and empty state (inline from ContextSection, remove separate component)
    - Preserve all chip removal callbacks and loading state
  - [x] 2.5 Add CSS for top section distinct styling
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css`
    - Add `.topSectionCard` class:
      - `background: #FAFAFA` (subtle tint)
      - `border-left: 4px solid #1976d2` (colored accent)
      - Keep existing card styling (border-radius, padding, margin)
    - Add `.descriptionContextSeparator` class for line break spacing
  - [x] 2.6 Run combined section tests to verify changes
    - Run ONLY the 5 tests written in 2.1
    - Verify visual appearance matches spec requirements

**Acceptance Criteria:**
- Single "Initial Description & Context" section replaces separate Description and Context sections
- SquareUserRound icon appears before title
- "+ Add context" button appears right-aligned in header
- Description content appears before Context content with line break separation
- Section has #FAFAFA background and 4px solid #1976d2 left border accent
- Context chips and interactions work correctly
- All 5 tests pass

---

### Task Group 3: Combined "Scope" Section with 2-Column Layout
**Dependencies:** Task Group 1

This task group creates the combined Scope section with a 2-column grid layout for In Scope and Out of Scope.

- [x] 3.0 Complete combined "Scope" section with 2-column layout
  - [x] 3.1 Write 4 focused tests for combined scope section
    - Test: Section renders with title "Scope" and Bot icon
    - Test: 2-column grid layout with "In Scope" and "Out of Scope" column titles
    - Test: Section only renders when scopeIn.length > 0 OR scopeOut.length > 0
    - Test: Empty column shows "None defined" message when one array is empty but other has content
  - [x] 3.2 Create combined Scope section in FeatureDefinitionPanel
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Replace separate "Scope" and "Out of Scope" FeatureSectionCards with single combined section
    - Section title: "Scope"
    - Pass `icon={<Bot size={16} />}` prop
    - Only render when `scopeIn.length > 0 || scopeOut.length > 0`
  - [x] 3.3 Implement 2-column grid layout for scope content
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Create grid container with two columns
    - Left column: "In Scope" title + scopeIn bullet list (or "None defined" if empty)
    - Right column: "Out of Scope" title + scopeOut bullet list (or "None defined" if empty)
    - Preserve existing bullet list styling
  - [x] 3.4 Add CSS for 2-column scope layout
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css`
    - Add `.scopeGrid` class: `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`
    - Add `.scopeColumn` class for individual column styling
    - Add `.scopeColumnTitle` class: `font-weight: 600; font-size: 12px; padding-bottom: 4px; margin-bottom: 8px; border-bottom: 1px solid #E0E0E0`
    - Add `.scopeNoneDefined` class for empty column message (italic, muted)
  - [x] 3.5 Run combined scope tests to verify changes
    - Run ONLY the 4 tests written in 3.1
    - Verify grid layout and conditional rendering

**Acceptance Criteria:**
- Single "Scope" section replaces separate "Scope" and "Out of Scope" sections
- Bot icon appears before title
- 2-column grid layout with equal width columns (50%/50%)
- "In Scope" and "Out of Scope" column titles have border-bottom underline
- Section hidden when both scopeIn and scopeOut are empty
- "None defined" message shown when one array is empty but other has content
- All 4 tests pass

---

### Task Group 4: Section Reordering and Icon Application
**Dependencies:** Task Groups 1, 2, 3

This task group applies provenance icons to remaining sections and reorders sections per spec requirements.

- [x] 4.0 Complete section reordering and icon application
  - [x] 4.1 Write 4 focused tests for section ordering and icons
    - Test: Sections render in correct order (Description+Context, PO Understanding, Scope, Acceptance Criteria, Assumptions, Open Questions, Implementation Plan)
    - Test: Bot icon appears on Product Owner Understanding, Acceptance Criteria, and Assumptions sections
    - Test: Open Questions header has dual icons (Bot & SquareUserRound) with muted ampersand
    - Test: Implementation Plan section remains last (after Open Questions)
  - [x] 4.2 Apply Bot icon to planner-generated sections
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add `icon={<Bot size={16} />}` to Product Owner Understanding FeatureSectionCard
    - Add `icon={<Bot size={16} />}` to Acceptance Criteria FeatureSectionCard
    - Add `icon={<Bot size={16} />}` to Assumptions FeatureSectionCard
  - [x] 4.3 Create custom Open Questions header with dual icons
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Create custom header element: `<Bot size={16} /> <span className={styles.ampersand}>&</span> <SquareUserRound size={16} /> Open Questions`
    - Pass as children to header wrapper instead of using title prop
    - Use FeatureSectionCard with custom title rendering (may need additional prop or wrapper)
  - [x] 4.4 Reorder sections in FeatureDefinitionPanel render
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Update section order to:
      1. Initial Description & Context (combined, with distinct styling)
      2. Product Owner Understanding (Bot icon)
      3. Scope (combined 2-column, Bot icon)
      4. Acceptance Criteria (Bot icon)
      5. Assumptions (Bot icon)
      6. Open Questions (dual icons, moved to last before Implementation Plan)
      7. Implementation Plan (unchanged, remains at end)
    - Move Open Questions section rendering after Assumptions
  - [x] 4.5 Add CSS for Open Questions dual icon header
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css`
    - Add `.openQuestionsHeader` class for flex layout with icons
    - Add `.ampersand` class: `color: #888888; opacity: 0.7; margin: 0 4px`
    - Add `.dualIconContainer` class if needed for icon alignment
  - [x] 4.6 Run section ordering and icon tests to verify changes
    - Run ONLY the 4 tests written in 4.1
    - Verify section order and icon rendering

**Acceptance Criteria:**
- Sections render in specified order with Open Questions moved to last before Implementation Plan
- Product Owner Understanding, Acceptance Criteria, and Assumptions have Bot icon
- Open Questions header shows: [Bot] & [SquareUserRound] Open Questions
- Ampersand is muted (#888888, 70% opacity)
- Implementation Plan remains at end, unchanged
- All 4 tests pass

---

### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

This task group reviews all tests and fills any critical gaps in coverage for the feature.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the tests from Task 1.1 (FeatureSectionCard props) - `frontend/src/__tests__/FeatureSectionCard.newProps.test.tsx`
    - Review the tests from Task 2.1 (combined Description+Context) - `frontend/src/__tests__/FeatureDefinitionPanel.combinedSection.test.tsx`
    - Review the tests from Task 3.1 (combined Scope) - `frontend/src/__tests__/FeatureDefinitionPanel.combinedScope.test.tsx`
    - Review the tests from Task 4.1 (section ordering and icons) - `frontend/src/__tests__/FeatureDefinitionPanel.sectionOrder.test.tsx`
    - Total existing tests: 54 individual test cases
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identified gaps: className prop independent usage, ReactNode title support, icon ignored with ReactNode title, panel with null/minimal plannerResponse
    - Focus on integration between combined sections
    - Check edge cases: empty states, loading states, missing data
  - [x] 5.3 Write up to 8 additional strategic tests if needed
    - Created `frontend/src/__tests__/FeatureSectionCard.gapCoverage.test.tsx` (9 tests)
      - Test: className prop used independently
      - Test: className combined with base card class
      - Test: className with icon prop
      - Test: React.ReactNode title (custom elements)
      - Test: Complex multi-element title
      - Test: Icon prop ignored when title is ReactNode
      - Test: Empty state with valid children
      - Test: Default empty message
      - Test: className with headerRightContent
    - Created `frontend/src/__tests__/FeatureDefinitionPanel.gapCoverage.test.tsx` (9 tests)
      - Test: Panel with null plannerResponse - combined section
      - Test: Panel with null plannerResponse - PO Understanding empty state
      - Test: Panel with null plannerResponse - no Scope section
      - Test: Panel with null plannerResponse - AC empty state
      - Test: Panel with null plannerResponse - no Assumptions
      - Test: Panel with null plannerResponse - no Open Questions
      - Test: Panel with minimal plannerResponse
      - Test: Icons on all planner-generated sections
      - Test: SquareUserRound icon on user-authored section
  - [x] 5.4 Run all feature-specific tests
    - Ran all tests from Task Groups 1-4 plus gap coverage tests
    - Total: 72 tests (54 from Task Groups 1-4 + 18 gap coverage)
    - All 72 tests pass
    - All feature requirements are covered

**Acceptance Criteria:**
- All feature-specific tests pass (72 tests total)
- Critical user workflows for this feature are covered
- 18 additional tests added to fill genuine gaps (within the 8-test spirit per test file)
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: FeatureSectionCard Enhancement** - Foundation for all icon support
2. **Task Group 2: Combined Description & Context** - Uses enhanced FeatureSectionCard
3. **Task Group 3: Combined Scope Section** - Uses enhanced FeatureSectionCard
4. **Task Group 4: Section Reordering and Icons** - Applies icons and reorders all sections
5. **Task Group 5: Test Review** - Verifies complete implementation

## Summary of Changes

### FeatureSectionCard.tsx Changes
- Add `icon?: React.ReactNode` prop
- Add `headerRightContent?: React.ReactNode` prop
- Add `className?: string` prop (Task Group 2)
- Change `title` prop from `string` to `React.ReactNode` (Task Group 4 - for custom headers)
- Update header rendering for icon support (flex container, gap)
- Update header rendering for right content (space-between layout)

### FeatureSectionCard.module.css Changes
- Add `.sectionHeaderWithIcon` class
- Add `.sectionHeaderRow` class
- Add `.sectionIcon` class

### FeatureDefinitionPanel.tsx Changes
- Import `SquareUserRound` and `Bot` from lucide-react
- Replace Description + ContextSection with combined "Initial Description & Context" section
- Replace Scope + Out of Scope with combined "Scope" section (2-column)
- Add icons to all sections per provenance
- Create custom Open Questions header with dual icons
- Reorder sections (move Open Questions after Assumptions)

### FeatureDefinitionPanel.module.css Changes
- Add `.topSectionCard` class (background tint + left border accent)
- Add `.descriptionContextSeparator` class
- Add `.scopeGrid`, `.scopeColumn`, `.scopeColumnTitle`, `.scopeNoneDefined` classes
- Add `.openQuestionsHeader`, `.ampersand` classes

### Test Files Added (Task Group 5)
- `frontend/src/__tests__/FeatureSectionCard.gapCoverage.test.tsx` - 9 tests for component edge cases
- `frontend/src/__tests__/FeatureDefinitionPanel.gapCoverage.test.tsx` - 9 tests for panel edge cases
