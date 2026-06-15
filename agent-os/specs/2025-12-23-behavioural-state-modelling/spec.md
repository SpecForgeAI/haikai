# Specification: Behavioural Architecture State Modelling (State and StateTransition Entities)

## Goal
Introduce state-based behavioural modelling to the architecture meta-model by adding State and StateTransition entities, enabling users to model finite state machines with triggers, guards, and effects through the Meta-Model view.

## User Stories
- As an architect, I want to define States (Initial, Normal, Final) so that I can model the lifecycle stages of business or system entities.
- As an architect, I want to create StateTransitions between states with triggers (Event, Method, or label) so that I can document how entities move between states.

## Specific Requirements

**State Entity (Behavioural Architecture)**
- id: UUID primary key (auto-generated, TEXT type as per existing pattern)
- model_file_id: UUID foreign key to model_files (required)
- name: TEXT (required)
- description: TEXT (optional)
- state_kind: TEXT enum with values Initial, Normal, Final (required)
- owner_ref_kind: TEXT (optional) - polymorphic reference type
- owner_ref_id: TEXT (optional) - polymorphic reference id
- created_at / updated_at timestamps (follow existing entity pattern if present)

**StateTransition Entity (Behavioural Architecture)**
- id: UUID primary key (auto-generated)
- model_file_id: UUID foreign key to model_files (required)
- from_state_id: UUID foreign key to states.id (required)
- to_state_id: UUID foreign key to states.id (required)
- from_state_id and to_state_id must reference States within the same model_file_id
- order_index: INTEGER (optional, for sequencing)
- description: TEXT (optional)

**StateTransition Trigger (Required, One-Of)**
- trigger_ref_kind: TEXT enum (Event | Method) - used with trigger_ref_id
- trigger_ref_id: TEXT - UUID reference to events or methods table
- trigger_label_text: TEXT - free-form text trigger
- Validation: exactly one trigger type must be supplied (ref pair OR label)
- UI must enforce switching between modes clears other trigger fields

**StateTransition Guard (Optional, One-Of)**
- guard_ref_kind: TEXT enum (Method) - used with guard_ref_id
- guard_ref_id: TEXT - UUID reference to methods table
- guard_expression: TEXT - free-form condition expression
- Validation: if guard is provided, must be either ref pair OR expression (not both)

**StateTransition Effect (Optional, One-Of)**
- effect_ref_kind: TEXT enum (Method) - used with effect_ref_id
- effect_ref_id: TEXT - UUID reference to methods table
- effect_label_text: TEXT - free-form effect description
- Validation: if effect is provided, must be either ref pair OR label (not both)

**Database Migration (Liquibase SQL)**
- Create new migration file: 004-states-state-transitions.sql
- Create table states with all fields, ON DELETE CASCADE for model_file_id FK
- Create table state_transitions with all fields
- Add foreign keys: from_state_id and to_state_id reference states.id (NO cascade delete)
- Add indexes on: states.model_file_id, state_transitions.model_file_id, from_state_id, to_state_id

**Backend State Delete Prevention**
- When deleting a State, check if any StateTransition references it as from_state_id or to_state_id
- If referenced, reject delete with HTTP 409 Conflict and clear error message
- Implement in service layer, not via database constraints

**API Endpoints**
- States integrated into existing bulk load/save via ModelService (no separate CRUD endpoints needed)
- Follow existing pattern: entities saved/loaded with model file via PUT /api/model
- Add states and stateTransitions arrays to MetaModelEntitiesDto record

## Visual Design
No mockups provided. Follow existing Meta-Model view patterns for entity grid tabs.

## Existing Code to Leverage

**EventEntity.java and EventDto.java (Behavioural domain pattern)**
- Follow identical JPA entity structure: @Entity, @Table, @Getter/@Setter/@Builder, String id, modelFileId, name, description
- Use String type for all IDs (not UUID) as per codebase convention
- EventRepository provides template for findByModelFileId, deleteByModelFileId methods

**003-events.sql (Migration pattern)**
- Follow exact SQL syntax: TEXT types, PRIMARY KEY, REFERENCES with ON DELETE CASCADE for model_file_id
- CREATE INDEX pattern: idx_[table]_[column] naming convention
- No timestamp columns in existing entity migrations (omit created_at/updated_at unless pattern changes)

**gridConfigs.ts (Frontend grid configuration)**
- Add states and stateTransitions grid configs following existing entity patterns
- Use cellType: 'fk_typeahead' for foreign key fields with fkTarget pointing to source collection
- Use cellType: 'dropdown' for enum fields (state_kind, trigger_ref_kind, guard_ref_kind, effect_ref_kind)

**model.ts (TypeScript interfaces)**
- Add State and StateTransition interfaces following Event interface pattern
- Add 'states' and 'state_transitions' to EntityType union
- Add to MetaModelEntities interface and ENTITY_TYPES constant

**domainGroupings and DOMAIN_ENTITY_TYPES in gridConfigs.ts**
- Add 'States' and 'State Transitions' to behavioural domain array in domainGroupings
- Add 'states' and 'state_transitions' to behavioural array in DOMAIN_ENTITY_TYPES
- Add tabToEntityType mappings for both new tabs

## Out of Scope
- State diagram visualisation or rendering
- Diagram palette changes for States or StateTransitions
- DiagramNode support for State entities
- Sequence diagram entities
- Activity diagram entities
- Gateway or MCP service changes
- Separate REST API endpoints for CRUD (use existing bulk model save)
- Cascade delete of StateTransitions when State is deleted (reject instead)
- Validation of trigger_ref_id against actual Event/Method existence (soft reference)
- Validation of guard_ref_id or effect_ref_id against actual Method existence (soft reference)
