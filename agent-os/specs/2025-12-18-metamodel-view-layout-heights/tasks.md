# Task Breakdown: Meta-Model View Layout Heights

## Overview
Total Tasks: 8
Estimated Complexity: Low (CSS-only changes)

This is a targeted CSS modification to apply viewport-based heights to Meta-Model view layout containers. Only 3 CSS properties need to change across 2 files.

## Files to Modify

| File | Class | Current | Target |
|------|-------|---------|--------|
| `frontend/src/components/MetaModelView/MetaModelView.module.css` | `.container` | `height: 100%` | `height: calc(100vh - 60px)` |
| `frontend/src/components/chat/ChatPanel.module.css` | `.panel` | `height: 100%` | `height: calc(100vh - 75px)` |
| `frontend/src/components/chat/ChatPanel.module.css` | `.collapsedTab` | `height: 100%` | `height: calc(100vh - 75px)` |

## Task List

### CSS Layout Updates

#### Task Group 1: Meta-Model View Height Fixes
**Dependencies:** None

- [x] 1.0 Complete Meta-Model view layout height updates
  - [x] 1.1 Write 4 focused tests for layout height behavior
    - Test 1: MetaModelView container renders with correct viewport-based height
    - Test 2: ChatPanel expanded state (`.panel`) renders with correct height
    - Test 3: ChatPanel collapsed state (`.collapsedTab`) renders with correct height
    - Test 4: ChatPanel maintains consistent height when toggling between expanded/collapsed states
  - [x] 1.2 Update MetaModelView container height
    - File: `frontend/src/components/MetaModelView/MetaModelView.module.css`
    - Change `.container` class `height: 100%` to `height: calc(100vh - 60px)`
    - Line 4 in current file
    - Preserve all other properties: `display: flex`, `flex-direction: row`, `overflow: hidden`, `min-height: 0`
  - [x] 1.3 Update ChatPanel expanded state height
    - File: `frontend/src/components/chat/ChatPanel.module.css`
    - Change `.panel` class `height: 100%` to `height: calc(100vh - 75px)`
    - Line 41 in current file
    - Preserve all other properties: `display: flex`, `flex-direction: column`, `min-height: 0`, `align-self: stretch`, `border-right`, `background`, `position: relative`, `flex-shrink: 0`
  - [x] 1.4 Update ChatPanel collapsed state height
    - File: `frontend/src/components/chat/ChatPanel.module.css`
    - Change `.collapsedTab` class `height: 100%` to `height: calc(100vh - 75px)`
    - Line 4 in current file
    - Preserve all other properties: `width: 32px`, `min-height: 0`, `align-self: stretch`, flex layout, padding, background, border, cursor, transition, `flex-shrink: 0`
  - [x] 1.5 Verify existing functionality is preserved
    - Horizontal panel width resize (via `.resizeHandle`) still works
    - Vertical input height resize (via `.inputDragHandle`) still works
    - Collapse/expand toggle continues to function
    - ChatMessageList scrolls correctly within available space
    - ChatInput remains pinned at bottom
  - [x] 1.6 Run layout height tests
    - Run ONLY the 4 tests written in 1.1
    - Verify all height calculations render correctly
    - Verify no visual regression in layout behavior

**Acceptance Criteria:**
- MetaModelView `.container` uses `height: calc(100vh - 60px)`
- ChatPanel `.panel` uses `height: calc(100vh - 75px)`
- ChatPanel `.collapsedTab` uses `height: calc(100vh - 75px)`
- All 4 tests from task 1.1 pass
- Horizontal and vertical resize handles continue to function
- Collapse/expand toggle works without layout issues
- ChatMessageList scrolls correctly
- ChatInput stays pinned at bottom
- No layout jerking when adding messages

## Height Calculation Reference

| Value | Purpose |
|-------|---------|
| `60px` | TopBar header height (confirmed in `TopBar.module.css` and used in `App.css`) |
| `75px` | TopBar (60px) + internal offset (15px for Meta-Model header rows) |

## Execution Order

This is a single task group with no dependencies:
1. CSS Layout Updates (Task Group 1)

## Notes

- This is a CSS-only change with no JavaScript/TypeScript modifications required
- The 60px offset is already established in `App.css` for `.main-content`
- Both `.panel` and `.collapsedTab` must use the same 75px offset for visual consistency
- All existing resize and toggle functionality must be preserved
