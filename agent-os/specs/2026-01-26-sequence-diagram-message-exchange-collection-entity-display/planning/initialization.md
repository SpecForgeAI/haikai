# Initialization

**Spec Name**: sequence-diagram-message-exchange-collection-entity-display
**Scope**: full-stack
**Type**: message-content-model-extension + ux-rendering-enhancement

## Original Request

**Intent**:
Allow Sequence Diagram message exchanges to indicate that a referenced data entity payload represents a collection (list/array/set) rather than a single instance, and render the label accordingly as Collection<EntityName>.

**Applies To**:
- Message Exchange request content when content mode is "Reference"
- Message Exchange response content when content mode is "Reference"
- Reference Type must be one of: PhysicalEntity, LogicalEntity

**UX Requirements - Add Message Exchange Modal**:
- When Request Content mode == Reference AND Reference Type IN {PhysicalEntity, LogicalEntity}:
  - Display a checkbox below the "Reference" selector labeled: "Is Collection?"
  - Checkbox default: unchecked
- When Response Content mode == Reference AND Reference Type IN {PhysicalEntity, LogicalEntity}:
  - Display a checkbox below the "Reference" selector labeled: "Is Collection?"
  - Checkbox default: unchecked
- When content mode is not Reference OR reference type is not PhysicalEntity/LogicalEntity:
  - Do not show the checkbox (or show disabled/hidden per existing UI patterns)
- Switching reference type away from PhysicalEntity/LogicalEntity:
  - MUST reset the corresponding "Is Collection?" value to false

**Data Model Requirements**:
- Extend the Sequence Diagram message exchange typed content to persist collection intent separately from label text (do NOT infer from string formatting)
- Add boolean flags:
  - request_is_collection: boolean (default false)
  - response_is_collection: boolean (default false)
- Backward compatibility: For existing diagrams with missing fields, treat as false

**Rendering Requirements**:

Request label rendering:
- If Request Content is Reference to PhysicalEntity/LogicalEntity:
  - If request_is_collection == true: display "Collection<${entityName}>"
  - Else: display "${entityName}"
- If Request Content is Label Text: render exactly as today (unchanged)
- If Request Content is Reference to other reference types: render exactly as today (unchanged)

Response label rendering:
- If Response Content is Reference to PhysicalEntity/LogicalEntity:
  - If response_is_collection == true: display "Collection<${entityName}>"
  - Else: display "${entityName}"
- If Response Content is Label Text: render exactly as today (unchanged)
- If Response Content is Reference to other reference types: render exactly as today (unchanged)

**Constraints**:
- No changes to participant rules, fragments, ordering, or layout engine beyond label text
- No changes to export/print behavior in this increment

**Non-Goals**:
- Do not support arbitrary generic types beyond "Collection<...>" in this increment

## Instructions Provided

1. Find the Add Message Exchange modal code
2. Find where message exchange typed content is defined (likely in types and backend)
3. Find where message labels are rendered in SequenceDiagramRenderer.tsx
4. Create the spec folder: agent-os/specs/2026-01-26-sequence-diagram-message-exchange-collection-entity-display/
5. Write comprehensive spec.md covering:
   - Backend typed content model changes
   - Frontend modal UX changes
   - Frontend rendering changes

This spec is well-defined. Proceed directly to creating the spec without asking clarifying questions.
