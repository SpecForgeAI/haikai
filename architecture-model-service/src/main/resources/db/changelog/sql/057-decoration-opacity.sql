-- Add background_opacity and border_opacity columns to diagram_decorations
-- These store opacity values (0-100) for shape decorations.
-- Previously these were only applied at render time from frontend defaults,
-- meaning they were lost on reload.

ALTER TABLE diagram_decorations ADD COLUMN IF NOT EXISTS background_opacity INTEGER;
ALTER TABLE diagram_decorations ADD COLUMN IF NOT EXISTS border_opacity INTEGER;
