# Specification: Diagram Types and Type-Aware Diagram View (Increment 1)

## Goal

Introduce "Diagram Type" as a first-class concept, allowing users to select a diagram type when creating new diagrams, persisting the type in the backend, and making the RHS palette panel filter available entities/relationships based on the selected diagram type.

## User Stories

- As an architect, I want to select a diagram type (General, ER, Sequence, Activity, State) when creating a new diagram so that the palette shows only relevant entities and relationships for that diagram type.
- As an architect, I want existing diagrams without a type to behave as "General" diagrams so that backward compatibility is preserved.

## Specific Requirements

**Diagram Type Enumeration**
- Define allowed diagram type values: General, ER, Sequence, Activity, State
- Store diagram type as a string field on the Diagram model
- Default value is "General" when not specified or when null/undefined

**Backend DiagramDto Extension**
- The `DiagramDto.java` already has a `diagramType` field with `@JsonProperty("diagram_type")`
- Verify the field is correctly mapped through DiagramMapper
- Ensure save and load operations include diagram_type

**Backend Database Schema**
- The `diagrams` table already has a `diagram_type TEXT` column (nullable)
- No additional migration is required since the column already exists
- Existing rows with NULL diagram_type are treated as "General"

**Frontend Diagram Model Extension**
- The `Diagram` interface in `model.ts` already has `diagram_type?: string`
- When loading a diagram with null/undefined diagram_type, treat as "General"
- Ensure ADD_DIAGRAM action populates diagram_type from user selection

**Diagram Type Selector in DiagramSelector Component**
- Add a dropdown to the right of the diagram name input field
- Dropdown positioned to the LEFT of the "[+ New]" button
- Options: General (default), ER, Sequence, Activity, State
- Dropdown uses a new CSS class for consistent styling with existing controls
- When creating a new diagram, include selected diagram type in the Diagram object

**Diagram Type Palette Mapping Configuration**
- Create a new configuration object DIAGRAM_TYPE_PALETTE_RULES in paletteData.ts
- Map each diagram type to its allowed entity types and relationship types
- General: ALL existing entities and relationships (current behaviour)
- ER: LogicalEntity, PhysicalEntity, LogicalAttribute, PhysicalAttribute entities; LogicalER relationships
- Sequence: BusinessUser, Application, ApplicationComponent, Service, Interface, Endpoint, Class, Method, Event entities; no relationships for now
- Activity: Activity, ActivityPartition entities; ActivityFlow relationships
- State: State entities; StateTransition relationships

**Palette Filtering by Diagram Type**
- Modify getPaletteSections() to accept an optional diagramType parameter
- When diagramType is provided, filter sections to only include those allowed by DIAGRAM_TYPE_PALETTE_RULES
- Apply BOTH domain filtering AND diagram type filtering (intersection)
- If no diagram type specified, treat as "General" (no additional filtering)

**Current Diagram Type Resolution**
- PalettePanel receives currentDiagramId prop, can look up diagram to get diagram_type
- Pass activeDiagram.diagram_type (defaulting to "General") to getPaletteSections()
- Palette updates automatically when selected diagram changes

**Empty Palette State Handling**
- If a diagram type has no matching palette items after filtering, show empty state text
- Text: "This diagram type supports creating elements directly in the diagram (coming next)."
- Do not block diagram usage or prevent canvas interaction

**Backward Compatibility**
- Existing diagrams without diagram_type load successfully as "General"
- No changes to canvas rendering in this increment
- No changes to create-and-place flows in this increment
- No changes to gateway/MCP services

## Visual Design

No mockups provided for this specification.

## Existing Code to Leverage

**frontend/src/types/model.ts - Diagram interface**
- Already has `diagram_type?: string` field at line 1386
- No model changes required, just ensure field is properly used

**frontend/src/components/DiagramsView/DiagramSelector.tsx**
- Component handles diagram creation at lines 33-63
- New diagram type dropdown should be added after name input (line 118-124)
- handleNewDiagram() must include selected diagram type in newDiagram object
- handleCopyDiagram() already deep copies diagram including diagram_type

**frontend/src/utils/paletteData.ts - getPaletteSections()**
- Currently accepts metaModel, searchQuery, and selectedDomain parameters
- Already has domainToPaletteSections mapping pattern to replicate for diagram types
- Add new DIAGRAM_TYPE_PALETTE_RULES configuration using same structure
- Extend getPaletteSections() to accept optional diagramType parameter

**frontend/src/components/DiagramsView/PalettePanel.tsx**
- Calls getPaletteSections() at line 745
- Has access to diagram object via props (line 703)
- Can extract diagram_type from diagram and pass to getPaletteSections()

**architecture-model-service DiagramDto.java**
- Already has diagramType field with correct JSON mapping at line 19
- No backend DTO changes required

## Out of Scope

- Canvas rendering changes for specific diagram types
- Create-and-place authoring flows for diagram elements
- Sequence diagram-specific editors or lifeline rendering
- Activity diagram swimlane layout engine
- State diagram specific visual styling
- Gateway or MCP service changes
- Diagram type change after creation (mutation of existing diagram type)
- Validation that placed entities match the diagram type
- Diagram type-specific toolbars or context menus
- Auto-layout algorithms for specific diagram types
