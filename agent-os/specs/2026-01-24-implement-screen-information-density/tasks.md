# Task Breakdown: Implement Screen Information Density

## Overview
Total Tasks: 29

This spec covers Screen Change 4 with three main parts:
- Part A: Remove "Implementation Assistant" header bar
- Part B: Move chat composer to RHS Team Chat panel only
- Part C: Density changes (reduce padding, margins, font sizes)

## Task List

### Part A: Header Removal

#### Task Group 1: Remove Implementation Assistant Header Bar
**Dependencies:** None
**Files:** `ImplementationAssistantPanel.tsx`, `ImplementationAssistantPanel.module.css`

- [x] 1.0 Complete header bar removal
  - [x] 1.1 Write 2-4 focused tests for header removal
    - Test that FeatureHeader is the topmost element after header removal
    - Test that no element with `.header` class is rendered in ImplementationAssistantPanel
    - Test that panel still renders correctly without header
  - [x] 1.2 Remove `.header` class and associated styles from `ImplementationAssistantPanel.module.css`
    - Delete lines 38-50 (`.header` block with padding, border-bottom, background, flex-shrink)
    - Delete lines 45-50 (`.title` block as it is only used by the header)
  - [x] 1.3 Remove header JSX from `ImplementationAssistantPanel.tsx`
    - Locate and remove the `<div className={styles.header}>` block
    - Remove any associated `<h2 className={styles.title}>` element
    - Ensure FeatureHeader becomes the topmost element beneath the tabs
  - [x] 1.4 Ensure header removal tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify FeatureHeader is now the topmost element

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- No "Implementation Assistant" header bar is rendered
- FeatureHeader (dark Epic -> Feature banner) is the topmost element beneath tabs
- No orphaned CSS classes remain

---

### Part B: Composer Relocation and Button Movement

#### Task Group 2: Relocate Chat Composer to RHS Panel
**Dependencies:** Task Group 1
**Files:** `ImplementationAssistantPanel.tsx`, `ImplementationAssistantPanel.module.css`

- [x] 2.0 Complete composer relocation to RHS panel
  - [x] 2.1 Write 2-4 focused tests for composer relocation
    - Test that `.inputArea` renders only inside `.chatPanel`
    - Test that composer is anchored at bottom of chat panel
    - Test that chat messages scroll above the fixed composer
    - Test Send button remains with composer in RHS
  - [x] 2.2 Restructure `.inputArea` JSX to render inside `.chatPanel` only
    - Move the `.inputArea` block from its current location
    - Place it as the last child inside the `.chatPanel` div
    - Ensure it renders after `.chatContent`
  - [x] 2.3 Update `.chatPanel` CSS for flex layout with composer at bottom
    - Verify `.chatPanel` has `display: flex; flex-direction: column`
    - Ensure `.chatContent` has `flex: 1` and `overflow-y: auto` for scrolling messages
    - Ensure `.inputArea` has `flex-shrink: 0` to stay at bottom
  - [x] 2.4 Verify Send button stays with composer
    - Confirm Send button remains in `.buttonRow` inside `.inputArea`
    - No changes to Send button handler or styling
  - [x] 2.5 Ensure composer relocation tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify chat messages scroll above fixed composer

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- Composer renders only in RHS chat panel (35% column)
- Composer anchored at bottom with messages scrolling above
- Send button remains functional with composer

#### Task Group 3: Relocate Implement Button to LHS Feature Panel
**Dependencies:** Task Group 2
**Files:** `ImplementationAssistantPanel.tsx`, `ImplementationAssistantPanel.module.css`, `FeatureDefinitionPanel.tsx`, `FeatureDefinitionPanel.module.css`

- [x] 3.0 Complete Implement button relocation to LHS panel
  - [x] 3.1 Write 2-4 focused tests for Implement button relocation
    - Test that Implement button renders in `.featureFooter` inside `.featurePanel`
    - Test that Implement button is positioned bottom-right under Feature Definition
    - Test that Implement button handler still works correctly
    - Test that `.buttonRow` in RHS only contains Send button
  - [x] 3.2 Create `.featureFooter` container in `ImplementationAssistantPanel.module.css`
    - Add new CSS class: `.featureFooter { display: flex; justify-content: flex-end; padding: 12px 16px; }`
    - Add border-top styling for visual separation
    - Set `flex-shrink: 0` to prevent footer from collapsing
  - [x] 3.3 Update `ImplementationAssistantPanel.tsx` to render Implement button in LHS footer
    - Extract Implement button from `.buttonRow`
    - Create new `.featureFooter` div inside `.featurePanel`
    - Move Implement button into `.featureFooter`
    - Preserve `handleImplement` callback and disabled state logic
  - [x] 3.4 Remove Implement button from RHS `.buttonRow`
    - Ensure `.buttonRow` only contains Send button
    - Adjust `.buttonRow` styling if needed for single button
  - [x] 3.5 Update responsive styles for footer
    - Ensure footer displays correctly on tablet (max-width: 1024px)
    - Ensure footer displays correctly on mobile (max-width: 768px)
    - Footer should remain at bottom of `.featurePanel` on all breakpoints
  - [x] 3.6 Ensure Implement button relocation tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify button position and functionality

**Acceptance Criteria:**
- The 2-4 tests written in 3.1 pass
- Implement button renders in LHS `.featurePanel` footer
- Button aligned bottom-right under Feature Definition content
- Button functionality (handler, disabled state) unchanged
- Send button alone in RHS `.buttonRow`

---

### Part C: Density Reduction

#### Task Group 4: Feature Definition Cards Density Reduction
**Dependencies:** Task Groups 1-3
**Files:** `FeatureSectionCard.module.css`, `FeatureDefinitionPanel.module.css`

- [x] 4.0 Complete Feature Definition cards density reduction
  - [x] 4.1 Write 2-4 focused tests for card density changes
    - Test that `.card` has padding of 10px
    - Test that `.card` has margin-bottom of 10px
    - Test that `.sectionHeader` has font-size of 13px
    - Test that `.contextCard` follows same density reductions
  - [x] 4.2 Update `FeatureSectionCard.module.css` card density
    - Change `.card` padding from `16px` to `10px`
    - Change `.card` margin-bottom from `16px` to `10px`
    - Change `.sectionHeader` font-size from `14px` to `13px`
    - Change `.content` font-size from `14px` to `13px`
  - [x] 4.3 Update `FeatureDefinitionPanel.module.css` context card density
    - Change `.contextCard` padding from `16px` to `10px`
    - Change `.contextCard` margin-bottom from `16px` to `10px`
    - Change `.contextTitle` font-size from `14px` to `13px`
    - Change `.contextContent` font-size from `14px` to `13px`
  - [x] 4.4 Ensure card density tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify visual appearance matches requirements

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- Card padding reduced from 16px to 10px
- Card margins reduced from 16px to 10px
- Section header and content font sizes reduced from 14px to 13px

#### Task Group 5: Open Questions Table Density Reduction
**Dependencies:** Task Group 4
**Files:** `QuestionsTable.module.css`, `QuestionsTableRow.module.css`

- [x] 5.0 Complete Open Questions table density reduction
  - [x] 5.1 Write 2-4 focused tests for table density changes
    - Test that `.header` has padding of 8px 12px
    - Test that `.row` has padding of 8px 0
    - Test that `.answerInput` has padding of 6px 10px
    - Test that font sizes are reduced appropriately
  - [x] 5.2 Update `QuestionsTable.module.css` header density
    - Change `.header` padding from `12px 16px` to `8px 12px`
    - Change `.header` font-size from `13px` to `12px`
  - [x] 5.3 Update `QuestionsTableRow.module.css` row density
    - Change `.row` padding from `12px 0` to `8px 0`
    - Change `.answerInput` padding from `8px 12px` to `6px 10px`
    - Change `.questionText` font-size from `14px` to `13px`
    - Change `.answerInput` font-size from `14px` to `13px`
    - Change `.sourceLabel` font-size from `13px` to `12px`
  - [x] 5.4 Ensure table density tests pass
    - Run ONLY the 2-4 tests written in 5.1
    - Verify table renders correctly with reduced density

**Acceptance Criteria:**
- The 2-4 tests written in 5.1 pass
- Header padding reduced from 12px 16px to 8px 12px
- Row padding reduced from 12px to 8px
- Input padding reduced from 8px 12px to 6px 10px
- Font sizes reduced by one step

#### Task Group 6: FeatureHeader Banner Density Reduction
**Dependencies:** Task Group 5
**Files:** `FeatureHeader.module.css`

- [x] 6.0 Complete FeatureHeader banner density reduction
  - [x] 6.1 Write 2-4 focused tests for banner density changes
    - Test that `.featureHeader` has padding of 10px 14px
    - Test that dark background is preserved
    - Test that visual prominence is maintained
  - [x] 6.2 Update `FeatureHeader.module.css` padding
    - Change `.featureHeader` padding from `12px 16px` to `10px 14px`
    - Preserve dark background (#2D2D2D)
    - Preserve all existing label/title/badge styling proportions
  - [x] 6.3 Ensure banner density tests pass
    - Run ONLY the 2-4 tests written in 6.1
    - Verify visual appearance remains prominent

**Acceptance Criteria:**
- The 2-4 tests written in 6.1 pass
- Banner padding reduced from 12px 16px to 10px 14px
- Dark background preserved
- Visual prominence maintained

#### Task Group 7: Responsive Layout Density Cascade
**Dependencies:** Task Groups 4-6
**Files:** `FeatureSectionCard.module.css`, `FeatureDefinitionPanel.module.css`, `QuestionsTable.module.css`, `QuestionsTableRow.module.css`, `FeatureHeader.module.css`

- [x] 7.0 Complete responsive layout density adjustments
  - [x] 7.1 Write 2-4 focused tests for responsive density
    - Test tablet breakpoint (max-width: 1024px) has reduced density
    - Test mobile breakpoint (max-width: 768px) has reduced density
    - Test mobile card padding in QuestionsTableRow is reduced proportionally
  - [x] 7.2 Apply density reductions to tablet breakpoint (max-width: 1024px)
    - Review and update any tablet-specific padding overrides
    - Ensure density reductions cascade to tablet styles
    - Maintain proportional reductions
  - [x] 7.3 Apply density reductions to mobile breakpoint (max-width: 768px)
    - Update mobile `.row` padding in `QuestionsTableRow.module.css` from `16px` to `12px`
    - Reduce footer padding proportionally
    - Keep mobile `.submitButton` at `width: 100%`
  - [x] 7.4 Ensure responsive density tests pass
    - Run ONLY the 2-4 tests written in 7.1
    - Test at multiple viewport widths

**Acceptance Criteria:**
- The 2-4 tests written in 7.1 pass
- Tablet styles have proportional density reductions
- Mobile card padding reduced from 16px to 12px
- Mobile submit button remains full-width
- All breakpoints maintain consistent visual hierarchy

---

### Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 2-4 tests from header removal (Task 1.1)
    - Review the 2-4 tests from composer relocation (Task 2.1)
    - Review the 2-4 tests from Implement button relocation (Task 3.1)
    - Review the 2-4 tests from card density (Task 4.1)
    - Review the 2-4 tests from table density (Task 5.1)
    - Review the 2-4 tests from banner density (Task 6.1)
    - Review the 2-4 tests from responsive density (Task 7.1)
    - Total existing tests: approximately 14-28 tests
  - [x] 8.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's density and layout changes
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end layout verification over unit test gaps
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Focus on integration points (e.g., button handler still works after relocation)
    - Test responsive behavior at actual breakpoints
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests unless business-critical
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 24-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify all layout and density changes work correctly

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-38 tests total)
- Critical layout workflows for this feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's layout and density changes

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Remove Implementation Assistant Header Bar
   - Clears the header, making FeatureHeader the topmost element

2. **Task Group 2**: Relocate Chat Composer to RHS Panel
   - Moves composer into chat panel with proper flex layout

3. **Task Group 3**: Relocate Implement Button to LHS Feature Panel
   - Creates feature footer, moves button, updates both panels

4. **Task Group 4**: Feature Definition Cards Density Reduction
   - Reduces padding, margins, font sizes on cards

5. **Task Group 5**: Open Questions Table Density Reduction
   - Reduces padding and font sizes in questions table

6. **Task Group 6**: FeatureHeader Banner Density Reduction
   - Reduces banner padding while maintaining prominence

7. **Task Group 7**: Responsive Layout Density Cascade
   - Ensures density changes apply to tablet and mobile breakpoints

8. **Task Group 8**: Test Review and Gap Analysis
   - Reviews all tests and fills critical gaps

---

## Files Summary

| File | Task Groups |
|------|-------------|
| `ImplementationAssistantPanel.tsx` | 1, 2, 3 |
| `ImplementationAssistantPanel.module.css` | 1, 2, 3 |
| `FeatureDefinitionPanel.tsx` | 3 (if passing button as prop) |
| `FeatureDefinitionPanel.module.css` | 4 |
| `FeatureSectionCard.module.css` | 4, 7 |
| `FeatureHeader.module.css` | 6, 7 |
| `QuestionsTable.module.css` | 5, 7 |
| `QuestionsTableRow.module.css` | 5, 7 |

---

## Out of Scope Reminders

Per spec requirements, the following are explicitly out of scope:
- No changes to button behavior or click handlers (only location changes)
- No changes to API endpoints or data models
- No changes to state management or context providers
- No changes to the 65/35 split ratio between Feature and Chat panels
- No changes to mobile tab bar switching behavior
- No changes to chat message rendering or formatting
- No new components or files beyond CSS modifications and minor JSX restructuring
- No changes to color schemes or visual theming
- No changes to FeatureHeader badge logic or epic/feature display format
- No changes to QuestionsTable filtering logic or submit button enable logic
