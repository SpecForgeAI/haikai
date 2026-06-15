-- Add text_text_decoration column to diagram_decorations
-- Supports underline text styling on decoration shapes

ALTER TABLE diagram_decorations ADD COLUMN IF NOT EXISTS text_text_decoration TEXT;
