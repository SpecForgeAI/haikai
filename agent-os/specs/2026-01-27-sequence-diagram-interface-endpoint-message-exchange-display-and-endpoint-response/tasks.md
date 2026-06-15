# Task Breakdown: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response

## Overview
Total Tasks: 6 Task Groups, ~35 sub-tasks

## Task List

### Database Layer

#### Task Group 1: Migration 041 - Endpoint Display Columns
**Dependencies:** None

- [x] 1.0 Complete database migration
  - [x] 1.1 Write 3 focused tests for migration and entity persistence
    - Test that migration applies without error
    - Test that new columns have correct defaults (FALSE/FALSE/FALSE/'normal')
    - Test that a SequenceMessageEntity round-trips the 4 new fields
  - [x] 1.2 Create migration file `041-seq-messages-interface-endpoint-display-options.sql`
    - Path: `architecture-model-service/src/main/resources/db/changelog/sql/041-seq-messages-interface-endpoint-display-options.sql`
    - Add columns: `show_endpoint_name BOOLEAN NOT NULL DEFAULT FALSE`, `show_endpoint_verb_path BOOLEAN NOT NULL DEFAULT FALSE`, `show_endpoint_req_res_data BOOLEAN NOT NULL DEFAULT FALSE`, `response_mode TEXT NOT NULL DEFAULT 'normal'`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - Add entry after `040-add-endpoint-request-response-data-entity-point.sql`
    - Author: `architecture-tool`
  - [x] 1.4 Ensure migration tests pass
    - Run ONLY the 3 tests from 1.1

**Acceptance Criteria:**
- Migration applies cleanly on existing database
- All existing rows default to FALSE/FALSE/FALSE/'normal'
- New migration registered in changelog

---

### Backend Layer

#### Task Group 2: Entity, DTO, Mapper, and Validation
**Dependencies:** Task Group 1

- [x] 2.0 Complete backend entity/DTO/mapper/validation
  - [x] 2.1 Write 5 focused tests for backend changes
    - Test SequenceMessageEntity persists and retrieves 4 new fields
    - Test SequenceMessageDto serializes/deserializes 4 fields with correct JSON property names
    - Test EntityMapper toDto maps all 4 fields correctly
    - Test EntityMapper toEntity maps all 4 fields correctly
    - Test validation: reject non-InterfaceEndpoint with responseMode != 'normal'
  - [x] 2.2 Add 4 fields to SequenceMessageEntity
    - `showEndpointName` (Boolean, `@Column(name = "show_endpoint_name")`)
    - `showEndpointVerbPath` (Boolean, `@Column(name = "show_endpoint_verb_path")`)
    - `showEndpointReqResData` (Boolean, `@Column(name = "show_endpoint_req_res_data")`)
    - `responseMode` (String, `@Column(name = "response_mode")`)
  - [x] 2.3 Add 4 fields to SequenceMessageDto record
    - `showEndpointName` (Boolean, `@JsonProperty("show_endpoint_name")`)
    - `showEndpointVerbPath` (Boolean, `@JsonProperty("show_endpoint_verb_path")`)
    - `showEndpointReqResData` (Boolean, `@JsonProperty("show_endpoint_req_res_data")`)
    - `responseMode` (String, `@JsonProperty("response_mode")`)
  - [x] 2.4 Update EntityMapper toDto and toEntity methods
    - Map all 4 new fields in `toDto(SequenceMessageEntity)` (~line 1172)
    - Map all 4 new fields in `toEntity(SequenceMessageDto, String)` (~line 1186)
    - Leave `isCollection` as-is (out of scope)
  - [x] 2.5 Add lightweight validation in service layer
    - If `refKind` is not `InterfaceEndpoint`, reject `responseMode` != `"normal"`
    - If `refKind` is `InterfaceEndpoint`, require at least one `show_*` flag to be `true`
  - [x] 2.6 Ensure backend tests pass
    - Run ONLY the 5 tests from 2.1

**Acceptance Criteria:**
- Entity persists and retrieves all 4 new fields
- DTO serializes with snake_case JSON property names
- Mapper round-trips all 4 fields
- Validation rejects invalid combinations

---

### Frontend Types and Data Mapping

#### Task Group 3: TypeScript Types and Hook Mapping
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend type and mapping changes
  - [x] 3.1 Write 4 focused tests for type mapping
    - Test sequenceContentToSequenceDiagram copies 4 new fields from SequenceMessageRef to SequenceMessage
    - Test sequenceDiagramToSequenceContent copies 4 new fields from SequenceMessage to SequenceMessageRef
    - Test round-trip: fields survive content-to-diagram-to-content conversion
    - Test missing fields default gracefully (undefined passes through)
  - [x] 3.2 Add 4 optional fields to SequenceMessage interface
    - File: `frontend/src/types/sequenceDiagram.ts` (~line 162)
    - Fields: `show_endpoint_name?: boolean`, `show_endpoint_verb_path?: boolean`, `show_endpoint_req_res_data?: boolean`, `response_mode?: string`
  - [x] 3.3 Add 4 optional fields to SequenceMessageRef interface
    - File: `frontend/src/types/typedContent.ts` (~line 109)
    - Same 4 fields for parity
  - [x] 3.4 Update useSequenceDiagram hook mapping functions
    - File: `frontend/src/hooks/useSequenceDiagram.ts`
    - In `sequenceContentToSequenceDiagram` (~line 83): copy 4 fields from ref to message
    - In `sequenceDiagramToSequenceContent` (~line 145): copy 4 fields from message to ref
  - [x] 3.5 Ensure type mapping tests pass
    - Run ONLY the 4 tests from 3.1

**Acceptance Criteria:**
- Both interfaces include the 4 new optional fields
- Hook mapping copies fields in both directions
- Round-trip persistence works

---

### Frontend Modal

#### Task Group 4: AddMessageExchangeDrawer - Checkbox Group and Endpoint Response
**Dependencies:** Task Group 3

- [x] 4.0 Complete modal UI changes
  - [x] 4.1 Write 6 focused tests for modal behavior
    - Test "What to Show?" checkbox group appears only when requestMode=reference AND requestRefKind=InterfaceEndpoint
    - Test checkbox group hidden for non-InterfaceEndpoint reference kinds
    - Test validation error when all 3 checkboxes unchecked
    - Test "Endpoint Response" radio appears only when request refs InterfaceEndpoint AND includeResponse checked
    - Test selecting "Endpoint Response" hides Reference Type dropdown and Reference picker
    - Test handleSubmit sets response_mode and copies show_* flags to response message
  - [x] 4.2 Add form state fields to FormData interface and INITIAL_FORM_DATA
    - `showEndpointName: boolean` (default: `false`)
    - `showEndpointVerbPath: boolean` (default: `true`)
    - `showEndpointReqResData: boolean` (default: `true`)
    - `responseContentMode` extended to `'label' | 'reference' | 'endpoint_response'`
  - [x] 4.3 Implement "What to Show?" checkbox group UI
    - Conditional on `requestMode === 'reference'` AND `requestRefKind === 'InterfaceEndpoint'`
    - Place after Reference picker, before "Is Collection?"
    - Three checkboxes: Name, Verb and Path, Request/Response Data
    - Validation: at least one checked; error "Choose at least one thing to show"
  - [x] 4.4 Implement "Endpoint Response" radio option
    - Add third radio in response content section after "Reference"
    - Visible only when request references InterfaceEndpoint AND includeResponse checked
    - When selected: hide Reference Type dropdown and Reference picker
  - [x] 4.5 Update handleSubmit to wire new fields
    - Set `show_endpoint_name`, `show_endpoint_verb_path`, `show_endpoint_req_res_data` on request message
    - When responseContentMode is `'endpoint_response'`: set `response_mode: 'endpoint_response'` on response message, copy `ref_kind` and `ref_id` from request, copy 3 `show_*` flags from request
  - [x] 4.6 Ensure modal tests pass
    - Run ONLY the 6 tests from 4.1

**Acceptance Criteria:**
- Checkbox group shows/hides conditionally
- Validation prevents submitting with no checkboxes
- Endpoint Response radio shows/hides controls correctly
- Submit creates messages with correct field values

---

### Frontend Renderer

#### Task Group 5: Multi-line Labels, Data Resolution, and Dynamic Row Height
**Dependencies:** Task Group 3

- [x] 5.0 Complete renderer changes
  - [x] 5.1 Write 8 focused tests for renderer changes
    - Test resolveMessageLabel returns string[] for InterfaceEndpoint with show_endpoint_name=true
    - Test resolveMessageLabel returns string[] with verb+path line when show_endpoint_verb_path=true
    - Test resolveMessageLabel returns string[] with data entity name when show_endpoint_req_res_data=true
    - Test legacy backward compatibility: all flags false/missing returns endpoint name
    - Test resolveDataEntityPointName resolves dep_log_* ID to logical data entity name
    - Test resolveDataEntityPointName resolves dep_phy_* ID to physical data entity name
    - Test MessageArrow renders multiple tspan elements for string[] label
    - Test dynamic row height increases for multi-line labels
  - [x] 5.2 Create resolveDataEntityPointName utility
    - Parse prefix: `dep_log_` maps to `logical_data_entities`, `dep_phy_` maps to `physical_data_entities`
    - Extract entity UUID after prefix
    - Look up entity name in metaModel
    - Place in `frontend/src/utils/` or co-locate in renderer
  - [x] 5.3 Extend resolveMessageLabel for InterfaceEndpoint
    - Detect `ref_kind === 'InterfaceEndpoint'`
    - Return `string[]` with up to 3 lines in order: name, verb+path, data entity
    - Use `exchange_role` to choose `request_data_entity_point_id` vs `response_data_entity_point_id`
    - Handle `response_mode === 'endpoint_response'` for response messages
    - Legacy fallback: if all `show_*` flags false/missing, default to `[endpoint.name]`
    - Return type changed to `string | string[]`
  - [x] 5.4 Update MessageArrow component for multi-line labels
    - Accept `label` as `string | string[]`
    - When array: render `<text>` with multiple `<tspan>` children
    - First tspan at base Y, subsequent tspans with `dy="14"`
    - Adjust `labelY` upward proportionally to center the label block
  - [x] 5.5 Update SelfMessageArrow component for multi-line labels
    - Same tspan pattern as MessageArrow
    - Adjust Y positioning for self-message layout
  - [x] 5.6 Implement dynamic row height in sequenceLayout.ts
    - File: `frontend/src/utils/sequenceLayout.ts`
    - Compute per-message row height based on label line count
    - Default 60px for 1 line; increase for 2-3 lines (e.g., ~70px for 2, ~80px for 3)
    - Ensure no overlap between adjacent message labels
  - [x] 5.7 Ensure renderer tests pass
    - Run ONLY the 8 tests from 5.1

**Acceptance Criteria:**
- InterfaceEndpoint messages display configurable multi-line labels
- Data entity point IDs resolve to entity names
- Legacy messages show endpoint name by default
- No label overlap on multi-line messages
- Both MessageArrow and SelfMessageArrow support multi-line

---

### Verification

#### Task Group 6: Test Review and Integration Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review and verify end-to-end
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 3 tests from Task Group 1 (migration/entity)
    - Review 5 tests from Task Group 2 (backend)
    - Review 4 tests from Task Group 3 (type mapping)
    - Review 6 tests from Task Group 4 (modal)
    - Review 8 tests from Task Group 5 (renderer)
    - Total existing: ~26 tests
  - [x] 6.2 Analyze coverage gaps for this feature
    - Focus on integration points between layers
    - Check end-to-end: create message with endpoint flags -> persist -> reload -> render multi-line
    - Check backward compatibility flow end-to-end
  - [x] 6.3 Write up to 8 additional integration tests
    - End-to-end: InterfaceEndpoint message creation with all 3 show flags -> multi-line render
    - End-to-end: Endpoint Response mode creates response message with correct fields
    - End-to-end: Legacy message (no flags) renders with endpoint name
    - Integration: modal submit -> hook mapping -> correct SequenceMessageRef fields
    - Integration: response_mode=endpoint_response copies ref_kind/ref_id from request
    - Backward compatibility: old data without show_* flags renders endpoint name
    - Validation: backend rejects non-InterfaceEndpoint with responseMode != 'normal'
    - Dynamic row height: 3-line label gets increased row height without overlap
  - [x] 6.4 Run all feature-specific tests
    - Run all tests from groups 1-5 plus new tests from 6.3
    - Expected total: ~34 tests
    - Do NOT run entire application test suite
    - Verify all pass

**Acceptance Criteria:**
- All ~34 feature-specific tests pass
- End-to-end flow works: create -> persist -> reload -> render
- Backward compatibility verified for legacy data
- No regressions in non-InterfaceEndpoint message rendering

---

## Execution Order

1. **Task Group 1: Database Migration** - Foundation; no dependencies
2. **Task Group 2: Backend Entity/DTO/Mapper/Validation** - Depends on migration
3. **Task Group 3: Frontend Types and Hook Mapping** - Depends on backend API contract
4. **Task Group 4: Frontend Modal** and **Task Group 5: Frontend Renderer** - Both depend on Task Group 3; can be done in parallel
5. **Task Group 6: Integration Verification** - Depends on all prior groups
