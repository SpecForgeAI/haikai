# Raw Idea

title: "Increment 1 – Add Product Tab + Minimal ProductDefinition (UI + DB only)"

intent:
  Introduce a new "Product" screen in the Product & Delivery section,
  backed by a minimal ProductDefinition entity (projectId + productName).
  No LLM, no chat, no MCP, no mission generation yet.

scope:
  include:
    - frontend navigation update
    - new ProductPage screen scaffold
    - minimal ProductDefinition entity (DB-backed)
    - CRUD endpoints for ProductDefinition
    - frontend API integration for load/save
  exclude:
    - any chat functionality
    - any OpenAI integration
    - any MCP tools
    - mission file generation
    - structured product fields beyond productName
    - roadmap or architecture linkage

backend:
  service: architecture-model-service

  domain:
    entity: ProductDefinition
    table: product_definitions
    fields:
      - id (UUID, primary key)
      - project_id (UUID, unique, not null, one-to-one with project)
      - product_name (string, not null)
      - created_at (timestamp)
      - updated_at (timestamp)

    constraints:
      - unique constraint on project_id
      - cascade delete if project is deleted

  repository:
    - ProductDefinitionRepository (JPA)

  service_layer:
    - ProductDefinitionService
      responsibilities:
        - getByProjectId(projectId)
        - upsert(projectId, productName)

  controller:
    base_path: /api/projects/{projectId}/product

    endpoints:
      - GET /
        response:
          - 200 with ProductDefinitionDto
          - 404 if not yet created

      - PUT /
        body:
          - productName (string, required)
        behavior:
          - create if not exists
          - update if exists
        response:
          - 200 with ProductDefinitionDto

  dto:
    ProductDefinitionDto:
      - id
      - projectId
      - productName
      - createdAt
      - updatedAt

frontend:
  navigation:
    location: Product & Delivery top tab bar
    change:
      before: [Roadmap] [Backlog] [Implement]
      after:  [Product] [Roadmap] [Backlog] [Implement]

  routing:
    new_route:
      path: /projects/:projectId/product
      component: ProductPage

  page:
    component: ProductPage.tsx
    responsibilities:
      - fetch ProductDefinition on mount
      - display editable Product Name field
      - allow Save button
      - show placeholder section:
          title: "Product Manager (Coming Soon)"
          content: informational text only

  api:
    add:
      - getProductDefinition(projectId)
      - saveProductDefinition(projectId, productName)

  state:
    - local component state for productName
    - loading and error handling consistent with existing patterns
    - no localStorage persistence

non_functional:
  - do not break existing Roadmap, Backlog, or Implement screens
  - maintain existing project active gating logic
  - follow existing coding conventions and DTO mapping patterns
  - no changes to gateway or mcp-server in this increment

acceptance_criteria:
  - Product tab appears before Roadmap
  - Clicking Product loads ProductPage
  - Product name can be saved and reloaded from DB
  - Only one ProductDefinition per project
  - No regression in other Product & Delivery tabs
