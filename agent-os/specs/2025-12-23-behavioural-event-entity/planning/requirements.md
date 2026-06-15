---
title: Add Behavioural Architecture entity: Event (meta-model + diagram palette integration)

intent:
  - Introduce Event as a first-class Behavioural Architecture entity used as a trigger for behaviour.
  - Ensure Event is:
    - persistable in the backend meta-model
    - editable in the Meta-Model view (tables)
    - usable in diagrams via the RHS Diagram Palette
  - Align with the latest agreed UX patterns:
    - Architecture Domain filtering
    - Event visible only under Behavioural Architecture
    - Consistent behaviour between Meta-Model view and Diagram view

scope:
  in:
    - architecture-model-service (schema + CRUD)
    - frontend Meta-Model view (Behavioural → Events tab)
    - frontend Diagram View RHS Palette (Behavioural domain)
  out:
    - state/sequence/activity entities (handled in later specs)
    - diagram rendering semantics for Event usage
    - gateway/MCP changes

acceptance_criteria:
  - Meta-Model View:
    - Behavioural Architecture domain exists
    - "Events" appears as an entity tab ONLY under Behavioural Architecture
    - Users can create/edit/delete Events via the Meta-Model grid
  - Diagram View:
    - When Behavioural Architecture domain is selected, "Events" appears in the RHS palette
    - Users can add Event nodes to diagrams using existing palette interactions
  - Backend:
    - Events are persisted and loaded with the model file
    - Event payload/source rules are validated
  - No regressions in existing entities, relationships, or diagrams

data_model:
  Event (Behavioural Architecture):
    fields:
      - id: UUID (PK)
      - model_file_id: UUID (FK, required)
      - name: text (required)
      - description: text (optional)
      - source_ref_kind: text (optional) - allowed values: BusinessUser, Application, ApplicationComponent, Service, Interface, InterfaceEndpoint, Class
      - source_ref_id: text (optional)
      - payload_ref_kind: text (optional, must be 'LogicalEntity' if set)
      - payload_ref_id: text (optional)
      - payload_primitive_type: text enum (optional) - values: string, number, integer, boolean, date, datetime, uuid

    validation rules:
      - if source_ref_kind is set → source_ref_id is required
      - payload_ref_kind/payload_ref_id and payload_primitive_type are mutually exclusive
      - payload_ref_kind, if set, must equal 'LogicalEntity'

backend_implementation:
  1) Liquibase migration - Create events table
  2) JPA entity - EventEntity
  3) Repository/Service/Controller - CRUD endpoints scoped by modelFileId

frontend_implementation:
  1) Types + state - EventRow type, events array in state
  2) Meta-Model grid - Events grid config with columns
  3) Domain grouping - Events under Behavioural Architecture only
  4) Diagram RHS Palette - Events section for Behavioural domain

deliverable:
  - Event is a fully integrated Behavioural Architecture entity
  - Ready to be referenced by State Transitions and Activity Flows in subsequent specs
---
