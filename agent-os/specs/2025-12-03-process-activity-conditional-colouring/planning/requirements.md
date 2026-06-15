# Spec Requirements: Conditional Background Colouring for Process Activity Nodes

## Initial Description

Define deterministic, spec-driven rules for colouring **Process Activity** diagram nodes according to their `User Interaction Level` attribute. Ensure the correct colours are always applied when nodes are first rendered AND whenever metadata changes (e.g., when a Process Activity's User Interaction Level is edited in the RHS panel). This update formalises the colour mapping and requires consistent refresh/update behaviour so the diagram always reflects the current attribute value.

## Context / Current Behaviour

The Process Activity nodes have a `user_interaction_level` attribute with values: `AUTOMATED`, `MINIMAL`, `MODERATE`, `SIGNIFICANT`. While basic colour mapping exists, there are inconsistencies in:

1. **Colour application timing** - Colours may not apply correctly on all creation paths (Advanced Add, Add with Business Processes, etc.)
2. **Live update behaviour** - When editing the User Interaction Level in the RHS panel, the diagram may not update immediately
3. **Style inheritance conflicts** - Parent containers (Business Process nodes) may override or suppress child Process Activity colours
4. **No canonical style definitions** - Colours may be inline values rather than stable CSS variables/tokens

## Desired Behaviour

### Section 1: Canonical Colour Mapping (CSS Variables)

**Define explicit CSS variables for Process Activity background colours:**

| User Interaction Level | CSS Variable Name | Colour Description |
|-----------------------|-------------------|-------------------|
| `AUTOMATED` | `--process-activity-automated-bg` | Dark Green (matches current automated activity screenshot colour) |
| `MINIMAL` | `--process-activity-minimal-bg` | Light Green (visually distinct from Business Process green - slightly different hue) |
| `MODERATE` | `--process-activity-moderate-bg` | Light Yellow (soft yellow background, readable contrast with dark text) |
| `SIGNIFICANT` | `--process-activity-significant-bg` | Light Red (soft red/pink background) |

**Requirements:**
- These colours MUST be defined as explicit CSS variables or style tokens inside the diagram rendering system
- The names must be stable and cannot be lost due to theme inheritance or stale style overrides
- Frontend rendering MUST always reference these canonical variables (not arbitrary inline colours)

**Files likely involved:**
- `frontend/src/utils/rendering.ts` - Central colour definitions and `getProcessActivityFill()` helper
- CSS/style files where diagram node styles are defined

### Section 2: Colour Application on Node Creation

**When colours MUST be applied:**

The renderer MUST read the activity's current `User Interaction Level` value and apply the correct background colour immediately for ALL creation paths:

1. **Simple "Add"** - Adding a Process Activity directly to the diagram
2. **"Add with Business Processes"** - When Process Activities are added along with their parent Business Process
3. **"Advanced Add..."** - When using the Advanced Add dialog to add entities
4. **Automatic creation during wrapping** - When deeper nodes are wrapped and Process Activities are created as part of the hierarchy

**Requirement:** No creation path should result in an incorrectly coloured or uncoloured Process Activity node.

### Section 3: Live Update on Metadata Change (RHS Panel)

**Requirement:** When the user edits a Process Activity's `User Interaction Level` in the meta-model RHS table:

1. The diagram MUST detect this metadata change
2. The node's background colour MUST update **immediately**, without requiring:
   - Page refresh
   - Diagram reload
   - Closing and reopening any modal

**Implementation approach:**
- Diagram nodes subscribe to metadata change events for their underlying entity
- When the entity's attributes change, the diagram re-evaluates colour using the same canonical mapping
- This re-render must be idempotent and override any stale cached styles

**Technical considerations:**
- React state updates via ArchitectureContext should trigger re-render
- `getProcessActivityFill()` helper must be called on every render to ensure fresh colour
- Any caching (React state, Konva node cache, canvas cache, ReactFlow node memoization) must NOT block the update

### Section 4: Colour Persistence in Nested/Wrapped Nodes

**Requirement:** When a Process Activity node is nested inside a parent Business Process node (or is re-wrapped due to Advanced Add recursion):

1. Its background colour MUST persist
2. Parent wrapping rules (padding, border, bold label, etc.) MUST NOT suppress or override the Process Activity's colour
3. The renderer MUST ensure child background colours remain visible even when nested multiple levels deep

### Section 5: Preventing Style Conflicts

**No inheritance override:**
- Parent containers (Business Process, Application, Component, Service, Interface) must NOT apply background styles to children that override a Process Activity's background colour
- If parent containers use background colours, the Process Activity box must have its own explicitly applied colour on the node's shape container

**Force re-render on attribute change:**
When a Process Activity's metadata object changes, the frontend MUST trigger a diagram node re-render cycle for that node. This re-render MUST:
1. Re-evaluate the Process Activity's visual style map
2. Re-apply the correct background colour
3. Remove any outdated styles previously applied

This guarantees that any external cached style cannot block the update.

## Acceptance Criteria

### AC1: CSS Variables Defined
- Four CSS variables are defined for Process Activity background colours
- Variables are named: `--process-activity-automated-bg`, `--process-activity-minimal-bg`, `--process-activity-moderate-bg`, `--process-activity-significant-bg`
- All Process Activity colour references use these variables (no hardcoded inline colours)

### AC2: Correct Colours on Simple Add
- Adding a Process Activity via simple "Add" applies the correct colour immediately
- Colour matches the activity's `user_interaction_level` value

### AC3: Correct Colours on "Add with Business Processes"
- Adding entities via "Add with Business Processes" applies correct colours to all Process Activities
- All four colour values render correctly when activities have different interaction levels

### AC4: Correct Colours on Advanced Add
- Adding entities via "Advanced Add..." dialog applies correct colours
- Works for single and multiple Process Activities
- Works when Process Activities are nested within Business Processes

### AC5: Live Update from RHS Panel
- Changing `user_interaction_level` in the Activities grid/RHS panel immediately updates the diagram node colour
- No refresh, reload, or modal close required
- Works for any diagram currently visible that contains the edited activity

### AC6: Colours Persist in Nested Nodes
- Process Activity nodes maintain their colour when nested inside Business Process nodes
- Parent styling does not override child colours
- Works at multiple nesting levels

### AC7: No Style Conflicts
- Parent container backgrounds do not bleed through to or override Process Activity colours
- Each Process Activity node has its own explicitly applied background colour

### AC8: Example Scenario Passes
1. Add a Business Process containing four Process Activities
2. Set levels: Automated (dark green), Minimal (light green), Moderate (light yellow), Significant (light red)
3. Diagram renders all four colours correctly
4. User changes "Moderate" to "Automated" in RHS
5. That node IMMEDIATELY changes to dark green background
6. No reload required, parent wrapping unaffected, no flickering

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Colour mapping reference:
- AUTOMATED: Dark Green
- MINIMAL: Light Green (distinct from Business Process green)
- MODERATE: Light Yellow
- SIGNIFICANT: Light Red/Pink

## Scope Boundaries

### In Scope:
- Define canonical CSS variables for Process Activity colours
- Ensure colour application on all node creation paths
- Implement live update behaviour when metadata changes in RHS panel
- Prevent parent container style conflicts
- Ensure colours persist in nested/wrapped nodes
- Force re-render on attribute change to clear stale cached styles

### Out of Scope:
- Changes to Business Process node colours or any other entity type styling
- Changes to the `user_interaction_level` enum values or migration logic (already handled in prior spec)
- Changes to diagram layout, positioning, or wrapping algorithms
- Backend changes (frontend-only scope)
- Changes to the Activities grid UI (already handled in prior spec)

## Requirements Summary

### Functional Requirements
- CSS variables define canonical Process Activity colours
- Colours always applied correctly on node creation (all paths)
- Colours update immediately when metadata changes (no refresh needed)
- Colours persist in nested/wrapped nodes
- No style conflicts from parent containers

### Reusability Opportunities
- CSS variables can be referenced throughout the codebase for consistency
- `getProcessActivityFill()` helper already exists and should use these variables
- Re-render pattern can serve as template for other live-update scenarios

### Technical Considerations
- CSS variables defined in appropriate style file or rendering utilities
- React context updates trigger re-render automatically
- Must ensure caching mechanisms don't block colour updates
- Test all creation paths: Add, Add with Business Processes, Advanced Add
- Test live update from RHS panel editing
