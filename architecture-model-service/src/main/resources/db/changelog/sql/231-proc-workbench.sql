-- 231-proc-workbench.sql
-- Spec: Stored Proc & Function Behaviour Program, Spec 4 (2026-09-09) --
-- translation workbench loop.
--
-- The workbench turns the translation queue from "draft + judge verdict" into
-- a REASONED LOOP: each routine is translated, applied to a built target and
-- reconciled against the pinned proc behaviour baseline (changeset 230), with
-- every attempt kept as evidence. Four pieces of state land here:
--
--   * db_migration_pack_translations + loop columns -- where the routine is in
--     the loop, which attempt is currently running, which attempt is the BEST
--     one so far, the rolled-up verdict, the parity report backing it and why
--     the row went stale.
--   * db_migration_pack_translation_attempts -- the append-only attempt
--     history (draft, judge verdict, apply result, parity report, verdict,
--     the evidence rung the attempt was given and any human guidance).
--   * db_migration_pack_target_builds -- the schema / data / translations
--     build of the TARGET database the loop applies drafts against.
--   * proc_parity_reports -- the comparator's per-scenario verdict reports,
--     from the workbench, from execution and from manual runs.
--
-- Snake_case wire (AMS default -- NO @CamelCaseWire on these DTOs/entities).
--
-- NEW changeset only -- applied changesets (<= 230) are never edited
-- (feedback_liquibase_immutable_changesets.md).

-- ---------------------------------------------------------------------------
-- 1. Loop columns on the existing translation queue.
-- ---------------------------------------------------------------------------
ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS loop_status varchar(32) NOT NULL DEFAULT 'idle';

ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS current_attempt_no int NOT NULL DEFAULT 0;

ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS best_attempt_no int NULL;

ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS verdict_json jsonb NULL;

ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS parity_report_id uuid NULL;

ALTER TABLE db_migration_pack_translations
  ADD COLUMN IF NOT EXISTS stale_reason varchar(64) NULL;

ALTER TABLE db_migration_pack_translations
  DROP CONSTRAINT IF EXISTS chk_dmpt_loop_status;

ALTER TABLE db_migration_pack_translations
  ADD CONSTRAINT chk_dmpt_loop_status CHECK (loop_status IN (
    'idle', 'queued', 'translating', 'applying', 'reconciling', 'reconciled',
    'exhausted', 'apply_failed', 'unverified', 'stale', 'blocked_by_callee',
    'dispositioned'));

COMMENT ON COLUMN db_migration_pack_translations.loop_status IS
  'Workbench loop state (Spec 4, 2026-09-09): idle | queued | translating | applying | reconciling | reconciled | exhausted | apply_failed | unverified | stale | blocked_by_callee | dispositioned. Enforced by chk_dmpt_loop_status. ORTHOGONAL to pipeline_state / review_status / disposition.';

COMMENT ON COLUMN db_migration_pack_translations.current_attempt_no IS
  'Attempt number the loop is currently on (0 = never attempted); capped by PROC_TRANSLATE_ATTEMPT_CAP in the gateway.';

COMMENT ON COLUMN db_migration_pack_translations.best_attempt_no IS
  'On exhaustion, the attempt with the fewest failing scenarios -- its draft becomes draft_content.';

COMMENT ON COLUMN db_migration_pack_translations.verdict_json IS
  'Rolled-up loop verdict for the row (match n of m, divergent dimensions, blocking callee, ...).';

COMMENT ON COLUMN db_migration_pack_translations.parity_report_id IS
  'proc_parity_reports.id backing the current verdict (NULL when never reconciled).';

COMMENT ON COLUMN db_migration_pack_translations.stale_reason IS
  'Why the row went stale (source body changed, baseline re-pinned, target rebuilt, ...).';

-- ---------------------------------------------------------------------------
-- 2. Attempt history: append-only evidence, one row per loop attempt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS db_migration_pack_translation_attempts (
    id                    uuid PRIMARY KEY,
    pack_id               uuid NOT NULL,
    translation_id        uuid NOT NULL,
    attempt_no            int NOT NULL,
    draft_content         text NULL,
    judge_verdict_json    jsonb NULL,
    apply_result_json     jsonb NULL,
    parity_report_id      uuid NULL,
    verdict               varchar(32) NOT NULL,
    evidence_rungs_json   jsonb NULL,
    guidance_text         text NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_dmpta_translation FOREIGN KEY (translation_id)
        REFERENCES db_migration_pack_translations (id) ON DELETE CASCADE,
    CONSTRAINT chk_dmpta_verdict CHECK (verdict IN (
        'reconciled', 'divergent', 'apply_failed', 'abi_mismatch',
        'overfit_suspected', 'blocked_by_callee', 'unverified', 'failed')),
    CONSTRAINT uq_dmpta_translation_attempt UNIQUE (translation_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS ix_dmpta_pack ON db_migration_pack_translation_attempts (pack_id);

COMMENT ON TABLE db_migration_pack_translation_attempts IS
  'One workbench loop attempt (Spec 4, 2026-09-09): the draft it produced, the judge verdict, the apply result, the parity report, the verdict, the evidence rung it was given and any human guidance. Append-only; unique per (translation, attempt_no).';

-- ---------------------------------------------------------------------------
-- 3. Target builds: the schema -> data -> translations build of the target DB
--    the loop applies drafts against.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS db_migration_pack_target_builds (
    id                  uuid PRIMARY KEY,
    pack_id             uuid NOT NULL,
    project_id          uuid NOT NULL,
    architecture_id     uuid NOT NULL,
    target_binding_json jsonb NULL,
    status              varchar(16) NOT NULL DEFAULT 'running',
    phases_json         jsonb NOT NULL DEFAULT '{}'::jsonb,
    s0_fingerprint_json jsonb NULL,
    pack_version        varchar(64) NULL,
    rebuild             boolean NOT NULL DEFAULT false,
    error               text NULL,
    started_at          timestamptz NOT NULL DEFAULT now(),
    ended_at            timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_dmptb_status CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS ix_dmptb_pack_started
    ON db_migration_pack_target_builds (pack_id, started_at);

COMMENT ON TABLE db_migration_pack_target_builds IS
  'One target-database build for a pack (Spec 4, 2026-09-09): the redacted target binding, per-phase progress (schema / data / translations), the loaded S0 fingerprint and whether it was a rebuild (Liquibase drop-all first).';

-- ---------------------------------------------------------------------------
-- 4. Proc parity reports: the comparator's per-scenario verdicts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proc_parity_reports (
    id                    uuid PRIMARY KEY,
    project_id            uuid NOT NULL,
    architecture_id       uuid NOT NULL,
    pack_id               uuid NULL,
    routine_id            uuid NOT NULL,
    baseline_id           uuid NULL,
    translation_attempt_id uuid NULL,
    purpose               varchar(16) NOT NULL,
    status                varchar(32) NOT NULL,
    migration_pair        varchar(64) NULL,
    ruleset_version       int NULL,
    summary_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    report_json           jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_ppr_purpose CHECK (purpose IN ('workbench', 'execution', 'manual')),
    CONSTRAINT chk_ppr_status CHECK (status IN (
        'clean', 'clean_with_waivers', 'divergent', 'unverifiable'))
);

CREATE INDEX IF NOT EXISTS ix_ppr_arch_routine_created
    ON proc_parity_reports (architecture_id, routine_id, created_at);

COMMENT ON TABLE proc_parity_reports IS
  'One proc-parity comparator run (Spec 4, 2026-09-09): per-routine, per-scenario verdicts against the pinned proc behaviour baseline. purpose = workbench (the translation loop) | execution (the migration run gate) | manual. The summary status / pair / ruleset version are lifted onto columns for the cheap latest-per-routine read; report_json holds the comparator body verbatim.';
