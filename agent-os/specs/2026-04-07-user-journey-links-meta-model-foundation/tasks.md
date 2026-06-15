# Task Breakdown: User Journey Links Meta-Model Foundation

## Overview
Total Tasks: 27

This spec introduces a new `USER_JOURNEY_LINK` relationship type into the architecture meta-model. It spans a Liquibase migration, JPA entity/repository/DTO, ModelService integration (load/save/delete), and frontend configuration changes (types, grid config, relationship definitions, defaults). No new controllers, services, gateway routes, or UI components are needed -- the existing whole-model load/save pipeline and RelationshipGrid component handle everything.

## Task List

### Database & JPA Layer

#### Task Group 1: Migration, Entity, Repository, DTO
**Dependencies:** None

- [x] 1.0 Complete database and JPA layer for user_journey_links
  - [x] 1.1 Write 4 focused tests for the JPA entity, repository, and DTO
    - Test 1: `UserJourneyLinkEntity` round-trip -- build via `@Builder`, verify all fields are set correctly
    - Test 2: `UserJourneyLinkDto` record instantiation with `@JsonProperty` snake_case serialization (serialize to JSON, verify keys are snake_case)
    - Test 3: `UserJourneyLinkRepository.findByModelFileId` returns correct links (integration or mocked)
    - Test 4: `UserJourneyLinkRepository.deleteByModelFileId` removes correct links (integration or mocked)
  - [x] 1.2 Create Liquibase migration `078-user-journey-links.sql`
    - File: `architecture-model-service/src/main/resources/db/changelog/sql/078-user-journey-links.sql`
    - CREATE TABLE `user_journey_links` with columns: `id` (TEXT PK), `model_file_id` (TEXT NOT NULL), `source_user_journey_id` (TEXT NOT NULL), `target_user_journey_id` (TEXT NOT NULL), `relationship_type` (TEXT NOT NULL), `label` (TEXT), `description` (TEXT), `tags` (TEXT)
    - FK on `model_file_id` to `model_files(id)` ON DELETE CASCADE
    - FK on `source_user_journey_id` to `user_journeys(id)` NO ACTION
    - FK on `target_user_journey_id` to `user_journeys(id)` NO ACTION
    - CHECK constraint: `source_user_journey_id <> target_user_journey_id`
    - UNIQUE constraint on `(source_user_journey_id, target_user_journey_id, relationship_type, label)`
    - Indexes: `idx_user_journey_links_model_file`, `idx_user_journey_links_source`, `idx_user_journey_links_target`
    - Follow pattern from: `059-user-journeys-activity-steps.sql`
  - [x] 1.3 Register migration in `db.changelog-master.yaml`
    - File: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add entry for `sql/078-user-journey-links.sql` after the 077 entry
  - [x] 1.4 Create `UserJourneyLinkEntity.java` in `model.entity` package
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyLinkEntity.java`
    - Annotations: `@Entity`, `@Table(name = "user_journey_links")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields: `id` (`@Id` String), `modelFileId` (`@Column(name = "model_file_id")`), `sourceUserJourneyId`, `targetUserJourneyId`, `relationshipType`, `label`, `description`, `tags`
    - Follow pattern from: `BusinessUserBusinessPointEntity.java`
  - [x] 1.5 Create `UserJourneyLinkRepository.java` in `repository.relationship` package
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/UserJourneyLinkRepository.java`
    - Extends `JpaRepository<UserJourneyLinkEntity, String>`
    - Methods: `List<UserJourneyLinkEntity> findByModelFileId(String modelFileId)`, `void deleteByModelFileId(String modelFileId)`
    - Follow pattern from: `BusinessUserBusinessPointRepository.java`
  - [x] 1.6 Create `UserJourneyLinkDto.java` in `model.dto.relationship` package
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/UserJourneyLinkDto.java`
    - Java record with `@JsonProperty` annotations: `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type`, `label`, `description`, `tags`
    - No resolved journey names -- frontend resolves via `fk_typeahead`
    - Follow pattern from: `BusinessUserBusinessPointDto.java`
  - [x] 1.7 Ensure database and JPA layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration SQL is syntactically valid
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Migration file creates the table with all constraints and indexes
- Migration is registered in `db.changelog-master.yaml`
- Entity, Repository, and DTO follow established patterns exactly
- DTO serializes with snake_case JSON keys

---

### Backend Service Integration

#### Task Group 2: ModelService Wiring and EntityMapper
**Dependencies:** Task Group 1

- [x] 2.0 Complete ModelService integration for user_journey_links
  - [x] 2.1 Write 5 focused tests for ModelService and EntityMapper integration
    - Test 1: `EntityMapper.toDto(UserJourneyLinkEntity)` maps all fields correctly to `UserJourneyLinkDto`
    - Test 2: `EntityMapper.toEntity(UserJourneyLinkDto, modelFileId)` maps all fields correctly to `UserJourneyLinkEntity` and sets `modelFileId`
    - Test 3: `loadRelationships` includes `userJourneyLinks` list in the returned `MetaModelRelationshipsDto`
    - Test 4: `saveRelationships` persists valid user_journey_links and validates `relationship_type` against allowed enum values (RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS)
    - Test 5: `saveRelationships` rejects an invalid `relationship_type` value
  - [x] 2.2 Add `userJourneyLinks` field to `MetaModelRelationshipsDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
    - Add `List<UserJourneyLinkDto> userJourneyLinks` with `@JsonProperty("user_journey_links")` as the 10th parameter in the record constructor
  - [x] 2.3 Add `toDto` and `toEntity` methods to `EntityMapper`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/EntityMapper.java`
    - `toDto(UserJourneyLinkEntity)` returns `UserJourneyLinkDto` record
    - `toEntity(UserJourneyLinkDto, String modelFileId)` returns `UserJourneyLinkEntity` via builder
    - Follow pattern from: `toDto(BusinessUserBusinessPointEntity)` / `toEntity(BusinessUserBusinessPointDto, String)`
  - [x] 2.4 Inject `UserJourneyLinkRepository` into `ModelService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Add `UserJourneyLinkRepository` field via `@RequiredArgsConstructor` constructor injection alongside other relationship repositories
  - [x] 2.5 Wire `loadRelationships` in `ModelService`
    - Add `userJourneyLinkRepository.findByModelFileId(modelFileId)` call
    - Map results via `entityMapper::toDto`
    - Pass as the new 10th argument to `MetaModelRelationshipsDto` constructor
  - [x] 2.6 Wire `saveRelationships` in `ModelService`
    - Add null-guarded block for `userJourneyLinks`
    - Validate `relationship_type` against allowed enum: `RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS`
    - Map via `entityMapper.toEntity` and call `saveAll`
    - Follow the existing null-check, stream, map, collect, saveAll pattern
  - [x] 2.7 Wire `deleteAllDataForModelFile` in `ModelService`
    - Add `userJourneyLinkRepository.deleteByModelFileId(modelFileId)` BEFORE the existing `activityStepRepository.deleteByModelFileId` / `userJourneyRepository.deleteByModelFileId` calls
    - This ordering respects the FK constraint (user_journey_links references user_journeys)
  - [x] 2.8 Ensure ModelService integration tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify load/save/delete operations work for user_journey_links
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- `MetaModelRelationshipsDto` includes the `user_journey_links` field with correct JSON serialization
- EntityMapper correctly maps between entity and DTO in both directions
- ModelService loads, saves (with enum validation), and deletes user_journey_links
- Delete ordering respects FK constraint (links deleted before journeys)

---

### Frontend Configuration

#### Task Group 3: TypeScript Types, Grid Config, Relationship Definitions, and Defaults
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend configuration for User Journey Links
  - [x] 3.1 Write 5 focused tests for frontend configuration
    - Test 1: `UserJourneyLink` type conforms to expected shape (compile-time or runtime shape check)
    - Test 2: `user_journey_links` grid config exists with correct columns (id, source FK, target FK, relationship_type dropdown, label, description, tags)
    - Test 3: `'User Journey Links'` appears in `relationshipTabNames` and maps to `'user_journey_links'` in `relationshipTabToType`
    - Test 4: `RELATIONSHIP_DEFINITIONS` includes entry with `relationshipKey: 'user_journey_links'` and `endpointEntityTypes: ['user_journeys']`
    - Test 5: `ENTITY_TYPE_TO_DOMAIN` maps `user_journeys` to `'business'` (gap fix verification)
  - [x] 3.2 Add TypeScript types to `model.ts`
    - File: `frontend/src/types/model.ts`
    - Add `UserJourneyLinkRelationshipType = 'RELATES_TO' | 'PRECEDES' | 'DEPENDS_ON' | 'OPTIONALLY_LEADS_TO' | 'TRIGGERS'`
    - Add `UserJourneyLink` interface with fields: `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type` (typed), optional `label`, `description`, `tags`
    - Add `'user_journey_links'` to `RelationshipType` union
    - Add `user_journey_links: UserJourneyLink[]` to `MetaModelRelationships` interface
  - [x] 3.3 Add grid column config to `gridConfigs.ts`
    - File: `frontend/src/config/gridConfigs.ts`
    - Add `user_journey_links` column config array with: `id` (text, autoGenerate), `source_user_journey_id` (fk_typeahead, fkTarget: user_journeys, width 220), `target_user_journey_id` (fk_typeahead, fkTarget: user_journeys, width 220), `relationship_type` (dropdown, options from enum, formatOptionLabel: snakeCaseToTitleCase, width 180), `label` (text, optional, width 150), `description` (text, optional, width 200), `tags` (tags, optional, width 130)
    - Add `'User Journey Links': 'user_journey_links'` to `relationshipTabToType`
    - Add `'User Journey Links'` to the end of `relationshipTabNames`
    - Reference the dropdown options from `userJourneyLinkTypeOptions` in `defaults.ts`
  - [x] 3.4 Add enum options to `defaults.ts`
    - File: `frontend/src/config/defaults.ts`
    - Export `userJourneyLinkTypeOptions = ['RELATES_TO', 'PRECEDES', 'DEPENDS_ON', 'OPTIONALLY_LEADS_TO', 'TRIGGERS']`
  - [x] 3.5 Update `relationshipDefinitions.ts`
    - File: `frontend/src/config/relationshipDefinitions.ts`
    - Add entry to `RELATIONSHIP_DEFINITIONS`: `{ relationshipKey: 'user_journey_links', displayName: 'User Journey Links', endpointEntityTypes: ['user_journeys'] }`
    - Append `'User Journey Links'` to the end of `RELATIONSHIP_TAB_ORDER`
    - Add `user_journeys: 'business'` to `ENTITY_TYPE_TO_DOMAIN` (fixes the existing derivation gap)
  - [x] 3.6 Ensure frontend configuration tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify TypeScript compilation succeeds with new types
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- TypeScript types compile without errors
- `UserJourneyLink` interface matches the backend DTO contract
- Grid config renders correct columns with proper cell types (fk_typeahead for FKs, dropdown for relationship_type)
- "User Journey Links" tab appears in the Business domain relationship tabs
- `ENTITY_TYPE_TO_DOMAIN` gap for `user_journeys` is fixed

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests written by Task Group 1 (entity, DTO, repository)
    - Review the 5 tests written by Task Group 2 (EntityMapper, ModelService load/save/delete)
    - Review the 5 tests written by Task Group 3 (frontend types, grid config, relationship definitions)
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical integration points that lack coverage
    - Focus ONLY on gaps related to user_journey_links feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end data flow: save model with links -> load model -> verify links returned
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - Potential gap: End-to-end save/load cycle for a model containing user_journey_links alongside other relationships
    - Potential gap: MetaModelRelationshipsDto JSON serialization round-trip with user_journey_links populated (verify `user_journey_links` key appears in JSON)
    - Potential gap: ModelService save rejects self-link (source == target) at service layer if applicable, or verify DB constraint catches it
    - Potential gap: ModelService delete ordering -- verify user_journey_links are deleted before user_journeys
    - Potential gap: Frontend `getRelationshipsForDomain('business')` returns 'User Journey Links' after ENTITY_TYPE_TO_DOMAIN fix
    - Potential gap: Grid config `fk_typeahead` columns reference `user_journeys` as fkTarget
    - Do NOT write more than 8 additional tests
    - Skip edge cases, performance tests, and accessibility tests
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to user_journey_links (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 14-22 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical data flow paths pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 14-22 tests total)
- Critical data flow from DB through ModelService to frontend types is covered
- No more than 8 additional tests added when filling in gaps
- Testing focused exclusively on user_journey_links feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Database & JPA Layer (Task Group 1)** -- Migration, entity, repository, DTO. No dependencies. This establishes the persistence foundation.
2. **Backend Service Integration (Task Group 2)** -- EntityMapper and ModelService wiring. Depends on Group 1 (entity, DTO, repository must exist).
3. **Frontend Configuration (Task Group 3)** -- TypeScript types, grid config, relationship definitions, defaults. Depends on Group 2 (backend contract must be finalized so frontend types match).
4. **Test Review and Gap Analysis (Task Group 4)** -- Review all tests from Groups 1-3, fill critical gaps. Depends on Groups 1-3 (all code must be written).

## Key Files Modified

| File | Task Group | Change Type |
|------|-----------|-------------|
| `architecture-model-service/src/main/resources/db/changelog/sql/078-user-journey-links.sql` | 1 | New file |
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | 1 | Append entry |
| `architecture-model-service/.../model/entity/UserJourneyLinkEntity.java` | 1 | New file |
| `architecture-model-service/.../repository/relationship/UserJourneyLinkRepository.java` | 1 | New file |
| `architecture-model-service/.../model/dto/relationship/UserJourneyLinkDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/MetaModelRelationshipsDto.java` | 2 | Add field |
| `architecture-model-service/.../service/EntityMapper.java` | 2 | Add 2 methods |
| `architecture-model-service/.../service/ModelService.java` | 2 | Inject repo, wire load/save/delete |
| `frontend/src/types/model.ts` | 3 | Add type, interface, extend unions |
| `frontend/src/config/gridConfigs.ts` | 3 | Add column config, tab mapping |
| `frontend/src/config/defaults.ts` | 3 | Add enum options array |
| `frontend/src/config/relationshipDefinitions.ts` | 3 | Add definition, fix ENTITY_TYPE_TO_DOMAIN, extend tab order |
