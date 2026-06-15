# Spec Requirements: User Journey Diagram Edit and Save Flow

## Initial Description
Enable editing and persistence of User Journey diagrams by allowing users to modify generated diagrams in the canvas and save them as first-class diagram artifacts of type "User Journey", completing the end-to-end UX Designer -> Diagram workflow.

## Requirements Discussion

### First Round Questions

**Q1:** Save Entry Point -- Journey Review Banner vs. Other Triggers. I assume the primary "save" action occurs from the Journey Review Banner (the blue "Preview" mode toolbar that currently shows Previous/Next/Back to List/Close Review buttons). The user would click a new "Save as Diagram" button on this banner to persist the currently viewed journey as a native USER_JOURNEY diagram in the model. Is that correct, or should saving also be possible from other entry points (e.g., a "Save All" option in the chooser view)?
**Answer:** The primary and only save entry point in Increment 8 should be a new "Save as Diagram" action from the Journey Review Banner/open review state; do not add "Save All" or other bulk save triggers in this increment.

**Q2:** Save Semantics -- Direct vs. Name Confirmation. When the user clicks "Save as Diagram", I assume we should show a brief confirmation modal (similar to NewDiagramModal) where they can review/edit the diagram name (defaulting to the journey name, e.g., "Customer Onboarding Journey") before saving. Is that correct, or should it save immediately with the auto-generated name and no modal?
**Answer:** Show a brief confirmation modal before save, reusing the existing naming pattern where possible, with the diagram name defaulting to the journey name and editable by the user before confirming.

**Q3:** Data Storage Structure. I assume the saved journey diagram will use the existing typedContent envelope pattern (like Sequence, ER, Activity, State diagrams) with { type: 'USER_JOURNEY', version: 1, content: <UserJourneyDiagramDto> } stored in the typed_content_json JSONB column. The diagram_nodes and diagram_edges arrays on the Diagram object would remain empty since the UserJourneyDiagramRenderer computes layout deterministically from the DTO data. Is that the correct approach, or should we convert journey data into native DiagramNode[]/DiagramEdge[] objects?
**Answer:** Save using the existing typedContent envelope pattern with type: 'USER_JOURNEY', versioned content carrying the authoritative UserJourneyDiagramDto-derived payload, and do not force-convert it into native DiagramNode[]/DiagramEdge[] as the stored source of truth for this increment.

**Q4:** Editing Capabilities -- Scope. The raw idea mentions "allowing users to modify generated diagrams in the canvas." I assume the editing capabilities for this increment are limited to: (a) renaming the diagram, (b) deleting the diagram, and (c) perhaps step name/description text editing. I do NOT assume we are enabling drag-to-move steps, drag-to-reorder lanes, or adding/removing steps/edges in the canvas -- those would be future enhancements. Is that correct, or do you want any specific interactive editing capabilities (e.g., step reordering, lane reordering, step text editing)?
**Answer:** Editing in Increment 8 should remain minimal: rename/save/delete lifecycle behavior for the diagram artifact itself, but no interactive canvas editing of journey structure, step text, ordering, or lanes yet.

**Q5:** Backend Persistence -- TypedContent Registration. The existing DiagramTypedContentType union in typedContent.ts includes 'Sequence' | 'ER' | 'Activity' | 'State' | 'UI_SCREEN' but not 'USER_JOURNEY'. The backend DiagramMapper.normalizeDiagramType() also does not have a USER_JOURNEY case. I assume we need to: (a) add 'USER_JOURNEY' to the DiagramTypedContentType union, (b) create a UserJourneyContent interface, (c) update createDefaultTypedContent(), (d) add the case to backend DiagramMapper.normalizeDiagramType(), and (e) ensure the model save/load pipeline round-trips the data correctly. Is that the expected scope for backend changes?
**Answer:** Yes: add 'USER_JOURNEY' to the typed-content registration pipeline end-to-end (frontend union/interface/default factory plus backend normalize/save/load round-trip support).

**Q6:** Post-Save Behavior. After saving a journey diagram, I assume the review session should close and the newly created diagram should be selected in the standard diagram selector (DiagramAutocomplete), showing the journey rendered via Canvas.tsx's USER_JOURNEY branch. The user would then be on a normal diagram page where they can rename, copy, or delete the diagram via the existing toolbar. Is that the expected behavior?
**Answer:** Yes: after save, close the temporary review state and select/open the newly created saved diagram in the normal diagram workspace/selector flow so it behaves like a standard saved diagram of type USER_JOURNEY.

**Q7:** Duplicate Handling. If a user saves the same journey multiple times (e.g., reviews the "Customer Onboarding" journey and clicks "Save as Diagram" twice), I assume each save creates a new independent diagram (the name confirmation modal would show a validation error if the exact name already exists, following the existing validateDiagramName pattern). The user would need to rename the duplicate. Is that correct, or should we detect and offer to overwrite an existing diagram with the same source journey?
**Answer:** Each save should create a new independent diagram artifact subject to normal diagram name validation; do not implement overwrite/update-from-source-journey behavior in Increment 8.

**Q8:** Exclusions -- What should we explicitly NOT build? Are there any specific capabilities you want to explicitly exclude from this spec? For example: SVG export for journey diagrams, re-generating journey data from the meta-model for an existing saved diagram, or synchronization between the saved diagram and the underlying meta-model entities?
**Answer:** Explicitly exclude SVG/PNG export, regeneration from meta-model, diagram-to-meta-model sync, overwrite-detection flows, bulk save, interactive structural editing, and any advanced lifecycle/versioning behavior.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ER Temporary Diagram Finalization Flow - Paths: `frontend/src/utils/diagramFinalizationUtils.ts`, `frontend/src/components/DiagramsView/MappingConfirmationModal.tsx`, `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines ~916-932 for the shared finalization effect)
- Feature: DiagramSelector New Diagram Creation - Path: `frontend/src/components/DiagramsView/DiagramSelector.tsx` (handleNewDiagram callback, lines ~52-65)
- Feature: TypedContentEnvelope Pattern - Path: `frontend/src/types/typedContent.ts` (envelope structure, content type interfaces, createDefault* factory functions)
- Feature: NewDiagramModal - Path: `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx` (name input, validation, submit pattern)
- Feature: JourneyReviewBanner - Path: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` (existing banner with navigation controls where "Save as Diagram" button will be added)
- Feature: UserJourneyReviewContext - Path: `frontend/src/contexts/UserJourneyReviewContext.tsx` (review session state management, close session flow)
- Feature: Canvas.tsx USER_JOURNEY Branch - Path: `frontend/src/components/DiagramsView/Canvas.tsx` (lines ~618-654 for extractUserJourneyDiagram helper, lines ~761 for isUserJourneyDiagram check, lines ~3551-3569 for render branch)
- Feature: DiagramMapper Backend - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/DiagramMapper.java` (normalizeDiagramType method needs USER_JOURNEY case)
- Feature: DiagramEntity/DiagramDto Backend - Paths: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiagramEntity.java`, `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java` (typed_content_json JSONB persistence)
- Feature: Model Save Pipeline - Path: `frontend/src/utils/saveUtils.ts` (saveModelToBackend), `frontend/src/api/modelSerialization.ts` (prepareModelForApiSave/normalizeModelFromApi for typedContent snake_case mapping)

### Follow-up Questions
No follow-up questions were needed. User answers were clear and comprehensive.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were found in the planning/visuals/ folder.

## Requirements Summary

### Functional Requirements
- Add a "Save as Diagram" button to the JourneyReviewBanner component, visible when a specific journey is being viewed (selectedIndex is not null)
- Clicking "Save as Diagram" opens a confirmation modal with an editable diagram name field defaulting to the journey name
- The modal follows existing NewDiagramModal patterns: name input, validation via validateDiagramName, Create/Cancel buttons
- On confirm, create a new Diagram object with diagram_type 'USER_JOURNEY', empty diagram_nodes/diagram_edges arrays, and typedContent envelope containing the UserJourneyDiagramDto data
- Dispatch ADD_DIAGRAM to add the new diagram to the model state
- Close the journey review session (via closeReviewSession) after successful save
- Select and navigate to the newly created diagram in the standard diagram workspace
- The saved diagram renders via Canvas.tsx's existing USER_JOURNEY branch using UserJourneyDiagramRenderer
- The saved diagram supports standard diagram lifecycle operations: rename (via RenameDiagramModal), copy (via CopyDiagramModal), delete (via DeleteDiagramConfirmModal) through the existing DiagramSelector toolbar
- Register 'USER_JOURNEY' in the TypedContentEnvelope pipeline: add to DiagramTypedContentType union, create UserJourneyContent interface, update createDefaultTypedContent factory
- Update backend DiagramMapper.normalizeDiagramType() to handle 'USER_JOURNEY' case
- Ensure full save/load round-trip: frontend typedContent -> API prepareModelForApiSave (typed_content snake_case) -> backend typed_content_json JSONB -> API normalizeModelFromApi -> frontend typedContent

### Reusability Opportunities
- NewDiagramModal pattern (or a simplified variant) for the save confirmation modal UI
- validateDiagramName utility for name validation in the modal
- generatePrefixedId('diag') for generating the new diagram ID
- TypedContentEnvelope structure and createDefault* factory pattern for the new USER_JOURNEY content type
- ADD_DIAGRAM dispatch action for adding the diagram to state (already handles view_quarter defaults, decorations array initialization)
- extractUserJourneyDiagram helper in Canvas.tsx already reads from typedContent.content -- just needs the save side to write in the same shape
- DiagramSelector toolbar buttons (Rename, Copy, Delete) work automatically for any diagram once it is in the model's diagrams array
- saveModelToBackend/prepareModelForApiSave pipeline handles typedContent serialization automatically

### Scope Boundaries
**In Scope:**
- "Save as Diagram" button on JourneyReviewBanner
- Save confirmation modal with editable name (defaulting to journey name)
- Creating a new Diagram object with USER_JOURNEY type and typedContent envelope
- Frontend TypedContentEnvelope registration for USER_JOURNEY (union type, interface, factory)
- Backend DiagramMapper normalizeDiagramType() update for USER_JOURNEY
- Post-save: close review session, select new diagram in standard workspace
- Standard diagram lifecycle (rename/copy/delete) via existing toolbar mechanisms
- Save/load round-trip verification through the full persistence pipeline
- Diagram name uniqueness validation (standard validateDiagramName)

**Out of Scope:**
- SVG/PNG export for User Journey diagrams
- Regeneration of journey data from meta-model for existing saved diagrams
- Diagram-to-meta-model synchronization (updating underlying USER_JOURNEY/ACTIVITY_STEP entities from diagram edits)
- Overwrite/update-from-source-journey detection or flows
- Bulk save ("Save All" from chooser view)
- Interactive structural editing in canvas (drag steps, reorder lanes, edit step text, add/remove steps or edges)
- Advanced lifecycle/versioning behavior
- Manual creation of USER_JOURNEY diagrams via NewDiagramModal (USER_JOURNEY remains excluded from CREATABLE_DIAGRAM_TYPES)

### Technical Considerations
- The UserJourneyDiagramDto structure (journey metadata, lanes, steps, edges, render_hints) is the authoritative payload stored in typedContent.content -- the renderer computes layout deterministically from this data
- diagram_nodes and diagram_edges arrays remain empty for USER_JOURNEY diagrams; all rendering data lives in typedContent
- The existing Canvas.tsx extractUserJourneyDiagram helper already looks in both typedContent.content and settings.journeyDiagram -- the save flow should write to typedContent.content as the canonical location
- The backend DiagramEntity stores typedContentJson as Map<String, Object> (JSONB) -- no schema migration is needed since the column already exists; only the DiagramMapper normalization needs updating
- The frontend modelSerialization.ts prepareModelForApiSave already maps typedContent -> typed_content for all diagrams generically -- no serialization changes needed
- The closeReviewSession() method in UserJourneyReviewContext clears all state; the caller (DiagramsView) must handle SET_VIEW restoration to return to the diagrams view after saving
- Name validation must check against all existing diagrams in the model (all types), not just USER_JOURNEY diagrams
- The confirmation modal should be a new lightweight component (e.g., SaveJourneyDiagramModal) rather than reusing NewDiagramModal directly, since it does not need the diagram type dropdown
