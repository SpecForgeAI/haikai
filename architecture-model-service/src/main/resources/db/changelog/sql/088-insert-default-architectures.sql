-- ============================================================================
-- Migration 088: Insert Default Architecture Per Existing Project
-- Spec: Multi-Architecture Plumbing (Spec #1)
--
-- Inserts exactly one row into `architecture` per existing project, with:
-- - name = 'Default'
-- - id   = project.id  (deterministic, derived 1:1 from project.id)
--
-- Why architecture.id = project.id?
-- The spec calls for a "deterministic UUID derived from project.id (e.g.
-- uuid_generate_v5(project.id, 'multi-arch-default')) so re-runs are
-- idempotent". The literal 1:1 derivation `architecture.id = project.id`
-- satisfies all the same constraints:
--   - Deterministic per project: yes (the project's own UUID).
--   - Idempotent on re-run:      yes (INSERT ... WHERE NOT EXISTS skips
--                                     the second run).
--   - Portable to H2/Postgres:   yes (no extension needed; uuid_generate_v5
--                                     would require pgcrypto/uuid-ossp).
-- The only practical implication is that for the migrated `Default`
-- architecture you will see the same UUID value as its parent project --
-- this is intentional and documented. New architectures created via the
-- post-spec-#3 CRUD flow will have fresh random UUIDs.
--
-- Idempotency: the INSERT uses `WHERE NOT EXISTS (... WHERE name='Default')`,
-- so re-running this changeset is a no-op (zero rows inserted).
-- ============================================================================

INSERT INTO architecture (id, project_id, name, description, archived, created_at, updated_at)
SELECT
    p.id,
    p.id,
    'Default',
    NULL,
    FALSE,
    p.created_at,
    p.updated_at
FROM project p
WHERE NOT EXISTS (
    SELECT 1 FROM architecture a
    WHERE a.project_id = p.id AND a.name = 'Default'
);
