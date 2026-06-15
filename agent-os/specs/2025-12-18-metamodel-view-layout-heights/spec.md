# Specification: Meta-Model View Layout Heights

## Goal
Apply explicit, fixed-height CSS styles using viewport-based calculations to the Meta-Model view layout containers and ChatPanel, replacing percentage-based heights that fail to produce the correct visual result.

## User Stories
- As a user, I want the Meta-Model view content area to fill the full available space beneath the top header so that the layout appears consistent and professional.
- As a user, I want the ChatPanel (both expanded and collapsed states) to render at the correct height so the input is pinned at the bottom and messages scroll properly without layout jerking.

## Specific Requirements

**Update MetaModelView container height**
- File: `frontend/src/components/MetaModelView/MetaModelView.module.css`
- Change `.container` height from `height: 100%` to `height: calc(100vh - 60px)`
- The 60px offset accounts for the fixed TopBar header height
- Preserve existing `display: flex`, `flex-direction: row`, `overflow: hidden`, and `min-height: 0` properties
- This container holds both the ChatPanel (left) and mainContent (right)

**Update ChatPanel expanded state height**
- File: `frontend/src/components/chat/ChatPanel.module.css`
- Change `.panel` height from `height: 100%` to `height: calc(100vh - 75px)`
- The 75px offset = 60px (TopBar) + 15px (internal spacing offset for Meta-Model header rows)
- Preserve all other existing properties: `display: flex`, `flex-direction: column`, `min-height: 0`, `align-self: stretch`, `border-right`, `background`, `position: relative`, `flex-shrink: 0`
- This ensures the ChatMessageList scrolls correctly and ChatInput stays pinned at bottom

**Update ChatPanel collapsed state height**
- File: `frontend/src/components/chat/ChatPanel.module.css`
- Change `.collapsedTab` height from `height: 100%` to `height: calc(100vh - 75px)`
- Must use the same height calculation as `.panel` for visual consistency between states
- Preserve all other existing properties: `width: 32px`, `min-height: 0`, `align-self: stretch`, flex layout, padding, background, border, cursor, transition, `flex-shrink: 0`

**Preserve existing resize functionality**
- Horizontal width resize (via `.resizeHandle`) must continue to work
- Vertical input height resize (via `.inputDragHandle`) must continue to work
- Collapse/expand toggle must continue to work
- Width is state-driven via inline style, not affected by height changes

**Maintain internal layout behavior**
- ChatMessageList must continue to scroll independently within available space
- ChatInput must remain pinned at the bottom of the panel
- Error banner must render correctly when present
- No layout jerking when messages are added to the chat

## Visual Design
No visual mockups provided. The target layout has been confirmed visually by the user in browser testing with DevTools.

## Existing Code to Leverage

**App.css `.main-content` (line 19-24)**
- Already uses `height: calc(100vh - 60px)` pattern for the main content area
- Confirms the 60px offset value for the TopBar is correct
- Same pattern should be applied to MetaModelView `.container` for consistency

**TopBar.module.css `.topBar` (line 1-14)**
- Defines fixed header with `height: 60px` and `position: fixed`
- Confirms the exact header height value used in calculations
- The `top: 0` and `z-index: 100` ensure it overlays content

**MetaModelView.module.css `.headerRow` (line 16-24)**
- Each header row has `padding: 8px 16px` contributing to the 15px internal offset
- Two header rows (Entities + Relationships) exist in the Meta-Model view
- These contribute to the additional 15px offset needed for ChatPanel (75px - 60px)

**ChatPanel.tsx structure (lines 156-233)**
- Collapsed state returns `.collapsedTab` div (line 158-178)
- Expanded state returns `.panel` div with ref for resize handling (line 182-232)
- Both states must be updated to maintain visual consistency

## Out of Scope
- Changes to TopBar height or TopBar component itself
- Backend services or API behavior
- Chat message functionality or message handling logic
- ChatMessageList or ChatInput internal component changes
- Modifying the horizontal width resize behavior
- Modifying the vertical input height resize behavior
- Modifying the collapse/expand toggle behavior
- Changes to MetaModelView header rows or tab structure
- Changes to the Grid or RelationshipGrid components
- DiagramsView layout or any other views
