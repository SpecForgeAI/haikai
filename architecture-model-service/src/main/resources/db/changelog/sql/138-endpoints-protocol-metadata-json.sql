-- 138-endpoints-protocol-metadata-json.sql
-- Spec: SOAP Discovery -- Spring Classic Phase 1
--       (2026-05-17) -- Task Group 9
--
-- Adds a single `protocol_metadata_json` JSONB column to the AMS `endpoints`
-- table. All new SOAP `data` fields emitted by the Spring Classic SOAP
-- finding scanner (`soap_action`, `request_root_element`,
-- `request_namespace`, `response_root_element`, `request_dto_class`,
-- `response_dto_class`, `wsdl_source`) ride inside this blob.
--
-- Promotion to explicit columns is deferred to a future spec when the UI
-- needs SOAP fields as sortable / filterable grid columns (per spec D-5).
--
-- Backfill: existing rows backfill to NULL (column added as nullable).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 137 are not edited.

ALTER TABLE endpoints
  ADD COLUMN protocol_metadata_json JSONB NULL;

COMMENT ON COLUMN endpoints.protocol_metadata_json IS
  'Optional JSONB blob carrying protocol-specific metadata (e.g. SOAP soap_action, request_root_element, request_namespace, response_root_element, request_dto_class, response_dto_class, wsdl_source). Spec: SOAP Discovery -- Spring Classic Phase 1 (2026-05-17).';
