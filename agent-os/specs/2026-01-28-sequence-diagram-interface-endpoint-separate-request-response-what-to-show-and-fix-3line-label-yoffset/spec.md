# Specification: Sequence Diagram Interface Endpoint - Separate Request/Response "What to Show?" and Fix 3-Line Label Y-Offset

## Goal
Allow users to independently control which label lines (Name, Verb+Path, Data) are shown for request vs response messages when using InterfaceEndpoint references, and fix the vertical positioning of 3-line multi-line labels so they do not overlap the arrow.

## User Stories
- As a diagram author, I want separate "What to Show?" checkboxes for request and response messages so that I can show different endpoint details on each arrow (e.g., verb+path on request, response data on response).
- As a diagram viewer, I want 3-line endpoint labels to be shifted upward slightly so that all three lines are readable and do not overlap the message arrow.

## Specific Requirements

**Separate response "What to Show?" form state in AddMessageExchangeDrawer**
- Add three new fields to the `FormData` interface: `responseShowEndpointName` (boolean, default false), `responseShowEndpointVerbPath` (boolean, default false), `responseShowEndpointReqResData` (boolean, default true)
- Add these defaults to `INITIAL_FORM_DATA`
- When `requestRefKind` changes away from `InterfaceEndpoint`, reset the three response show flags to their defaults alongside the existing request flag resets

**Second "What to Show?" checkbox group in the response section**
- When `responseContentMode === 'endpoint_response'`, render a second checkbox group inside the "Response Content" conditional section (where `null` is currently returned at line 809)
- Label the group "What to Show?" matching the request group's styling
- Checkbox labels: "Name", "Verb and Path", "Response Data" (note: NOT "Request/Response Data")
- Wire checkboxes to `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData` via `handleFieldChange`

**Contextual label on request "What to Show?" third checkbox**
- Change the third checkbox label in the existing request "What to Show?" group from "Request/Response Data" to "Request Data" (line 713)

**Validation for response "What to Show?" group**
- In `validateForm`, when `includeResponse` is true AND `responseContentMode === 'endpoint_response'`, validate that at least one of the three response show flags is checked
- Use a distinct error key (e.g., `responseWhatToShow`) and display the error below the response checkbox group

**Stop copying request flags to response on submit**
- In `handleSubmit`, replace lines 461-463 which currently copy `formData.showEndpointName/VerbPath/ReqResData` to the response message
- Instead use: `show_endpoint_name: formData.responseShowEndpointName`, `show_endpoint_verb_path: formData.responseShowEndpointVerbPath`, `show_endpoint_req_res_data: formData.responseShowEndpointReqResData`

**3-line label y-offset fix in renderMultiLineLabel**
- In the `renderMultiLineLabel` function (SequenceDiagramRenderer.tsx, line 1125), after computing `startY`, add a conditional: if `labelLines.length === 3`, subtract an additional 10px from `startY`
- This applies to BOTH `MessageArrow` and `SelfMessageArrow` since both call `renderMultiLineLabel`
- Do NOT apply the offset for 1-line or 2-line labels

**No backend changes required**
- The `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data`, and `response_mode` fields already exist on `SequenceMessageEntity` and `SequenceMessageDto`
- Each message row (request and response) already stores its own independent copy of these booleans
- The backend `SequenceDiagramService` (parseMessages/messageToMap) and `EntityMapper` already round-trip these fields correctly
- No database migration needed (columns exist from migration 041)

**No changes to resolveInterfaceEndpointLabel**
- The renderer function already correctly switches between `request_data_entity_point_id` and `response_data_entity_point_id` based on `exchange_role`/`response_mode`
- Legacy fallback (all flags false/missing -> show endpoint name) remains unchanged for both request and response

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**AddMessageExchangeDrawer form state pattern (lines 58-94)**
- The `FormData` interface and `INITIAL_FORM_DATA` object define all form fields with defaults
- The existing request show flags (`showEndpointName`, `showEndpointVerbPath`, `showEndpointReqResData`) serve as the exact pattern to replicate for the three new response fields
- `handleFieldChange` already handles arbitrary `keyof FormData` fields, so the new response fields will work without modifying that function

**AddMessageExchangeDrawer "What to Show?" checkbox group UI (lines 684-720)**
- The existing request checkbox group provides the exact JSX pattern to duplicate for the response section
- Same styling: `flexDirection: column`, `gap: 6px`, checkbox + label with `gap: 8px`
- The response group replaces the `null` at line 809 when `endpoint_response` is selected

**renderMultiLineLabel centering logic (lines 1125-1156)**
- Currently computes `startY = baseY - totalHeight / 2` to center the label block
- The 3-line offset adds one additional line: `if (labelLines.length === 3) startY -= 10;`
- Both `MessageArrow` and `SelfMessageArrow` call this same function, so the fix applies everywhere automatically

**SequenceMessage interface (sequenceDiagram.ts, lines 162-189)**
- Already declares `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data`, and `response_mode` as optional fields
- No type changes needed; the response message object constructed in handleSubmit already accepts these fields

**Canvas.tsx extractSequenceDiagram function**
- Already maps `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data`, and `response_mode` when extracting sequence diagram data from typed content
- No changes needed in the extraction/serialization layer

## Out of Scope
- No new database migration or schema changes (columns already exist)
- No changes to `resolveInterfaceEndpointLabel` logic in the renderer
- No changes to backend Java code (SequenceDiagramService, EntityMapper, SequenceMessageDto, SequenceMessageEntity)
- No edit/migration tooling for existing saved message exchanges
- No layout engine row-height redesign (only the small y-offset tweak for 3-line labels)
- No changes to non-InterfaceEndpoint message types
- No changes to the `SequenceMessage` TypeScript interface or `SequenceMessageRef` typed content interface
- No changes to Canvas.tsx extraction logic
- No changes to useSequenceDiagram.ts hook mapping functions
- No changes to the request "What to Show?" checkbox group defaults (Name unchecked, Verb+Path checked, Request Data checked remain as-is)
