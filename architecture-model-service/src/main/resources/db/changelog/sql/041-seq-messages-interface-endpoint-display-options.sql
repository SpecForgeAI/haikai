-- ============================================================================
-- Migration 041: Add endpoint display option columns to sequence_messages table
-- Spec: Sequence Diagram Interface Endpoint Message Exchange Display and Endpoint Response
--
-- Adds 3 boolean display flags and 1 response mode text column to control
-- how InterfaceEndpoint references are rendered on sequence diagram arrows.
-- Defaults: all show flags FALSE, response_mode 'normal'.
-- ============================================================================

ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS show_endpoint_name BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS show_endpoint_verb_path BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS show_endpoint_req_res_data BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS response_mode TEXT NOT NULL DEFAULT 'normal';
