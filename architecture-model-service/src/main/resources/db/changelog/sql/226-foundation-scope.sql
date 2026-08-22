-- ============================================================================
-- Foundations & Scope program, Spec 1 (2026-08-22) — the scope data plane.
--
-- (1) TWO nullable columns on the EXISTING physical_data_entities table
--     (never edit applied changesets; mirrors the 164 precedent):
--       migration_scope     — 'in_scope' | 'excluded' | 'volatile' |
--                             'data_only'; NULL means in_scope (safe
--                             default — decisions never block).
--       scope_decision_ref  — the foundation decision key ('F-1') that set
--                             the scope; receipts on every screen cite it.
--     Exclusion is a TAG, never a deletion: current-state keeps excluded
--     entities (factual record + the S0 fingerprint verifier resolves table
--     metadata from the model). Target-side stages filter scope through the
--     per-service accessor pair (inScopeEntities/allEntities).
--
-- (2) foundation_decisions — durable, additive adjudication facts produced
--     by the Foundations Review (rule-level answers with provenance +
--     evidence hash; re-scans reopen a question ONLY when its evidence
--     hash changed). Wire is snake_case (AMS global).
-- ============================================================================

ALTER TABLE physical_data_entities ADD COLUMN migration_scope VARCHAR(32);
ALTER TABLE physical_data_entities ADD COLUMN scope_decision_ref VARCHAR(64);

CREATE TABLE foundation_decisions (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    architecture_id VARCHAR(64) NOT NULL,
    -- Human-facing decision key, unique per architecture ('F-1', 'F-2', ...).
    decision_key VARCHAR(32) NOT NULL,
    -- Deterministic rule that raised the question ('backup_copy',
    -- 'temp_working', 'key_posture', 'engine_hazard', 'crud_matrix', ...).
    rule_key VARCHAR(64) NOT NULL,
    -- The question as shown to the operator (audit trail).
    question_text TEXT,
    -- The chosen answer ('exclude_all', 'promote_pk', 'keyless_multiset',
    -- 'keep', ... — rule-specific vocabulary).
    answer VARCHAR(64) NOT NULL,
    -- Scope level the answer applies to targets ('excluded', 'volatile',
    -- 'data_only', 'in_scope') — NULL for answers that set no scope
    -- (e.g. key-policy-only decisions).
    scope VARCHAR(32),
    -- Target entity names/ids + per-target overrides (JSON array).
    targets_json JSONB NOT NULL,
    -- Rule-specific payload (key columns for a promotion, tolerances, ...).
    payload_json JSONB,
    rationale TEXT,
    -- Hash of the evidence the answer was based on; a re-scan that changes
    -- the evidence flips `stale` instead of silently dropping the answer.
    evidence_hash VARCHAR(128),
    stale BOOLEAN NOT NULL DEFAULT FALSE,
    decided_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_foundation_decisions_key UNIQUE (project_id, architecture_id, decision_key)
);

CREATE INDEX idx_foundation_decisions_arch
    ON foundation_decisions (project_id, architecture_id);
