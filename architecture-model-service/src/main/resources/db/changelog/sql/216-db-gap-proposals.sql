-- 216-db-gap-proposals.sql
-- Spec 4: LLM gap-proposal queue (2026-08-04)
--
-- Introduces `db_gap_proposals` -- ONE row per LLM- (or manually-) proposed
-- fix for a DB structural finding (e.g. a missing FK join or a missing
-- primary key). Proposals are keyed by PROJECT + proposal_key
-- (`fk--<relationship_id>` / `pk--<table>`), NOT by pack: pack regeneration
-- wholesale replaces pack rows, while these rows are the review-queue
-- DURABILITY mechanism -- a re-proposed gap re-links to its existing row via
-- the stable proposal_key identity, and human review state
-- (approved/rejected/needs_rework) is never clobbered by a refresh.
--
-- Columns:
--   * project_id    -> owning project UUID (no FK by design: proposals must
--                      outlive pack row churn; project lifecycle is managed
--                      upstream).
--   * proposal_key  -> stable identity `fk--<relationship_id>` /
--                      `pk--<table>`; UNIQUE per project
--                      (uq_dgp_project_proposal_key) so upserts re-link
--                      instead of duplicating.
--   * finding_key   -> the structural finding this proposal addresses
--                      (indexed with project_id for the review-panel filter).
--   * kind          -> fk_join | primary_key (chk_dgp_kind).
--   * payload_json  -> the proposed change, kind-shaped:
--                      fk_join:     {relationship_id, from_table,
--                                    join_columns[], to_table,
--                                    referenced_columns[]}
--                      primary_key: {table, entity_id, columns[]}
--   * rationale     -> the proposer's reasoning (free text).
--   * confidence    -> high | medium | low (chk_dgp_confidence; NULL allowed).
--   * origin        -> llm | manual (chk_dgp_origin; default llm).
--   * review_status -> unreviewed | approved | rejected | needs_rework
--                      (chk_dgp_review_status; default unreviewed). Refresh
--                      upserts only touch rows still `unreviewed`
--                      (service-enforced).
--   * applied_at    -> stamped when the model write-back succeeded.
--   * reviewed_at   -> stamped when a review action is persisted.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 215 are not edited.

CREATE TABLE db_gap_proposals (
  id             UUID PRIMARY KEY,
  project_id     UUID NOT NULL,
  proposal_key   TEXT NOT NULL,
  finding_key    TEXT NOT NULL,
  kind           TEXT NOT NULL,
  payload_json   JSONB NOT NULL,
  rationale      TEXT NULL,
  confidence     TEXT NULL,
  origin         TEXT NOT NULL DEFAULT 'llm',
  review_status  TEXT NOT NULL DEFAULT 'unreviewed',
  reviewer_notes TEXT NULL,
  applied_at     TIMESTAMP WITH TIME ZONE NULL,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reviewed_at    TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT chk_dgp_kind CHECK (kind IN
    ('fk_join','primary_key')),
  CONSTRAINT chk_dgp_confidence CHECK (confidence IS NULL OR confidence IN
    ('high','medium','low')),
  CONSTRAINT chk_dgp_origin CHECK (origin IN
    ('llm','manual')),
  CONSTRAINT chk_dgp_review_status CHECK (review_status IN
    ('unreviewed','approved','rejected','needs_rework'))
);

CREATE UNIQUE INDEX uq_dgp_project_proposal_key
  ON db_gap_proposals (project_id, proposal_key);

CREATE INDEX idx_dgp_project
  ON db_gap_proposals (project_id);

CREATE INDEX idx_dgp_project_finding
  ON db_gap_proposals (project_id, finding_key);

-- NB: no double-hyphen sequences inside the string literals below -- the
-- changelog applies this file with stripComments: true, which truncates at
-- a double hyphen even mid-literal. The key shapes are therefore described
-- as "fk / pk prefix, double hyphen, identifier" in prose.

COMMENT ON TABLE db_gap_proposals IS
  'Per-project LLM gap-proposal queue for DB structural findings (missing FK joins / primary keys). Durable across pack regeneration via proposal_key (fk or pk prefix, double hyphen, then relationship_id or table), unique per project. Spec: LLM gap-proposal queue (2026-08-04), Spec 4.';

COMMENT ON COLUMN db_gap_proposals.proposal_key IS
  'Stable identity: fk or pk prefix, double hyphen, then the relationship_id or table. Unique per project via uq_dgp_project_proposal_key; upserts re-link rather than duplicate.';

COMMENT ON COLUMN db_gap_proposals.payload_json IS
  'Kind-shaped proposed change. fk_join: {relationship_id, from_table, join_columns[], to_table, referenced_columns[]}. primary_key: {table, entity_id, columns[]}.';

COMMENT ON COLUMN db_gap_proposals.review_status IS
  'unreviewed | approved | rejected | needs_rework. Enforced by chk_dgp_review_status. Refresh upserts only touch rows still unreviewed (service-enforced); reviewed rows are human state.';

COMMENT ON COLUMN db_gap_proposals.applied_at IS
  'Stamped when the model write-back for an approved proposal succeeded.';
