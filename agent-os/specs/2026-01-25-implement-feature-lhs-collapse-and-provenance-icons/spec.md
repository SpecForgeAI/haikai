# Specification: Feature LHS Collapse and Provenance Icons

## Goal
Consolidate sections in the Implement Feature LHS panel to create more vertical space and make section provenance explicit (user-authored vs planner/LLM-generated) using lucide-react icons, while reordering sections so Open Questions appears last.

## User Stories
- As a user, I want to see at a glance which sections contain my input versus planner-generated content so that I understand the provenance of each piece of information.
- As a user, I want a more compact LHS panel with fewer separate sections so that I can see more content without scrolling.

## Specific Requirements

**Provenance Icons in Section Headers**
- Import `SquareUserRound` and `Bot` icons from lucide-react
- Render `SquareUserRound` icon for user-authored sections (Initial Description & Context)
- Render `Bot` icon for planner-generated sections (Product Owner Understanding, Scope, Acceptance Criteria, Assumptions)
- Icons should be 16px in size with consistent vertical alignment to header text baseline
- Position icons to the left of the section title text with appropriate gap (8px)

**Enhanced FeatureSectionCard for Icon Support**
- Add optional `icon` prop of type `React.ReactNode` to FeatureSectionCard component
- Add optional `headerRightContent` prop for placing elements (e.g., buttons) on the right side of the header
- When `icon` prop is provided, render it before the title in a flex container
- Ensure icon aligns vertically with the title text baseline
- Add `.sectionHeaderWithIcon` CSS class for flex layout: `display: flex; align-items: center; gap: 8px`

**Combined Initial Description & Context Section**
- Replace separate "Description" and "Context" sections with a single combined section
- Section title: "Initial Description & Context" with `SquareUserRound` icon
- Position "+ Add context" button in the section header, right-aligned (use `headerRightContent` prop)
- Render Description content first, followed by a line break (no divider rule)
- Render Context chips row and empty state after the line break
- Apply distinct visual styling: subtle background tint (#FAFAFA) and colored left border accent (4px solid #1976d2)
- Remove the separate ContextSection component rendering; inline its content into this combined section

**Combined Scope Section with 2-Column Layout**
- Replace separate "Scope" and "Out of Scope" sections with a single combined section
- Section title: "Scope" with `Bot` icon
- Section body uses CSS Grid: `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`
- Left column: title "In Scope" (with border-bottom underline), containing existing scope.in bullet list
- Right column: title "Out of Scope" (with border-bottom underline), containing existing scope.out bullet list
- Column titles use `.scopeColumnTitle` class: `font-weight: 600; font-size: 12px; padding-bottom: 4px; margin-bottom: 8px; border-bottom: 1px solid #E0E0E0`
- Only render combined section if either scopeIn.length > 0 OR scopeOut.length > 0
- Show empty column with "None defined" message if one array is empty but the other has content

**Open Questions Header with Dual Icons**
- Render Open Questions header with both `Bot` and `SquareUserRound` icons separated by ampersand: `[Bot] & [SquareUserRound] Open Questions`
- Style the ampersand with muted appearance: `color: #888888; opacity: 0.7; margin: 0 4px`
- Both icons remain 16px in size
- Pass a custom header element to FeatureSectionCard instead of relying on icon prop

**Section Reordering**
- Update FeatureDefinitionPanel to render sections in new order (top to bottom):
  1. Initial Description & Context (combined) - with distinct styling
  2. Product Owner Understanding
  3. Scope (combined 2-column)
  4. Acceptance Criteria
  5. Assumptions
  6. Open Questions (moved to last position before Implementation Plan)
- Implementation Plan section remains at the end, after Open Questions, unchanged

**Distinct Top Section Styling**
- Create `.topSectionCard` CSS class extending base card styles
- Add subtle background tint: `background: #FAFAFA`
- Add left border accent: `border-left: 4px solid #1976d2`
- Keep all other card styling (border-radius, padding, margin) consistent with other sections

## Visual Design
No visual mockups were provided. Implementation should follow these design guidelines:
- Icons: lucide-react icons at 16px, vertically centered with header text
- Top section: distinguish with #FAFAFA background and 4px solid #1976d2 left border
- Scope columns: equal width (50%/50%), titles underlined with border-bottom
- Ampersand: muted color (#888888) at 70% opacity between dual icons

## Existing Code to Leverage

**FeatureSectionCard.tsx**
- Current component provides title, children, isEmpty, and emptyMessage props
- Extend to add optional `icon` and `headerRightContent` props
- Maintains existing card styling pattern used throughout the panel

**FeatureDefinitionPanel.tsx**
- Contains all section rendering logic and ordering in lines 686-791
- ContextSection is a separate internal component (lines 501-616) that can be adapted
- Chip components and aggregation logic (lines 159-370) should be preserved
- deriveQuestions function and QuestionsTable integration remain unchanged

**FeatureDefinitionPanel.module.css**
- Contains existing context card styling (.contextCard, .contextHeader, .contextTitle, etc.) that can inform combined section styling
- Chip styles (.entityChip, .diagramChip, .relationshipChip) should be reused
- .addContextButton styling should be preserved

**ContextPickerModal.tsx lucide-react pattern**
- Icons imported as named exports: `import { ChartNetwork } from 'lucide-react'`
- Icons rendered with size prop: `<Icon size={16} />`
- Icons styled with className for consistent sizing

**architectureDomain.ts icon pattern**
- Type `LucideIcon` imported from lucide-react for typing icon props
- Pattern: `Record<string, LucideIcon>` for icon mappings

## Out of Scope
- Mobile/responsive redesign beyond what naturally follows from existing layout rules
- Changes to the ImplementationPlanSection component or its styling/iconography
- Changes to content semantics within sections (only header/icons, ordering, and merges)
- Changes to QuestionsTable component or answer submission logic
- Changes to FeatureHeader component
- Backend API changes
- New test files (tests should be updated separately)
- Changes to IncrementCard or pipeline execution functionality
- Context picker modal changes
- Changes to chip aggregation logic
