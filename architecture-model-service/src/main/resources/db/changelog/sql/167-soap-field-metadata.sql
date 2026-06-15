-- ============================================================================
-- SOAP/WSDL message-field depth for Discovery (Spec: 2026-05-30 SOAP/WSDL
-- Message-Field Depth) -- Task Group 1.
--
-- Two additive, nullable columns on EXISTING tables (each created by an applied
-- changeset, which is NEVER edited -- this is a NEW changeset only). Mirrors the
-- 164-physical-entity-constraints-jsonb.sql precedent (a single nullable JSONB
-- column on an existing data entity, via the Hypersistence @Type(JsonType.class)
-- Map<String,Object> idiom in the JPA entity) and the 161-endpoint-data-effects.sql
-- JSONB idiom.
--
-- 1. logical_data_attributes.field_metadata (JSONB) -- the SINGLE structured
--    metadata blob ON the attribute (NOT ~8 typed columns). Carries:
--      cardinality:   { min_occurs, max_occurs, is_collection }
--      restrictions:  { enumeration[], pattern, minLength, maxLength,
--                       minInclusive, maxInclusive, totalDigits, fractionDigits }
--      xsd_type:      the XSD source-type string (captured AS-IS, no normalization)
--    is_nullable STAYS a real Boolean column mapped from XSD `nillable`
--    (present-but-null) and is NOT touched/overloaded here -- cardinality
--    (min_occurs=0 = optional) lives in this blob, kept DISTINCT from nullability.
--
-- 2. logical_data_entities.source_provenance (TEXT) -- a small provenance string
--    on each minted SOAP message entity: source namespace / originating DTO
--    class name (e.g. "http://example.com/orders :: com.example.Foo").
--
-- Both additive + nullable: existing rows carry no value, so a null/absent value
-- round-trips cleanly. Boxed reference types in the JPA entity/DTO so a PATCH
-- carrying no value preserves the existing column content (per
-- project_primitive_double_dto_overwrite.md).
-- ============================================================================

ALTER TABLE logical_data_attributes ADD COLUMN field_metadata JSONB;

ALTER TABLE logical_data_entities ADD COLUMN source_provenance TEXT;
