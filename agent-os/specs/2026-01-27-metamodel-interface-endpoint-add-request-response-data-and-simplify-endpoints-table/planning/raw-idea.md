```
intent:
  Extend InterfaceEndpoint (Endpoints) to capture request/response body data entities via
  Data Entity Point FKs, and simplify the Endpoints UI table by removing unused columns
  (Status, Version, Tags).

meta_model_changes:
  entity: InterfaceEndpoint
  add_attributes:
    - request_data_entity_point_id:
        type: FK
        target: DataEntityPoint
        required: false
        label: "Request Data"
        ui_selector: DataEntityPointDropdownGrouped
    - response_data_entity_point_id:
        type: FK
        target: DataEntityPoint
        required: false
        label: "Response Data"
        ui_selector: DataEntityPointDropdownGrouped
  remove_attributes_from_model_surface:
    - status
    - version
    - tags
  notes:
    - "remove_attributes_from_model_surface" means:
        - no longer exposed/editable in UI
        - no longer present in API DTOs / typed meta-model payloads
        - safe to leave any existing DB columns as-is (do NOT drop columns in this increment)

database_changes_liquibase:
  required_columns:
    table: interface_endpoints
    add_columns:
      - request_data_entity_point_id:
          type: VARCHAR(64)
          nullable: true
      - response_data_entity_point_id:
          type: VARCHAR(64)
          nullable: true
  foreign_keys:
    - from: interface_endpoints.request_data_entity_point_id
      to: data_entity_points.id
      on_delete: SET NULL
    - from: interface_endpoints.response_data_entity_point_id
      to: data_entity_points.id
      on_delete: SET NULL
  migrations:
    - add_sql_file: db/changelog/sql/0XX-add-endpoint-request-response-data-entity-point.sql
    - update_master_changelog: db/changelog/db.changelog-master.yaml
      changeSets:
        - id: 0XX-add-interface-endpoint-request-response-data
          author: architecture-tool

model_service_changes:
  persistence_and_mapping:
    - Add fields to InterfaceEndpoint persistence model and DTOs
    - Ensure DataEntityPoint lookup/resolution uses existing mechanisms
  api_contract:
    - Expose the new fields in meta-model endpoints read/write for InterfaceEndpoint
    - Remove status/version/tags from InterfaceEndpoint DTOs

frontend_changes:
  endpoints_table_ui:
    location: Application > Endpoints tab (InterfaceEndpoint list/table)
    add_columns:
      - "Request Data" (Data Entity Point dropdown grouped by Logical/Physical)
      - "Response Data" (Data Entity Point dropdown grouped by Logical/Physical)
    remove_columns:
      - Status
      - Version
      - Tags
    crowded_table_handling:
      - New dropdowns must match existing "Data Entity Point" UX:
          - searchable
          - grouped headers: LOGICAL DATA ENTITIES / PHYSICAL DATA ENTITIES
          - displays "Name [TYPE]" (existing convention)

non_goals:
  - Do not implement Sequence Diagram message rendering changes in this spec
  - Do not drop any existing DB columns for status/version/tags
  - Do not change endpoint verb/path behavior or validation beyond adding the two new FK fields

acceptance_criteria:
  - architecture-model-service starts with ddl-auto=validate after Liquibase runs
  - Endpoints UI table shows "Request Data" and "Response Data" dropdown columns
  - Endpoints UI table no longer displays Status, Version, or Tags columns
  - Created/updated InterfaceEndpoints persist request/response data entity point selection
```
