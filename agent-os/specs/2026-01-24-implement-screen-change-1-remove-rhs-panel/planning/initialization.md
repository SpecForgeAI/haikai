# Spec Initialization

## Title
Implement Screen Change 1 — Remove RHS WorkItemSummaryPanel; Move Epic Header + Context Selector into Feature Column

## Description
Remove the redundant right-hand "Work Item" panel from the Implement screen and relocate the only
two required elements (Epic display and Context selector) into the left Feature Definition area,
producing a clean 2-column layout: Feature Definition (left) + Team Chat (right).

## Scope

### In Scope
- Delete/hide the RHS Work Item area on the Implement screen (WorkItemSummaryPanel)
- Move Epic display into the Feature header (dark banner) in the Feature Definition column
- Move the Context selector UI from RHS into the Feature Definition column (below Description, above Product Owner Understanding)
- Preserve existing context behavior and API interactions
- Keep "Back to Backlog" action accessible

### Out of Scope
- Any changes to backend endpoints or response shapes
- Any changes to context selection logic or persistence semantics
- Any changes to Team Chat behavior

## Raw Idea
The Implement screen currently has a 3-column layout with a right-hand side "Work Item" panel (WorkItemSummaryPanel) that is mostly redundant. The goal is to simplify to a 2-column layout by:
1. Removing the RHS WorkItemSummaryPanel entirely
2. Moving the Epic display into the Feature header (dark banner area) in the left Feature Definition column
3. Moving the Context selector from the RHS into the Feature Definition column, positioned below the Description and above Product Owner Understanding
4. Maintaining all existing functionality for context selection and the "Back to Backlog" action
