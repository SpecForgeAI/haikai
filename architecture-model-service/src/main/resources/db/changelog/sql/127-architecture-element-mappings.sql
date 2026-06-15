-- 127-architecture-element-mappings.sql
-- Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 1
--
-- New table that persists explicit cross-architecture element mappings produced by
-- the selective-copy "create target baseline" workflow (auto-mapped equivalence
-- rows) and by the in-wizard Mapping Review modal (manual add / edit of arbitrary
-- mapping types). The table is intentionally architecture-pair-scoped, NOT
-- architecture-scoped, so a single row links a specific (source_element, target_element)
-- pair across two architectures within one project.
--
-- The mapping_type column accepts free-text values; v1 allowed values are validated
-- at the service layer (equivalent / renamed / replaced_by / split / merged /
-- manual_review_required). Status column similarly accepts free-text validated at
-- service layer (confirmed / proposed / needs_review / rejected). Boxed Double for
-- confidence on the entity is required to avoid PATCH wipe-to-zero (see project
-- memory note: project_primitive_double_dto_overwrite.md).
--
-- Per project memory (feedback_liquibase_immutable_changesets): applied Liquibase
-- changesets are immutable. This is a NEW changeset only; changesets <= 126 are
-- not edited.

CREATE TABLE architecture_element_mappings (
  id                        UUID PRIMARY KEY,
  project_id                UUID NOT NULL,
  source_architecture_id    UUID NOT NULL,
  target_architecture_id    UUID NOT NULL,
  source_element_type       TEXT NOT NULL,
  source_element_id         TEXT NOT NULL,
  target_element_type       TEXT NOT NULL,
  target_element_id         TEXT NOT NULL,
  mapping_type              TEXT NOT NULL,
  status                    TEXT NOT NULL,
  created_by_task           TEXT NOT NULL,
  created_at                TIMESTAMP NOT NULL,
  updated_at                TIMESTAMP NOT NULL,
  notes                     TEXT NULL,
  confidence                DOUBLE PRECISION NULL
);

-- Unique constraint prevents duplicate mappings for the same source/target pair
-- under the same mapping_type (project + arch pair + both element identities +
-- mapping_type). Rejected rows still occupy a row in v1.
ALTER TABLE architecture_element_mappings
  ADD CONSTRAINT architecture_element_mappings_unique_pair
  UNIQUE (project_id, source_architecture_id, target_architecture_id,
          source_element_type, source_element_id,
          target_element_type, target_element_id,
          mapping_type);

-- Search-filter indexes: arch-pair lookup (Mapping Review on open),
-- source-side and target-side element lookups (future migration-planning queries).
CREATE INDEX idx_arch_elt_mapping_arch_pair
  ON architecture_element_mappings (project_id, source_architecture_id, target_architecture_id);

CREATE INDEX idx_arch_elt_mapping_source_element
  ON architecture_element_mappings (project_id, source_element_id);

CREATE INDEX idx_arch_elt_mapping_target_element
  ON architecture_element_mappings (project_id, target_element_id);
