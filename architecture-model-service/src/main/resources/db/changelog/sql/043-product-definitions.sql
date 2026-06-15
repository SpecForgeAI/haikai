-- ============================================================================
-- Migration 043: Product Definitions Table
-- Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
--
-- Introduces a new ProductDefinition entity with a 1:1 relationship to Project.
-- Each project can have at most one product definition.
-- ============================================================================

-- ============================================================================
-- PRODUCT DEFINITIONS TABLE
-- Stores the minimal product definition (product name) per project.
-- ============================================================================

CREATE TABLE product_definitions (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK constraint: project_id references project(id) with cascade delete
ALTER TABLE product_definitions
  ADD CONSTRAINT fk_product_definitions_project
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;

-- Unique index on project_id to enforce the 1:1 relationship at DB level
CREATE UNIQUE INDEX idx_product_definitions_project_id ON product_definitions(project_id);
