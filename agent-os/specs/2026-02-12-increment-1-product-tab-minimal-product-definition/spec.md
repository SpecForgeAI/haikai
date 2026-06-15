# Specification: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)

## Goal
Introduce a new "Product" tab in the Product & Delivery sub-tab bar, backed by a minimal `ProductDefinition` entity with `projectId` and `productName` fields, persisted to a PostgreSQL table via a full backend stack (migration, entity, repository, service, controller, DTO, mapper). No LLM, chat, MCP, or mission generation is included in this increment.

## User Stories
- As a product owner, I want to navigate to a Product tab in the Product & Delivery section so that I can define the product name for my project.
- As a product owner, I want to save and reload the product name from the database so that the definition persists across sessions.

## Specific Requirements

**Product tab in the Product & Delivery sub-tab bar**
- Add `'product'` to the existing `ProductTab` type union in `ProductView.tsx` (currently `'backlog' | 'implement' | 'roadmap'`)
- Add a new `<button>` as the first tab in the tab bar, before the Roadmap button, with label "Product", `data-testid="product-tab"`, and `?tab=product` URL parameter
- Update `parseTabFromUrl()` to recognize `tabParam === 'product'` and return `'product'`
- The default tab remains `'backlog'` -- do NOT change the default
- Conditionally hide the Product tab button when `includeDatabase` is `false`, using the `useIncludeDatabase()` hook from `AppConfigContext`
- Render the new `ProductPage` component in the content area when `activeTab === 'product'`

**ProductPage component**
- Create `ProductPage.tsx` and `ProductPage.module.css` in `frontend/src/components/ProductView/`
- On mount, call `getProductDefinition(projectId)` to fetch any existing ProductDefinition; handle 404 as "no definition yet" (not an error)
- Display an editable text input field for "Product Name" with a Save button
- Save button calls `saveProductDefinition(projectId, productName)` (PUT upsert)
- Save button is disabled when the product name is empty OR unchanged from the last saved value
- Include loading and error state handling using local `useState` (no global state, no localStorage)
- Display a non-interactive placeholder card with heading "Product Manager (Coming Soon)" and body text "Product Manager chat will be available in a future increment."
- Obtain `projectId` from the active project context (via `useProject()` from `ProjectContext`)

**Frontend API module for ProductDefinition**
- Create `frontend/src/api/productDefinitionApi.ts` following the pattern in `organisationsApi.ts` and `projectsApi.ts`
- Export `getProductDefinition(projectId: string): Promise<ProductDefinitionDto | null>` -- GET `/api/projects/{projectId}/product`, returns `null` on 404
- Export `saveProductDefinition(projectId: string, productName: string): Promise<ProductDefinitionDto>` -- PUT `/api/projects/{projectId}/product` with body `{ "productName": "..." }`
- Define `ProductDefinitionDto` interface with fields: `id: string`, `projectId: string`, `productName: string`, `createdAt: string`, `updatedAt: string`
- No snake_case-to-camelCase mapping needed -- the backend API returns camelCase JSON directly (deliberate choice for this new endpoint, as Spring Boot defaults to camelCase)
- Use `API_BASE` from `import.meta.env.VITE_API_BASE_URL ?? ''` consistent with other API modules
- Follow the error extraction pattern: try to parse `response.json()` for `message` or `error` fields, then throw `Error`

**Liquibase SQL migration for product_definitions table**
- Create `architecture-model-service/src/main/resources/db/changelog/sql/043-product-definitions.sql` (next number after `042-organisation-standards-fields.sql`)
- Table: `product_definitions` with columns: `id UUID PRIMARY KEY`, `project_id UUID NOT NULL UNIQUE`, `product_name TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Add FK constraint: `FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE`
- Add unique index on `project_id` to enforce the 1:1 relationship at the DB level
- Register in `db.changelog-master.yaml` as changeset id `043-product-definitions` with preCondition `not: tableExists: tableName: product_definitions` and `onFail: MARK_RAN`

**ProductDefinitionEntity JPA entity**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProductDefinitionEntity.java`
- Use `@Entity`, `@Table(name = "product_definitions")`, Lombok `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
- Fields: `id` (UUID, `@Id`), `projectId` (UUID, `@Column(name = "project_id", unique = true, nullable = false)`), `productName` (String, `@Column(name = "product_name", nullable = false)`), `createdAt` (Instant or `java.time.Instant`, `@Column(name = "created_at")`), `updatedAt` (Instant, `@Column(name = "updated_at")`)
- Follow the pattern from `OrganisationEntity.java` but simpler (no JSON converters needed)

**ProductDefinitionRepository**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/repository/ProductDefinitionRepository.java`
- Extend `JpaRepository<ProductDefinitionEntity, UUID>`
- Add method: `Optional<ProductDefinitionEntity> findByProjectId(UUID projectId)`
- Annotate with `@Repository`

**ProductDefinitionService**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProductDefinitionService.java`
- Annotate with `@Service`, `@Slf4j`, and `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)` following the `OrganisationService` pattern
- Constructor-inject `ProductDefinitionRepository` and `ProductDefinitionMapper`
- Method `getByProjectId(UUID projectId)`: returns `Optional<ProductDefinitionDto>` by calling `repository.findByProjectId(projectId)` and mapping via `mapper.toDto()`
- Method `upsert(UUID projectId, String productName)`: finds existing by `projectId`, updates `productName` and `updatedAt` if found, or creates new entity with `UUID.randomUUID()` as id if not found; saves and returns `ProductDefinitionDto`
- Validate that `productName` is non-blank (throw `IllegalArgumentException` if blank)
- Use `@Transactional` on write methods, `@Transactional(readOnly = true)` on read methods

**ProductDefinitionController**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProductDefinitionController.java`
- Annotate with `@RestController`, `@RequestMapping("/api/projects/{projectId}/product")`, `@Slf4j`, and `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
- GET endpoint (no additional path): returns `ResponseEntity.ok(dto)` if found, or `ResponseEntity.notFound().build()` if not
- PUT endpoint (no additional path): accepts `@RequestBody` with `productName` field, calls `service.upsert()`, returns `ResponseEntity.ok(dto)`
- Define inner `record SaveProductDefinitionRequest(String productName) {}` for the PUT request body
- No DELETE endpoint -- upsert-only (GET + PUT)

**ProductDefinitionDto (Java record)**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProductDefinitionDto.java`
- Java record with fields: `UUID id`, `UUID projectId`, `String productName`, `Instant createdAt`, `Instant updatedAt`
- No `@JsonAlias` annotations needed because the API uses camelCase natively (Spring Boot default Jackson serialization)

**ProductDefinitionMapper**
- Create `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProductDefinitionMapper.java`
- Annotate with `@Component`
- Method `toDto(ProductDefinitionEntity entity)`: maps entity fields to `ProductDefinitionDto` record
- Follow the `OrganisationMapper.java` pattern but simpler (no list normalization needed)

## Visual Design
No visual assets provided. The Product tab follows the existing tab bar visual pattern established in `ProductView.module.css` (`.tab`, `.activeTab` classes). The ProductPage layout should use a simple form card layout consistent with the overall application styling.

## Existing Code to Leverage

**ProductView tab bar (`frontend/src/components/ProductView/ProductView.tsx`)**
- The `ProductTab` type union, `parseTabFromUrl()`, `updateUrl()`, and tab button rendering pattern are all in this file
- Extend the type union, add a case to `parseTabFromUrl()`, add a new `<button>` before the Roadmap button, and add a conditional render block for `activeTab === 'product'`
- The `ProductView.module.css` already has `.tab`, `.activeTab`, `.tabBar`, and `.content` styles that the new tab will reuse

**Organisation backend stack (`architecture-model-service/.../controller/OrganisationController.java`, `OrganisationService.java`, `OrganisationRepository.java`, `OrganisationEntity.java`, `OrganisationMapper.java`, `OrganisationDto.java`)**
- This is the primary reference for the backend entity/repo/service/controller/DTO/mapper pattern
- Follow the same `@ConditionalOnProperty` annotation, constructor injection, `@Transactional` usage, and mapper `@Component` pattern
- The DTO uses the Java `record` pattern; follow `OrganisationDto.java` structure but simpler

**Frontend API modules (`frontend/src/api/organisationsApi.ts`, `frontend/src/api/projectsApi.ts`)**
- Follow the `API_BASE`, error extraction, and fetch pattern
- Since this new endpoint returns camelCase JSON, the implementation is simpler -- no `mapFromSnake` function is needed, unlike `projectsApi.ts`

**Liquibase migration files (`architecture-model-service/src/main/resources/db/changelog/sql/029-organisations.sql` and `db.changelog-master.yaml`)**
- Follow the SQL file naming convention (sequential number prefix)
- Follow the changelog YAML entry pattern with `preConditions`, `onFail: MARK_RAN`, and `sqlFile` reference
- The `project` table migration (`013-project-table.sql`) shows the UUID PK and `TIMESTAMPTZ` patterns to follow

**Feature toggle gating (`frontend/src/components/TopBar/TopBar.tsx` and `frontend/src/contexts/AppConfigContext.tsx`)**
- The `useIncludeDatabase()` hook from `AppConfigContext` provides the boolean toggle
- TopBar demonstrates the pattern of conditionally rendering UI based on `includeDelivery`; the Product tab should follow the same pattern using `includeDatabase`

## Out of Scope
- Any chat functionality or AI/LLM integration on the Product page
- Any OpenAI or MCP tool integration
- Mission file generation
- Structured product fields beyond `productName` (e.g., description, vision, goals, target users)
- Roadmap or architecture linkage from the ProductDefinition entity
- A DELETE endpoint for ProductDefinition
- Changes to the gateway or mcp-server services
- Changing the default tab from `backlog` to `product`
- File Mode support for ProductPage (the tab is simply hidden when DB is disabled)
- Any new global state management or localStorage persistence for ProductPage
