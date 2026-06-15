# Specification: User Journey Temporary Diagram JSON Generation

## Goal
Generate deterministic, stateless User Journey diagram JSON by projecting persisted USER_JOURNEY and ACTIVITY_STEP meta-model data into a stable v1 diagram contract, exposed via project-scoped REST endpoints (no UI rendering, no persistence of diagram data).

## User Stories
- As a system integrator, I want to retrieve a deterministic JSON diagram contract for any persisted User Journey so that downstream consumers (future UI renderer, LLM context) can visualize journey flow without relying on LLM-generated diagrams.
- As a developer, I want a project-scoped endpoint that returns diagram contracts for all journeys in a project so that I can list and select journeys for rendering in a future increment.

## Specific Requirements

**Diagram Contract v1 Schema**
- Top-level envelope: `diagram_type` (constant `"USER_JOURNEY"`), `version` (constant `"1.0"`)
- Journey object: `id`, `name`, `description`, `user_role_id` (from `primaryBusinessUserId`), `user_role_name` (resolved from BusinessUserEntity), `parent_business_process_id`, `parent_business_process_name` (resolved from BusinessProcessEntity)
- Lanes array: each lane is `{ id, name, order }` derived from unique Applications referenced by the journey's ActivitySteps
- Steps array: each step is `{ id, journey_id, order, lane_id, process_activity_id, process_activity_name, name, description, business_user_id, business_user_name }` -- one per ActivityStep, ordered by `sequence_order`
- Edges array: each edge is `{ id, from_step_id, to_step_id, order, is_cross_lane }` connecting sequential steps
- Render hints object: `{ lane_axis: "VERTICAL", flow_direction: "LEFT_TO_RIGHT", show_title: true }`
- Issue fields (`activity_related_issues`, `ui_related_issues`, `has_issues`) are omitted from v1 since no issue data exists in the current schema
- Use Java records with `@JsonProperty` annotations for all new DTOs, following the pattern in `TemporaryDiagramDto` and `ActivityStepDto`

**Projection Rules: Lane Derivation**
- Collect unique `applicationId` values from the journey's ActivitySteps
- Each unique Application becomes a lane with `id` = Application.id and `name` = Application.name
- Lane `order` is determined by first occurrence in step `sequence_order` ascending
- Tie-break when two applications first appear at the same `sequence_order`: sort alphabetically by `application_id`
- Use bulk `findAllById` on ApplicationRepository to batch-load all referenced Applications

**Projection Rules: Step Ordering**
- Sort ActivitySteps by `sequence_order` ascending as the primary sort
- Deterministic fallback: sort by `id` ascending for duplicate `sequence_order` values
- Each step's `lane_id` is its `applicationId`, mapping it to the correct lane
- Defensive name fallback: if `ActivityStep.name` is null, use `ProcessActivity.name` from the linked ProcessActivityEntity (even though current schema has name as NOT NULL)

**Projection Rules: Edge Generation**
- Connect each step to the next step in sorted order, producing N-1 edges for N steps
- Edge `id` uses deterministic format: `"edge-{journeyId}-{fromOrder}-{toOrder}"` where fromOrder/toOrder are the `sequence_order` values of the connected steps
- Edge `order` is a sequential integer index (0-based or 1-based, consistent)
- `is_cross_lane` is `true` when `from_step.applicationId != to_step.applicationId`

**Projection Rules: Name Resolution**
- Resolve `user_role_name` by looking up `BusinessUserEntity` via `primaryBusinessUserId` on the journey
- Resolve `parent_business_process_name` by looking up `BusinessProcessEntity` via `parentBusinessProcessId` on the journey
- Resolve `process_activity_name` for each step by looking up `ProcessActivityEntity` via `processActivityId`
- Resolve step-level `business_user_name` by looking up `BusinessUserEntity` via `businessUserId` on each step
- Use bulk `findAllById` calls to batch-load BusinessUsers, ProcessActivities, and Applications referenced across all steps in a journey

**API Endpoints**
- `GET /api/projects/{projectId}/user-journey-diagrams/{userJourneyId}/temporary` -- returns single diagram contract JSON; returns 404 if journey not found or does not belong to project's model file
- `GET /api/projects/{projectId}/user-journey-diagrams/temporary` -- returns JSON array of diagram contracts for all USER_JOURNEYs in the project's active model file
- Both endpoints are stateless read-only projections; no data is persisted
- `projectId` is a UUID path variable matching the existing pattern in `TemporaryDiagramController`

**Service Layer: UserJourneyDiagramProjectionService**
- Stateless Spring `@Service` with `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- Constructor-injected repositories: `UserJourneyRepository`, `ActivityStepRepository`, `ApplicationRepository`, `ProcessActivityRepository`, `BusinessUserRepository`, `BusinessProcessRepository`, `ModelFileRepository`
- Core method `projectSingleJourney(UUID projectId, String userJourneyId)` resolves project scoping, loads entities via targeted queries, and builds the contract
- Core method `projectAllJourneys(UUID projectId)` resolves model file, loads all journeys for that model file, and calls projection for each
- Add `findByUserJourneyId(String userJourneyId)` to `ActivityStepRepository` (Spring Data derived query, no custom SQL needed)
- Use `findAllById` for batch lookups of Applications, ProcessActivities, BusinessUsers referenced by a journey's steps

**Project Scoping Approach**
- Resolve `projectId` (UUID) to `ModelFileEntity` via `ModelFileRepository.findByProjectId(projectId)`; throw `ResourceNotFoundException` with clear message if no model file exists for this project
- For single-journey endpoint: after loading `UserJourneyEntity` by ID, verify its `modelFileId` matches the resolved model file's ID; return 404 if mismatch
- For all-journeys endpoint: use `UserJourneyRepository.findByModelFileId(modelFileId)` to load only journeys belonging to this project's model file

**Controller Design: UserJourneyDiagramController**
- `@RestController` with `@RequestMapping("/api/projects/{projectId}/user-journey-diagrams")`
- `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` and `@RequiredArgsConstructor`
- GET `/{userJourneyId}/temporary` method accepts `@PathVariable UUID projectId` and `@PathVariable String userJourneyId`
- GET `/temporary` method accepts `@PathVariable UUID projectId`
- Delegate entirely to `UserJourneyDiagramProjectionService`; controller contains no business logic

**Validation and Error Handling**
- Return 404 (via `ResourceNotFoundException`) when: no model file for project, journey not found, journey does not belong to project's model file
- Fail fast with clear error when a referenced linked entity (Application, ProcessActivity, BusinessUser, BusinessProcess) is not found -- this indicates data integrity issues and should produce an error rather than silently omitting data
- The all-journeys endpoint returns an empty array (not 404) when the project has zero journeys

**Testing Approach**
- Unit tests for `UserJourneyDiagramProjectionService`: mock all repositories; test single-lane journey, multi-lane journey, edge generation with cross-lane detection, lane ordering by first occurrence with tie-break, defensive name fallback when step name is null, step-level business user enrichment, project scoping verification (journey belongs to model file), empty steps list
- `@WebMvcTest` controller tests for `UserJourneyDiagramController`: mock the projection service; verify URL routing, 200 responses with correct JSON structure, 404 for missing journey, array response for all-journeys endpoint
- Lightweight Spring integration test: verify the `findByUserJourneyId` repository method works correctly with the actual Spring Data query derivation
- Regression: confirm existing temporary diagram and sequence diagram endpoints are unaffected (no changes to their code)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**TemporaryDiagramController / TemporaryDiagramService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/TemporaryDiagramController.java` and the corresponding service
- Follow the same `@ConditionalOnProperty`, `@RequiredArgsConstructor`, `@RequestMapping("/api/projects/{projectId}/...")` pattern
- Follow the `@WebMvcTest` + `@MockBean` test pattern from `TemporaryDiagramControllerTest.java`
- Note: the new feature is a read-only projection, NOT a persistence service -- do not reuse the save/upsert pattern

**DiagramCanonicalizer**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramCanonicalizer.java`
- Reference for ensuring deterministic output ordering via explicit sorting of collections
- The projection service should apply its own deterministic sorts (sequence_order + id fallback for steps, first-occurrence + application_id for lanes)

**ModelFileRepository.findByProjectId(UUID projectId)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/repository/ModelFileRepository.java`
- Already provides the `projectId -> ModelFileEntity` resolution needed for project scoping
- Returns `Optional<ModelFileEntity>` which the service should unwrap with a 404 if empty

**Existing Entity Classes and Repositories**
- `UserJourneyEntity`, `ActivityStepEntity`, `ApplicationEntity`, `BusinessUserEntity`, `ProcessActivityEntity`, `BusinessProcessEntity` all use String IDs, have `modelFileId`, and their repositories extend `JpaRepository<T, String>` with `findByModelFileId` and `findAllById` (inherited from JpaRepository)
- `EntityMapper` (line 99-133) shows the existing entity-to-DTO mapping pattern for UserJourney and ActivityStep

**ProjectService.getProjectById(UUID id)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
- Provides project existence validation; however for this feature, `ModelFileRepository.findByProjectId` is the direct path since the projection only needs the model file, not the full project DTO

## Out of Scope
- Diagram canvas/editor UI or any frontend rendering
- Temporary diagram chooser UI
- Persisting generated diagram JSON to the database (no DB writes)
- LLM generation of diagram visuals
- Any layout engine in the frontend
- Changes to spreadsheet or save logic
- Gateway/chatV2 save orchestration changes or post-save integration
- Issue fields on steps (`activity_related_issues`, `ui_related_issues`, `has_issues`)
- New diagram type registration in UI
- Editing of generated diagrams
- Full Testcontainers integration tests (use lightweight Spring integration tests only)
