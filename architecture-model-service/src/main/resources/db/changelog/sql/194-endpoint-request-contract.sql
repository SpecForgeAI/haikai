-- ============================================================================
-- Per-endpoint request-contract capture for Discovery (Spec: 2026-06-19) --
-- Task Group 1.
--
-- Adds ONE nullable `request_contract` JSONB column to the EXISTING `endpoints`
-- table (created by an applied changeset, which is NEVER edited -- comment-only
-- edits also break startup via Liquibase checksum validation; this is a NEW
-- changeset only). Mirrors the 168-endpoint-response-contract.sql precedent
-- exactly (a nullable JSONB column on an existing table, via the Hypersistence
-- @Type(JsonType.class) Map<String,Object> idiom in the JPA entity).
--
-- `request_contract` carries the per-endpoint REQUEST CONTRACT -- how a
-- correctly-formatted request to the endpoint is constructed: request
-- content-type, required headers, request param/field date-formats, and
-- request-field validation -- as METADATA ON THE ENTITY, NOT as a new entity
-- type or relationship. It is mined from code evidence (code-scan provenance)
-- and is NON-REVIEWED (no accept/reject lifecycle). It is a STRUCTURED JSON
-- passthrough: typed enough for downstream OAS enrichment to read it
-- key-by-key, loose enough that the block shape evolves freely. Top-level shape:
--   {
--     content_type:        "<request media type>",
--     consumes:            [ "<request media type>", ... ],
--     required_headers:    [ { name, source } ],
--     param_formats:       [ { name, location, format, pattern, source } ],
--     request_validation:  [ { field, constraint, failure_status, message } ],
--     provenance:          { source_files[], method_id },  -- 'code-scan'
--     confidence:          <double 0..1>,
--     schema_version:      "request-contract.v1"
--   }
--
-- The block embeds its OWN internal `schema_version` INSIDE the JSONB blob -- it
-- is deliberately NOT a separate column, so the block shape can evolve without a
-- schema migration. This mirrors the 168-endpoint-response-contract.sql
-- precedent.
--
-- The embedded `confidence` is a DOUBLE PRECISION value INSIDE the JSONB and is
-- mapped to a boxed `Double` in the JPA entity / DTO so a PATCH carrying no value
-- preserves null rather than wiping to 0.0 (per
-- project_primitive_double_dto_overwrite.md). There is NO separate confidence
-- column -- confidence lives inside the request-contract block.
--
-- Additive + nullable: existing `endpoints` rows have no request contract, so a
-- null/absent `request_contract` round-trips cleanly.
-- ============================================================================

ALTER TABLE endpoints ADD COLUMN request_contract JSONB;

COMMENT ON COLUMN endpoints.request_contract IS
    'Per-endpoint REQUEST CONTRACT block (code-scan provenance, non-reviewed): request content_type/consumes[], required_headers[], param_formats[], request_validation[], provenance, a boxed-Double confidence, and an internal schema_version, all INSIDE the one JSONB blob (no separate columns). Mirrors response_contract. Spec: Request Contract from Code Evidence (2026-06-19), Task Group 1.';
