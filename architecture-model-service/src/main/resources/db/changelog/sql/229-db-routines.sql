-- 229-db-routines.sql
-- Spec: Stored Proc & Function Behaviour Program, Spec 1 (2026-09-09) --
-- routine catalog.
--
-- Stored procedures, functions and triggers become FIRST-CLASS facts. Until
-- now they existed only as findings (size-capped, redacted bodies) and as
-- translation-queue rows; no parameter metadata existed anywhere. The DB scan
-- writes one row per harvested routine at completion (fail-soft, loud), keyed
-- by (architecture, schema, name, kind). Bodies are UNBOUNDED text (the 64KB
-- finding cap no longer applies); signature / profile / closures are jsonb
-- produced by the engine pack's deterministic profiler. Snake_case wire (AMS
-- default -- NO @CamelCaseWire).

CREATE TABLE IF NOT EXISTS db_routines (
    id                          uuid PRIMARY KEY,
    project_id                  uuid NOT NULL,
    architecture_id             uuid NOT NULL,
    discovery_run_id            uuid NULL,
    schema_name                 varchar(128) NOT NULL,
    routine_name                varchar(255) NOT NULL,
    routine_kind                varchar(16) NOT NULL,
    language                    varchar(32) NULL,
    full_body                   text NOT NULL,
    body_hash                   varchar(80) NOT NULL,
    body_md5                    varchar(40) NULL,
    params_json                 jsonb NOT NULL DEFAULT '[]'::jsonb,
    returns_type                varchar(255) NULL,
    trigger_on_table            varchar(255) NULL,
    trigger_events_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
    profile_json                jsonb NOT NULL DEFAULT '{}'::jsonb,
    reads_json                  jsonb NOT NULL DEFAULT '[]'::jsonb,
    writes_json                 jsonb NOT NULL DEFAULT '[]'::jsonb,
    proc_calls_json             jsonb NOT NULL DEFAULT '[]'::jsonb,
    reads_closure_json          jsonb NOT NULL DEFAULT '[]'::jsonb,
    writes_closure_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
    trigger_expanded_writes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    source                      varchar(16) NOT NULL DEFAULT 'live',
    signature_parsed            boolean NOT NULL DEFAULT true,
    signature_error             text NULL,
    harvested_at                timestamptz NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_db_routines_kind CHECK (routine_kind IN ('procedure', 'function', 'trigger')),
    CONSTRAINT uq_db_routines_natural UNIQUE (architecture_id, schema_name, routine_name, routine_kind)
);

CREATE INDEX IF NOT EXISTS ix_db_routines_arch_kind ON db_routines (architecture_id, routine_kind);
CREATE INDEX IF NOT EXISTS ix_db_routines_project ON db_routines (project_id);

COMMENT ON TABLE db_routines IS
  'Routine catalog (Stored Proc & Function Behaviour Program, Spec 1, 2026-09-09): one row per harvested proc / function / trigger with the FULL body, parsed signature, static profile and read/write closures. Written by the DB scan at completion.';

-- The translation queue links back to the routine it was seeded from.
ALTER TABLE db_migration_pack_translations ADD COLUMN IF NOT EXISTS routine_id uuid NULL;
CREATE INDEX IF NOT EXISTS ix_dmpt_routine_id ON db_migration_pack_translations (routine_id);

COMMENT ON COLUMN db_migration_pack_translations.routine_id IS
  'db_routines.id the source body was seeded from (Spec 1, 2026-09-09); NULL = seeded from a finding snippet or a kind the catalog does not cover.';
