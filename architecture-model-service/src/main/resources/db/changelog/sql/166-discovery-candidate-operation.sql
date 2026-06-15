-- ============================================================================
-- Discovery candidate `operation` dimension (Spec: 2026-05-30 Model-Aware
-- Discovery -- Dedup Against Existing Entities + Enrichment/Link Candidates) --
-- Task Group 1.
--
-- Adds ONE typed `operation` column to the EXISTING discovery_candidate table
-- (created by an applied changeset, which is NEVER edited -- this is a NEW
-- changeset only). Mirrors the 165-relationship-fk-columns.sql additive-column
-- style (a single ADD COLUMN on an existing discovery table). snake_case wire,
-- no @CamelCaseWire.
--
-- `operation` is a DIMENSION on the candidate row -- NOT a new entity or
-- relationship TYPE. Values:
--   create  -- propose a brand-new meta-model element (the default / status quo)
--   enrich  -- add attributes and/or relationships to ONE existing entity
--   link    -- map two EXISTING entities (one logical data entity <-> one
--              physical data entity) via logical_data_entity_physical_data_entities
--
-- NOT NULL DEFAULT 'create' so every existing discovery_candidate row
-- round-trips as `create` with no backfill (it parallels candidate_type/status,
-- which are likewise NOT NULL on this table).
--
-- The matching index parallels the existing
-- idx_discovery_candidate_run_id_type so candidates can be filtered by
-- (run_id, operation) the same way they are by (run_id, candidate_type).
-- ============================================================================

ALTER TABLE discovery_candidate ADD COLUMN operation VARCHAR(32) NOT NULL DEFAULT 'create';

CREATE INDEX idx_discovery_candidate_run_id_operation ON discovery_candidate (run_id, operation);
