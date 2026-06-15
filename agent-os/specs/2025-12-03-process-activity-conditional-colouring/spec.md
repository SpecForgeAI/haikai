# Specification: Process Activity Conditional Colouring

## Goal
Ensure Process Activity diagram nodes always display the correct background colour based on their `user_interaction_level` attribute, with deterministic CSS variable definitions and immediate live updates when metadata changes.

## User Stories
- As a modeler, I want Process Activity colours to update immediately when I change the User Interaction Level in the RHS panel so that the diagram always reflects current metadata without requiring refresh.
- As a diagram author, I want consistent colour application across all node creation paths (Simple Add, Advanced Add, Add with Business Processes, wrapping) so that colours are never missing or incorrect.

## Specific Requirements

**CSS Variable Definitions**
- Define four canonical CSS variables in `defaults.ts` for Process Activity backgrounds
- Variable names: `--process-activity-automated-bg`, `--process-activity-minimal-bg`, `--process-activity-moderate-bg`, `--process-activity-significant-bg`
- Colours: AUTOMATED=#a5d6a7 (medium green), MINIMAL=#c8e6c9 (light green), MODERATE=#fff9c4 (light yellow), SIGNIFICANT=#ffcdd2 (light red)
- Export variables as JavaScript constants AND as CSS custom properties if CSS module is used
- `processActivityColors` Record already exists with correct mapping - ensure it is the single source of truth

**Canvas Node Rendering Fix**
- Canvas.tsx currently uses `node.background_color || colors.background` for fill colour (line ~2111)
- Replace with call to `getNodeFillColor(node, state.model)` from `rendering.ts` to leverage Process Activity colour logic
- Import `getNodeFillColor` into Canvas.tsx from `utils/rendering`
- The `getNodeFillColor` function already handles PROCESS_ACTIVITY special case and calls `getProcessActivityDefaultFill`
- This change ensures colour is derived from entity metadata, not just static entity type defaults

**Colour Application on All Creation Paths**
- Simple "Add" from PalettePanel: Ensure new PROCESS_ACTIVITY nodes do NOT set `background_color` override - let renderer derive it
- "Add with Business Processes": Ensure child Process Activities do NOT have hardcoded `background_color` in node creation
- "Advanced Add...": AdvancedAddDialog must NOT set `background_color` on PROCESS_ACTIVITY nodes
- Automatic wrapping: When deeper hierarchy nodes are wrapped, do NOT persist `background_color` on PROCESS_ACTIVITY nodes
- Rule: PROCESS_ACTIVITY nodes should never have `background_color` set on creation; colour is always derived at render time

**Live Update Behaviour**
- When user edits `user_interaction_level` in RHS Activities grid, dispatch `UPDATE_ENTITY` action updates context state
- Canvas component consumes `state.model` via `useArchitecture()` hook
- React triggers re-render when context state changes
- On re-render, `getNodeFillColor(node, state.model)` is called which reads fresh `user_interaction_level` from entity
- `getProcessActivityDefaultFill(activity)` returns correct colour from `processActivityColors` map
- No manual refresh, JSON reload, or modal close required

**Style Conflict Prevention**
- `getNodeFillColor` returns explicit colour value, not inherited from parent
- Canvas renders each node with its own `fill` attribute - no CSS inheritance from parent container
- Parent Business Process nodes have their own background colour (green) which does NOT affect nested child Process Activity colours
- Each Process Activity rect element receives independent fill value computed at render time

**Implementation Details**
- `processActivityColors` in `defaults.ts` (lines 305-310): Already defined with UserInteractionLevel keys
- `getProcessActivityDefaultFill` in `defaults.ts` (lines 319-322): Reads `activity.user_interaction_level`, returns colour from map
- `getNodeFillColor` in `rendering.ts` (lines 257-276): Checks for PROCESS_ACTIVITY type, looks up entity, calls `getProcessActivityDefaultFill`
- Canvas.tsx line ~2111: Change `const nodeBackgroundColor = node.background_color || colors.background;` to use `getNodeFillColor`
- Ensure Canvas.tsx imports: Add `getNodeFillColor` to imports from `utils/rendering`

## Existing Code to Leverage

**processActivityColors in defaults.ts (lines 305-310)**
- Already defines colour mapping: AUTOMATED=#a5d6a7, MINIMAL=#c8e6c9, MODERATE=#fff9c4, SIGNIFICANT=#ffcdd2
- Keyed by UserInteractionLevel type - single source of truth for colours
- Used by getProcessActivityDefaultFill helper

**getProcessActivityDefaultFill in defaults.ts (lines 319-322)**
- Reads `activity.user_interaction_level` and returns colour from `processActivityColors`
- Defaults to AUTOMATED colour if field missing
- Correctly handles UserInteractionLevel enum values

**getNodeFillColor in rendering.ts (lines 257-276)**
- Checks if node is PROCESS_ACTIVITY type
- Looks up ProcessActivity entity from model by entity_id
- Calls getProcessActivityDefaultFill to get colour based on user_interaction_level
- Falls back to entity type default if not PROCESS_ACTIVITY
- Already exported but NOT imported/used by Canvas.tsx

**Canvas.tsx node rendering (lines 2100-2248)**
- Currently constructs `nodeBackgroundColor` as `node.background_color || colors.background`
- `colors` comes from `getEntityColor(node.entity_type)` which returns static entity type defaults
- Change this to call `getNodeFillColor(node, state.model)` for dynamic colour derivation

**ArchitectureContext UPDATE_ENTITY action**
- Dispatched when grid cell edits entity field (including user_interaction_level)
- Updates `state.model` which triggers React re-render
- Canvas consumes state.model - re-render automatically calls getNodeFillColor with fresh data

## Out of Scope
- Changes to Business Process node colours or any other entity type styling
- Changes to the user_interaction_level enum values (already defined in prior spec)
- Changes to diagram layout, positioning, or wrapping algorithms
- Backend/API changes (frontend-only scope)
- Changes to the Activities grid UI columns (already handled in prior spec)
- Migration logic for old is_manual/user_input_amount fields (already handled in prior spec)
- Changes to ProcessActivity cascade delete behaviour
- Performance optimizations beyond standard React re-render
- Persisting computed colours to node.background_color (colours must be derived, not stored)
- CSS-in-JS or theme provider changes (use existing JavaScript constants)
