# Specification: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response

## Goal
Enable configurable multi-line labels for sequence diagram messages referencing InterfaceEndpoint entities (showing name, verb+path, request/response data), and add an "Endpoint Response" response mode that implicitly reuses the same endpoint for the return message.

## User Stories
- As a solution architect, I want to configure which parts of an InterfaceEndpoint are displayed on sequence diagram arrows so that the diagram communicates the right level of detail (endpoint name, HTTP verb + path, and/or data entities).
- As a solution architect, I want an "Endpoint Response" option for response messages so that the return arrow automatically shows the endpoint's response data without manually picking a separate reference.

## Specific Requirements

**Database Migration 041: Add endpoint display columns to sequence_messages**
- Create file `architecture-model-service/src/main/resources/db/changelog/sql/041-seq-messages-interface-endpoint-display-options.sql`; the latest existing migration is `040-add-endpoint-request-response-data-entity-point.sql`
- Add 4 columns to `sequence_messages`: `show_endpoint_name BOOLEAN NOT NULL DEFAULT FALSE`, `show_endpoint_verb_path BOOLEAN NOT NULL DEFAULT FALSE`, `show_endpoint_req_res_data BOOLEAN NOT NULL DEFAULT FALSE`, `response_mode TEXT NOT NULL DEFAULT 'normal'`
- Register the new SQL file in `db.changelog-master.yaml` with author `architecture-tool`
- All existing rows default to FALSE/FALSE/FALSE/'normal'; backward compatibility logic is handled in the frontend renderer (not via migration)

**Backend Entity: SequenceMessageEntity**
- File: `architecture-model-service/.../model/entity/SequenceMessageEntity.java` (currently 50 lines)
- Add 4 new JPA fields: `showEndpointName` (Boolean, column `show_endpoint_name`), `showEndpointVerbPath` (Boolean, column `show_endpoint_verb_path`), `showEndpointReqResData` (Boolean, column `show_endpoint_req_res_data`), `responseMode` (String, column `response_mode`)
- Use `@Column` annotations matching the DB column names; all non-null with defaults

**Backend DTO: SequenceMessageDto**
- File: `architecture-model-service/.../model/dto/entity/SequenceMessageDto.java` (currently 32 lines, Java record)
- Add 4 new record components: `showEndpointName` (Boolean, `@JsonProperty("show_endpoint_name")`), `showEndpointVerbPath` (Boolean, `@JsonProperty("show_endpoint_verb_path")`), `showEndpointReqResData` (Boolean, `@JsonProperty("show_endpoint_req_res_data")`), `responseMode` (String, `@JsonProperty("response_mode")`)

**Backend Mapper: EntityMapper sequence message methods**
- File: `architecture-model-service/.../mapper/EntityMapper.java`, methods `toDto(SequenceMessageEntity)` at line ~1172 and `toEntity(SequenceMessageDto, String)` at line ~1186
- Map all 4 new fields in both `toDto` and `toEntity` directions
- Note: the `isCollection` field is still passed as `null` in `toDto` (fix is out of scope per requirements Q1)

**Backend Validation (lightweight)**
- If `refKind` is not `InterfaceEndpoint`, then `responseMode` must be `"normal"` (reject otherwise)
- If `refKind` is `InterfaceEndpoint`, at least one of the three `show_*` flags must be `true`
- Place validation in the service layer where sequence messages are persisted

**Frontend Type Changes: SequenceMessage interface**
- File: `frontend/src/types/sequenceDiagram.ts`, `SequenceMessage` interface (line ~162)
- Add 4 optional fields: `show_endpoint_name?: boolean`, `show_endpoint_verb_path?: boolean`, `show_endpoint_req_res_data?: boolean`, `response_mode?: string`

**Frontend Type Changes: SequenceMessageRef interface**
- File: `frontend/src/types/typedContent.ts`, `SequenceMessageRef` interface (line ~109)
- Add the same 4 optional fields to keep parity with `SequenceMessage`

**Frontend Data Mapping: useSequenceDiagram hook**
- File: `frontend/src/hooks/useSequenceDiagram.ts`
- In `sequenceContentToSequenceDiagram` (line ~83 message mapping): copy the 4 new fields from `SequenceMessageRef` to `SequenceMessage`
- In `sequenceDiagramToSequenceContent` (line ~145 message mapping): copy the 4 new fields from `SequenceMessage` to `SequenceMessageRef`

**Frontend Modal: "What to Show?" checkbox group**
- File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
- Add 3 new fields to `FormData` interface: `showEndpointName: boolean`, `showEndpointVerbPath: boolean`, `showEndpointReqResData: boolean`; and a `responseContentMode` field with type `'label' | 'reference' | 'endpoint_response'`
- Defaults in `INITIAL_FORM_DATA`: `showEndpointName: false`, `showEndpointVerbPath: true`, `showEndpointReqResData: true`
- Show the "What to Show?" checkbox group only when `requestMode === 'reference'` AND `requestRefKind === 'InterfaceEndpoint'`; place it after the Reference picker, before "Is Collection?"
- Validation: if the checkbox group is visible, at least one must be checked; error message "Choose at least one thing to show"
- Wire the 3 show flags and `response_mode` onto the created `SequenceMessage` objects in `handleSubmit`

**Frontend Modal: "Endpoint Response" radio option**
- In the Response Content section radio group (currently Label Text / Reference at lines ~662-679), add a third radio: "Endpoint Response"
- This third option is only visible when the request references an `InterfaceEndpoint` AND `includeResponse` is checked
- Radio order: Label Text / Reference / Endpoint Response
- When "Endpoint Response" is selected, hide the Reference Type dropdown and Reference picker; the response message implicitly references the same InterfaceEndpoint as the request
- Set `response_mode: 'endpoint_response'` on the response `SequenceMessage`; copy the request's `ref_kind` and `ref_id` to the response message
- Copy the 3 `show_*` flags from the request to the response message

**Frontend Renderer: Multi-line label with tspan elements**
- File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
- In `MessageArrow` component (line ~1032) and `SelfMessageArrow` component (line ~1098), replace the single `<text>` element with a `<text>` containing multiple `<tspan>` child elements when the label is an array of lines
- Change the `label` prop type from `string` to `string | string[]` (or introduce a `labelLines: string[]` prop)
- Each `<tspan>` uses `dy` for line spacing (~14px per line) and `x` set to the label center X; first tspan uses the base Y offset, subsequent tspans use `dy="14"`
- Adjust `labelY` upward proportionally to number of lines so the label block remains centered above the arrow

**Frontend Renderer: resolveMessageLabel changes for InterfaceEndpoint**
- In `resolveMessageLabel` function (line ~533), detect `ref_kind === 'InterfaceEndpoint'` and return an array of label lines instead of a single string
- Build lines in fixed order: (1) if `show_endpoint_name` or legacy fallback: `endpoint.name`, (2) if `show_endpoint_verb_path`: `"${endpoint.operation_verb} ${endpoint.path_or_address}"`, (3) if `show_endpoint_req_res_data`: resolved entity name from `request_data_entity_point_id` (for Request role) or `response_data_entity_point_id` (for Response role)
- Change return type to `string | string[]`; existing callers that render a single-line string continue to work for non-endpoint messages
- Legacy backward compatibility: if all 3 `show_*` flags are `false`/missing (old data), default to showing endpoint name (treat as `show_endpoint_name = true`)

**Frontend Renderer: Data Entity Point ID resolver utility**
- The Endpoint type (in `frontend/src/types/model.ts`, line ~110) has `request_data_entity_point_id` and `response_data_entity_point_id` fields using the `dep_log_*`/`dep_phy_*` format
- Create a utility function `resolveDataEntityPointName(depId: string, metaModel: MetaModel): string` that parses the prefix (`dep_log_` or `dep_phy_`) to determine collection (`logical_data_entities` or `physical_data_entities`), extracts the entity UUID, and looks up the entity name
- Place this utility in `frontend/src/utils/` or co-locate in the renderer; reuse from `resolveMessageLabel`

**Frontend Renderer: Response label for endpoint_response mode**
- When `response_mode === 'endpoint_response'`, the response message uses the same InterfaceEndpoint ref as the request
- `resolveMessageLabel` uses the same `show_*` flags but resolves the data line from `response_data_entity_point_id` instead of `request_data_entity_point_id`
- Distinguish request vs response data resolution using `exchange_role` on the `SequenceMessage`

**Frontend Layout: Row height increase for multi-line labels**
- File: `frontend/src/utils/sequenceLayout.ts`, `LAYOUT_CONSTANTS.rowHeight` is currently `60` (line ~45)
- Messages with multi-line labels (up to 3 lines) need more vertical space; increase `rowHeight` or compute per-message row height based on line count
- Approach: either make `rowHeight` dynamic per message or increase the global constant to accommodate 3 lines (e.g., ~80px); dynamic per-message is preferred to avoid wasting space on single-line messages
- No overlap is allowed between adjacent message labels

## Visual Design
No visual assets were provided.

## Existing Code to Leverage

**resolveMessageLabel function (`SequenceDiagramRenderer.tsx` line ~533)**
- Currently resolves entity name from `MESSAGE_REF_KIND_TO_COLLECTION` map and applies collection formatting
- Extend this function with an InterfaceEndpoint-specific branch that builds multi-line output
- Reuse `MESSAGE_REF_KIND_TO_COLLECTION['InterfaceEndpoint']` which maps to `metaModel.entities.endpoints`

**MessageArrow and SelfMessageArrow components (`SequenceDiagramRenderer.tsx` lines ~1032, ~1098)**
- Both currently render a single `<text>` element for the label at a computed `labelY` position
- Both need to support multi-line rendering via `<tspan>` elements
- The SVG `<text>` + `<tspan dy="...">` pattern is standard SVG for multi-line text

**AddMessageExchangeDrawer form pattern (`AddMessageExchangeDrawer.tsx`)**
- `FormData` interface and `INITIAL_FORM_DATA` constant define all form state (line ~55-85)
- Conditional visibility pattern: `showRequestIsCollectionCheckbox` (line ~234) demonstrates how to conditionally show UI based on `requestMode` and `requestRefKind`
- Response section radio buttons (lines ~662-679) show the existing Label Text / Reference pattern to extend with a third option
- `handleSubmit` (line ~349) constructs `SequenceMessage` objects with spread syntax for conditional fields

**useSequenceDiagram hook mapping functions (`useSequenceDiagram.ts`)**
- `sequenceContentToSequenceDiagram` (line ~53) and `sequenceDiagramToSequenceContent` (line ~137) perform field-by-field mapping between `SequenceMessageRef` and `SequenceMessage`
- New fields must be added to both mapping directions to ensure round-trip persistence

**Endpoint type definition (`model.ts` line ~110)**
- `Endpoint` interface has `operation_verb`, `path_or_address`, `request_data_entity_point_id`, `response_data_entity_point_id`
- These fields provide all the data needed for the 3 display lines (name from entity lookup, verb+path from fields, data entity from dep ID resolution)

## Out of Scope
- Fixing the missing `isCollection` field on `SequenceMessageEntity.java` (separate spec per requirements Q1)
- Changes to the InterfaceEndpoint meta-model itself
- Changes to message routing, lifeline layout, fragments, or horizontal spacing
- Export or print layout changes
- New reference types or changes to existing (non-endpoint) reference rendering
- Auto-generation of request/response data entities
- User-configurable display templates beyond the 3 checkbox options
- Label prefixes or visual styling differences between request and response labels (distinction is arrow style only)
- Editing existing messages (this spec covers creation via the Add Message Exchange drawer only)
- Any changes to the "Is Collection?" checkbox behavior for InterfaceEndpoint references
