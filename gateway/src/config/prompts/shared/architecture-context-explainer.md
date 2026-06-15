# Architecture Meta-Model Reference

This section describes the entity types and relationship types in the Architecture Meta-Model. Use this reference to understand the structure of the architecture model data that follows.

> **Note:** `ui_contracts` is excluded from the model data below. It is a deprecated duplicate of `interfaces` and is pending removal.

## Entity Types

### Application Architecture

- **`applications`** -- Top-level deployable systems
- **`app_components`** -- Human-defined grouping of service types/tiers/layers within an application on a technical basis (e.g. "Web Tier", "Persistence Tier"), so that certain important things can be stated about this grouping e.g. "our company uses React/TS for all frontends" + if a project has 3 services whose parent app_component is "UI Tier", then those 3 deployed services should be React/TS according to company technical standards.
- **`services`** -- Runtime components within an application
- **`interfaces`** -- API boundaries exposed by services
- **`endpoints`** -- Individual operations on an interface
- **`application_points`** -- **Polymorphic wrapper (1:1 with a concrete entity)**. Every application_point row maps to exactly one concrete entity (application, app_component, service, or interface). This mechanism allows relationships like `data_movements` to flexibly reference any level of the application architecture as source/target. **AUTO-MANAGED by the backend -- the LLM must NEVER create these directly.**

### Code-Level Entities

- **`classes`** -- Code-level entities. E.g. if Java, it's a Java class. Used in UML "Class diagrams".
- **`methods`** -- Code-level methods on classes. Used in "Class diagrams" and referenced in other diagrams e.g. a sequence diagram might show an internal calculation `calcMyNumbers(...)`.

### Data Entities

- **`logical_data_entities`** -- Conceptual data objects (DTOs), often representing the actual shape of data transferring between applications in APIs.
- **`logical_data_attributes`** -- Fields on logical data entities (name, dataType, isPrimaryKey, isNullable).
- **`physical_data_entities`** -- Persisted storage structures (database tables, collections, physical files). May carry an optional structured `constraints_metadata` field (JSONB): the table's structural constraint/index truth captured verbatim by the discovery DB scan, with shape `{ primary_key:{name,columns[]}, unique_constraints:[{name,columns[]}], check_constraints:[{name,expression}], indexes:[{name,columns[],is_unique}] }`. This is metadata ON the entity, NOT a separate entity type. Views are also `physical_data_entities` (`physical_type='View'`); a view's defining SQL is captured as a Finding, not on the entity.
- **`physical_data_attributes`** -- Columns on physical data entities (name, dataType, isPrimaryKey, isNullable). For database-discovered columns these may also carry verbatim structural-migration detail, all optional: `source_type` (the exact engine type string, e.g. `numeric(10,2)` -- captured as-is with NO normalization), `scale` and `precision` (numeric), `column_default` (the default expression; named `column_default` because `default` is a SQL reserved word), `ordinal` (1-based column position), and `is_identity` (column-level identity / auto-increment flag).
- **`data_entity_points`** -- **Polymorphic wrapper (1:1 with a concrete entity)**. Every data_entity_point maps to exactly one logical or physical data entity. Allows relationships to flexibly reference either type. **AUTO-MANAGED by the backend -- the LLM must NEVER create these directly.**

### Business Domain

- **`business_users`** -- Actors/roles who use the system.
- **`business_processes`** -- High-level business workflows.
- **`process_activities`** -- Steps within a business process.
- **`business_points`** -- **Polymorphic wrapper (1:1 with a concrete entity)**. Every business_point maps to either a `business_process` or an `activity`. Allows relationships to reference either a very high-level business process or a medium-to-high level business activity. **AUTO-MANAGED by the backend -- the LLM must NEVER create these directly.**
- **`app_business_points`** -- **Super-polymorphic wrapper**. Allows the flexible choice of either an `application_point` or a `business_point` in a relationship. **AUTO-MANAGED by the backend -- the LLM must NEVER create these directly.**
- **`interactions`** -- A flexible definition allowing you to define any kind of interaction that a user may have with `application_points` or `business_points` (hence the use of `app_business_points`). Architecturally loose by design.

### State Machine

- **`events`** -- Events in a state machine model.
- **`states`** -- States in a state machine model.
- **`state_transitions`** -- Transitions between states in a state machine.

### Activity/Workflow

- **`activities`** -- Steps in an activity/workflow diagram.
- **`activity_flows`** -- Connections between activities in a workflow.
- **`activity_partitions`** -- Swimlanes/groupings in activity diagrams.

### UI Architecture

- **`ui_screens`** -- Frontend pages/views. Key attributes: **`route`** (the URL path pattern this screen is served at, e.g. `/dashboard`, `/projects/:id/settings`), **`description`** (purpose and content of the screen). When the architecture model includes UI screens, their `route` attribute tells you the exact URL path for navigation.
- **`ui_components`** -- Component/element within a screen (not a UI widget). What would be defined in multiple frontend frameworks in code in `src/components`. Components build on top of each other e.g. basic components are used in the definition of parent, more complex components. Key attributes: **`description`** (what the component renders/does).
- **`ui_actions`** -- User-triggered or system-triggered actions in UI. Key attributes: **`description`** (what happens when the action fires), **`trigger`** (what initiates the action, e.g. button click, form submit).
- **`ui_characteristics`** -- Business features / UX characteristics linked to services that are "UI tier" i.e. frontend UIs.

### Business Logic & Packaging

- **`business_logics`** -- Business rules/domain logic owned by a service. May carry an optional structured `behavior` field (JSONB): a tech-agnostic behaviour spec per rule-bearing method (inputs/outputs, validation/preconditions, transformation/computation, data effects, side effects, edge cases, provenance + confidence), keyed by method id (FQN + signature) and LLM-captured, used to faithfully re-implement the logic in a migration target.
- **`package_sets`** -- A set of "packages" that allows someone to state their full src directory/package structure.
- **`packages`** -- Code packaging (think Java Package, albeit this word is different in other languages e.g. Python Module).
- **`package_set_default_rules`** -- Auto-resolution rules for package set selection.

## Relationship Types

- **`business_user_business_points`** -- Links business users to business points (polymorphic: business processes or activities).
- **`application_point_business_points`** -- Links application points to business points.
- **`logical_data_entity_relationships`** -- Links between logical data entities (e.g. FK-style references, associations). For database-discovered foreign keys it may also carry an optional `fk_columns` field (JSONB): the FK column lists on each side, with shape `{ join_columns:[...], referenced_columns:[...] }` (the referencing columns and the referenced columns). This is metadata on the relationship, NOT a separate entity type; the relationship's endpoints are still the `data_entity_points` it connects.
- **`logical_data_entity_physical_data_entities`** -- Maps logical entities to physical entities (logical<->physical mapping).
- **`logical_data_attribute_physical_data_attributes`** -- Maps logical attributes to physical attributes.
- **`data_movements`** -- Data flowing between application points, optionally referencing a data entity point or interface.
- **`interface_logical_entities`** -- Links interfaces to the logical entities they expose.
- **`ui_workflow_transitions`** -- Navigation/flow between UI screens.
- **`application_point_business_logics`** -- Links application points to business logic rules.
- **`endpoint_data_effects`** -- Links an `endpoint` to a data entity (referenced via a `data_entity_point`) that the endpoint reads and/or writes, with an `access_mode` (`read` / `write` / `read-write`). Carries `path_metadata_json`: the ordered controller->service->repository call chain (each hop = FQN + method signature, role-tagged), the operation hint (insert/update/delete/select), and a `transactional` flag -- i.e. the chain of evidence from the endpoint down to the data-access (repository) call. Discovered for inbound HTTP endpoints (Spring Classic). NOTE: the class/method hops are recorded here as EVIDENCE only; `classes`/`methods` entities are intentionally NOT minted from discovery (volume) -- the call chain lives in this field, not as separate entities.

## Important Notes on Polymorphic Wrappers

The following entity types are **polymorphic wrappers** that are **automatically managed by the backend**. The LLM must **NEVER** create, update, or delete these entities directly. They are created and maintained automatically when their corresponding concrete entities are saved:

1. **`application_points`** -- Auto-created for applications, app_components, services, and interfaces
2. **`data_entity_points`** -- Auto-created for logical_data_entities and physical_data_entities
3. **`business_points`** -- Auto-created for business_processes and activities
4. **`app_business_points`** -- Auto-created to bridge application_points and business_points
