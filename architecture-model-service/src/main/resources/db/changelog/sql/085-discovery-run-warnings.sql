-- 085-discovery-run-warnings.sql
-- Spec: V3 Tier UX
--
-- Adds a nullable `warnings` TEXT column to the discovery_run table to persist the
-- JSON-encoded warnings array synthesized at run creation time by the V3 tier
-- gate in discovery-service (`POST /discovery/runs`).
--
-- Stored format: JSON-encoded `string[]` (e.g. `["Tier B warning text"]`), or NULL
-- when no warnings are emitted. The architecture-model-service does not parse the
-- array server-side; it is persisted and surfaced verbatim on the DTO.
--
-- TEXT (not JSONB) is used to match the existing Liquibase portability pattern.
-- Nullable so legacy rows remain valid and no backfill is required.

ALTER TABLE discovery_run ADD COLUMN warnings TEXT NULL;
