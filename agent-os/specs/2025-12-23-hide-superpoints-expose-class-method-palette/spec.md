# Specification: Hide Super-Points from Meta-Model and Expose Class/Method in Palette

## Goal
Correct two UI integration issues: (1) hide Business Point and Application Point from Meta-Model entity tabs since they are derived super-entities not meant for direct editing, and (2) add Class and Method entities to the Diagram RHS Palette for the Application domain so users can add them to diagrams.

## User Stories
- As an architect, I want Business Point and Application Point hidden from Meta-Model entity tabs so that I am not tempted to directly edit derived super-entities that are managed internally.
- As an architect, I want Class and Method entities available in the Diagram RHS Palette so that I can add code-level entities to my architecture diagrams.

## Specific Requirements

**Remove Business Points and Application Points from Meta-Model entity tabs**
- Modify `domainGroupings` in `gridConfigs.ts` to exclude 'Business Points' from the business domain array
- Modify `domainGroupings` in `gridConfigs.ts` to exclude 'Application Points' from the application domain array
- Keep 'Business Points' and 'Application Points' entries in `tabToEntityType` for internal API wiring
- Keep grid config definitions for `business_points` and `application_points` intact
- Relationship tabs referencing these entities (e.g., 'User <-> Business Point', 'App Point <-> Business Point') remain visible and functional

**Add Classes palette section to Application domain**
- Add `'classes'` to the `application` array in `domainToPaletteSections` in `paletteData.ts`
- Position after `'endpoints'` and before `'application_point_business_points'` for logical grouping
- Entity section definition for `classes` already exists in `entitySections` array; ensure it is included

**Add Methods palette section to Application domain**
- Add `'methods'` to the `application` array in `domainToPaletteSections` in `paletteData.ts`
- Position after `'classes'` to maintain parent-child logical ordering
- Entity section definition for `methods` must be added to `entitySections` array in `getPaletteSections()`

**Add entity section definition for Classes**
- Add a new entry in `entitySections` array with id `'classes'`, label `'Classes'`, items from `metaModel.entities.classes`, type `'entity'`
- Follow existing pattern used for `applications`, `services`, etc.

**Add entity section definition for Methods**
- Add a new entry in `entitySections` array with id `'methods'`, label `'Methods'`, items from `metaModel.entities.methods`, type `'entity'`
- Follow existing pattern used for `endpoints`, `process_activities`, etc.

**Update getEntityTypeConstant mapping**
- Add `classes: ENTITY_TYPES.CLASS` mapping if not already present
- Add `methods: ENTITY_TYPES.METHOD` mapping if not already present
- Verify ENTITY_TYPES constants exist in `model.ts` for CLASS and METHOD

**Verify no regression to relationship tabs**
- Relationship tabs like 'User <-> Business Point' and 'App Point <-> Business Point' must continue to work
- `getRelationshipTabsForDomain()` in `MetaModelView.tsx` uses FK targets, not entity tab presence, so no changes needed there

## Existing Code to Leverage

**`domainGroupings` in `gridConfigs.ts` (lines 340-345)**
- Maps each ArchitectureDomain to an array of entity tab names
- Modify by removing 'Business Points' from business array and 'Application Points' from application array
- Simple array element removal; no structural changes needed

**`domainToPaletteSections` in `paletteData.ts` (lines 32-62)**
- Maps each ArchitectureDomain to an array of palette section IDs
- Add 'classes' and 'methods' to the application array
- Follow existing pattern for entity section ordering

**`entitySections` array in `getPaletteSections()` in `paletteData.ts` (lines 118-195)**
- Defines entity sections with id, label, items, and type
- Add new sections for classes and methods following existing pattern
- Reference `metaModel.entities.classes` and `metaModel.entities.methods`

**`getEntityTypeConstant()` in `paletteData.ts` (lines 69-88)**
- Maps entity keys to ENTITY_TYPES constants
- Add mappings for classes and methods if missing

**`gridConfigs.ts` Class/Method configs (lines 123-139)**
- Grid configurations for classes and methods entities already exist
- Confirms these entity types are fully defined and ready for palette integration

## Out of Scope
- Removing Business Point or Application Point from `gridConfigs` definitions
- Removing Business Point or Application Point from `tabToEntityType` mapping
- Modifying relationship tabs or relationship grid behavior
- Changes to backend schema or APIs
- Adding Class/Method to relationship tabs
- Modifying diagram rendering logic for Class/Method nodes
- Adding context menu actions specific to Class/Method entities
- Modifying the Meta-Model grid for Classes or Methods tabs (already working)
- Any changes to Business Point / Application Point auto-generation logic
