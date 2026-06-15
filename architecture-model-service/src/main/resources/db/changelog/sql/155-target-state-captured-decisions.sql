-- 155-target-state-captured-decisions.sql
-- Spec: Target State Captured Decisions -- Data Plane
--       (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 1
--
-- Introduces `target_state_captured_decisions` -- the new first-class artifact
-- that carries architect-persona captured decisions for a target architecture.
-- This spec ships the rails only; the table is empty in every environment
-- until Spec 3 starts writing through the architect-persona conversation.
--
-- Scoping:
--   * project_id              -> NOT NULL. Anchors every row to the owning project.
--   * target_architecture_id  -> NOT NULL. The target-state architecture draft
--                                this decision applies to.
--   * scope_kind              -> NOT NULL. One of architecture / service /
--                                interface / element. Lets the architect set
--                                architecture-wide defaults then refine per-
--                                element exceptions.
--   * scope_ref_type          -> VARCHAR NULL. Populated ONLY when
--                                scope_kind='element' (where we don't know the
--                                element supertype table at write time without
--                                it). NULL when scope_kind is architecture /
--                                service / interface (those have their own
--                                supertype tables and scope_ref_id is sufficient).
--   * scope_ref_id            -> VARCHAR NULL. Target-side element id when
--                                scope_kind is service / interface / element.
--                                NULL when scope_kind='architecture'.
--
-- CHECK constraint `chk_tscd_scope_invariant` enforces:
--   (a) scope_kind='element' iff scope_ref_type IS NOT NULL
--   (b) scope_kind='architecture' iff scope_ref_id IS NULL
-- Together these encode the spec's scope invariant:
--   - architecture-scope rows carry NO ref id and NO ref type
--   - service/interface-scope rows carry a ref id but NO ref type
--   - element-scope rows carry BOTH a ref id and a ref type
--
-- No CHECK on `decision_code` values -- open-ended by design (per Q7) so Spec 3
-- can grow the question library without DDL changes. Typo cost is "downstream
-- sees no decisions found and the architect re-answers."
--
-- `created_by_task` is NOT NULL with NO DB default (per Q9). Callers must pass
-- it explicitly. Spec 3 will pass `architect-persona-conversation`; future
-- tasks pass their own task identifier.
--
-- `superseded_by_id` is a NULLABLE self-FK to target_state_captured_decisions.id.
-- Decisions are immutable once written (per D6): to "change" a decision, a new
-- row is inserted and the prior matching-tuple row's `superseded_by_id` is set
-- to the new row's id atomically (same transaction at the service layer).
-- ON DELETE clause is intentionally omitted (default NO ACTION) -- supersession
-- is append-only and there is no expected delete path on these rows.
--
-- No FK from this table to architecture_element_mappings (per Q2). Reverse-
-- discovery happens via the `[decision:<code>]` tag the notes-decoration
-- helper appends to architecture_element_mappings.notes.
--
-- Indexes:
--   * idx_target_state_captured_decisions_project_target
--       -- composite (project_id, target_architecture_id) for the "all
--          decisions for this target" read path.
--   * idx_target_state_captured_decisions_latest_per_scope
--       -- composite (project_id, target_architecture_id, decision_code,
--          scope_kind, scope_ref_id) supports the "latest decision per scope"
--          read pattern AND the cheap supersession lookup at create time.
--   * idx_target_state_captured_decisions_decision_code
--       -- per-column (decision_code) for cross-architecture analytics
--          (find every project that has answered db.engine, etc).
--
-- All decimal / boolean fields on the entity are boxed types per
-- project_primitive_double_dto_overwrite.md. This spec uses POST-only writes
-- (no PATCH), but staying consistent with the project pattern keeps the door
-- open for future evolution without silent zero-overwrites.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 154 are not edited.

CREATE TABLE target_state_captured_decisions (
  id                          UUID PRIMARY KEY,
  project_id                  UUID NOT NULL,
  target_architecture_id      UUID NOT NULL,
  decision_code               VARCHAR(255) NOT NULL,
  scope_kind                  VARCHAR(32) NOT NULL,
  scope_ref_type              VARCHAR(64) NULL,
  scope_ref_id                VARCHAR(255) NULL,
  answer_value                TEXT NOT NULL,
  answer_summary              VARCHAR(1024) NULL,
  standards_lookup_ref        VARCHAR(255) NULL,
  conversation_thread_id      VARCHAR(255) NULL,
  conversation_turn_ref       VARCHAR(255) NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by_task             VARCHAR(255) NOT NULL,
  superseded_by_id            UUID NULL,
  CONSTRAINT chk_tscd_scope_invariant
    CHECK (
      (
        (scope_kind = 'element' AND scope_ref_type IS NOT NULL)
        OR (scope_kind IN ('architecture', 'service', 'interface') AND scope_ref_type IS NULL)
      )
      AND (
        (scope_kind = 'architecture' AND scope_ref_id IS NULL)
        OR (scope_kind IN ('service', 'interface', 'element') AND scope_ref_id IS NOT NULL)
      )
    ),
  CONSTRAINT fk_tscd_superseded_by
    FOREIGN KEY (superseded_by_id)
    REFERENCES target_state_captured_decisions (id)
);

CREATE INDEX idx_target_state_captured_decisions_project_target
  ON target_state_captured_decisions (project_id, target_architecture_id);

CREATE INDEX idx_target_state_captured_decisions_latest_per_scope
  ON target_state_captured_decisions (project_id, target_architecture_id, decision_code, scope_kind, scope_ref_id);

CREATE INDEX idx_target_state_captured_decisions_decision_code
  ON target_state_captured_decisions (decision_code);

COMMENT ON TABLE target_state_captured_decisions IS
  'Architect-persona captured decisions for a target-state architecture. One row per answered concern question, scoped architecture-wide / per-service / per-interface / per-element. Insert-only at the data plane; "revise" semantics are implemented by writing a new row and setting the prior matching-tuple row''s superseded_by_id to the new row''s id atomically (see TargetStateCapturedDecisionService.createDecision). Spec: Target State Captured Decisions -- Data Plane (2026-05-24) -- Task Group 1.';

COMMENT ON COLUMN target_state_captured_decisions.decision_code IS
  'Stable opaque decision code (e.g. db.engine, api.protocol, service.framework). Open-ended by design -- no CHECK constraint, no enum validation. Spec 3 owns the question library and is the single writer; typo cost is "downstream sees no decisions found and the architect re-answers."';

COMMENT ON COLUMN target_state_captured_decisions.scope_kind IS
  'Scope kind. One of architecture / service / interface / element. Enforced via chk_tscd_scope_invariant in combination with scope_ref_type and scope_ref_id.';

COMMENT ON COLUMN target_state_captured_decisions.scope_ref_type IS
  'Element supertype table indicator. Populated ONLY when scope_kind=''element''. NULL for all other scope kinds. Enforced via chk_tscd_scope_invariant.';

COMMENT ON COLUMN target_state_captured_decisions.scope_ref_id IS
  'Target-side element id. NULL only when scope_kind=''architecture''. Populated for service / interface / element scopes. Enforced via chk_tscd_scope_invariant.';

COMMENT ON COLUMN target_state_captured_decisions.standards_lookup_ref IS
  'Optional opaque reference into the standards registry. Format TBD by Spec 3. Nullable -- not every decision is grounded in a standards lookup.';

COMMENT ON COLUMN target_state_captured_decisions.conversation_thread_id IS
  'Optional reference to the architect-persona conversation thread that produced this decision. Spec 3 wires this; nullable for backfill / direct-write tolerance.';

COMMENT ON COLUMN target_state_captured_decisions.conversation_turn_ref IS
  'Optional reference to the turn index within the conversation thread that produced this decision. Spec 3 wires this; nullable for the same reason as conversation_thread_id.';

COMMENT ON COLUMN target_state_captured_decisions.created_by_task IS
  'Task identifier for audit. NOT NULL with NO DB default -- callers must pass it explicitly (per Q9). Spec 3 will pass architect-persona-conversation; future tasks pass their own task identifier.';

COMMENT ON COLUMN target_state_captured_decisions.superseded_by_id IS
  'Self-FK to target_state_captured_decisions.id. NULL while this row is the latest decision for its (decision_code, scope) tuple; non-null after a new row has superseded it. Set atomically inside the same transaction as the superseding insert by TargetStateCapturedDecisionService.createDecision so at most one row per tuple has superseded_by_id IS NULL at any consistent read.';
