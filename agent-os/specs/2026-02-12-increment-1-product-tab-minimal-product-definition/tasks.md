# Task Breakdown: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)

## Overview
Total Tasks: 31 (across 4 task groups)

This feature introduces a new "Product" tab in the Product & Delivery sub-tab bar, backed by a minimal `ProductDefinition` entity with `projectId` and `productName` fields, persisted to PostgreSQL via a full backend stack (migration, entity, repository, service, controller, DTO, mapper). No LLM, chat, MCP, or mission generation is included.

## Task List

### Database & Backend Layer

#### Task Group 1: Database Migration, Entity, Repository, Service, Controller, DTO, Mapper
**Dependencies:** None

- [x] 1.0 Complete backend stack for ProductDefinition
  - [x] 1.1 Write 5 focused tests for the ProductDefinition backend stack
    - Test 1: `ProductDefinitionControllerTest` -- GET `/api/projects/{projectId}/product` returns 404 when no definition exists
    - Test 2: `ProductDefinitionControllerTest` -- PUT `/api/projects/{projectId}/product` creates a new definition and returns 200 with DTO
    - Test 3: `ProductDefinitionControllerTest` -- PUT upsert updates existing definition when one already exists for the project
    - Test 4: `ProductDefinitionControllerTest` -- PUT with blank productName returns 400 Bad Request
    - Test 5: `ProductDefinitionMapperTest` -- `toDto()` correctly maps all entity fields to DTO record fields
    - Create test file: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProductDefinitionControllerTest.java`
    - Create test file: `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/ProductDefinitionMapperTest.java`
    - Follow test patterns from `OrganisationControllerTest.java` and `OrganisationMapperTest.java`
  - [x] 1.2 Create Liquibase SQL migration for `product_definitions` table
    - Create file: `architecture-model-service/src/main/resources/db/changelog/sql/043-product-definitions.sql`
    - Table: `product_definitions`
    - Columns: `id UUID PRIMARY KEY`, `project_id UUID NOT NULL UNIQUE`, `product_name TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`
    - FK constraint: `FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE`
    - Unique index on `project_id` to enforce the 1:1 relationship
    - Follow SQL pattern from `029-organisations.sql`
  - [x] 1.3 Register migration in Liquibase changelog master
    - Modify file: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add changeset `043-product-definitions` after the existing `042-organisation-standards-fields` entry
    - Use preCondition `not: tableExists: tableName: product_definitions` with `onFail: MARK_RAN`
    - Reference `db/changelog/sql/043-product-definitions.sql` with `splitStatements: true` and `stripComments: true`
  - [x] 1.4 Create `ProductDefinitionDto` Java record
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProductDefinitionDto.java`
    - Java record with fields: `UUID id`, `UUID projectId`, `String productName`, `Instant createdAt`, `Instant updatedAt`
    - No `@JsonAlias` annotations needed (API returns camelCase natively via Spring Boot default Jackson serialization)
    - Follow pattern from `OrganisationDto.java` but simpler (no list fields, no snake_case aliases)
  - [x] 1.5 Create `ProductDefinitionEntity` JPA entity
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProductDefinitionEntity.java`
    - Annotations: `@Entity`, `@Table(name = "product_definitions")`, Lombok `@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`
    - Fields: `id` (UUID, `@Id`), `projectId` (UUID, `@Column(name = "project_id", unique = true, nullable = false)`), `productName` (String, `@Column(name = "product_name", nullable = false)`), `createdAt` (Instant, `@Column(name = "created_at")`), `updatedAt` (Instant, `@Column(name = "updated_at")`)
    - Follow pattern from `OrganisationEntity.java` but without JSON converters or list fields
  - [x] 1.6 Create `ProductDefinitionMapper`
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProductDefinitionMapper.java`
    - Annotate with `@Component`
    - Method `toDto(ProductDefinitionEntity entity)`: maps all entity fields to `ProductDefinitionDto` record constructor
    - Follow pattern from `OrganisationMapper.java` but simpler (no list normalization, no `toEntity` or `toListItemDto` needed)
  - [x] 1.7 Create `ProductDefinitionRepository`
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/ProductDefinitionRepository.java`
    - Extend `JpaRepository<ProductDefinitionEntity, UUID>`
    - Annotate with `@Repository`
    - Add method: `Optional<ProductDefinitionEntity> findByProjectId(UUID projectId)`
    - Follow pattern from `OrganisationRepository.java` but with UUID type parameter (not String)
  - [x] 1.8 Create `ProductDefinitionService`
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProductDefinitionService.java`
    - Annotate with `@Service`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Constructor-inject `ProductDefinitionRepository` and `ProductDefinitionMapper`
    - Method `getByProjectId(UUID projectId)`: returns `Optional<ProductDefinitionDto>`, calls `repository.findByProjectId(projectId)` and maps via `mapper.toDto()`, annotate with `@Transactional(readOnly = true)`
    - Method `upsert(UUID projectId, String productName)`: validates `productName` is non-blank (throw `IllegalArgumentException`), finds existing by `projectId`, updates `productName` and `updatedAt` if found, creates new entity with `UUID.randomUUID()` as id if not found, saves and returns `ProductDefinitionDto`, annotate with `@Transactional`
    - Follow `OrganisationService.java` for `@ConditionalOnProperty` and transactional patterns
  - [x] 1.9 Create `ProductDefinitionController`
    - Create file: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProductDefinitionController.java`
    - Annotate with `@RestController`, `@RequestMapping("/api/projects/{projectId}/product")`, `@Slf4j`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`
    - Constructor-inject `ProductDefinitionService`
    - Define inner `record SaveProductDefinitionRequest(String productName) {}` for PUT request body
    - GET endpoint (`@GetMapping`): calls `service.getByProjectId(projectId)`, returns `ResponseEntity.ok(dto)` if present, or `ResponseEntity.notFound().build()` if empty
    - PUT endpoint (`@PutMapping`): accepts `@PathVariable UUID projectId` and `@RequestBody SaveProductDefinitionRequest`, calls `service.upsert(projectId, request.productName())`, returns `ResponseEntity.ok(dto)`
    - No DELETE endpoint
    - Follow `OrganisationController.java` for `@ConditionalOnProperty`, request record, and response entity patterns
  - [x] 1.10 Ensure backend tests pass
    - Run ONLY the 5 tests written in 1.1
    - Verify migration file is syntactically correct
    - Verify entity, repository, service, controller, DTO, and mapper compile without errors
    - Do NOT run the entire backend test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 1.1 pass
- Migration `043-product-definitions.sql` creates the table with correct columns, constraints, and indexes
- Migration is registered in `db.changelog-master.yaml`
- GET `/api/projects/{projectId}/product` returns 200 with DTO or 404 when not found
- PUT `/api/projects/{projectId}/product` with `{ "productName": "..." }` performs upsert and returns 200 with DTO
- PUT with blank productName returns 400
- All JSON responses use camelCase field names (Spring Boot default)
- Controller and service are conditional on `app.features.include-database=true`

---

### Frontend API Layer

#### Task Group 2: Frontend API Module for ProductDefinition
**Dependencies:** Task Group 1 (backend endpoints must be defined to know the contract)

- [x] 2.0 Complete frontend API module for ProductDefinition
  - [x] 2.1 Write 3 focused tests for the ProductDefinition API module
    - Test 1: `getProductDefinition` returns `ProductDefinitionDto` on successful 200 response
    - Test 2: `getProductDefinition` returns `null` on 404 response (not an error)
    - Test 3: `saveProductDefinition` sends PUT with correct body and returns `ProductDefinitionDto`
    - Create test file: `frontend/src/api/__tests__/productDefinitionApi.test.ts`
    - Follow test patterns from existing API tests (e.g., `organisationsApi.standards.test.ts`)
  - [x] 2.2 Create `productDefinitionApi.ts` API module
    - Create file: `frontend/src/api/productDefinitionApi.ts`
    - Define and export `ProductDefinitionDto` interface: `{ id: string; projectId: string; productName: string; createdAt: string; updatedAt: string }`
    - Use `API_BASE` from `import.meta.env.VITE_API_BASE_URL ?? ''` (consistent with `organisationsApi.ts`)
    - Export `getProductDefinition(projectId: string): Promise<ProductDefinitionDto | null>`:
      - GET `${API_BASE}/api/projects/${projectId}/product`
      - Return parsed JSON on 200, return `null` on 404
      - On other errors: extract `message` or `error` from JSON body, throw `Error`
    - Export `saveProductDefinition(projectId: string, productName: string): Promise<ProductDefinitionDto>`:
      - PUT `${API_BASE}/api/projects/${projectId}/product` with body `{ productName }`
      - Return parsed JSON on 200
      - On error: extract `message` or `error` from JSON body, throw `Error`
    - IMPORTANT: The backend response uses snake_case fields (project_id, product_name, created_at, updated_at) due to global Jackson SNAKE_CASE strategy. Maps these to camelCase in the frontend DTO following the pattern from `organisationsApi.ts`.
    - Follow error extraction pattern from `organisationsApi.ts` (try `response.json()` for `message` or `error`, then throw)
  - [x] 2.3 Ensure frontend API module tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify TypeScript compiles without errors
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- `getProductDefinition` correctly handles 200 (returns DTO) and 404 (returns null) responses
- `saveProductDefinition` sends PUT request with `{ productName }` body and returns DTO
- Error responses are properly extracted and thrown as `Error` instances
- `ProductDefinitionDto` interface is exported for use by the ProductPage component
- Module follows the established `organisationsApi.ts` patterns

---

### Frontend UI Components

#### Task Group 3: ProductPage Component and ProductView Tab Integration
**Dependencies:** Task Group 2 (API module must exist for component to import)

- [x] 3.0 Complete frontend UI for Product tab and ProductPage
  - [x] 3.1 Write 5 focused tests for the Product tab and ProductPage component
    - Test 1: Product tab button renders in the tab bar when `includeDatabase` is `true`
    - Test 2: Product tab button is NOT rendered when `includeDatabase` is `false`
    - Test 3: Clicking the Product tab button renders the `ProductPage` component
    - Test 4: `ProductPage` displays the "Product Manager (Coming Soon)" placeholder card
    - Test 5: Save button is disabled when product name input is empty
    - Create test file: `frontend/src/components/ProductView/__tests__/ProductPage.test.tsx`
    - Mock `productDefinitionApi` functions and context providers (`useProject`, `useIncludeDatabase`)
  - [x] 3.2 Add `'product'` to `ProductTab` type union in `ProductView.tsx`
    - Modify file: `frontend/src/components/ProductView/ProductView.tsx`
    - Change `type ProductTab = 'backlog' | 'implement' | 'roadmap'` to `type ProductTab = 'backlog' | 'implement' | 'roadmap' | 'product'`
    - Update `parseTabFromUrl()` to recognize `tabParam === 'product'` and return `'product'` (add case before the default return)
    - The default return remains `'backlog'` -- do NOT change it
  - [x] 3.3 Add Product tab button to the tab bar in `ProductView.tsx`
    - Modify file: `frontend/src/components/ProductView/ProductView.tsx`
    - Import `useIncludeDatabase` from `../../contexts/AppConfigContext`
    - Call `const includeDatabase = useIncludeDatabase()` inside `ProductViewContent`
    - Add a new `<button>` as the FIRST tab in the `.tabBar` div, BEFORE the existing Roadmap button
    - Conditionally render: only show the Product tab button when `includeDatabase` is `true`
    - Button attributes: `className` using `styles.tab` / `styles.activeTab` pattern, `onClick={() => handleTabChange('product')}`, `data-testid="product-tab"`, label text "Product"
    - The button follows the exact same JSX pattern as the existing Roadmap, Backlog, and Implement buttons
  - [x] 3.4 Add conditional rendering for ProductPage in the content area of `ProductView.tsx`
    - Modify file: `frontend/src/components/ProductView/ProductView.tsx`
    - Import `ProductPage` from `./ProductPage`
    - Add a new conditional render block inside the `.content` div: `{activeTab === 'product' && <ProductPage />}`
    - Place it before or after the existing blocks (order does not matter since only one renders at a time)
  - [x] 3.5 Create `ProductPage.tsx` component
    - Create file: `frontend/src/components/ProductView/ProductPage.tsx`
    - Import `useState`, `useEffect` from React
    - Import `useProject` from `../../contexts/ProjectContext`
    - Import `getProductDefinition`, `saveProductDefinition`, `ProductDefinitionDto` from `../../api/productDefinitionApi`
    - Import CSS module from `./ProductPage.module.css`
    - Obtain `projectId` from the active project context via `useProject()` (access `.id` property)
    - Local state: `productName` (string), `savedProductName` (string, tracks last saved value), `loading` (boolean), `saving` (boolean), `error` (string | null)
    - On mount (and when `projectId` changes): call `getProductDefinition(projectId)` to fetch existing definition
      - On 200 (non-null return): set `productName` and `savedProductName` to the returned `productName`
      - On null (404): leave `productName` as empty string (no error displayed)
      - On error: set `error` state
      - Set `loading` to false after fetch completes
    - Render an editable text input field for "Product Name" with label
    - Render a Save button:
      - Disabled when: `productName.trim() === ''` OR `productName === savedProductName` OR `saving` is true
      - On click: call `saveProductDefinition(projectId, productName.trim())`, update `savedProductName` on success, set `error` on failure
    - Render loading state (e.g., "Loading..." text) while fetching
    - Render error state if `error` is non-null
    - Render a non-interactive placeholder card with heading "Product Manager (Coming Soon)" and body text "Product Manager chat will be available in a future increment."
    - No global state, no localStorage, no chat integration
  - [x] 3.6 Create `ProductPage.module.css` styles
    - Create file: `frontend/src/components/ProductView/ProductPage.module.css`
    - Define styles for: page container layout, form card (product name input + save button), placeholder card ("Coming Soon"), loading state, error state
    - Follow the existing application design system (use similar spacing, colors, font sizes as `ProductView.module.css`)
    - Use a simple form card layout: label, text input, save button in a row or stacked layout
    - Placeholder card: muted background, centered text, visually distinct as non-interactive
    - Keep styles minimal and consistent with the overall application look and feel
  - [x] 3.7 Ensure frontend UI component tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify TypeScript compiles without errors for all modified and new files
    - Verify the Product tab button appears first in the tab bar (before Roadmap) when `includeDatabase` is true
    - Verify the Product tab button is hidden when `includeDatabase` is false
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- `'product'` is in the `ProductTab` type union
- `parseTabFromUrl()` recognizes `?tab=product` and returns `'product'`
- The default tab remains `'backlog'`
- Product tab button renders as the first tab (before Roadmap) when `includeDatabase` is true
- Product tab button is hidden when `includeDatabase` is false
- Clicking Product tab renders `ProductPage` component
- `ProductPage` fetches existing definition on mount and populates the product name field
- Save button is disabled when product name is empty or unchanged
- Save button calls PUT endpoint and updates the saved state on success
- "Product Manager (Coming Soon)" placeholder card is rendered
- Loading and error states are handled with local `useState`

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 5 backend tests written in Task 1.1 (controller + mapper)
    - Review the 3 API module tests written in Task 2.1 (getProductDefinition, saveProductDefinition)
    - Review the 5 UI component tests written in Task 3.1 (tab rendering, ProductPage behavior)
    - Total existing tests: 13 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage:
      - Full save flow: user types product name, clicks save, value persists
      - Full load flow: user navigates to Product tab, existing product name loads into input
      - Upsert behavior: saving when a definition already exists updates rather than creates
      - Tab URL routing: navigating to `?tab=product` activates the Product tab
      - Error handling: API errors during save are displayed to the user
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over additional unit test gaps
  - [x] 4.3 Write up to 10 additional strategic tests maximum
    - Fill identified gaps from 4.2. Possible additions (select only what is needed, maximum 10):
      - Backend: Service upsert creates new entity when none exists for projectId
      - Backend: Service upsert updates existing entity when one already exists for projectId
      - Backend: Service validates productName is non-blank
      - Frontend: ProductPage displays error message when API fetch fails
      - Frontend: ProductPage successfully saves and updates savedProductName state (Save button becomes disabled after save)
      - Frontend: ProductPage Save button becomes enabled when user modifies the product name after a successful save
      - Frontend: URL `?tab=product` is recognized by `parseTabFromUrl()` and returns `'product'`
      - Frontend: Default tab remains `'backlog'` when no tab parameter is in URL
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - Backend: `ProductDefinitionControllerTest`, `ProductDefinitionMapperTest`, and any new service/integration tests from 4.3
      - Frontend: `productDefinitionApi.test.ts` and `ProductPage.test.tsx`
    - Expected total: approximately 13-23 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 13-23 tests total)
- Critical user workflows for this feature are covered (fetch on mount, save, upsert, tab navigation, error handling)
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Database & Backend Layer** -- No dependencies. Creates the migration, entity, repository, service, controller, DTO, and mapper. This must be completed first because the frontend API module depends on the endpoint contract, and the UI depends on the API module.

2. **Task Group 2: Frontend API Layer** -- Depends on Task Group 1 (needs to know the endpoint paths and JSON contract). Creates `productDefinitionApi.ts` with `getProductDefinition` and `saveProductDefinition` functions.

3. **Task Group 3: Frontend UI Components** -- Depends on Task Group 2 (ProductPage imports API functions). Modifies `ProductView.tsx` to add the Product tab, creates `ProductPage.tsx` and `ProductPage.module.css`.

4. **Task Group 4: Test Review & Gap Analysis** -- Depends on Task Groups 1-3. Reviews all tests written during development and adds up to 10 additional tests to cover critical gaps.

## Files Summary

### New Files to Create
| File | Task |
|------|------|
| `architecture-model-service/src/main/resources/db/changelog/sql/043-product-definitions.sql` | 1.2 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProductDefinitionDto.java` | 1.4 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ProductDefinitionEntity.java` | 1.5 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/ProductDefinitionMapper.java` | 1.6 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/repository/ProductDefinitionRepository.java` | 1.7 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProductDefinitionService.java` | 1.8 |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProductDefinitionController.java` | 1.9 |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProductDefinitionControllerTest.java` | 1.1 |
| `architecture-model-service/src/test/java/com/example/architecturemodel/mapper/ProductDefinitionMapperTest.java` | 1.1 |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/ProductDefinitionServiceTest.java` | 4.3 |
| `frontend/src/api/productDefinitionApi.ts` | 2.2 |
| `frontend/src/api/__tests__/productDefinitionApi.test.ts` | 2.1 |
| `frontend/src/components/ProductView/ProductPage.tsx` | 3.5 |
| `frontend/src/components/ProductView/ProductPage.module.css` | 3.6 |
| `frontend/src/components/ProductView/__tests__/ProductPage.test.tsx` | 3.1, 4.3 |

### Existing Files to Modify
| File | Task |
|------|------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | 1.3 |
| `frontend/src/components/ProductView/ProductView.tsx` | 3.2, 3.3, 3.4 |
