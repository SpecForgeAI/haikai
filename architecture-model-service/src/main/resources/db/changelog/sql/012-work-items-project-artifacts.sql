-- ============================================================================
-- Migration 012: Work Items and Project Artifacts
-- Hierarchical work item storage (Initiative/Epic/Feature/Story) with
-- cascading deletes, plus versioned project artifact storage for markdown
-- ============================================================================

-- ============================================================================
-- WORK_ITEM TABLE
-- Hierarchical work items with self-referential parent relationship
-- type values: INITIATIVE, EPIC, FEATURE, STORY
-- status default: PLANNED
-- ============================================================================

CREATE TABLE work_item (
  id                 UUID PRIMARY KEY,
  project_id         TEXT NOT NULL,
  type               TEXT NOT NULL,
  parent_id          UUID NULL,
  title              TEXT NOT NULL,
  description        TEXT NULL,
  status             TEXT NOT NULL DEFAULT 'PLANNED',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  priority           INTEGER NULL,
  target_window      TEXT NULL,
  tags_json          JSONB NULL,
  external_system    TEXT NULL,
  external_key       TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_work_item_parent FOREIGN KEY (parent_id) REFERENCES work_item(id) ON DELETE CASCADE,
  CONSTRAINT chk_work_item_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Index for filtering by project
CREATE INDEX idx_work_item_project_id ON work_item(project_id);

-- Index for filtering by project and type
CREATE INDEX idx_work_item_project_type ON work_item(project_id, type);

-- Index for ordering within project with parent
CREATE INDEX idx_work_item_project_parent_sort ON work_item(project_id, parent_id, sort_order);

-- Index for parent_id lookups (cascade delete performance)
CREATE INDEX idx_work_item_parent_id ON work_item(parent_id);

-- ============================================================================
-- PROJECT_ARTIFACT TABLE
-- Versioned storage for markdown artifacts (mission.md, roadmap.md, etc.)
-- artifact_type values: MISSION_MD, ROADMAP_MD, BACKLOG_MD
-- source values: AGENT_OS, TOOL, USER_EDIT
-- ============================================================================

CREATE TABLE project_artifact (
  id                 UUID PRIMARY KEY,
  project_id         TEXT NOT NULL,
  artifact_type      TEXT NOT NULL,
  content            TEXT NOT NULL,
  source             TEXT NOT NULL DEFAULT 'AGENT_OS',
  revision           INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_artifact_project_type_revision UNIQUE (project_id, artifact_type, revision)
);

-- Index for filtering by project and artifact type
CREATE INDEX idx_artifact_project_type ON project_artifact(project_id, artifact_type);

-- Index for finding latest revision by project and type
CREATE INDEX idx_artifact_project_type_revision ON project_artifact(project_id, artifact_type, revision DESC);
