-- 145-architecture-element-provenance-and-decom.sql
-- Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 1
--
-- Adds two new authoring-metadata columns to every architecture element
-- supertype table that participates in the target-architecture table editor:
--
--   * application_components -- the component supertype
--   * interfaces             -- the API supertype
--   * data_entity_points     -- the data entity supertype (polymorphic
--                               wrapper over logical / physical data entities)
--   * infrastructure_points  -- the infrastructure element supertype
--                               (polymorphic wrapper over the 12 infra types)
--
-- The two new columns:
--
--   * provenance              -- VARCHAR(32), NULLABLE,
--                                CHECK IN ('cloned-from', 'imported',
--                                          'user-authored', 'llm-suggested').
--                                Where this element came from. Per spec:
--                                cloned-from   -- copy from current via
--                                                 ArchitectureCloneService
--                                imported      -- imported from an external
--                                                 source (existing v1 import
--                                                 path)
--                                user-authored -- inserted by the user via
--                                                 the table editor
--                                llm-suggested -- produced by the LLM
--                                                 "Suggest target arch" task
--
--   * decommissioning_status  -- VARCHAR(32), NULLABLE,
--                                CHECK IN ('not-applicable', 'proposed',
--                                          'decommissioned').
--                                Target-side only. Current architecture has
--                                no decommissioning concept of its own; the
--                                current-side "decommissioned in target"
--                                annotation is DERIVED at read time from
--                                missing mappings or target-side decommissioned
--                                rows.
--
-- Both columns are NULLABLE so the entity-side mapping uses boxed String types
-- per project_primitive_double_dto_overwrite -- a PATCH omitting the field
-- never wipes the column. Defaults apply ONLY on insert via the entity layer;
-- existing rows are NEVER overwritten by this changeset.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 144 are not edited.

-- ============================================================================
-- application_components
-- ============================================================================

ALTER TABLE application_components
  ADD COLUMN provenance             VARCHAR(32) NULL;

ALTER TABLE application_components
  ADD COLUMN decommissioning_status VARCHAR(32) NULL;

ALTER TABLE application_components
  ADD CONSTRAINT chk_application_components_provenance
  CHECK (provenance IS NULL OR provenance IN
    ('cloned-from', 'imported', 'user-authored', 'llm-suggested'));

ALTER TABLE application_components
  ADD CONSTRAINT chk_application_components_decom_status
  CHECK (decommissioning_status IS NULL OR decommissioning_status IN
    ('not-applicable', 'proposed', 'decommissioned'));

COMMENT ON COLUMN application_components.provenance IS
  'Authoring provenance for this element. Allowed values cloned-from | imported | user-authored | llm-suggested. Nullable so existing rows survive without overwrite. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN application_components.decommissioning_status IS
  'Target-side decommissioning vocabulary. Allowed values not-applicable | proposed | decommissioned. Nullable; current architecture has no decommissioning field of its own (derived at read time). Spec: Target Architecture Authoring Flow (2026-05-20).';

-- ============================================================================
-- interfaces (API supertype)
-- ============================================================================

ALTER TABLE interfaces
  ADD COLUMN provenance             VARCHAR(32) NULL;

ALTER TABLE interfaces
  ADD COLUMN decommissioning_status VARCHAR(32) NULL;

ALTER TABLE interfaces
  ADD CONSTRAINT chk_interfaces_provenance
  CHECK (provenance IS NULL OR provenance IN
    ('cloned-from', 'imported', 'user-authored', 'llm-suggested'));

ALTER TABLE interfaces
  ADD CONSTRAINT chk_interfaces_decom_status
  CHECK (decommissioning_status IS NULL OR decommissioning_status IN
    ('not-applicable', 'proposed', 'decommissioned'));

COMMENT ON COLUMN interfaces.provenance IS
  'Authoring provenance for this API. Allowed values cloned-from | imported | user-authored | llm-suggested. Nullable so existing rows survive without overwrite. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN interfaces.decommissioning_status IS
  'Target-side decommissioning vocabulary. Allowed values not-applicable | proposed | decommissioned. Nullable. Spec: Target Architecture Authoring Flow (2026-05-20).';

-- ============================================================================
-- data_entity_points (data entity supertype)
-- ============================================================================

ALTER TABLE data_entity_points
  ADD COLUMN provenance             VARCHAR(32) NULL;

ALTER TABLE data_entity_points
  ADD COLUMN decommissioning_status VARCHAR(32) NULL;

ALTER TABLE data_entity_points
  ADD CONSTRAINT chk_data_entity_points_provenance
  CHECK (provenance IS NULL OR provenance IN
    ('cloned-from', 'imported', 'user-authored', 'llm-suggested'));

ALTER TABLE data_entity_points
  ADD CONSTRAINT chk_data_entity_points_decom_status
  CHECK (decommissioning_status IS NULL OR decommissioning_status IN
    ('not-applicable', 'proposed', 'decommissioned'));

COMMENT ON COLUMN data_entity_points.provenance IS
  'Authoring provenance for this data entity point. Allowed values cloned-from | imported | user-authored | llm-suggested. Nullable. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN data_entity_points.decommissioning_status IS
  'Target-side decommissioning vocabulary. Allowed values not-applicable | proposed | decommissioned. Nullable. Spec: Target Architecture Authoring Flow (2026-05-20).';

-- ============================================================================
-- infrastructure_points (infrastructure element supertype)
-- ============================================================================

ALTER TABLE infrastructure_points
  ADD COLUMN provenance             VARCHAR(32) NULL;

ALTER TABLE infrastructure_points
  ADD COLUMN decommissioning_status VARCHAR(32) NULL;

ALTER TABLE infrastructure_points
  ADD CONSTRAINT chk_infrastructure_points_provenance
  CHECK (provenance IS NULL OR provenance IN
    ('cloned-from', 'imported', 'user-authored', 'llm-suggested'));

ALTER TABLE infrastructure_points
  ADD CONSTRAINT chk_infrastructure_points_decom_status
  CHECK (decommissioning_status IS NULL OR decommissioning_status IN
    ('not-applicable', 'proposed', 'decommissioned'));

COMMENT ON COLUMN infrastructure_points.provenance IS
  'Authoring provenance for this infrastructure element. Allowed values cloned-from | imported | user-authored | llm-suggested. Nullable. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN infrastructure_points.decommissioning_status IS
  'Target-side decommissioning vocabulary. Allowed values not-applicable | proposed | decommissioned. Nullable. Spec: Target Architecture Authoring Flow (2026-05-20).';
