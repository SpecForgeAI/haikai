# Spec Requirements: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)

## Initial Description

Introduce a new "Product" screen in the Product & Delivery section, backed by a minimal ProductDefinition entity (projectId + productName). No LLM, no chat, no MCP, no mission generation yet.

**Include:**
- Frontend navigation update
- New ProductPage screen scaffold
- Minimal ProductDefinition entity (DB-backed)
- CRUD endpoints for ProductDefinition
- Frontend API integration for load/save

**Exclude:**
- Any chat functionality
- Any OpenAI integration
- Any MCP tools
- Mission file generation
- Structured product fields beyond productName
- Roadmap or architecture linkage

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea specifies the API base path as `/api/projects/{projectId}/product`. The existing codebase has two URL namespace patterns: some controllers use `/api/model/projects/{projectId}/...` (e.g., WorkItemController) while others use `/api/projects/...` (e.g., ProjectController) or `/api/v1/...` (e.g., OrganisationController). Should we use `/api/projects/{projectId}/product` as stated, since this is a project-level concern (not a model-level concern)?
**Answer:** Yes -- use `/api/projects/{projectId}/product` (project-level). Keep `/api/model/*` for model file payloads only.

**Q2:** The raw idea describes `project_id` as UUID. The existing `work_item` table uses String projectId (mapped to loaded filename), while the `project` table has a proper UUID `id`. Should `project_id` be a UUID with a foreign key constraint to `project(id)` with `ON DELETE CASCADE`?
**Answer:** Yes -- `project_id` is a UUID FK to `project(id)` with `ON DELETE CASCADE`, enforcing 1:1 via `UNIQUE(project_id)`.

**Q3:** The current Product & Delivery tab bar uses query parameter-based routing (`?tab=backlog`, `?tab=implement`, `?tab=roadmap`) with `backlog` as the default tab. Should we add `'product'` as a new `ProductTab` value and change the default tab from `backlog` to `product`?
**Answer:** Keep the existing default (`backlog`). Product is available via the tab but is not the default in this increment.

**Q4:** The raw idea mentions a placeholder section titled "Product Manager (Coming Soon)" with informational text. Should this be a simple styled card/box with a heading and brief sentence, non-interactive with no buttons?
**Answer:** Yes -- non-interactive styled card. Text: "Product Manager chat will be available in a future increment."

**Q5:** For the editable Product Name field and Save button: should the pattern match existing pages with a simple text input + Save button, with loading/error states via local useState, and Save disabled when empty or unchanged?
**Answer:** Yes -- disable Save when empty and when unchanged. Standard local state + loading/error handling.

**Q6:** The new `ProductDefinitionController` should be conditional on database being enabled. Should the frontend `ProductPage` still render when in File Mode (no-database) with a "requires database" message, or should the entire Product tab be hidden?
**Answer:** Hide the Product tab when DB is disabled (same behavior as other DB-backed screens). No special message needed in v0.1.

**Q7:** Should the backend DTO use Java record pattern and should the API use snake_case property names with the frontend performing camelCase mapping?
**Answer:** Yes -- use Java record DTOs. However, keep API JSON in **camelCase** to match the frontend (no snake_case conversion needed for this new endpoint). This is a deliberate choice for this endpoint.

**Q8:** Is there anything explicitly excluded beyond what is listed? Should there be no delete endpoint for ProductDefinition?
**Answer:** Correct -- no delete endpoint. Upsert-only (GET + PUT).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Product & Delivery tab bar - Path: `frontend/src/components/ProductView/ProductView.tsx` -- tab bar pattern for adding the new Product tab
- Feature: Frontend API module - Path: `frontend/src/api/projectsApi.ts` and `frontend/src/api/organisationsApi.ts` -- API call patterns (note: this new endpoint uses camelCase JSON so no snake_case mapping is needed)
- Feature: Backend entity/repo/service/controller - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/` -- the Organisation entity set (`OrganisationEntity`, `OrganisationRepository`, `OrganisationService`, `OrganisationController`) as a clean reference for a simple entity CRUD
- Feature: Backend DTO - Path: Organisation's `OrganisationDto.java` (record pattern) for DTO structure
- Feature: Backend mapper - Path: `OrganisationMapper.java` for entity-to-DTO mapping
- Feature: DB migration - Path: `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` and `029-organisations.sql` for the Liquibase changelog + SQL migration file pattern
- Feature: TopBar view gating - Path: `frontend/src/components/TopBar/TopBar.tsx` -- the `includeDelivery` feature toggle pattern for conditionally rendering the Product & Delivery button; the Product tab should follow a similar pattern using the `includeDatabase` toggle
- Feature: Database feature toggle - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/config/DatabaseAutoConfiguration.java` -- the `@ConditionalOnProperty` pattern for conditionally enabling DB-backed controllers

### Follow-up Questions

No follow-up questions were needed. All answers were clear and complete.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `agent-os/specs/2026-02-12-increment-1-product-tab-minimal-product-definition/planning/visuals/` confirmed no image files present.

### Visual Insights:
N/A -- no visuals to analyze.

## Requirements Summary

### Functional Requirements
- Add a "Product" tab as the first tab in the Product & Delivery sub-tab bar (before Roadmap), accessible via `?tab=product`
- The default tab remains `backlog` (not changed to `product`)
- The Product tab is hidden when the database feature toggle is disabled (File Mode)
- ProductPage displays an editable Product Name text input field and a Save button
- Save button is disabled when the product name is empty or unchanged from the last saved value
- ProductPage displays a non-interactive "Product Manager (Coming Soon)" placeholder card with the text: "Product Manager chat will be available in a future increment."
- ProductPage fetches the existing ProductDefinition on mount (GET) and allows saving (PUT, upsert)
- Only one ProductDefinition exists per project (1:1 relationship enforced by UNIQUE constraint)
- No delete endpoint -- upsert-only (GET + PUT)

### Backend Requirements
- New `product_definitions` table with columns: `id` (UUID PK), `project_id` (UUID, UNIQUE, NOT NULL, FK to `project(id)` ON DELETE CASCADE), `product_name` (TEXT, NOT NULL), `created_at` (TIMESTAMP), `updated_at` (TIMESTAMP)
- Liquibase SQL migration file following the existing numbered pattern (next available number in the changelog)
- `ProductDefinitionEntity` JPA entity class
- `ProductDefinitionRepository` Spring Data JPA repository with `findByProjectId(UUID)` method
- `ProductDefinitionService` with `getByProjectId(UUID)` and `upsert(UUID, String)` methods
- `ProductDefinitionController` at `/api/projects/{projectId}/product` with GET and PUT endpoints
- Controller annotated with `@ConditionalOnProperty(name = "app.features.include-database")` or equivalent conditional bean
- `ProductDefinitionDto` as a Java `record`
- `ProductDefinitionMapper` for entity-to-DTO conversion
- API JSON uses **camelCase** field names (no snake_case) -- this is a deliberate choice for this endpoint
- GET returns 200 with DTO or 404 if not yet created
- PUT accepts `{ "productName": "..." }`, creates if not exists, updates if exists, returns 200 with DTO

### Frontend Requirements
- Add `'product'` to the `ProductTab` type union
- Add Product tab button as the first item in the ProductView tab bar
- Conditionally hide the Product tab when `includeDatabase` is false
- New `ProductPage.tsx` component with CSS module
- New `productDefinitionApi.ts` API module with `getProductDefinition(projectId)` and `saveProductDefinition(projectId, productName)` functions
- No snake_case-to-camelCase mapping needed (API returns camelCase directly)
- Local component state for product name, loading state, and error handling
- No localStorage persistence

### Reusability Opportunities
- Tab bar pattern from `ProductView.tsx` -- extending the existing `ProductTab` type and tab button rendering
- API module pattern from `organisationsApi.ts` / `projectsApi.ts` -- simplified since no case conversion needed
- Backend entity/repo/service/controller pattern from the Organisation feature set
- Java record DTO pattern from `OrganisationDto`
- Liquibase migration pattern from `029-organisations.sql`
- Feature toggle gating pattern from TopBar's `includeDelivery` / `includeDatabase` checks

### Scope Boundaries
**In Scope:**
- New Product tab in Product & Delivery tab bar
- ProductPage component with product name field, save button, and placeholder card
- Full backend stack: migration, entity, repository, service, controller, DTO, mapper
- Frontend API module for GET/PUT
- Feature toggle gating (hide when DB disabled)

**Out of Scope:**
- Any chat functionality or AI integration
- Any OpenAI or LLM integration
- Any MCP tools
- Mission file generation
- Structured product fields beyond productName (description, vision, goals, etc.)
- Roadmap or architecture linkage
- Delete endpoint
- Changes to gateway or mcp-server
- Changing the default tab to Product
- File Mode support for ProductPage

### Technical Considerations
- The API JSON format is camelCase (not snake_case), which is a deliberate departure from some older endpoints. Spring Boot's default Jackson serialization uses camelCase, so no special configuration is needed on the backend.
- The `product_definitions` table uses a UNIQUE constraint on `project_id` to enforce the 1:1 relationship at the database level.
- The controller uses `@ConditionalOnProperty` to ensure it is only active when the database feature is enabled.
- The frontend hides the Product tab entirely when `includeDatabase` is false, consistent with how other DB-backed features are gated.
- No changes to existing Roadmap, Backlog, or Implement screens -- the existing default tab (`backlog`) is preserved.
- Follow existing coding conventions, file organization, and testing patterns throughout.
