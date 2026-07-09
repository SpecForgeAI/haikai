-- ============================================================================
-- 206: API Behaviour comparison waivers (Spec 2026-07-06-j — Parity Exactness
-- & First-Class SOAP, Code-Tier Oracle Program).
--
-- Durable, reasoned tolerance records consumed by the reconcile comparator.
-- An "exact" verdict is exact-modulo-THESE-ROWS, and the rows are visible,
-- editable data — replacing the comparator's fixed in-code header allowlist.
--
--   scope      — 'global' (project_id NULL) or 'project'.
--   dimension  — 'header' | 'body_path' | 'xml_xpath' | 'ordering_path'
--                | 'break_fingerprint' (Spec I interim per-break waivers ride
--                the same table).
--   target     — the waived name/path/pointer/fingerprint (headers lowercase).
--
-- The 16 legacy allowlisted header names (VOLATILE_HEADER_NAMES in the
-- reconcile comparator, verbatim) are SEEDED as global rows (provenance
-- 'seed:legacy-allowlist') so today's tolerance survives the switch, now
-- visible and deletable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS api_behaviour_comparison_waivers (
    id          UUID PRIMARY KEY,
    project_id  UUID,
    scope       TEXT NOT NULL DEFAULT 'project',
    dimension   TEXT NOT NULL,
    target      TEXT NOT NULL,
    reason      TEXT NOT NULL,
    author      TEXT,
    provenance  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_abcw_dimension CHECK (dimension IN
        ('header', 'body_path', 'xml_xpath', 'ordering_path', 'break_fingerprint')),
    CONSTRAINT chk_abcw_scope CHECK (scope IN ('global', 'project'))
);

CREATE INDEX IF NOT EXISTS idx_abcw_project ON api_behaviour_comparison_waivers (project_id);

-- Seed the legacy header allowlist as visible global waivers (idempotent).
INSERT INTO api_behaviour_comparison_waivers
    (id, project_id, scope, dimension, target, reason, author, provenance)
SELECT gen_random_uuid(), NULL, 'global', 'header', seed.name,
       'Legacy in-code header allowlist (pre-2026-07-06-j): value drift on this header was always tolerated.',
       'system', 'seed:legacy-allowlist'
FROM (VALUES
    ('date'), ('age'), ('expires'), ('last-modified'), ('etag'),
    ('set-cookie'), ('x-request-id'), ('x-correlation-id'), ('x-trace-id'),
    ('request-id'), ('trace-id'), ('x-runtime'), ('x-response-time'),
    ('server-timing'), ('keep-alive'), ('content-length')
) AS seed(name)
WHERE NOT EXISTS (
    SELECT 1 FROM api_behaviour_comparison_waivers w
    WHERE w.scope = 'global' AND w.dimension = 'header' AND w.target = seed.name
);
