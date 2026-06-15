-- ============================================================================
-- Task Group 4: Normalize diagram_type Values in Diagrams Table
-- Canonicalizes existing diagram_type values to consistent casing:
-- "General", "ER", "Sequence", "Activity", "State"
-- This migration is idempotent and safe to re-run.
-- ============================================================================

-- ============================================================================
-- NORMALIZE DIAGRAM_TYPE VALUES
-- ============================================================================

UPDATE diagrams
SET diagram_type =
  CASE
    WHEN diagram_type IS NULL THEN NULL
    WHEN UPPER(TRIM(diagram_type)) = 'GENERAL' THEN 'General'
    WHEN UPPER(TRIM(diagram_type)) = 'ER' THEN 'ER'
    WHEN UPPER(TRIM(diagram_type)) = 'SEQUENCE' THEN 'Sequence'
    WHEN UPPER(TRIM(diagram_type)) = 'ACTIVITY' THEN 'Activity'
    WHEN UPPER(TRIM(diagram_type)) = 'STATE' THEN 'State'
    ELSE TRIM(diagram_type)
  END;
