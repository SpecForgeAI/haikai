-- 147-architecture-last-marked-stale-at.sql
-- Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3
--
-- Adds the `last_marked_stale_at` discriminator column on `architecture` so
-- the AMS-side debounce for the stale-marking pipeline has a durable anchor.
--
--   * last_marked_stale_at -- TIMESTAMPTZ-equivalent (TIMESTAMP WITH TIME ZONE),
--                             NULLABLE. Stamped every time the active-target
--                             save path successfully invokes the stale-mark
--                             pipeline. Consulted on the next save: if the
--                             elapsed gap is < N seconds (default 5s in v1)
--                             the stale-mark is skipped; else fire it.
--                             Promotions ignore this stamp (they always fire).
--
-- Nullable on insert so existing rows do not need a backfill. Boxed `Instant`
-- on the JPA entity per project_primitive_double_dto_overwrite -- a PATCH that
-- omits the field never silently wipes the column.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 146 are not edited.

ALTER TABLE architecture
  ADD COLUMN last_marked_stale_at TIMESTAMP WITH TIME ZONE NULL;

COMMENT ON COLUMN architecture.last_marked_stale_at IS
  'Timestamp of the last successful stale-mark invocation against this architecture as the active target. Drives the AMS-side debounce: if a save arrives within N seconds (default 5s in v1) of this stamp, the stale-mark is skipped. Promotions always fire regardless. Nullable so existing rows survive without backfill. Spec: Target Architecture Authoring Flow (2026-05-20).';
