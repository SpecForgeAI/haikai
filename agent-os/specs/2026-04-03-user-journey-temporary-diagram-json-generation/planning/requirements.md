# Spec Requirements: User Journey Temporary Diagram JSON Generation

## Initial Description
Generate deterministic temporary User Journey diagram JSON for each persisted USER_JOURNEY by projecting USER_JOURNEY and ordered ACTIVITY_STEP data into a stable diagram contract (no UI rendering yet).

After Increment 4, USER_JOURNEY and ACTIVITY_STEP are persisted as authoritative meta-model data. The next step in the UX Designer flow is to visualize each journey as a diagram. The LLM must NOT render diagrams; instead, the system must deterministically project the meta-model into a diagram JSON contract. This increment produces that contract for each journey, enabling later UI selection and rendering.

## Requirements Discussion

### First Round Questions

**Q1:** The diagram contract v1 specifies `activity_related_issues`, `ui_related_issues`, and `has_issues` on each step. However, after inspecting `ActivityStepEntity`, `ActivityStepDto`, and the `059-user-journeys-activity-steps.sql` migration, there are no issue-related columns anywhere in the current data model. Should these fields be omitted from the v1 contract and deferred to a future increment, or should we add placeholder fields (always empty/false) now to pre-shape the contract?
**Answer:** Omit issue fields from the v1 contract for now rather than emitting placeholder arrays/flags, so the projection matches the actually persisted schema and avoids implying data the model does not yet store.

**Q2:** The `ActivityStepEntity` already has a `name` field that is NOT NULL. The raw idea specifies a "name fallback to PROCESS_ACTIVITY.name" for steps where `ACTIVITY_STEP.name` is null. Since `name` is `TEXT NOT NULL` in both the schema and the entity, this fallback can never trigger. Should we (a) remove the fallback logic, (b) implement it defensively, or (c) change the schema to make `name` nullable?
**Answer:** Use (b): keep the defensive fallback-to-PROCESS_ACTIVITY.name logic in the projection layer even though ActivityStepEntity.name is currently NOT NULL, but do not change the schema in this increment.

**Q3:** Should the new endpoints follow the existing `temporary-diagrams` pattern (`/api/projects/{projectId}/temporary-diagrams/{id}`) which stores LLM-generated JSONB payloads, or be a separate projection endpoint? The existing infrastructure persists data; this new feature is a stateless on-the-fly projection.
**Answer:** Keep these projection endpoints separate from the existing temporary-diagram JSONB persistence infrastructure and make them project-scoped for consistency, e.g. `/api/projects/{projectId}/user-journey-diagrams/{userJourneyId}/temporary` and `/api/projects/{projectId}/user-journey-diagrams/temporary`.

**Q4:** How should the projection service resolve linked entity names? The current repositories only have `findByModelFileId` queries. Should we add targeted queries (e.g. `findByUserJourneyId`) and use individual `findById` calls, or load the entire model's entities for a given `modelFileId` and do in-memory joins?
**Answer:** Prefer repository/query support targeted to this use case (e.g. findByUserJourneyId plus efficient bulk fetches/joins for linked entities) rather than loading the entire model into memory and doing broad in-memory joins.

**Q5:** How does project scoping work for the single-journey endpoint? `UserJourneyEntity` doesn't have a `projectId` -- it has a `modelFileId`. Should the projection service resolve `projectId` -> active model file -> verify that the requested `userJourneyId` belongs to that model file?
**Answer:** Yes, resolve scoping through projectId -> active model file -> verify the USER_JOURNEY belongs to that model file, because model_file ownership is the real persistence boundary in the current schema.

**Q6:** Should this increment modify the gateway/chatV2 save flow to add a post-save call that fetches diagram JSON and appends it to the LLM context, or is the gateway integration deferred?
**Answer:** Do NOT modify gateway/chatV2 save orchestration in Increment 5; keep this increment focused on the projection service and endpoints only, and defer post-save UX Designer flow integration to the later review-flow increment.

**Q7:** Each `ActivityStep` references a `businessUserId` (which could differ from the journey's `primaryBusinessUserId`). Should the step-level business user be included in the diagram contract, or is the business user only relevant at the journey level?
**Answer:** Include the step-level business user on each step in the diagram contract as an optional field for richness/future use, even though the rendered title remains driven by the journey-level primary user.

**Q8:** For deterministic lane ordering, if two different applications both first appear at the same `sequence_order`, what is the tie-breaker?
**Answer:** Yes, if a secondary tie-break is ever needed, use a stable secondary sort such as application_id/name alphabetical; however with one step per sequence_order in the current model, first-occurrence-by-step-order should normally already be deterministic.

**Q9:** Should the new service have both unit tests and Spring Boot integration tests with Testcontainers, or is unit-only sufficient for this stateless projection?
**Answer:** Use both: add focused unit tests for the stateless projection logic and at least lightweight Spring integration tests for the endpoint/repository wiring; full heavy Testcontainers coverage is only needed if that is already your established persistence-testing pattern.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: TemporaryDiagramController/TemporaryDiagramService - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TemporaryDiagramController.java` and `architecture-model-service/src/main/java/com/example/architecturemodel/service/TemporaryDiagramService.java` -- Reference for controller/service structure, project-scoped URL patterns, `@ConditionalOnProperty` annotation usage
- Feature: DiagramCanonicalizer - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramCanonicalizer.java` -- Reference for deterministic output ordering patterns
- Feature: SequenceDiagramService - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/SequenceDiagramService.java` -- Reference for loading entities and building DTOs from related data
- Feature: ModelService.loadEntities() - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` -- Reference for understanding how UserJourney and ActivityStep entities are loaded (lines 770-773), and how repositories are injected and used
- Feature: DiagramExportService - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java` -- Reference for using ProjectService to resolve project context
- Feature: EntityMapper - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java` -- Reference for entity-to-DTO mapping patterns (UserJourney at line 99, ActivityStep at line 122)

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were found in the visuals folder.

## Requirements Summary

### Functional Requirements

#### Diagram Contract v1 Schema

The projection produces a self-contained JSON object per USER_JOURNEY with the following structure:

**Top-level envelope:**
- `diagram_type`: `"USER_JOURNEY"` (string constant)
- `version`: `"1.0"` (string constant)

**Journey object:**
- `id`: USER_JOURNEY.id
- `name`: USER_JOURNEY.name
- `description`: USER_JOURNEY.description
- `user_role_id`: USER_JOURNEY.primaryBusinessUserId (FK to business_users)
- `user_role_name`: resolved name from the referenced BusinessUser entity
- `parent_business_process_id`: USER_JOURNEY.parentBusinessProcessId (FK to business_processes)
- `parent_business_process_name`: resolved name from the referenced BusinessProcess entity

**Lanes array** (derived from unique APPLICATIONs referenced by ACTIVITY_STEPs):
- `id`: APPLICATION.id
- `name`: APPLICATION.name
- `order`: integer, determined by first occurrence in ACTIVITY_STEP sequence_order; tie-break by application_id alphabetical

**Steps array** (one per ACTIVITY_STEP, ordered by sequence_order):
- `id`: ACTIVITY_STEP.id
- `journey_id`: ACTIVITY_STEP.userJourneyId
- `order`: ACTIVITY_STEP.sequenceOrder
- `lane_id`: ACTIVITY_STEP.applicationId (maps step to its lane)
- `process_activity_id`: ACTIVITY_STEP.processActivityId
- `process_activity_name`: resolved name from the referenced ProcessActivity entity
- `name`: ACTIVITY_STEP.name, with defensive fallback to ProcessActivity.name if null (even though current schema is NOT NULL)
- `description`: ACTIVITY_STEP.description
- `business_user_id` (optional enrichment): ACTIVITY_STEP.businessUserId -- step-level actor, may differ from journey-level primary user
- `business_user_name` (optional enrichment): resolved name from the referenced BusinessUser entity for the step

Note: Issue fields (`activity_related_issues`, `ui_related_issues`, `has_issues`) are **omitted from v1** since no issue data exists in the current schema. These will be added in a future increment when issue tracking is introduced on activity steps.

**Edges array** (connect sequential steps):
- `id`: deterministic string, e.g. `"edge-{journeyId}-{fromOrder}-{toOrder}"`
- `from_step_id`: the ACTIVITY_STEP.id of the preceding step
- `to_step_id`: the ACTIVITY_STEP.id of the following step
- `order`: integer, sequential edge index
- `is_cross_lane`: boolean, true when `from_step.applicationId != to_step.applicationId`

**Render hints object:**
- `lane_axis`: `"VERTICAL"`
- `flow_direction`: `"LEFT_TO_RIGHT"`
- `show_title`: `true`
- Additional hints may be added in future versions

#### Projection Rules

1. **Journey**: Populate from USER_JOURNEY entity; resolve linked BusinessUser and BusinessProcess names via targeted repository lookups.
2. **Lanes**: Derived from unique APPLICATIONs referenced by ACTIVITY_STEPs belonging to the journey. Ordered by first occurrence in `sequence_order`. Tie-break by `application_id` alphabetical for determinism.
3. **Steps**: One per ACTIVITY_STEP, sorted by `sequence_order` ascending. Deterministic fallback sort by `id` for duplicate `sequence_order` values. Assigned to correct lane by `applicationId`. Name fallback: if `ACTIVITY_STEP.name` is null, use `ProcessActivity.name` (defensive, even though current schema is NOT NULL).
4. **Edges**: Connect each step to the next step in sequence_order order. Flag `is_cross_lane = true` when consecutive steps reference different applications.
5. **ID generation**: Edge IDs use deterministic format `"edge-{journeyId}-{fromOrder}-{toOrder}"`.
6. **Step-level business user**: Each step includes `business_user_id` and `business_user_name` as optional enrichment fields for future use.

#### API Endpoints

- `GET /api/projects/{projectId}/user-journey-diagrams/{userJourneyId}/temporary` -- Returns the diagram contract for a single USER_JOURNEY. Always regenerates from DB. Returns 404 if journey not found or does not belong to the project's active model file.
- `GET /api/projects/{projectId}/user-journey-diagrams/temporary` -- Returns an array of diagram contracts for all USER_JOURNEYs in the project's active model file. Always regenerates from DB.

Both endpoints are stateless projections -- no diagram data is persisted.

#### Service Layer Design

- Create `UserJourneyDiagramProjectionService` -- stateless, deterministic projection service.
- Use targeted repository queries, NOT full model load:
  - Add `findByUserJourneyId(String userJourneyId)` to `ActivityStepRepository`
  - Use `findById` on `UserJourneyRepository`, `BusinessUserRepository`, `ApplicationRepository`, `ProcessActivityRepository`, `BusinessProcessRepository` for resolving linked entity names
  - Use bulk fetches where possible (e.g., `findAllById` for batch-loading Applications/ProcessActivities referenced by a journey's steps)
- Fetch chain: USER_JOURNEY -> ACTIVITY_STEPs (by journey ID) -> linked APPLICATION, PROCESS_ACTIVITY, BUSINESS_USER, BUSINESS_PROCESS (by their IDs)
- Build the contract object from the fetched data

#### Project Scoping Approach

Resolve project scoping as: `projectId` -> active model file (via `ProjectService` / `ModelFileRepository`) -> verify that the requested `userJourneyId` belongs to that model file via `modelFileId` comparison. This is because `UserJourneyEntity` has `modelFileId` (not `projectId`) and model_file ownership is the real persistence boundary.

#### Validation Rules

- Sort ACTIVITY_STEPs by `sequence_order` ascending
- Deterministic fallback sort by `id` for duplicate `sequence_order` values
- Fail fast with clear error (appropriate HTTP status) for:
  - Missing/not-found USER_JOURNEY (404)
  - USER_JOURNEY not belonging to project's active model file (404)
  - Missing linked entities that should exist (e.g., referenced Application not found) -- this should produce a clear error rather than silently omitting data

### Reusability Opportunities

- **Controller pattern**: Follow `TemporaryDiagramController` for project-scoped URL structure, `@ConditionalOnProperty`, and `@RequiredArgsConstructor` patterns
- **Deterministic output**: Reference `DiagramCanonicalizer` for sorting/ordering patterns to ensure determinism
- **Entity loading**: Reference `SequenceDiagramService` for the pattern of loading related entities and building composite DTOs
- **Project resolution**: Reference `DiagramExportService` for using `ProjectService` to resolve project context
- **Entity mapping**: Reference `EntityMapper` for entity-to-DTO conversion patterns
- **DTO style**: Use Java records (like existing DTOs in `model/dto/entity/`) with `@JsonProperty` annotations

### Scope Boundaries

**In Scope:**
- `UserJourneyDiagramProjectionService` -- stateless, deterministic projection from meta-model to diagram contract JSON
- New DTO classes for the diagram contract (journey diagram DTO, lane DTO, step DTO, edge DTO, render hints DTO)
- `UserJourneyDiagramController` with two GET endpoints (single journey, all journeys in project)
- New repository query: `findByUserJourneyId` on `ActivityStepRepository`
- Project scoping logic (projectId -> model file -> entity verification)
- Defensive name fallback logic (ActivityStep.name -> ProcessActivity.name)
- Step-level business user enrichment (business_user_id, business_user_name on each step)
- Unit tests for projection logic (single lane, multiple lanes, edge generation, lane ordering, name fallback, cross-lane detection)
- Lightweight Spring integration tests for endpoint wiring and repository queries
- Regression verification that existing diagram endpoints are unaffected

**Out of Scope:**
- Diagram canvas/editor UI (no frontend rendering)
- Temporary diagram chooser UI
- Persisting diagrams as diagram artifacts (no DB writes)
- LLM generation of diagram visuals
- Any layout engine in frontend
- Changes to spreadsheet or save logic
- Gateway/chatV2 save orchestration changes (no post-save integration in this increment)
- Issue fields on steps (activity_related_issues, ui_related_issues, has_issues)
- New diagram type registration in UI
- Editing of generated diagrams
- Full Testcontainers integration tests (unless already the established pattern)

### Technical Considerations

- **Stateless projection**: Every call regenerates the diagram from authoritative DB data. No diagram state is stored.
- **Determinism**: Output must be deterministic and stable for identical input data. Sorting by sequence_order with id fallback, lane ordering by first-occurrence with application_id tie-break, and deterministic edge ID generation all ensure this.
- **Contract extensibility**: The v1 contract uses a versioned envelope (`version: "1.0"`) to support future extensions (branching, swimlanes, issue fields, etc.) without breaking consumers.
- **Separation from existing temporary diagram infrastructure**: The existing `TemporaryDiagramEntity`/`TemporaryDiagramService`/`TemporaryDiagramController` persists LLM-generated JSONB payloads. This new feature is a read-only, on-the-fly projection and must remain separate.
- **Repository strategy**: Targeted queries (e.g., `findByUserJourneyId`, `findAllById` batch lookups) rather than loading the entire model into memory. This keeps the service efficient and focused.
- **Conditional bean registration**: Follow existing pattern of `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` on both controller and service.
- **Entity ID types**: UserJourney and ActivityStep use `String` IDs (not UUID), matching the existing schema pattern.
- **Existing FK relationships**: ActivityStep references user_journeys (CASCADE delete), process_activities, business_users, and applications (NO ACTION cross-entity FKs). The projection must handle cases where cross-entity FKs point to entities that may not exist (fail fast with clear error).

### Acceptance Criteria

1. System generates diagram JSON matching the defined v1 contract for any persisted USER_JOURNEY
2. Lanes correspond to unique APPLICATIONs used in the journey's ACTIVITY_STEPs, ordered by first occurrence in sequence_order with application_id alphabetical tie-break
3. Steps ordered by sequence_order (with id fallback for ties), each assigned to the correct lane
4. Edges connect sequential steps; `is_cross_lane` flagged correctly when consecutive steps reference different applications
5. Defensive name fallback implemented: if ACTIVITY_STEP.name were null, ProcessActivity.name would be used
6. Step-level business_user_id and business_user_name included as optional enrichment fields
7. Issue fields omitted from v1 contract (no activity_related_issues, ui_related_issues, has_issues)
8. Output deterministic for identical input data
9. Single journey endpoint (`GET /api/projects/{projectId}/user-journey-diagrams/{userJourneyId}/temporary`) works correctly
10. Project-level endpoint (`GET /api/projects/{projectId}/user-journey-diagrams/temporary`) returns array of all journey diagrams in the project
11. Project scoping enforced: returns 404 if journey does not belong to the project's active model file
12. No diagram data persisted in DB -- every call regenerates from meta-model
13. No UI rendering required
14. No gateway/chatV2 modifications in this increment
15. Existing diagram endpoints (temporary diagrams, sequence diagrams, general diagrams) unaffected
16. Unit tests cover: single lane, multiple lanes, edge generation, lane ordering, name fallback, cross-lane detection, step-level business user enrichment
17. Lightweight Spring integration tests cover endpoint wiring and repository query correctness
