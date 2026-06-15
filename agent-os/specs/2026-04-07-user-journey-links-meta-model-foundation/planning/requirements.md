# Spec Requirements: User Journey Links Meta-Model Foundation

## Initial Description

Introduce a new first-class Business Architecture relationship called USER_JOURNEY_LINK so that relationships between User Journeys become authoritative architecture data and can later drive parent overview diagram generation and navigation.

### Motivation
- The next architecture layer needs a zoomed-out parent diagram for a given user/role, with child User Journey diagrams beneath it.
- That parent diagram should be generated from architecture truth, not from manually added post-drawing arrows.
- Therefore journey-to-journey connections must become a first-class Business Architecture relationship in the meta-model.
- This increment establishes the relationship foundation only; workbook ingestion, overview diagram generation, and diagram linking come later.

## Requirements Discussion

### First Round Questions

**Q1:** The existing relationship types (like `business_user_business_points`, `data_movements`, etc.) do NOT have their own dedicated REST controllers -- they are exclusively managed through the whole-model load/save cycle via `ModelService` and `ModelController`. The initialization.md calls for a standalone "Controller with CRUD/list/search endpoints." Should USER_JOURNEY_LINK follow the existing pattern (managed only within the whole-model load/save, no dedicated controller) for consistency, or do you specifically want a standalone `UserJourneyLinkController` with individual CRUD endpoints?
**Answer:** Follow the existing whole-model load/save pattern for consistency in Increment 11; do not introduce a standalone UserJourneyLinkController or new CRUD/search endpoint pattern here.

**Q2:** `user_journeys` is present in `DOMAIN_ENTITY_TYPES` (in `gridConfigs.ts`) for the business domain, but it is NOT yet added to `ENTITY_TYPE_TO_DOMAIN` (in `relationshipDefinitions.ts`). The relationship derivation logic (`getRelationshipsForDomain`) uses `ENTITY_TYPE_TO_DOMAIN` exclusively. We MUST add `user_journeys: 'business'` to `ENTITY_TYPE_TO_DOMAIN` for the new "User Journey Links" tab to appear under the Business domain. Is this a gap from the original User Journey spec that should be fixed as part of this spec?
**Answer:** Yes, fix the ENTITY_TYPE_TO_DOMAIN gap in this increment so user_journeys is correctly recognized under the Business domain and the new "User Journey Links" relationship tab can appear in the right place.

**Q3:** The requirements say the backend DTO should include `source_user_journey_name` and `target_user_journey_name` resolved by the service layer. However, in the existing model, the whole-model load already provides all `user_journeys` entities to the frontend, and the `fk_typeahead` grid cell type already resolves foreign key display names client-side using the loaded model data. Should we still add resolved names to the DTO, or rely on the frontend's existing FK resolution pattern?
**Answer:** Rely on the frontend's existing FK/typeahead resolution pattern rather than adding resolved source/target journey names to a new backend DTO in this increment.

**Q4:** The initialization specifies "search/filter by source_user_journey_id, target_user_journey_id, or relationship_type." No other relationship type in the system currently has search/filter endpoints. Should we add search endpoints for this relationship type, or is `findByModelFileId` sufficient?
**Answer:** Do not add dedicated search/filter endpoints for this relationship type in Increment 11; model-file-scoped load/save is sufficient and consistent with current relationship handling.

**Q5:** The spec says `relationship_type` validation happens in the Java service layer only, with TEXT storage in the DB. Should there also be a DB-level CHECK constraint on the allowed values?
**Answer:** Validate relationship_type in the Java/service/model layer and keep DB storage as TEXT without a DB-level CHECK constraint in this increment.

**Q6:** The `RELATIONSHIP_TAB_ORDER` currently has 9 entries. Where should "User Journey Links" appear?
**Answer:** Append "User Journey Links" at the end of the existing Business relationship tab order for now.

**Q7:** If we keep this entirely within the existing /api/model whole-model load/save flow, no new gateway routes are needed. Confirm?
**Answer:** Correct: keep this entirely within the existing /api/model whole-model load/save flow with no new gateway routes in Increment 11.

**Q8:** Are there any plans to make USER_JOURNEY_LINK directional rendering on the existing User Journey diagrams in this increment?
**Answer:** Explicitly no visual rendering or directional display of USER_JOURNEY_LINK in this increment; it is purely first-class meta-model data plus standard Business relationship table exposure.

### Existing Code to Reference

**Similar Features Identified:**

The following existing patterns were analyzed to establish conventions that this spec must follow:

- **Relationship entity pattern**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/BusinessUserBusinessPointEntity.java` -- Canonical relationship entity pattern: `id`, `modelFileId`, two FK fields, `description`, `tags`, `validFrom`, `validTo`. USER_JOURNEY_LINK follows this same pattern but adds `relationshipType` and `label` fields unique to its domain, and omits `validFrom`/`validTo` (not specified).

- **Relationship DTO pattern**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/BusinessUserBusinessPointDto.java` -- Java record with `@JsonProperty` for snake_case JSON serialization. All relationship DTOs live in the `model.dto.relationship` package. Note: no resolved FK names in DTO; frontend resolves display names client-side via fk_typeahead.

- **Relationship repository pattern**: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/BusinessUserBusinessPointRepository.java` -- Extends `JpaRepository<Entity, String>`, provides `findByModelFileId(String)` and `deleteByModelFileId(String)`. All relationship repos live in `repository.relationship` package.

- **MetaModelRelationshipsDto**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` -- Java record that bundles all relationship lists. USER_JOURNEY_LINK list must be added here with `@JsonProperty("user_journey_links")`.

- **ModelService**: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` -- Injects all entity and relationship repositories; the new `UserJourneyLinkRepository` must be added here and wired into load/save/delete operations. This is the ONLY backend integration point; no standalone controller or service is needed.

- **Source entity**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyEntity.java` -- JPA entity with Lombok annotations, String id, String modelFileId, name, description, tags, primaryBusinessUserId, parentBusinessProcessId. This is the entity that USER_JOURNEY_LINK references via source/target FKs.

- **Liquibase migration pattern**: `architecture-model-service/src/main/resources/db/changelog/sql/059-user-journeys-activity-steps.sql` -- SQL migration with CREATE TABLE, FK references, and CREATE INDEX. Next available migration number is 078.

- **Frontend grid config pattern**: `frontend/src/config/gridConfigs.ts` -- Grid column definitions for relationship tables. `business_user_business_points` (line 448) shows the canonical pattern with `id` (autoGenerate), FK fields (`fk_typeahead` cellType), `description`, `tags`. USER_JOURNEY_LINK adds a `dropdown` for `relationship_type` enum.

- **Frontend relationship definitions**: `frontend/src/config/relationshipDefinitions.ts` -- `RELATIONSHIP_DEFINITIONS` array, `ENTITY_TYPE_TO_DOMAIN` mapping, `RELATIONSHIP_TAB_ORDER` array. All three must be updated.

- **Frontend relationship tab mappings**: `frontend/src/config/gridConfigs.ts` lines 626-636 -- `relationshipTabToType` maps display names to type keys. `relationshipTabNames` array. Both must be updated.

- **Frontend type definitions**: `frontend/src/types/model.ts` -- `RelationshipType` union (line 2227), `MetaModelRelationships` interface (line 2163), and relationship interface definitions. All must be updated.

- **ENTITY_TYPE_TO_DOMAIN gap**: `frontend/src/config/relationshipDefinitions.ts` line 141 -- `user_journeys` is currently MISSING from `ENTITY_TYPE_TO_DOMAIN` despite being in `DOMAIN_ENTITY_TYPES` in `gridConfigs.ts`. Must add `user_journeys: 'business'` so that the derivation logic in `getRelationshipsForDomain` correctly surfaces "User Journey Links" in the Business domain.

### Follow-up Questions

No follow-up questions were needed. The user's answers were clear and unambiguous on all 8 points, and the simplifications are internally consistent.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Domain Model

**USER_JOURNEY_LINK entity:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | TEXT (PK) | Yes | Auto-generated unique identifier |
| model_file_id | TEXT (FK) | Yes | References model_files(id) ON DELETE CASCADE |
| source_user_journey_id | TEXT (FK) | Yes | References user_journeys(id) -- NO ACTION (cross-entity FK) |
| target_user_journey_id | TEXT (FK) | Yes | References user_journeys(id) -- NO ACTION (cross-entity FK) |
| relationship_type | TEXT | Yes | Enum: RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS |
| label | TEXT | No | Human-readable label for the link |
| description | TEXT | No | Longer description |
| tags | TEXT | No | Comma-separated tags (consistent with all other entities) |

**Constraints:**
- Directed relationship (source -> target)
- CHECK constraint: `source_user_journey_id <> target_user_journey_id` (no self-links)
- UNIQUE constraint on `(source_user_journey_id, target_user_journey_id, relationship_type, label)` to prevent duplicates
- relationship_type validated as one of: `RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS` -- validation in Java service layer only, no DB-level CHECK on enum values

### Functional Requirements

#### Persistence (Liquibase Migration)

- New migration file: `078-user-journey-links.sql` (next available number)
- CREATE TABLE `user_journey_links` with all fields above
- FK to `model_files(id)` with ON DELETE CASCADE
- FK to `user_journeys(id)` for both source and target (NO ACTION / cross-entity FK pattern)
- CHECK constraint preventing self-links
- UNIQUE constraint on (source, target, type, label)
- Indexes: `idx_user_journey_links_model_file ON user_journey_links(model_file_id)`, `idx_user_journey_links_source ON user_journey_links(source_user_journey_id)`, `idx_user_journey_links_target ON user_journey_links(target_user_journey_id)`
- Register in `db.changelog-master.yaml`

#### Backend (Java/Spring Boot)

**JPA Entity:**
- `UserJourneyLinkEntity.java` in `model.entity` package
- Follow existing Lombok pattern: `@Entity`, `@Table`, `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
- Fields: `id`, `modelFileId`, `sourceUserJourneyId`, `targetUserJourneyId`, `relationshipType`, `label`, `description`, `tags`

**Repository:**
- `UserJourneyLinkRepository.java` in `repository.relationship` package
- Extends `JpaRepository<UserJourneyLinkEntity, String>`
- Methods: `findByModelFileId(String modelFileId)`, `deleteByModelFileId(String modelFileId)`

**DTO:**
- `UserJourneyLinkDto.java` in `model.dto.relationship` package
- Java record with `@JsonProperty` annotations for snake_case JSON:
  - `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type`, `label`, `description`, `tags`
- No resolved journey names in DTO -- frontend resolves display names client-side via existing fk_typeahead pattern

**No Standalone Controller or Service:**
- No `UserJourneyLinkController` -- no dedicated CRUD/search endpoints
- No `UserJourneyLinkService` -- entity/DTO mapping is handled inline within `ModelService` (consistent with all other relationship types)

**MetaModelRelationshipsDto:**
- Add `user_journey_links` field: `List<UserJourneyLinkDto> userJourneyLinks` with `@JsonProperty("user_journey_links")`

**ModelService Integration:**
- Inject `UserJourneyLinkRepository`
- Wire into load model (fetch by modelFileId and map to DTOs)
- Wire into save model (map from DTOs and saveAll)
- Wire into delete model (deleteByModelFileId)
- Include in the `ArchitectureModelDto` -> `MetaModelDto` -> `MetaModelRelationshipsDto` chain

#### Frontend (React/TypeScript)

**Type Definitions (`frontend/src/types/model.ts`):**
- Add `UserJourneyLinkRelationshipType` type: `'RELATES_TO' | 'PRECEDES' | 'DEPENDS_ON' | 'OPTIONALLY_LEADS_TO' | 'TRIGGERS'`
- Add `UserJourneyLink` interface:
  ```typescript
  export interface UserJourneyLink {
    id: string;
    source_user_journey_id: string;
    target_user_journey_id: string;
    relationship_type: UserJourneyLinkRelationshipType;
    label?: string;
    description?: string;
    tags?: string;
  }
  ```
- Add `'user_journey_links'` to `RelationshipType` union
- Add `user_journey_links: UserJourneyLink[]` to `MetaModelRelationships` interface

**Grid Config (`frontend/src/config/gridConfigs.ts`):**
- Add `user_journey_links` grid column config:
  - `id`: cellType `text`, required, autoGenerate, width 100
  - `source_user_journey_id`: cellType `fk_typeahead`, required, fkTarget `user_journeys`, displayName "Source User Journey", width 220
  - `target_user_journey_id`: cellType `fk_typeahead`, required, fkTarget `user_journeys`, displayName "Target User Journey", width 220
  - `relationship_type`: cellType `dropdown`, required, options from enum, displayName "Relationship Type", width 180, formatOptionLabel: `snakeCaseToTitleCase`
  - `label`: cellType `text`, required false, displayName "Label", width 150
  - `description`: cellType `text`, required false, displayName "Description", width 200
  - `tags`: cellType `tags`, required false, width 130
- Add to `relationshipTabToType`: `'User Journey Links': 'user_journey_links'`
- Add `'User Journey Links'` to `relationshipTabNames` array (at end)

**Defaults (`frontend/src/config/defaults.ts`):**
- Add enum options array `userJourneyLinkTypeOptions` with values: `RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS`

**Relationship Definitions (`frontend/src/config/relationshipDefinitions.ts`):**
- Add to `RELATIONSHIP_DEFINITIONS`:
  ```typescript
  {
    relationshipKey: 'user_journey_links',
    displayName: 'User Journey Links',
    endpointEntityTypes: ['user_journeys'],
  }
  ```
- Add `'User Journey Links'` to end of `RELATIONSHIP_TAB_ORDER`
- Add `user_journeys: 'business'` to `ENTITY_TYPE_TO_DOMAIN` (fixing the existing gap so derivation logic works)

### Reusability Opportunities

- **Entity pattern**: Direct copy of `BusinessUserBusinessPointEntity.java` structure with field name changes and addition of `relationshipType` and `label`
- **Repository pattern**: Direct copy of `BusinessUserBusinessPointRepository.java`
- **DTO pattern**: Direct copy of `BusinessUserBusinessPointDto.java` record pattern (without resolved names)
- **ModelService pattern**: Follow the existing load/save/delete wiring pattern used for all other relationship repositories in `ModelService.java`
- **Grid config pattern**: Follow `business_user_business_points` grid config entry pattern, adding `dropdown` for relationship_type
- **RelationshipGrid component**: Already exists and handles all relationship types generically -- no new component needed
- **MetaModelView**: Already renders relationship tabs from `relationshipDefinitions.ts` -- no view changes needed beyond config updates
- **Migration pattern**: Follow `059-user-journeys-activity-steps.sql` structure

### Scope Boundaries

**In Scope:**
- Liquibase migration for `user_journey_links` table with all constraints
- JPA entity and repository in architecture-model-service
- DTO (without resolved names) in architecture-model-service
- MetaModelRelationshipsDto update to include user_journey_links
- ModelService integration for load/save/delete
- Frontend TypeScript type/interface definitions
- Frontend grid config for "User Journey Links" relationship tab
- Frontend relationship definition registration
- Frontend ENTITY_TYPE_TO_DOMAIN gap fix for `user_journeys`
- Frontend relationship tab ordering (append at end)
- DB-level CHECK constraint preventing self-links
- DB-level UNIQUE constraint on (source, target, type, label)
- Service-layer validation of relationship_type enum values

**Out of Scope:**
- Standalone UserJourneyLinkController (no dedicated CRUD endpoints)
- Standalone UserJourneyLinkService (no dedicated service class)
- Resolved journey names in backend DTO (frontend resolves via fk_typeahead)
- Search/filter endpoints (model-file-scoped load/save is sufficient)
- Gateway proxy route changes (flows through existing /api/model endpoint)
- Visual rendering or directional display of links on diagrams
- XLSX parser updates (no workbook ingestion for this entity)
- UX Designer task/prompt changes
- MCP/generate/save-artifact changes
- Parent "User Journey Overview" diagram type
- Child/parent diagram linking
- Any sync behavior
- Bulk import/export UX
- Any new dedicated screen outside the existing Business Architecture table framework
- DB-level CHECK constraint on relationship_type enum values

### Technical Considerations

- **Migration numbering**: Next available is 078 (after 077-class-service-id-migration.sql)
- **FK strategy**: Cross-entity FKs to `user_journeys(id)` use NO ACTION (not CASCADE) to prevent accidental cascade deletion of links when journeys are individually removed -- consistent with how `activity_steps` references `process_activities`, `business_users`, and `applications`
- **Model file scoping**: All queries are scoped by `model_file_id`, consistent with every other entity/relationship in the system
- **No resolved names in DTO**: Frontend already receives all `user_journeys` entities in the model load response and the `fk_typeahead` cell type resolves display names client-side -- no backend join/lookup needed
- **Enum handling**: `relationship_type` is stored as TEXT in the database with no DB-level CHECK on values -- validation happens in the Java service/model layer only. Frontend uses a dropdown with options array from `defaults.ts`.
- **Changelog registration**: Add the new migration file to `db.changelog-master.yaml` following the existing pattern
- **ENTITY_TYPE_TO_DOMAIN fix**: `user_journeys` must be added to `ENTITY_TYPE_TO_DOMAIN` in `relationshipDefinitions.ts` with value `'business'` -- this is a gap from the original User Journey spec that prevented relationship derivation from working for any relationship whose endpoints include `user_journeys`
- **No gateway changes**: The new relationship data flows through the existing `/api/model` whole-model load/save endpoint automatically; no new gateway proxy routes are needed
- **Delete ordering in ModelService**: `user_journey_links` must be deleted BEFORE `user_journeys` during model deletion to respect the FK constraint (source/target reference user_journeys)
