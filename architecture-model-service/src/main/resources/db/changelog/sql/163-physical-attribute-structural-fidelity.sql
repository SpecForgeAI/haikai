-- ============================================================================
-- Physical-attribute structural fidelity for Discovery (Spec: 2026-05-29 DB
-- Structural Fidelity) -- Task Group 1.
--
-- Adds nullable verbatim structural columns to the EXISTING
-- physical_data_attributes table (created by an applied changeset, which is
-- NEVER edited -- comment-only edits also break startup via Liquibase checksum
-- validation; this is a NEW changeset only).
--
-- Captures the like-for-like Sybase->Postgres schema-migration detail the scan
-- previously dropped or under-captured, ALONGSIDE the existing is_nullable /
-- is_primary_key:
--   source_type     -- the verbatim engine type string (NO normalization; the
--                      Sybase->Postgres type mapping is a downstream concern).
--   scale           -- numeric scale (INTEGER; boxed Integer in the JPA entity).
--   precision       -- numeric precision (INTEGER; boxed Integer).
--   column_default  -- the column default expression, verbatim (`default` is a
--                      SQL reserved word, so the column is named column_default
--                      consistently across SQL / entity / DTO).
--   ordinal         -- 1-based ordinal position of the column in the table.
--   is_identity     -- column-level identity / auto-increment flag.
--
-- All numerics are INTEGER mapped to a boxed Integer, and is_identity is mapped
-- to a boxed Boolean, so a PATCH carrying no value preserves the existing
-- column content rather than wiping to 0 / false (per
-- project_primitive_double_dto_overwrite.md).
--
-- Additive + nullable: existing physical_data_attributes rows carry none of
-- these, so null/absent values round-trip cleanly.
-- ============================================================================

ALTER TABLE physical_data_attributes ADD COLUMN source_type TEXT;
ALTER TABLE physical_data_attributes ADD COLUMN scale INTEGER;
ALTER TABLE physical_data_attributes ADD COLUMN precision INTEGER;
ALTER TABLE physical_data_attributes ADD COLUMN column_default TEXT;
ALTER TABLE physical_data_attributes ADD COLUMN ordinal INTEGER;
ALTER TABLE physical_data_attributes ADD COLUMN is_identity BOOLEAN;
