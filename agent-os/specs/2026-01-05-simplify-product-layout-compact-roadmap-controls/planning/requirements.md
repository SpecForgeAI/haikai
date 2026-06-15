# Requirements: Simplify Product Layout and Compact Roadmap Controls

## Title
Simplify Product layout and compact Roadmap controls into a thin control row

## Intent
Reduce vertical and horizontal space waste in the Product area, especially on the Roadmap screen,
by removing redundant headers and compacting Roadmap import/refresh controls into a thin row
below the Product sub-tabs, leaving the roadmap tree as the primary visible content.

## Scope
- frontend UI/layout only
- no data model, API, or behavior changes
- reuse existing roadmap import/refresh logic

## Requirements

### 1) Remove redundant "Product" header row
- Remove the second-row header that displays the text "Product" under the top-level navigation.
- Do not replace it with any other header.
- Product sub-tabs ([Roadmap][Backlog][Implement]) should become the first visible row below the top nav.

### 2) Compact Roadmap controls into a thin row
- On the Roadmap tab only:
  - Add a new thin horizontal control row directly BELOW the Product sub-tab row.
  - Height should be comparable to the sub-tab row (compact, single-line).

- Replace the existing:
  - "Import roadmap.md" button
  - "Refresh" button
  with a single button labeled:
  - "Import/Refresh roadmap.md"

- Button behavior:
  - Trigger the same roadmap import/refresh action currently used by both Import and Refresh.
  - No change to backend calls or success/error handling.

- Move the "Last Imported" summary into this control row:
  - Place it to the RIGHT of the Import/Refresh button.
  - Display the same information as today (revision, time ago, source).
  - Keep existing formatting cues (e.g., badges like "Rev 1", "AGENT OS"), but inline and compact.

### 3) Roadmap main content layout
- The main Roadmap content area should contain ONLY:
  - The collapsible initiative/epic tree.
- The tree should:
  - Start at the left edge of the content area.
  - Retain the same width it currently uses (do not stretch to full width).
- The remaining right-side space should be empty (reserved for future use).

### 4) Remove old Roadmap left-side panel
- Remove the current left-side column/panel that contains:
  - Import roadmap.md
  - Refresh
  - Last Imported card
- Ensure no duplicate controls remain after the new control row is added.

## Implementation Notes

### Frontend
- Identify and remove the Product header row in the Product view layout component.
- Refactor the Roadmap page layout:
  - Extract existing import/refresh logic into a single handler if not already shared.
  - Add a compact control row component rendered only when activeTab === 'roadmap'.
  - Move and restyle the Last Imported display into inline form within this row.
- Ensure existing CSS classes or layout containers are adjusted to:
  - eliminate the old left-side panel
  - keep the roadmap tree container width unchanged

## Constraints
- Do NOT change:
  - roadmap import semantics
  - tab keys or routing logic
  - backend APIs
  - initiative/epic tree behavior
- Keep all changes localized to Product/Roadmap layout components and styles.

## Acceptance Criteria
- No "Product" header row appears under the top-level navigation.
- On the Roadmap tab:
  - A single thin control row appears under the sub-tabs.
  - It contains "Import/Refresh roadmap.md" on the left and Last Imported info on the right.
- The initiative/epic roadmap tree is the only main content visible and retains its current width.
- Import/Refresh works exactly as before.
- No unused or duplicate controls remain on the screen.
