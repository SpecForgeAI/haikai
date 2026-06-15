# Spec Requirements: Sequence Diagram Interface Endpoint Separate Request/Response What-to-Show and Fix 3-Line Label Y-Offset

## Initial Description
For Sequence Diagram Message Exchanges where the REQUEST is a Reference to an InterfaceEndpoint:
1) Allow users to choose different "What to Show?" options for the request label vs the endpoint-derived response label (Endpoint Response).
2) Fix readability when all 3 label lines are shown by shifting the multi-line label up by 10px.

Scope: full-stack. Type: sequence-message-ux + persistence-mapping + label-rendering-bugfix.

## Requirements Discussion

### First Round Questions

**Q1:** The current "What to Show?" checkbox group has a single label "Request/Response Data" for the third option. The idea renames this to "Request Data" for the request section and "Response Data" for the response section. The underlying field name `show_endpoint_req_res_data` stays the same on each message row (since each message already has its own copy), and only the UI label changes contextually. Is that correct?
**Answer:** Yes. Keep `show_endpoint_req_res_data` as-is on each message row; only the UI label text is contextual ("Request Data" for request, "Response Data" for response).

**Q2:** Currently the response message in "Endpoint Response" mode copies the request's show flags verbatim (lines 461-463 in AddMessageExchangeDrawer.tsx). The idea introduces a SECOND independent "What to Show?" checkbox group for the response with different defaults. Should we add new form state fields for the response's show flags (e.g., `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData`), separate from the request's, or reuse the same field names and swap values at submit time?
**Answer:** Yes. Add a SECOND independent checkbox group for the response with separate form state (`responseShowEndpointName`/`VerbPath`/`ReqResData`) and persist those separately on the response row. Do NOT reuse request fields and "swap at submit".

**Q3:** For the 3-line label y-offset fix: `renderMultiLineLabel` currently centers the label block vertically around `baseY`. Should the additional 10px upward shift apply only when exactly 3 lines are shown, or for any label with 2+ lines?
**Answer:** Apply the -10px offset ONLY when `labelLines.length === 3` (exactly 3 lines), not for 2+.

**Q4:** The renderer's `resolveInterfaceEndpointLabel` currently determines request vs response data by checking `message.exchange_role === 'Response' || message.response_mode === 'endpoint_response'`. This already correctly uses `request_data_entity_point_id` for requests and `response_data_entity_point_id` for responses. Is this existing behavior correct and unchanged?
**Answer:** Confirmed. `resolveInterfaceEndpointLabel` already switches request vs response data based on `exchange_role`/`response_mode`, no change needed there.

**Q5:** For backward compatibility, legacy messages (where all three show flags are false/undefined) currently fall back to showing the endpoint name. Should this legacy fallback remain unchanged for both request and response messages?
**Answer:** Yes. Legacy fallback stays the same for BOTH request and response: if flags are missing/false, default to showing endpoint name (preserve current behavior).

**Q6:** Is there anything explicitly out of scope for this feature?
**Answer:** Out of scope: No new edit/migration tooling for existing exchanges beyond the legacy fallback behavior. No layout engine row-height redesign; only the small y-offset tweak for 3-line labels.

### Existing Code to Reference

No similar existing features identified by the user. However, the following files contain the current implementation that this spec modifies:

- Feature: AddMessageExchangeDrawer (current "What to Show?" UI) - Path: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
- Feature: SequenceDiagramRenderer (multi-line label rendering) - Path: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
- Feature: SequenceMessage types - Path: `frontend/src/types/sequenceDiagram.ts`
- Feature: Backend DTO - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Separate the "What to Show?" checkbox group into two independent groups: one for the request message and one for the response message (when "Endpoint Response" mode is selected)
- Request "What to Show?" options: Name, Verb and Path, Request Data (label change from "Request/Response Data")
- Request defaults: Name unchecked, Verb and Path checked, Request Data checked
- Response "What to Show?" options (shown only when "Endpoint Response" selected): Name, Verb and Path, Response Data (label change from "Request/Response Data")
- Response defaults: Name unchecked, Verb+Path unchecked, Response Data checked
- Validation: at least one checkbox must be checked in each visible group
- Each message row persists its own `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data` booleans independently
- Response message in "Endpoint Response" mode stores its own show flags, not copied from request
- The `response_mode` field distinguishes "normal" vs "endpoint_response" on the response message
- Legacy backward compatibility: messages with all show flags false/missing fall back to showing endpoint name
- Fix 3-line label readability: when `labelLines.length === 3`, shift the multi-line label up by an additional 10px
- The 10px offset applies only to exactly 3 lines, not 2 or fewer

### Reusability Opportunities
- The existing `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data` fields on `SequenceMessage` and `SequenceMessageDto` are reused as-is; no new database columns needed
- The existing `response_mode` field is reused as-is
- The existing `resolveInterfaceEndpointLabel` renderer logic is unchanged; it already handles request vs response data entity resolution correctly

### Scope Boundaries
**In Scope:**
- New form state fields for response show flags in AddMessageExchangeDrawer
- Second "What to Show?" checkbox group in the response section (visible only when "Endpoint Response" selected)
- Contextual UI labels: "Request Data" vs "Response Data" for the third checkbox
- Independent persistence of show flags per message row (request and response stored separately)
- Backend validation: at least one show flag true per InterfaceEndpoint message
- 3-line label y-offset fix (-10px when exactly 3 lines)

**Out of Scope:**
- Edit/migration tooling for existing message exchanges
- Layout engine row-height redesign
- Changes to resolveInterfaceEndpointLabel logic
- Any changes to non-InterfaceEndpoint message types

### Technical Considerations
- Frontend form state: add `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData` to `FormData` interface in AddMessageExchangeDrawer
- Frontend submit: when responseContentMode is "endpoint_response", use the response-specific show flags (not request flags) on the response SequenceMessage
- Frontend renderer: in `renderMultiLineLabel`, add conditional check for `labelLines.length === 3` to subtract 10px from `startY`
- Backend: SequenceMessageDto and SequenceMessageEntity already have the needed fields; no schema changes required
- Backend validation: add server-side check that at least one of the three show flags is true for any InterfaceEndpoint message
