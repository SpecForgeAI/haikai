# Specification: Implement Screen Information Density

## Goal
Increase information density across the Implementation Assistant panel by removing the "Implementation Assistant" header bar, relocating the chat composer to the RHS Team Chat panel only, moving the Implement button to the LHS Feature column, and reducing padding/margins/font sizes throughout Feature Definition cards, Open Questions table, and FeatureHeader banner.

## User Stories
- As a Product Owner, I want to see more Feature Definition content on screen so that I can review requirements without excessive scrolling.
- As a user, I want the chat composer only in the Team Chat panel so that the LHS Feature column has more vertical space for content.

## Specific Requirements

**Remove Implementation Assistant Header Bar**
- Delete the `.header` class and associated styles from `ImplementationAssistantPanel.module.css` (lines 38-50)
- Remove the JSX that renders the header div in `ImplementationAssistantPanel.tsx`
- After removal, FeatureHeader (dark Epic -> Feature banner) becomes the topmost element beneath the tabs
- The `.title` class can also be removed as it is only used by the header

**Relocate Chat Composer to RHS Team Chat Panel**
- Move the `.inputArea` JSX block so it renders only inside the RHS `.chatPanel` (35% column)
- Anchor the composer at the bottom of the chat panel using flex layout
- Chat messages scroll above the fixed composer
- The `.chatContent` div should contain messages with `flex: 1` and `overflow-y: auto`
- The `.inputArea` stays at `flex-shrink: 0` at the bottom of `.chatPanel`

**Relocate Implement Button to LHS Feature Column**
- Move the Implement button out of the `.buttonRow` in the chat composer
- Position it in the LHS `.featurePanel`, aligned bottom-right under Feature Definition content
- Create a new `.featureFooter` container with `display: flex; justify-content: flex-end; padding: 12px 16px`
- The Send button remains with the chat composer in the RHS panel

**Feature Definition Cards Density Reduction**
- In `FeatureSectionCard.module.css`: Change `.card` padding from `16px` to `10px`
- In `FeatureSectionCard.module.css`: Change `.card` margin-bottom from `16px` to `10px`
- In `FeatureSectionCard.module.css`: Change `.sectionHeader` font-size from `14px` to `13px`
- In `FeatureSectionCard.module.css`: Change `.content` font-size from `14px` to `13px`
- In `FeatureDefinitionPanel.module.css`: Apply same reductions to `.contextCard` (padding: 10px, margin-bottom: 10px)
- In `FeatureDefinitionPanel.module.css`: Change `.contextTitle` font-size from `14px` to `13px`
- In `FeatureDefinitionPanel.module.css`: Change `.contextContent` font-size from `14px` to `13px`

**Open Questions Table Density Reduction**
- In `QuestionsTable.module.css`: Change `.header` padding from `12px 16px` to `8px 12px`
- In `QuestionsTable.module.css`: Change `.header` font-size from `13px` to `12px`
- In `QuestionsTableRow.module.css`: Change `.row` padding from `12px 0` to `8px 0`
- In `QuestionsTableRow.module.css`: Change `.answerInput` padding from `8px 12px` to `6px 10px`
- In `QuestionsTableRow.module.css`: Change `.questionText` font-size from `14px` to `13px`
- In `QuestionsTableRow.module.css`: Change `.answerInput` font-size from `14px` to `13px`
- In `QuestionsTableRow.module.css`: Change `.sourceLabel` font-size from `13px` to `12px`

**FeatureHeader Banner Density Reduction**
- In `FeatureHeader.module.css`: Change `.featureHeader` padding from `12px 16px` to `10px 14px`
- Keep the dark background and visual prominence
- Maintain all existing label/title/badge styling proportions

**Responsive Layout Density Cascade**
- Apply density reductions to tablet breakpoint (max-width: 1024px) styles
- Apply density reductions to mobile breakpoint (max-width: 768px) styles
- Ensure mobile card padding in `QuestionsTableRow.module.css` is reduced proportionally (from `16px` to `12px`)
- Keep the mobile `.submitButton` at `width: 100%` but reduce footer padding

## Visual Design
No visual mockups provided - implementation follows explicit numeric values from requirements.

## Existing Code to Leverage

**ImplementationAssistantPanel.module.css - Split Layout**
- Existing `.splitContainer`, `.featurePanel`, `.chatPanel` flex layout structure
- Use this pattern for positioning the Implement button footer in `.featurePanel`
- Existing `.chatContent` flex container can be reused for chat + composer layout

**FeatureSectionCard.module.css - Card Pattern**
- Current `.card` styling with padding/margin/border-radius provides the baseline
- Same pattern is followed by `.contextCard` in FeatureDefinitionPanel.module.css
- Reduce values consistently across both card types

**QuestionsTable/QuestionsTableRow CSS - Grid Layout**
- Existing 4-column grid layout in `.row` and `.header`
- Responsive breakpoints already defined for tablet and mobile
- Reduce padding values while preserving grid structure

**ImplementationAssistantPanel.tsx - Button Row Pattern**
- Existing `.buttonRow` with Send and Implement buttons shows current layout
- Extract Implement button to its own location while preserving state/handlers
- The `handleImplement` callback and disabled state logic remain unchanged

**FeatureDefinitionPanel.tsx - Panel Structure**
- Existing `.panel` with FeatureHeader and scrollable `.content` area
- Add a footer section below `.content` for the Implement button placement

## Out of Scope
- No changes to button behavior or click handlers
- No changes to API endpoints or data models
- No changes to state management or context providers
- No changes to the 65/35 split ratio between Feature and Chat panels
- No changes to mobile tab bar switching behavior
- No changes to chat message rendering or formatting
- No new components or files beyond CSS modifications and minor JSX restructuring
- No changes to color schemes or visual theming
- No changes to FeatureHeader badge logic or epic/feature display format
- No changes to QuestionsTable filtering logic or submit button enable logic
