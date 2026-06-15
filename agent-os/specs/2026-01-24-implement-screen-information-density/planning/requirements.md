# Spec Requirements: Implement Screen Information Density

## Initial Description

This spec covers Screen Change 4 with three main parts:

A) Remove "Implementation Assistant" header bar
B) Move chat composer into RHS Team Chat panel only
C) Density changes (reduce padding, margins, font sizes)

Key requirements from user's YAML:
- Remove full-width "Implementation Assistant" header bar entirely
- Move composer to only render inside RHS Team Chat panel (anchored at bottom)
- LHS Feature Definition column gains reclaimed vertical space
- Reduce vertical padding/margins in Feature Definition cards by 25-40%
- Reduce gaps between cards by 30-40%
- Reduce section header font size by one step
- Reduce body text font size slightly
- Reduce Open Questions table row height and padding
- Team Chat becomes vertical flex layout (scrolling messages + fixed composer)

## Requirements Discussion

### First Round Questions

**Q1:** Confirmed removal of `.header` in `ImplementationAssistantPanel.module.css`?
**Answer:** Yes - remove the `.header` entirely. After removal, FeatureHeader (dark Epic to Feature banner) becomes the top element beneath the tabs.

**Q2:** Where should the chat composer move?
**Answer:** Move `.inputArea` so it renders only inside the RHS `.chatPanel` (35% column). Anchored at the bottom, with chat messages scrolling above it.

**Q3:** What happens to the Send and Implement buttons?
**Answer:** Send button stays with the chat composer in RHS. Implement button moves to LHS Feature column, aligned bottom-right under Feature Definition content (near "Answer Open Questions" once present).

**Q4:** What are the specific density reductions for Feature Definition cards?
**Answer:** Card padding: 16px to 10px. Card margin-bottom: 16px to 10px. Section header font-size: 14px to 13px. Content font-size: 14px to 13px. Context card follows same reductions.

**Q5:** What are the specific density reductions for Open Questions table?
**Answer:** Header padding: 12px 16px to 8px 12px. Row padding: 12px 0 to 8px 0. Input padding: 8px 12px to 6px 10px. Reduce font sizes by one step.

**Q6:** What about the FeatureHeader banner density?
**Answer:** Slightly densify (reduce padding) but keep visually prominent.

**Q7:** Do density changes apply only to desktop or also responsive layouts?
**Answer:** Density reductions cascade to responsive layouts (not desktop-only).

**Q8:** Any exclusions from scope?
**Answer:** No behavioral changes. No endpoint/state model changes. No structural changes beyond presentation/layout.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ImplementationAssistantPanel - Path: `frontend/src/components/ImplementationAssistant/`
- CSS Module: `ImplementationAssistantPanel.module.css` - contains `.header`, `.inputArea`, `.chatPanel` styles
- Components to potentially modify: FeatureHeader, Feature Definition cards, Open Questions table

### Follow-up Questions

No follow-up questions were needed - all requirements were confirmed with specific values.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visual files found in planning/visuals folder.

## Requirements Summary

### Functional Requirements

#### Part A: Remove "Implementation Assistant" Header Bar
- Remove the `.header` class and its styles entirely from `ImplementationAssistantPanel.module.css`
- Remove any JSX/TSX that renders the header bar
- After removal, FeatureHeader (dark Epic to Feature banner) becomes the top element beneath the tabs

#### Part B: Move Composer to RHS Team Chat Panel
- Move `.inputArea` (chat composer) to render only inside the RHS `.chatPanel` (35% column)
- Composer anchored at the bottom of the chat panel
- Chat messages scroll above the composer
- **Send button**: Stays with the chat composer in RHS
- **Implement button**: Moves to LHS Feature column, aligned bottom-right under Feature Definition content (near "Answer Open Questions" once present)

#### Part C: Density Changes

**Feature Definition Cards:**
| Property | Current | New |
|----------|---------|-----|
| Card padding | 16px | 10px |
| Card margin-bottom | 16px | 10px |
| Section header font-size | 14px | 13px |
| Content font-size | 14px | 13px |

- Context card follows same reductions

**Open Questions Table:**
| Property | Current | New |
|----------|---------|-----|
| Header padding | 12px 16px | 8px 12px |
| Row padding | 12px 0 | 8px 0 |
| Input padding | 8px 12px | 6px 10px |
| Font sizes | Current | Reduce by one step |

**FeatureHeader Banner:**
- Slightly reduce padding
- Keep visually prominent

**Responsive:**
- Density reductions cascade to responsive layouts (not desktop-only)

### Reusability Opportunities
- Existing CSS Module patterns in `ImplementationAssistantPanel.module.css`
- Existing responsive breakpoints in the component styles
- Existing flex layout patterns for chat panel structure

### Scope Boundaries

**In Scope:**
- CSS changes for density reduction (padding, margins, font sizes)
- Layout restructuring to move composer to RHS panel
- Moving Implement button to LHS Feature column
- Removing Implementation Assistant header bar
- Responsive layout adjustments

**Out of Scope:**
- No behavioral changes
- No endpoint/state model changes
- No structural changes beyond presentation/layout
- No new functionality

### Technical Considerations
- Changes are CSS-focused with minimal JSX restructuring
- Must preserve existing functionality while changing layout
- Responsive breakpoints must be updated to maintain density reductions across screen sizes
- Test that chat scrolling behavior works correctly with composer anchored at bottom
