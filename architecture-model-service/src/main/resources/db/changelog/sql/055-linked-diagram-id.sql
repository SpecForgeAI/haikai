-- Add linked_diagram_id column to diagram_nodes, diagram_edges, and diagram_decorations
-- Supports cross-diagram navigation links on nodes, edges, and decorations

ALTER TABLE diagram_nodes ADD COLUMN IF NOT EXISTS linked_diagram_id TEXT;

ALTER TABLE diagram_edges ADD COLUMN IF NOT EXISTS linked_diagram_id TEXT;

ALTER TABLE diagram_decorations ADD COLUMN IF NOT EXISTS linked_diagram_id TEXT;
