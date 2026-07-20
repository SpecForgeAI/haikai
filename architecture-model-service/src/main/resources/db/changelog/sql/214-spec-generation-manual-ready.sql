-- 214: manual-ready marker on spec generations (Phase 1a, 2026-07-20).
--
-- A story may be tool-unresolvable; the user then SUPPLIES the spec (full or
-- edited) and marks the story ready — story by story, never bulk. The marker
-- is additive + audited; the stage gate (Phase 1b) treats
-- status IN ('generated','generated_with_warnings') OR manual_ready as
-- satisfied. Never set by the tool itself.

ALTER TABLE migration_story_spec_generations
    ADD COLUMN manual_ready BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE migration_story_spec_generations
    ADD COLUMN manual_ready_at TIMESTAMPTZ NULL;

ALTER TABLE migration_story_spec_generations
    ADD COLUMN manual_ready_by TEXT NULL;
