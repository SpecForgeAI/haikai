# Task Breakdown: Sequence Diagram Interface Endpoint - Separate Request/Response "What to Show?" and Fix 3-Line Label Y-Offset

## Overview
Total Tasks: 14
Scope: Frontend-only

This feature separates the "What to Show?" checkbox group into independent request and response controls when using InterfaceEndpoint references, and fixes the vertical positioning of 3-line multi-line labels so they do not overlap the message arrow. No backend changes are required.

## Task List

### Frontend - Form State Layer

#### Task Group 1: AddMessageExchangeDrawer - Response Show Flags Form State
**Dependencies:** None

- [x] 1.0 Complete form state changes for separate response show flags
  - [x] 1.1 Write 4 focused tests for response show flag form state
    - Test: `FormData` includes `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData` fields
    - Test: `INITIAL_FORM_DATA` defaults are `false`, `false`, `true` for the three response show fields
    - Test: changing `requestRefKind` away from `InterfaceEndpoint` resets response show flags to defaults
    - Test: response show flags are independent from request show flags
  - [x] 1.2 Add response show flag fields to `FormData` interface
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add `responseShowEndpointName: boolean` (default false)
    - Add `responseShowEndpointVerbPath: boolean` (default false)
    - Add `responseShowEndpointReqResData: boolean` (default true)
  - [x] 1.3 Add defaults to `INITIAL_FORM_DATA`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - `responseShowEndpointName: false`
    - `responseShowEndpointVerbPath: false`
    - `responseShowEndpointReqResData: true`
  - [x] 1.4 Reset response show flags when `requestRefKind` changes away from `InterfaceEndpoint`
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add the three response flags to the existing reset logic alongside request flag resets
  - [x] 1.5 Ensure form state tests pass
    - Run ONLY the 4 tests written in 1.1

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Response show flags exist with correct defaults
- Flags reset when switching away from InterfaceEndpoint
- Response flags are independent from request flags

### Frontend - Form UI Layer

#### Task Group 2: Response "What to Show?" Checkbox Group and Label Updates
**Dependencies:** Task Group 1

- [x] 2.0 Complete response checkbox group UI and label updates
  - [x] 2.1 Write 5 focused tests for the response checkbox group UI
    - Test: response "What to Show?" checkbox group renders when `responseContentMode === 'endpoint_response'`
    - Test: response "What to Show?" checkbox group does NOT render when `responseContentMode !== 'endpoint_response'`
    - Test: response checkbox labels are "Name", "Verb and Path", "Response Data"
    - Test: request third checkbox label reads "Request Data" (not "Request/Response Data")
    - Test: response checkboxes are wired to `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData`
  - [x] 2.2 Change request third checkbox label from "Request/Response Data" to "Request Data"
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Update label text at approximately line 713
  - [x] 2.3 Add response "What to Show?" checkbox group in response content section
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Replace the `null` return at approximately line 809 when `responseContentMode === 'endpoint_response'`
    - Duplicate the request checkbox group JSX pattern (lines 684-720)
    - Label the group "What to Show?" matching request group styling
    - Checkbox labels: "Name", "Verb and Path", "Response Data"
    - Wire to `responseShowEndpointName`, `responseShowEndpointVerbPath`, `responseShowEndpointReqResData` via `handleFieldChange`
    - Use same styling: `flexDirection: column`, `gap: 6px`, checkbox + label with `gap: 8px`
  - [x] 2.4 Ensure UI tests pass
    - Run ONLY the 5 tests written in 2.1

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Response checkbox group appears only when endpoint_response mode is selected
- Request checkbox third label reads "Request Data"
- Response checkbox third label reads "Response Data"
- Checkboxes toggle the correct form state fields

### Frontend - Validation and Submit Layer

#### Task Group 3: Validation and Submit Logic
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete validation and submit logic changes
  - [x] 3.1 Write 4 focused tests for validation and submit behavior
    - Test: validation error when `includeResponse` is true, `responseContentMode === 'endpoint_response'`, and all three response show flags are false
    - Test: no validation error when at least one response show flag is true
    - Test: `handleSubmit` uses `responseShowEndpointName`/`VerbPath`/`ReqResData` for response message (not request flags)
    - Test: `handleSubmit` still uses request show flags for request message
  - [x] 3.2 Add validation for response "What to Show?" group
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - In `validateForm`, when `includeResponse === true` AND `responseContentMode === 'endpoint_response'`, validate at least one response show flag is checked
    - Use error key `responseWhatToShow`
    - Display error below the response checkbox group
  - [x] 3.3 Update `handleSubmit` to use response-specific show flags
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Replace lines 461-463 which copy request flags to response message
    - Use `formData.responseShowEndpointName`, `formData.responseShowEndpointVerbPath`, `formData.responseShowEndpointReqResData` for the response message
  - [x] 3.4 Ensure validation and submit tests pass
    - Run ONLY the 4 tests written in 3.1

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Validation prevents submit when no response show flag is checked (endpoint_response mode)
- Response message persists its own independent show flags
- Request message continues to use request show flags

### Frontend - SVG Rendering Layer

#### Task Group 4: 3-Line Label Y-Offset Fix
**Dependencies:** None (can run in parallel with Task Groups 1-3)

- [x] 4.0 Complete 3-line label y-offset fix
  - [x] 4.1 Write 3 focused tests for the 3-line label y-offset
    - Test: `renderMultiLineLabel` shifts startY up by additional 10px when `labelLines.length === 3`
    - Test: `renderMultiLineLabel` does NOT shift startY for 2-line labels
    - Test: `renderMultiLineLabel` does NOT shift startY for 1-line labels
  - [x] 4.2 Add 3-line offset in `renderMultiLineLabel`
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - After computing `startY = baseY - totalHeight / 2` (around line 1125)
    - Add: `if (labelLines.length === 3) startY -= 10;`
    - This fix applies to both `MessageArrow` and `SelfMessageArrow` since both call `renderMultiLineLabel`
  - [x] 4.3 Ensure rendering tests pass
    - Run ONLY the 3 tests written in 4.1

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- 3-line labels are shifted up by 10px and do not overlap the arrow
- 1-line and 2-line labels remain unaffected
- Fix applies to both regular and self-message arrows

### Testing - Integration and Gap Analysis

#### Task Group 5: Test Review and Integration Testing
**Dependencies:** Task Groups 1-4 (all completed)

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests from Task Group 1 (form state)
    - Review the 5 tests from Task Group 2 (checkbox UI)
    - Review the 4 tests from Task Group 3 (validation and submit)
    - Review the 3 tests from Task Group 4 (y-offset rendering)
    - Total existing tests: 16 tests
  - [x] 5.2 Analyze test coverage gaps for this feature
    - Identify critical user workflows lacking coverage
    - Focus on integration between form state, submit, and rendering
    - Focus on backward compatibility with legacy messages (all flags false/missing -> show endpoint name)
  - [x] 5.3 Write up to 8 additional integration tests if needed
    - Test: end-to-end flow - create message exchange with separate request/response show flags, verify both messages persist correct flags
    - Test: legacy message with all show flags false/missing renders endpoint name (backward compatibility)
    - Test: switching responseContentMode away from endpoint_response hides response checkbox group
    - Test: 3-line InterfaceEndpoint label renders above arrow without overlap
    - Test: request message with Name+VerbPath+RequestData shows all 3 lines; response with only ResponseData shows 1 line
    - Test: validation error clears when user checks at least one response show flag
    - Test: response show flags do not affect request message rendering
    - Test: mixed diagram with endpoint and non-endpoint messages renders correctly
  - [x] 5.4 Run all feature-specific tests
    - Run all tests related to this feature
    - Expected total: approximately 16-24 tests
    - Verify all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-24 tests total)
- End-to-end workflow from form to rendering is covered
- Backward compatibility with legacy messages is verified
- No regressions in existing message exchange behavior

## Execution Order

Recommended implementation sequence:

**Phase 1 (Parallel):**
- Task Group 1: Form State Layer (can start immediately)
- Task Group 4: 3-Line Label Y-Offset Fix (can start immediately, independent of form changes)

**Phase 2 (Sequential after Group 1):**
- Task Group 2: Response Checkbox Group UI (requires Group 1 form state)

**Phase 3 (Sequential after Group 2):**
- Task Group 3: Validation and Submit Logic (requires Groups 1 and 2)

**Phase 4 (Sequential after all):**
- Task Group 5: Integration Testing (requires Groups 1-4 complete)

## File Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx` | 1, 2, 3 | Add response show flag fields/defaults, response checkbox group UI, label text change, validation, submit logic |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | 4 | Add 3-line y-offset conditional in `renderMultiLineLabel` |

## Notes

- **No backend changes required** - `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data` already exist on each message row
- **No database migration required** - columns exist from migration 041
- **No changes to `resolveInterfaceEndpointLabel`** - already correctly handles request vs response data resolution
- **No changes to TypeScript interfaces** - `SequenceMessage` already declares the needed optional fields
- **No changes to Canvas.tsx extraction** - already maps the show flag fields
- Legacy backward compatibility is preserved: messages with all flags false/missing default to showing endpoint name
