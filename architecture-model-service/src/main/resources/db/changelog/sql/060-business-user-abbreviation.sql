-- Add abbreviation column to business_users table.
-- Stores a short abbreviation (typically initials) for compact display in diagrams.
-- NOT NULL: all business users must have an abbreviation assigned.
ALTER TABLE business_users ADD COLUMN abbreviation TEXT NOT NULL DEFAULT '';
