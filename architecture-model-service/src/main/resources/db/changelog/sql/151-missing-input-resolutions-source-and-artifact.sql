-- 151-missing-input-resolutions-source-and-artifact.sql
-- Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1
--
-- Adds two provenance columns to `missing_input_resolutions` (created by
-- changeset 148 from the Missing Input Resolver Flow spec) so the bulk-resolve
-- OAS/WSDL upload path can stamp where each resolution came from:
--
--   * resolution_source    -- VARCHAR(32), nullable. Open vocabulary stamped
--                            by the service layer. Current values:
--                              'manual'           -- entered via the bulk-
--                                                   resolve modal manual-entry
--                                                   path (pre-existing rows
--                                                   are backfilled to this).
--                              'oas_wsdl_upload'  -- created by the new
--                                                   parse-files endpoint.
--                            NO DB CHECK constraint is declared by design --
--                            the vocabulary stays open so future resolution
--                            sources (Postman collections, GraphQL SDL, etc.)
--                            can be added without a schema migration. The
--                            service layer is responsible for cooperative
--                            enforcement of valid values.
--   * project_artifact_id  -- UUID, nullable. FK to `project_artifact(id)`
--                            with ON DELETE SET NULL. Back-references the
--                            uploaded OAS/WSDL file the resolution was derived
--                            from. NULL for manual-entry rows (no source
--                            artefact) and NULL for orphan rows whose source
--                            artefact has since been deleted.
--                            ON DELETE SET NULL is chosen so that deleting a
--                            project_artifact leaves the resolution row intact
--                            (audit trail preserved) -- the resolution simply
--                            loses its back-reference. Per
--                            project_pg_deferrable_set_null_action.md, ON
--                            DELETE SET NULL fires immediately at DELETE time
--                            (not deferred to commit); capture-and-restore
--                            flows that DELETE+re-INSERT a project_artifact
--                            row will null out the back-reference unless they
--                            capture+restore project_artifact_id on the
--                            resolution row in the same transaction.
--
-- Backfill: every pre-existing row in `missing_input_resolutions` (created
-- via the manual-entry bulk-resolve modal before this changeset shipped) is
-- stamped with resolution_source='manual'. The project_artifact_id stays
-- NULL on those rows because manual-entry rows never have a source artefact.
--
-- Boxed types on the entity (String, UUID) per
-- project_primitive_double_dto_overwrite.md.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 150 are not edited.

ALTER TABLE missing_input_resolutions
  ADD COLUMN resolution_source VARCHAR(32) NULL,
  ADD COLUMN project_artifact_id UUID NULL;

ALTER TABLE missing_input_resolutions
  ADD CONSTRAINT fk_mir_project_artifact
  FOREIGN KEY (project_artifact_id)
  REFERENCES project_artifact(id)
  ON DELETE SET NULL;

-- Backfill pre-existing rows. Every pre-existing row was created via the
-- manual-entry bulk-resolve modal before the parse-files endpoint shipped,
-- so 'manual' is the correct provenance value. New rows created by the
-- parse-files endpoint are stamped 'oas_wsdl_upload' at service-layer write
-- time.
UPDATE missing_input_resolutions
  SET resolution_source = 'manual'
  WHERE resolution_source IS NULL;

COMMENT ON COLUMN missing_input_resolutions.resolution_source IS
  'Open-vocabulary provenance stamp written by the service layer. Current values: manual (entered via the bulk-resolve modal manual-entry path), oas_wsdl_upload (created by the parse-files endpoint). No DB CHECK constraint by design so future sources can be added without schema migration. Boxed String on the entity per project_primitive_double_dto_overwrite. Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN missing_input_resolutions.project_artifact_id IS
  'FK back-reference to the project_artifact row holding the uploaded OAS/WSDL file the resolution was derived from. NULL for manual-entry rows (no source artefact) and NULL after the source artefact is deleted (FK declared ON DELETE SET NULL so the audit row survives). Boxed UUID on the entity. Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1.';
