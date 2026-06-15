# Specification: Fix Diagram Type Normalization

## Goal
Restore Sequence Editor panel rendering for all Sequence diagrams by making diagram_type handling case-insensitive across the frontend, backend, and database, ensuring canonical values ("General", "ER", "Sequence", "Activity", "State") are consistently used throughout the system.

## User Stories
- As a user, I want to select any Sequence diagram (regardless of how its type was persisted) and see the Sequence Editor panel with "+ Add Participant" and Flow tab functionality.
- As a user, I want newly created diagrams to reliably persist and load with their correct diagram type behavior.

## Specific Requirements

**FE-1: Add normalizeDiagramType helper function**
- Create `normalizeDiagramType(value?: string | null): DiagramType | null` in `frontend/src/types/diagramType.ts`
- Trim whitespace from input string
- Perform case-insensitive mapping: "general"->"General", "er"->"ER", "sequence"->"Sequence", "activity"->"Activity", "state"->"State"
- Return null for unknown/invalid values
- Update `isDiagramType()` to use: `normalizeDiagramType(value) !== null`
- Update `getDiagramType()` to use: `normalizeDiagramType(diagram.diagram_type) ?? DEFAULT_DIAGRAM_TYPE`

**FE-2: Fix useSequenceDiagram hook guard**
- Modify `frontend/src/hooks/useSequenceDiagram.ts` to import `getDiagramType` from `../types/diagramType`
- Replace strict comparison `activeDiagram.diagram_type !== 'Sequence'` with `getDiagramType(activeDiagram) !== 'Sequence'`
- This fix is in the `loadDiagram` callback at approximately line 239
- Keep all other existing behavior unchanged (typedContent initialization, autosave, etc.)

**BE-1: Add normalizeDiagramType helper in DiagramMapper**
- Add private method `normalizeDiagramType(String raw)` in `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/DiagramMapper.java`
- Handle null input by returning null
- Trim whitespace and compare uppercase: "GENERAL"->"General", "ER"->"ER", "SEQUENCE"->"Sequence", "ACTIVITY"->"Activity", "STATE"->"State"
- Return trimmed input for unknown values (do not throw exceptions)
- Apply normalization in `toEntity()` method: `.diagramType(normalizeDiagramType(dto.diagramType()))`
- Apply normalization in `toDto()` method when constructing DiagramDto (defensive for legacy DB values)

**DB-1: Add Liquibase migration to canonicalize existing diagram_type values**
- Create new SQL file: `architecture-model-service/src/main/resources/db/changelog/sql/008-normalize-diagram-types.sql`
- Add corresponding changeset entry in `db.changelog-master.yaml` after changeset 007
- Use idempotent UPDATE statement with CASE expression for Postgres
- Map: NULL->NULL, UPPER(TRIM())='GENERAL'->'General', 'ER'->'ER', 'SEQUENCE'->'Sequence', 'ACTIVITY'->'Activity', 'STATE'->'State'
- Fallback: ELSE TRIM(diagram_type) for any unknown values

**QA-1: Add frontend unit tests for normalization functions**
- Add tests in `frontend/src/__tests__/` directory (follow existing test file naming pattern)
- Assert: `normalizeDiagramType('SEQUENCE') === 'Sequence'`
- Assert: `normalizeDiagramType(' sequence ') === 'Sequence'`
- Assert: `normalizeDiagramType('unknown') === null`
- Assert: `getDiagramType({diagram_type:'SEQUENCE', ...}) === 'Sequence'`
- Assert: `getDiagramType(null) === 'General'` (default)

## Existing Code to Leverage

**frontend/src/types/diagramType.ts**
- Contains existing `DiagramType` union type, `ALL_DIAGRAM_TYPES` array, `DEFAULT_DIAGRAM_TYPE` constant
- Has existing `isDiagramType()` and `getDiagramType()` functions to modify
- Pattern for type guards is already established; extend rather than replace

**frontend/src/hooks/useSequenceDiagram.ts**
- Line 239: Contains the strict guard `activeDiagram.diagram_type !== 'Sequence'` to update
- Already imports from `../types/model`; add import from `../types/diagramType`
- Hook structure and autosave logic remain unchanged

**architecture-model-service/src/main/java/.../mapper/DiagramMapper.java**
- `toEntity()` method at line 57-68 where diagramType is mapped
- `toDto()` method at line 30-45 where diagramType is passed to DiagramDto constructor
- Add private helper method following existing mapper patterns

**Liquibase migration patterns in db.changelog-master.yaml**
- Changesets follow sequential ID pattern (001, 002, etc.)
- SQL files stored in `db/changelog/sql/` with numbered prefixes
- Preconditions use `onFail: MARK_RAN` for idempotent behavior

## Out of Scope
- No changes to typed-content persistence or diagram rendering logic
- No changes to diagram creation UX or the diagram type selector component
- No modifications to how DiagramsView decides which panel to show (Palette vs. SequenceEditor) - this is driven by getDiagramType
- No changes to Activity, State, or ER diagram-specific logic beyond ensuring type normalization
- No backend enum or constraint enforcement on diagram_type column
- No frontend validation or error messages for invalid diagram types (gracefully default to General)
- No changes to the Diagram entity class or DiagramDto record structure
- No REST API changes or new endpoints
- No changes to existing tests beyond adding new normalization tests
