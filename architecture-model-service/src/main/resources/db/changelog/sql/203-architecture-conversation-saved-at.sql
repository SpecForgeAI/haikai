-- 203-architecture-conversation-saved-at.sql
-- Spec: Target-State Conversation -- Save, Resume, and Plan Sourcing Decoupled
-- from "Active" (2026-06-26) -- Task Group 1 (FR1).
--
-- Adds the single save-marker column that turns a target-state architect
-- conversation into a saveable / resumable / listable object, decoupled from
-- promoting a draft to "active". The "Save Conversation" action stamps
-- conversation_saved_at = now() on the target architecture row; the
-- most-recent-saved / list-saved finders and the plan's saved-conversation
-- sourcing all key off this timestamp:
--
--   architecture:
--     - conversation_saved_at TIMESTAMPTZ NULL -- the instant the target-state
--       conversation was last saved. NULL = never saved (the common pre-spec
--       case). Applies to kind='target' rows in practice, but the column is
--       unconditional (mirrors last_marked_stale_at / changeset 147).
--
-- Defer conversation_status entirely -- the timestamp drives every query (a
-- saved row IS NOT NULL; ordering is conversation_saved_at DESC).
--
-- NULLABLE, no backfill: every existing architecture row (current AND target,
-- active AND draft) reads conversation_saved_at back null = "never saved". No
-- retroactive save semantics. Boxed Instant on the Java side
-- (project_primitive_double_dto_overwrite.md) so a null-safe PATCH never wipes
-- the column.
--
-- The codebase convention is TIMESTAMPTZ (as used by 198 / 178 / 135 against
-- real PostgreSQL). The H2 @DataJpaTest datasource aliases TIMESTAMPTZ ->
-- TIMESTAMP WITH TIME ZONE, and the focused changeset test registers the same
-- domain alias, so the unmodified production DDL applies in tests too.
--
-- NEW changeset only -- never edit applied changesets (<= 202) per
-- feedback_liquibase_immutable_changesets.md. Registered AFTER 202 with the
-- not-columnExists precondition idiom (onFail MARK_RAN) so a re-run is a clean
-- no-op (mirrors 198 / 201 / 202).

ALTER TABLE architecture ADD COLUMN conversation_saved_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN architecture.conversation_saved_at IS
  'Instant the target-state architect conversation was last saved (the "Save Conversation" action stamps now()). NULL = never saved. Drives the most-recent-saved / list-saved finders and the plan''s saved-conversation sourcing. Spec: Target-State Conversation Save/Resume/Plan-Sourcing (2026-06-26).';
