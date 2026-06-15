# Specification: Product Implement Context Picker v1

## Goal
Add a Context Picker to the Product Implement view enabling users to link architecture meta-model entities and diagrams to the currently selected Feature/Story work item, with selections persisted locally via localStorage for immediate usability without backend changes.

## User Stories
- As a product owner, I want to link relevant architecture entities and diagrams to a work item so that implementation context is preserved for spec generation.
- As a developer, I want to see linked context as removable chips so I can quickly understand and modify what is relevant to the current work item.

## Specific Requirements

**Context Section in WorkItemSummaryPanel**
- Add a "Context" section below the existing context placeholder in the right pane
- Display an "Add context" button that opens the ContextPickerModal
- Render linked entity_refs as chips showing the entity label with a remove (x) icon
- Render linked diagram_refs as chips showing the diagram label with a remove (x) icon
- Chips should be compact, visually distinct (entities vs diagrams via subtle color coding)
- Removing a chip immediately updates state and persists to localStorage

**Local Persistence Helpers (contextStorage.ts)**
- Create new utility file: `frontend/src/utils/contextStorage.ts`
- Implement `loadContext(projectId, workItemId)` returning `ContextState` with fallback to empty state
- Implement `saveContext(projectId, workItemId, state)` for writing to localStorage
- Use localStorage key pattern: `product_context::<projectId>::<workItemId>`
- Wrap JSON.parse in try/catch; on corrupt data, return empty state `{version:1, entity_refs:[], diagram_refs:[]}`
- Data structure includes version field for future migrations

**Context Data Model Types**
- Define `EntityRef` interface: `{ kind: "ENTITY", entity_type: string, entity_id: string, label: string }`
- Define `DiagramRef` interface: `{ kind: "DIAGRAM", diagram_id: string, label: string }`
- Define `ContextState` interface: `{ version: 1, entity_refs: EntityRef[], diagram_refs: DiagramRef[] }`
- Types should be co-located in contextStorage.ts or a new types file

**Architecture Pick List Builder**
- Create helper function `buildArchitecturePickList(metaModelEntities)` returning grouped options
- Group entities by their collection key (e.g., "applications", "interfaces", "logical_data_entities")
- For each entity: use `item.name` or `item.title` for label, fallback to `<entity_type> <id>`
- Use collection key as the `entity_type` value for consistency
- Return structure: `Record<string, PickOption[]>` where key is group name

**Diagram Pick List Builder**
- Create helper to build diagram options from `model.diagrams`
- For each diagram: use `diagram.name` if present, else `${diagram.diagram_type} (${id.slice(0,8)})`
- Include diagram_type in label for clarity when name exists (optional)
- Return `PickOption[]` with `{ value: diagram.id, label: string }`

**ContextPickerModal Component**
- Create new file: `frontend/src/components/ProductView/ContextPickerModal.tsx`
- Props: `isOpen`, `onClose`, `initialSelected: ContextState`, `architectureOptions`, `diagramOptions`, `onApply(ContextState)`
- Two-tab layout: "Architecture" and "Diagrams" using button/div-based tab switching
- Each tab has a search input filtering options by label substring (case-insensitive)
- Architecture tab renders groups with collapsible headers (default expanded), each option has checkbox + label
- Diagrams tab renders flat list with checkbox + label
- Modal maintains internal draft selection state until Apply is clicked
- Footer buttons: Cancel (closes without change) and Apply (calls onApply)
- Follow modal patterns from WorkItemCreateModal.tsx for overlay, close behavior, styling

**Multi-Select and Deduplication Logic**
- Maintain selection state across both tabs during modal session
- When Apply is clicked, merge selections from both tabs into new ContextState
- Deduplicate by (entity_type, entity_id) for entities and by diagram_id for diagrams
- Preserve existing selections that were not modified in the modal session

**Wire Modal into ProductImplementPage**
- On "Add context" click: load current context from page state, open modal
- On Apply: update page state with new context, call saveContext to persist
- On page mount with workItemId: call loadContext and set page state
- When workItemId changes (URL navigation): reload context from storage

**Empty State Handling**
- If architectureOptions has no items: show "No architecture entities available in this project."
- If diagramOptions is empty: show "No diagrams available in this project."
- Modal should not crash or error on empty project data

**Testing Requirements**
- Unit tests for contextStorage: load/save round-trip, corrupt JSON fallback, empty state default
- Unit tests for label resolution helper: name/title/id fallback logic
- UI tests (if RTL exists): open modal, select items across tabs, apply, verify chips appear
- UI tests: simulate refresh/remount, verify chips persist from localStorage

## Visual Design
N/A - No visual mockups provided. Follow existing ProductView modal and panel patterns for styling.

## Existing Code to Leverage

**WorkItemSummaryPanel.tsx**
- Current location of context placeholder (lines 171-191)
- Add Context section directly below or replace the placeholder
- Follow existing field group styling patterns
- Use existing CSS module (WorkItemSummaryPanel.module.css)

**WorkItemCreateModal.tsx**
- Modal structure pattern: overlay, header with close button, content, footer
- Form validation and submission patterns
- useCallback patterns for event handlers
- CSS module patterns in WorkItemCreateModal.module.css

**ArchitectureContext.tsx**
- Access global state via `useArchitecture()` hook
- `state.model.metaModel.entities` provides all entity collections
- `state.model.diagrams` provides diagram list
- `state.loadedFileName` serves as projectId

**model.ts (MetaModelEntities)**
- All entity collection keys defined in MetaModelEntities interface
- Entity structures show name/title patterns for label resolution
- Diagram interface shows id, name, diagram_type fields

**Existing CSS patterns (WorkItemSummaryPanel.module.css)**
- `.contextPlaceholder` style block can be adapted for context section
- Badge and chip styling patterns from `.badge`, `.childItem` classes
- Button styling from `.backButton` class

## Out of Scope
- No LLM integration or write-spec generation in this increment
- No backend persistence or new API endpoints for context storage
- No deep previews of diagrams or entities (thumbnail/details on hover)
- No drag-and-drop reordering of context chips
- No batch operations for context items
- No "Select All" functionality in modal tabs
- No filtering by entity domain (all domains shown together)
- No integration with implementation assistant panel
- No export/import of context state
- No context item ordering or priority fields
