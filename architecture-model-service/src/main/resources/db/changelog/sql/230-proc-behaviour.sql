-- 230-proc-behaviour.sql
-- Spec: Stored Proc & Function Behaviour Program, Spec 3 (2026-09-09) --
-- proc behaviour capture data model.
--
-- The second KIND of behaviour baseline. Where api_behaviour_* captures HTTP
-- envelopes against a running app, proc_behaviour_* captures routine call
-- envelopes (result sets, OUT params, messages, errors, state delta) fired at
-- S0 inside the derived compensation bracket, and pins the result as a proc
-- behaviour baseline that the workbench (Spec 4) and the execution check
-- (Spec 5) replay. Independent of any API session: no base URL, no API auth.
--
-- Snake_case wire (AMS default -- NO @CamelCaseWire on these DTOs).

-- ---------------------------------------------------------------------------
-- Sessions: one capture run over a scope of routines at a pinned S0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_capture_sessions (
    id                      uuid PRIMARY KEY,
    project_id              uuid NOT NULL,
    architecture_id         uuid NOT NULL,
    name                    varchar(255) NOT NULL,
    status                  varchar(32) NOT NULL DEFAULT 'draft',
    kind                    varchar(16) NOT NULL DEFAULT 'current',
    scope_routine_ids_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
    db_config_redacted_json jsonb NULL,
    session_profile_json    jsonb NULL,
    capture_tuning_json     jsonb NULL,
    coverage_summary_json   jsonb NULL,
    s0_fingerprint_json     jsonb NULL,
    started_at              timestamptz NULL,
    completed_at            timestamptz NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_pbcs_status CHECK (status IN (
        'draft', 'configured', 'running', 'completed',
        'completed_with_findings', 'failed', 'cancelled')),
    CONSTRAINT chk_pbcs_kind CHECK (kind IN ('current', 'target'))
);

CREATE INDEX IF NOT EXISTS ix_pbcs_architecture ON proc_behaviour_capture_sessions (architecture_id);
CREATE INDEX IF NOT EXISTS ix_pbcs_project ON proc_behaviour_capture_sessions (project_id);

COMMENT ON TABLE proc_behaviour_capture_sessions IS
  'Proc behaviour capture run (Spec 3, 2026-09-09): scope of routines, DB config (redacted), session profile, tuning, coverage roll-up and the S0 fingerprint the run was pinned against.';

-- ---------------------------------------------------------------------------
-- Scenarios: what we intend to fire, per routine. Deterministic seeds and the
-- LLM loop both land here BEFORE any fire (record-then-fire).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_scenarios (
    id                uuid PRIMARY KEY,
    session_id        uuid NOT NULL,
    routine_id        uuid NOT NULL,
    scenario_name     varchar(255) NOT NULL,
    scenario_type     varchar(32) NOT NULL,
    generation_source varchar(32) NOT NULL,
    inputs_json       jsonb NOT NULL DEFAULT '[]'::jsonb,
    sequence_json     jsonb NULL,
    status            varchar(16) NOT NULL DEFAULT 'proposed',
    exclusion_reason  text NULL,
    notes             text NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_pbs_session FOREIGN KEY (session_id)
        REFERENCES proc_behaviour_capture_sessions (id) ON DELETE CASCADE,
    CONSTRAINT chk_pbs_type CHECK (scenario_type IN (
        'happy_path', 'error_path', 'zero_rows', 'boundary',
        'null_param', 'default_param', 'business_edge', 'sequence')),
    CONSTRAINT chk_pbs_source CHECK (generation_source IN (
        'db_seed', 'llm_generated', 'llm_refined')),
    CONSTRAINT chk_pbs_status CHECK (status IN ('proposed', 'fired', 'excluded')),
    CONSTRAINT uq_pbs_session_routine_name UNIQUE (session_id, routine_id, scenario_name)
);

CREATE INDEX IF NOT EXISTS ix_pbs_session ON proc_behaviour_scenarios (session_id);
CREATE INDEX IF NOT EXISTS ix_pbs_session_routine ON proc_behaviour_scenarios (session_id, routine_id);

COMMENT ON TABLE proc_behaviour_scenarios IS
  'One intended routine call (Spec 3, 2026-09-09): deterministic seed or LLM-generated, recorded BEFORE the fire; unique per (session, routine, scenario_name).';

-- ---------------------------------------------------------------------------
-- Captures: what actually happened when a scenario was fired.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_captures (
    id                  uuid PRIMARY KEY,
    session_id          uuid NOT NULL,
    scenario_id         uuid NOT NULL,
    routine_id          uuid NOT NULL,
    attempt_number      int NOT NULL DEFAULT 1,
    envelope_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
    state_delta_json    jsonb NULL,
    volatile_cells_json jsonb NULL,
    bracket_outcome     varchar(32) NULL,
    duration_ms         bigint NULL,
    error_type          varchar(64) NULL,
    error_message       text NULL,
    accepted            boolean NOT NULL DEFAULT false,
    captured_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_pbc_session FOREIGN KEY (session_id)
        REFERENCES proc_behaviour_capture_sessions (id) ON DELETE CASCADE,
    CONSTRAINT fk_pbc_scenario FOREIGN KEY (scenario_id)
        REFERENCES proc_behaviour_scenarios (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_pbc_session ON proc_behaviour_captures (session_id);
CREATE INDEX IF NOT EXISTS ix_pbc_scenario ON proc_behaviour_captures (scenario_id);
CREATE INDEX IF NOT EXISTS ix_pbc_routine ON proc_behaviour_captures (routine_id);

COMMENT ON TABLE proc_behaviour_captures IS
  'One fired attempt (Spec 3, 2026-09-09): the routine envelope, the computed state delta, volatility evidence and the compensation bracket outcome.';

-- ---------------------------------------------------------------------------
-- Baselines: the pinned, replayable behaviour of the routine catalog.
-- ONE pinned per (architecture, kind) -- enforced in the service.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_baselines (
    id                  uuid PRIMARY KEY,
    session_id          uuid NULL,
    project_id          uuid NOT NULL,
    architecture_id     uuid NOT NULL,
    name                varchar(255) NOT NULL,
    status              varchar(16) NOT NULL DEFAULT 'draft',
    kind                varchar(16) NOT NULL DEFAULT 'current',
    s0_fingerprint_json jsonb NULL,
    content_hash        varchar(80) NULL,
    routine_count       int NOT NULL DEFAULT 0,
    scenario_count      int NOT NULL DEFAULT 0,
    pinned_at           timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_pbb_status CHECK (status IN ('draft', 'pinned', 'superseded')),
    CONSTRAINT chk_pbb_kind CHECK (kind IN ('current', 'target'))
);

CREATE INDEX IF NOT EXISTS ix_pbb_architecture ON proc_behaviour_baselines (architecture_id);
CREATE INDEX IF NOT EXISTS ix_pbb_session ON proc_behaviour_baselines (session_id);
CREATE INDEX IF NOT EXISTS ix_pbb_arch_kind_status ON proc_behaviour_baselines (architecture_id, kind, status);

COMMENT ON TABLE proc_behaviour_baselines IS
  'Pinned proc behaviour baseline (Spec 3, 2026-09-09). One pinned per (architecture, kind); pinning supersedes the previous pinned baseline of that kind.';

-- ---------------------------------------------------------------------------
-- Baseline items: the canonical expected envelope per scenario, keyed by the
-- routine body hash so a rewritten routine goes STALE loudly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_baseline_items (
    id                     uuid PRIMARY KEY,
    baseline_id            uuid NOT NULL,
    routine_id             uuid NOT NULL,
    routine_body_hash      varchar(80) NULL,
    scenario_id            uuid NULL,
    scenario_name          varchar(255) NOT NULL,
    scenario_type          varchar(32) NOT NULL,
    exit_outcome           varchar(64) NULL,
    inputs_json            jsonb NOT NULL DEFAULT '[]'::jsonb,
    sequence_json          jsonb NULL,
    expected_envelope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    state_delta_json       jsonb NULL,
    volatile_cells_json    jsonb NULL,
    business_notes         text NULL,
    stale                  boolean NOT NULL DEFAULT false,
    stale_reason           varchar(64) NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_pbbi_baseline FOREIGN KEY (baseline_id)
        REFERENCES proc_behaviour_baselines (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_pbbi_baseline ON proc_behaviour_baseline_items (baseline_id);
CREATE INDEX IF NOT EXISTS ix_pbbi_baseline_routine ON proc_behaviour_baseline_items (baseline_id, routine_id);

COMMENT ON TABLE proc_behaviour_baseline_items IS
  'One replayable expectation (Spec 3, 2026-09-09): inputs / sequence in, expected envelope + state delta out, carried with the routine body hash that produced it.';

-- ---------------------------------------------------------------------------
-- Diagnostics: why a routine or scenario is NOT in the baseline. Loud, always.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_behaviour_diagnostics (
    id              uuid PRIMARY KEY,
    session_id      uuid NOT NULL,
    routine_id      uuid NULL,
    diagnostic_type varchar(48) NOT NULL,
    message         text NULL,
    detail_json     jsonb NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_pbd_session FOREIGN KEY (session_id)
        REFERENCES proc_behaviour_capture_sessions (id) ON DELETE CASCADE,
    CONSTRAINT chk_pbd_type CHECK (diagnostic_type IN (
        'routine_skipped', 'non_compensatable', 'bracket_residue',
        'coverage_floor_unmet', 'excluded_by_user', 'not_possible',
        'captured_as_error', 'result_set_truncated', 'login_dependent'))
);

CREATE INDEX IF NOT EXISTS ix_pbd_session ON proc_behaviour_diagnostics (session_id);
CREATE INDEX IF NOT EXISTS ix_pbd_routine ON proc_behaviour_diagnostics (routine_id);

COMMENT ON TABLE proc_behaviour_diagnostics IS
  'Loud narration of every routine or scenario that did not make the baseline (Spec 3, 2026-09-09): refusals, residue, unmet floors, user exclusions.';
