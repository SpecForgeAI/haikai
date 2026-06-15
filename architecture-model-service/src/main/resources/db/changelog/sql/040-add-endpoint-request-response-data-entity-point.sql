-- ============================================================================
-- Migration 040: Add request/response data entity point FK columns to endpoints
-- ============================================================================
-- Adds two nullable VARCHAR(64) FK columns to the endpoints table that reference
-- data_entity_points(id), allowing each endpoint to capture its request and
-- response data contract via Data Entity Point associations.
--
-- ON DELETE SET NULL ensures that deleting a referenced data entity point
-- nullifies the FK rather than cascading the delete to the endpoint row.
--
-- Spec: Metamodel Interface Endpoint - Add Request/Response Data and Simplify Endpoints Table
-- Task Group 1: Migration 040 - Add Request/Response FK Columns
-- ============================================================================

-- STEP 1: Add request_data_entity_point_id column
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS request_data_entity_point_id VARCHAR(64);

-- STEP 2: Add response_data_entity_point_id column
ALTER TABLE endpoints ADD COLUMN IF NOT EXISTS response_data_entity_point_id VARCHAR(64);

-- STEP 3: Add FK constraint for request_data_entity_point_id
ALTER TABLE endpoints ADD CONSTRAINT fk_ep_request_data_entity_point
FOREIGN KEY (request_data_entity_point_id) REFERENCES data_entity_points(id) ON DELETE SET NULL;

-- STEP 4: Add FK constraint for response_data_entity_point_id
ALTER TABLE endpoints ADD CONSTRAINT fk_ep_response_data_entity_point
FOREIGN KEY (response_data_entity_point_id) REFERENCES data_entity_points(id) ON DELETE SET NULL;
