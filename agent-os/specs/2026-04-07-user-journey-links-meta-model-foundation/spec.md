# Specification: User Journey Links Meta-Model Foundation

## Goal
Introduce a first-class Business Architecture relationship called USER_JOURNEY_LINK so that directed connections between User Journeys become authoritative architecture data, managed through the existing whole-model load/save cycle and surfaced as a standard relationship table in the Business domain.

## User Stories
- As an architect, I want to define directed relationships (e.g., PRECEDES, DEPENDS_ON) between User Journeys so that journey-to-journey connections are captured as authoritative meta-model data rather than ad-hoc diagram annotations.
- As an architect, I want to view and edit User Journey Links in the same relationship table UX used by all other Business relationships so that the workflow is consistent and familiar.

## Specific Requirements

**Liquibase migration 078-user-journey-links.sql**
- CREATE TABLE `user_journey_links` with columns: `id` (TEXT PK), `model_file_id` (TEXT NOT NULL), `source_user_journey_id` (TEXT NOT NULL), `target_user_journey_id` (TEXT NOT NULL), `relationship_type` (TEXT NOT NULL), `label` (TEXT), `description` (TEXT), `tags` (TEXT)
- FK on `model_file_id` to `model_files(id)` with ON DELETE CASCADE
- FK on `source_user_journey_id` and `target_user_journey_id` to `user_journeys(id)` with NO ACTION (cross-entity FK pattern, not CASCADE)
- CHECK constraint: `source_user_journey_id <> target_user_journey_id` to prevent self-links
- UNIQUE constraint on `(source_user_journey_id, target_user_journey_id, relationship_type, label)` to prevent duplicates
- Three indexes: `idx_user_journey_links_model_file`, `idx_user_journey_links_source`, `idx_user_journey_links_target`
- Register the migration file in `db.changelog-master.yaml` after entry 077

**JPA Entity: UserJourneyLinkEntity**
- Create in `model.entity` package following the Lombok pattern: `@Entity`, `@Table(name = "user_journey_links")`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
- Fields: `id` (String PK), `modelFileId`, `sourceUserJourneyId`, `targetUserJourneyId`, `relationshipType`, `label`, `description`, `tags`
- Same structural pattern as `BusinessUserBusinessPointEntity` but with `relationshipType` and `label` fields instead of `validFrom`/`validTo`

**Repository: UserJourneyLinkRepository**
- Create in `repository.relationship` package extending `JpaRepository<UserJourneyLinkEntity, String>`
- Two methods: `findByModelFileId(String modelFileId)` and `deleteByModelFileId(String modelFileId)`
- Identical pattern to `BusinessUserBusinessPointRepository`

**DTO: UserJourneyLinkDto**
- Create as a Java record in `model.dto.relationship` package with `@JsonProperty` annotations for snake_case serialization
- Fields: `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type`, `label`, `description`, `tags`
- No resolved journey names -- frontend resolves display names client-side via the existing `fk_typeahead` pattern

**MetaModelRelationshipsDto update**
- Add a new field `List<UserJourneyLinkDto> userJourneyLinks` with `@JsonProperty("user_journey_links")` to the existing record constructor
- This is the 10th relationship list in the record (after `applicationPointBusinessLogics`)

**ModelService integration (load/save/delete)**
- Inject `UserJourneyLinkRepository` alongside the other relationship repositories in the constructor (via `@RequiredArgsConstructor`)
- In `loadRelationships`: add `userJourneyLinkRepository.findByModelFileId(modelFileId)` mapped via `entityMapper::toDto` as the new 10th argument to the `MetaModelRelationshipsDto` constructor
- In `saveRelationships`: add a null-guarded block that validates `relationship_type` against the allowed enum (`RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS`) and then calls `saveAll` via `entityMapper.toEntity`
- In `deleteAllDataForModelFile`: add `userJourneyLinkRepository.deleteByModelFileId(modelFileId)` BEFORE the existing `activityStepRepository.deleteByModelFileId` / `userJourneyRepository.deleteByModelFileId` calls to respect FK ordering

**EntityMapper toDto/toEntity methods**
- Add `toDto(UserJourneyLinkEntity)` returning `UserJourneyLinkDto` record -- same pattern as `toDto(BusinessUserBusinessPointEntity)`
- Add `toEntity(UserJourneyLinkDto, String modelFileId)` returning `UserJourneyLinkEntity` via builder -- same pattern as `toEntity(BusinessUserBusinessPointDto, String)`

**Frontend TypeScript types (model.ts)**
- Add type `UserJourneyLinkRelationshipType = 'RELATES_TO' | 'PRECEDES' | 'DEPENDS_ON' | 'OPTIONALLY_LEADS_TO' | 'TRIGGERS'`
- Add interface `UserJourneyLink` with fields: `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type` (typed as `UserJourneyLinkRelationshipType`), optional `label`, `description`, `tags`
- Add `'user_journey_links'` to the `RelationshipType` union
- Add `user_journey_links: UserJourneyLink[]` to the `MetaModelRelationships` interface

**Frontend grid config (gridConfigs.ts)**
- Add `user_journey_links` column config array: `id` (text, autoGenerate), `source_user_journey_id` (fk_typeahead, fkTarget: `user_journeys`, width 220), `target_user_journey_id` (fk_typeahead, fkTarget: `user_journeys`, width 220), `relationship_type` (dropdown, options from enum values, formatOptionLabel: `snakeCaseToTitleCase`, width 180), `label` (text, optional, width 150), `description` (text, optional, width 200), `tags` (tags, optional, width 130)
- Add `'User Journey Links': 'user_journey_links'` to `relationshipTabToType` map
- Add `'User Journey Links'` to the end of the `relationshipTabNames` array

**Frontend relationship definitions (relationshipDefinitions.ts)**
- Add entry to `RELATIONSHIP_DEFINITIONS`: `{ relationshipKey: 'user_journey_links', displayName: 'User Journey Links', endpointEntityTypes: ['user_journeys'] }`
- Append `'User Journey Links'` at the end of `RELATIONSHIP_TAB_ORDER`
- Add `user_journeys: 'business'` to `ENTITY_TYPE_TO_DOMAIN` to fix the existing gap that prevents `getRelationshipsForDomain` from surfacing any relationship whose endpoints include `user_journeys`

**Frontend defaults (defaults.ts)**
- Add exported array `userJourneyLinkTypeOptions` with values: `['RELATES_TO', 'PRECEDES', 'DEPENDS_ON', 'OPTIONALLY_LEADS_TO', 'TRIGGERS']`
- This array is referenced by the grid config dropdown column for `relationship_type`

## Visual Design
No visual assets provided. The "User Journey Links" tab uses the existing `RelationshipGrid` component with no visual changes -- only configuration-driven column definitions.

## Existing Code to Leverage

**BusinessUserBusinessPointEntity / Dto / Repository pattern**
- `BusinessUserBusinessPointEntity.java` is the canonical relationship entity with `id`, `modelFileId`, two FK fields, `description`, `tags`
- `BusinessUserBusinessPointDto.java` is the canonical Java record DTO with `@JsonProperty` snake_case annotations
- `BusinessUserBusinessPointRepository.java` provides `findByModelFileId` and `deleteByModelFileId`
- All three files serve as direct copy-and-adapt templates for UserJourneyLink, replacing FK field names and adding `relationshipType` and `label`

**ModelService whole-model load/save/delete wiring**
- `loadRelationships()` (line 777) constructs `MetaModelRelationshipsDto` by fetching all relationship repos by modelFileId -- new repo follows the same `findByModelFileId -> stream -> map(entityMapper::toDto) -> collect` pattern
- `saveRelationships()` (line 1194) null-guards each relationship list and calls `saveAll` -- new repo follows the same `null check -> stream -> map(entityMapper.toEntity) -> collect -> saveAll` pattern
- `deleteAllDataForModelFile()` (line 829) deletes in FK-safe order -- user_journey_links must be inserted before the existing `activityStepRepository` / `userJourneyRepository` delete calls

**EntityMapper toDto/toEntity pattern**
- `EntityMapper.java` (line 1361) has `toDto(BusinessUserBusinessPointEntity)` and `toEntity(BusinessUserBusinessPointDto, String)` methods
- New `toDto`/`toEntity` methods for UserJourneyLink follow the identical pattern with field name substitutions

**Frontend relationshipDefinitions.ts derivation system**
- `RELATIONSHIP_DEFINITIONS` array, `ENTITY_TYPE_TO_DOMAIN` mapping, and `RELATIONSHIP_TAB_ORDER` array work together to derive which relationship tabs appear under each domain
- Adding `user_journeys: 'business'` to `ENTITY_TYPE_TO_DOMAIN` and a new definition with `endpointEntityTypes: ['user_journeys']` ensures automatic surfacing in the Business domain
- The `RelationshipGrid` component already renders any relationship type generically from grid config -- no new component needed

**Frontend gridConfigs.ts relationship column patterns**
- `business_user_business_points` (line 448) demonstrates the canonical column config: `id` (autoGenerate), FK fields (`fk_typeahead`), `description`, `tags`
- `ui_characteristics` grid (line 436) demonstrates `dropdown` cellType with `formatOptionLabel: snakeCaseToTitleCase` -- same pattern needed for `relationship_type` column

## Out of Scope
- Standalone `UserJourneyLinkController` with dedicated CRUD/search endpoints -- no new REST controller
- Standalone `UserJourneyLinkService` class -- entity/DTO mapping handled inline in ModelService
- Resolved source/target journey names in backend DTO -- frontend resolves via existing `fk_typeahead`
- Dedicated search/filter endpoints for user_journey_links -- model-file-scoped load/save is sufficient
- Gateway proxy route changes -- data flows through existing `/api/model` endpoint automatically
- Visual rendering or directional display of links on User Journey diagrams
- XLSX parser / workbook ingestion updates for user_journey_links
- UX Designer task or prompt changes
- MCP / generate / save-artifact changes
- Parent "User Journey Overview" diagram type or child/parent diagram linking
- DB-level CHECK constraint on `relationship_type` enum values -- validation in Java service layer only
- Bulk import/export UX for user_journey_links
- Any new dedicated screen outside the existing Business Architecture relationship table framework
