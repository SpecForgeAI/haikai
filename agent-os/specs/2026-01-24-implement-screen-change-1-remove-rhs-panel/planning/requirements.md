# Spec Requirements: Implement Screen Change 1 - Remove RHS WorkItemSummaryPanel

## Initial Description

Remove the redundant right-hand "Work Item" panel from the Implement screen and relocate the only two required elements (Epic display and Context selector) into the left Feature Definition area, producing a clean 2-column layout: Feature Definition (left) + Team Chat (right).

The Implement screen currently has a 3-column layout with a right-hand side "Work Item" panel (WorkItemSummaryPanel) that is mostly redundant. The goal is to simplify to a 2-column layout by:
1. Removing the RHS WorkItemSummaryPanel entirely
2. Moving the Epic display into the Feature header (dark banner area) in the left Feature Definition column
3. Moving the Context selector from the RHS into the Feature Definition column, positioned below the Description and above Product Owner Understanding
4. Maintaining all existing functionality for context selection and the "Back to Backlog" action

## Requirements Discussion

### First Round Questions

**Q1:** What format should the Epic display take in the Feature header banner?
**Answer:** Display-only, no interactivity. Format exactly as: "Epic: [Epic Name, max 30 characters] -> Feature: [Feature Name]". If Epic name exceeds 30 characters, truncate with ellipsis.

**Q2:** How should the Context selector be styled when moved into the Feature Definition column?
**Answer:** Change the context selector header to match the feature headers (have the "Add context" button to the right-hand side of that header area). The chip styling should stay the same as current.

**Q3:** Where should the "Back to Backlog" action be relocated after removing the RHS panel?
**Answer:** Remove the "Back to Backlog" button entirely. Do not relocate it.

**Q4:** What should the column layout proportions be for the 2-column layout?
**Answer:** 65/35 split - Feature Definition column gets 65% width, Team Chat column gets 35% width.

**Q5:** Should any loading or error states be updated for the relocated components?
**Answer:** Maintain all existing loading and error states as-is. No changes needed.

**Q6:** Are there any other elements in the RHS WorkItemSummaryPanel that need to be preserved or relocated?
**Answer:** Remove anything else that exists in WorkItemSummaryPanel. Only the Epic display and Context selector elements are being relocated; everything else is being deleted.

### Existing Code to Reference

No similar existing features identified for reference.

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Remove the entire RHS WorkItemSummaryPanel from ProductImplementPage
- Add Epic display to the Feature header banner with format: "Epic: [name max 30 chars] -> Feature: [name]"
- Truncate Epic names exceeding 30 characters with ellipsis
- Epic display is read-only with no interactivity
- Move Context selector into Feature Definition column, positioned below Description and above Product Owner Understanding
- Context selector header should match feature header styling with "Add context" button on the right side
- Context selector chips retain existing styling
- Remove "Back to Backlog" button entirely (no relocation)
- Delete or leave unused WorkItemSummaryPanel.tsx

### Layout Requirements
- Change from 3-column to 2-column layout
- Feature Definition column: 65% width
- Team Chat column: 35% width

### Reusability Opportunities
- Existing feature header styling for the context selector header
- Existing context chip components and styling
- Existing loading and error state patterns

### Scope Boundaries

**In Scope:**
- Remove RHS WorkItemSummaryPanel from the Implement screen
- Add Epic display to Feature header banner
- Move Context selector into Feature Definition column
- Apply feature header styling to context selector header
- Update layout to 65/35 two-column split
- Remove "Back to Backlog" button

**Out of Scope:**
- Any changes to backend endpoints or response shapes
- Any changes to context selection logic or persistence semantics
- Any changes to Team Chat behavior
- Changes to loading or error states
- Any interactivity for the Epic display

### Technical Considerations
- WorkItemSummaryPanel.tsx can be deleted or left unused
- Context selector API interactions must be preserved exactly as-is
- The Epic name truncation logic (30 characters with ellipsis) needs to be implemented in the Feature header
- Layout uses percentage-based widths (65%/35%) for responsive behavior
