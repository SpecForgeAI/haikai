-- Add abbreviation column to applications table.
-- Stores a short abbreviation (typically initials) for compact display in diagrams.
-- NOT NULL: all applications must have an abbreviation assigned.
ALTER TABLE applications ADD COLUMN abbreviation TEXT NOT NULL DEFAULT '';
