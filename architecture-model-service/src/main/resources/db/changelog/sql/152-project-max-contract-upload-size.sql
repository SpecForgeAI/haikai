-- 152-project-max-contract-upload-size.sql
-- Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1
--
-- Adds a per-project configuration column on the `project` table to drive the
-- file-size cap for OAS/WSDL contract uploads on the new parse-files endpoint:
--
--   * max_contract_upload_file_size_mb -- INTEGER, nullable, DB DEFAULT 10.
--                                         Maximum size (in megabytes) per
--                                         uploaded contract file. The new
--                                         parse-files endpoint enforces this
--                                         cap BEFORE reading bytes into memory;
--                                         over-cap files are marked failed with
--                                         reason `file_size_exceeded` and never
--                                         consume parser memory. The frontend
--                                         project-settings screen exposes this
--                                         as a single integer input under the
--                                         new "Uploads" section.
--
-- The column is nullable so the entity exposes it as a BOXED Integer per
-- project_primitive_double_dto_overwrite.md. Jackson maps a missing JSON field
-- on a PATCH to the primitive default (0), which would silently wipe an
-- explicit user setting -- boxed fields plus null-guarded update handlers
-- protect against this. The DB DEFAULT of 10 supplies the documented fallback
-- for both newly-created projects and the bulk backfill of every pre-existing
-- row (since Postgres 11 any column added with a DEFAULT is back-filled by
-- ALTER TABLE in a metadata-only operation that does not rewrite the table).
--
-- Two-layer defaulting posture: AMS reads this column via ProjectRepository
-- in the parse-files endpoint; if the value is null (which should not happen
-- given the DB DEFAULT but is defensively handled per the spec's "defence in
-- depth" note) the endpoint falls back to a 10MB constant in code. The
-- gateway proxy mirrors the same fallback when sizing its multer `limits.
-- fileSize`.
--
-- Coordination with prior project-config changeset 143 (Cross-Story Context
-- Injection -- Task Group 9): that changeset added per_story_context_token_cap
-- / cross_story_context_token_cap / auto_run_pass_2. This changeset is purely
-- additive on the same `project` table; no overlap with those columns.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changeset 143 is not edited.

ALTER TABLE project
  ADD COLUMN max_contract_upload_file_size_mb INTEGER NULL DEFAULT 10;

COMMENT ON COLUMN project.max_contract_upload_file_size_mb IS
  'Per-project cap (in megabytes) on the size of each individual OAS/WSDL contract file uploaded to the parse-files endpoint. DB DEFAULT 10. Boxed Integer on the entity so PATCH preserves null per project_primitive_double_dto_overwrite. The endpoint enforces the cap BEFORE reading bytes into memory; over-cap files are marked failed with reason file_size_exceeded. Defence-in-depth fallback: if the column is null (should not happen given DB DEFAULT), the endpoint and the gateway proxy both fall back to a 10MB constant in code. Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 1.';
