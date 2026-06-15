-- ============================================================================
-- Migration 039: Add is_collection column to sequence_messages table
-- Spec: Liquibase Migrations - Add Internal Classification and Sequence Message Collection
--
-- Adds is_collection BOOLEAN column to indicate if a message represents
-- a collection/loop of multiple items. Default FALSE for normal messages.
-- ============================================================================

ALTER TABLE sequence_messages ADD COLUMN IF NOT EXISTS is_collection BOOLEAN NOT NULL DEFAULT FALSE;
