# Spec Requirements: Fix ER Relationship Addability

## Initial Description

Fix the ER diagram relationship palette so relationship rows become selectable/enabled when their endpoints are already on the canvas, even when relationship endpoints are stored using unified `dataEntityPointId` values (e.g. `dep_log_<id>` / `dep_phy_<id>`).

Also ensure that when the relationship is added to the diagram, the created edge correctly attaches to the existing entity nodes (uses raw entity IDs, not `dep_*` point IDs).

**Problem:** After refactoring to store certain data-entity references as a unified `dataEntityPointId`, the relationship palette "endpoints present" check compares:
- diagram node IDs (raw entity IDs) vs
- relationship endpoint values (point IDs like `dep_phy_<id>`)

These never match, so all relationships remain greyed out with:
> "Both endpoints must be on the diagram to add this relationship"

Additionally, if an edge is created using `dep_*` IDs, it will not attach to entity nodes on the canvas.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the `parseDataEntityPointId()` utility mentioned in the prompt already exists in `dataEntityPointOptions.ts` and follows the pattern described (parsing `dep_log_<id>` and `dep_phy_<id>`). Is that correct, or does it need to be created/modified?
**Answer:** Yes, `parseDataEntityPointId()` already exists in `frontend/src/utils/dataEntityPointOptions.ts` (lines 164-184). It parses `dep_log_<id>` and `dep_phy_<id>` format strings into `{ entityType: 'logical' | 'physical', entityId: string }`. It was created in a previous spec.

**Q2:** I'm thinking the palette enable/disable logic lives in a file like `erdRelationshipPalette.ts` or within the ER diagram components. Should I assume standard naming conventions, or can you point me to the exact file/component that handles this?
**Answer:** Search for files related to ER relationship palette - likely in `frontend/src/components/DiagramsView/` or `frontend/src/utils/erd*.ts`. Look for palette addability logic, endpoint matching, and relationship enablement checks.

**Q3:** The raw idea mentions supporting "logical to physical ER relationships (if supported by the relationship table)". I assume cross-kind relationships (logical-to-physical) ARE supported and should be handled. Is that correct, or should we only handle same-kind relationships (physical-to-physical, logical-to-logical)?
**Answer:** Yes, cross-kind relationships (logical-to-physical) ARE supported and should be handled. The relationship table supports both entity types via the unified dataEntityPointId field.

**Q4:** For the legacy/raw ID fallback behavior: the spec says to "only allow this fallback where needed and safe." I assume we should be strict and NOT attempt to guess the kind from raw IDs - instead, only accepting the explicit `dep_log_*` / `dep_phy_*` format. Is that the safer approach you want, or do we need backward compatibility for raw IDs in certain places?
**Answer:** Use strict approach - only accept explicit `dep_log_*` / `dep_phy_*` format. Do NOT attempt to guess kind from raw IDs. This is the safer approach.

**Q5:** I assume the diagram node types are exactly `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY` as string constants somewhere in the codebase. Is that correct, or are they named differently?
**Answer:** Yes, the entity types are `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY` as string constants in `frontend/src/config/entityTypes.ts`.

**Q6:** For regression tests, I assume we should use Vitest (per the tech stack) and React Testing Library if component-level testing is needed. Should tests be placed in `frontend/src/__tests__/` following the existing pattern I see in the git status?
**Answer:** Yes, use Vitest and place tests in `frontend/src/__tests__/` following existing patterns.

**Q7:** Is there anything we should explicitly NOT change or touch during this fix (e.g., other palette types, relationship authoring UI beyond addability, specific shared utilities)?
**Answer:** Out of scope: Backend changes, relationship authoring UI, other palette types (non-ER), and changes to how dataEntityPointId values are stored.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: parseDataEntityPointId() - Path: `frontend/src/utils/dataEntityPointOptions.ts` (lines 164-184)
- Feature: resolveDataEntitiesForInterface() - Path: `frontend/src/utils/dataEntityPointOptions.ts` - similar resolution pattern
- Feature: ENTITY_TYPES constants - Path: `frontend/src/config/entityTypes.ts`
- Components to potentially reuse: Existing palette/addability logic in DiagramsView components
- Backend logic to reference: None (frontend-only fix)

### Follow-up Questions

No follow-up questions were needed - the initial answers provided comprehensive context.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - this is a code-only bugfix with no UI design changes.

## Requirements Summary

### Functional Requirements

1. **Endpoint Resolution for Addability Checks**
   - Use existing `parseDataEntityPointId()` to resolve `dep_log_<id>` and `dep_phy_<id>` format strings
   - Output format: `{ entityType: 'logical' | 'physical', entityId: string }`
   - Strict parsing: only accept explicit `dep_log_*` / `dep_phy_*` format, do NOT guess kind from raw IDs

2. **Fix Palette Enable/Disable Logic**
   - Build lookup of nodes currently on canvas, keyed by BOTH:
     - Node type (`LOGICAL_DATA_ENTITY` or `PHYSICAL_DATA_ENTITY`)
     - Raw entity ID
   - For each relationship row endpoint:
     - Resolve stored endpoint via `parseDataEntityPointId()`
     - If `entityType === 'logical'` => require `LOGICAL_DATA_ENTITY` node with matching `entityId` on diagram
     - If `entityType === 'physical'` => require `PHYSICAL_DATA_ENTITY` node with matching `entityId` on diagram
   - Only enable relationship row if BOTH resolved endpoints are present on diagram

3. **Tooltip Behavior**
   - If disabled: show existing tooltip ("Both endpoints must be on the diagram to add this relationship")
   - If enabled: tooltip should not appear (or be neutral)

4. **Fix Edge Creation/Attachment**
   - When relationship is added from palette, use `parseDataEntityPointId()` to obtain raw entity IDs
   - Create diagram edge endpoints referencing concrete node IDs/types (raw IDs)
   - Do NOT store `dep_*` IDs as edge endpoints
   - Must work for:
     - physical-to-physical ER relationships
     - logical-to-logical ER relationships
     - logical-to-physical ER relationships (cross-kind)

5. **Regression Tests**
   - Test A (Addability): Given diagram with two `PHYSICAL_DATA_ENTITY` nodes (IDs A and B) and ER relationship with endpoints `dep_phy_A` and `dep_phy_B`, expect relationship row to be enabled
   - Test B (Edge Attachment): When adding relationship, assert created edge references endpoints A and B (raw IDs), not `dep_phy_A`/`dep_phy_B`
   - Test framework: Vitest
   - Test location: `frontend/src/__tests__/`

### Reusability Opportunities

- `parseDataEntityPointId()` in `frontend/src/utils/dataEntityPointOptions.ts` - already exists and should be reused directly
- `resolveDataEntitiesForInterface()` in same file - similar pattern for reference
- `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY` constants from `frontend/src/config/entityTypes.ts`
- Existing palette/addability patterns in DiagramsView components

### Scope Boundaries

**In Scope:**
- Frontend-only changes
- Normalize relationship endpoints before performing addability checks
- Normalize endpoints when creating diagram edges
- Add regression tests for endpoint resolver, addability predicate, and edge endpoint mapping

**Out of Scope:**
- Backend/API changes
- Database migrations
- Changing meta-model data storage format
- Relationship authoring UI (beyond correctness of addability)
- Other palette types (non-ER)
- Changes to how `dataEntityPointId` values are stored

### Technical Considerations

- Integration points: Uses existing `parseDataEntityPointId()` utility
- Existing system constraints: Must not break existing relationship add behavior for non-data-entity relationships
- Technology: React/TypeScript frontend, Vitest for testing
- Similar code patterns to follow:
  - `frontend/src/utils/dataEntityPointOptions.ts` for endpoint parsing
  - `frontend/src/config/entityTypes.ts` for entity type constants
  - Files in `frontend/src/components/DiagramsView/` or `frontend/src/utils/erd*.ts` for palette logic

### Acceptance Criteria

1. In an ER diagram with physical entities on canvas, physical ER relationships referencing those entities via `dep_phy_<id>` become enabled (not greyed out)
2. The tooltip "Both endpoints must be on the diagram..." only appears when one or both endpoints truly are not on the canvas
3. Adding an enabled relationship creates an edge that correctly attaches to existing entity nodes (raw IDs), and renders on canvas
4. No regressions to existing relationship add behavior for non-data-entity relationships
5. Automated tests cover the `dep_*` endpoint scenario and pass
