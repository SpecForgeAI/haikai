-- Spec: Candidate Review and Approval Workflow (Increment 13)
-- Task Group 1: Database Migration and JPA Entity Extension
--
-- Adds review workflow fields to the discovery_candidate table:
-- - review_status: tracks the review lifecycle (pending_review, approved, rejected, deferred)
-- - reviewed_by: freeform label identifying who performed the review action
-- - reviewed_at: timestamp of when the review action was performed
-- - previous_review_status: captures the prior review_status before a transition
--
-- All existing rows default to review_status = 'pending_review'.
-- An explicit UPDATE ensures any rows with status = 'proposed' also get 'pending_review'.

-- Add review_status column with NOT NULL DEFAULT
ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(32) NOT NULL DEFAULT 'pending_review';

-- Add reviewed_by column (nullable, freeform text)
ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Add reviewed_at column (nullable, timestamp with time zone)
ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Add previous_review_status column (nullable, captures prior state)
ALTER TABLE discovery_candidate
    ADD COLUMN IF NOT EXISTS previous_review_status VARCHAR(32);

-- Explicit UPDATE for existing rows that may have status = 'proposed'
-- to ensure they get review_status = 'pending_review' (the DEFAULT clause covers new rows
-- and rows inserted after migration, but this handles any edge cases for existing data)
UPDATE discovery_candidate
    SET review_status = 'pending_review'
    WHERE review_status IS NULL OR review_status = '';

-- Composite index on (run_id, review_status) for efficient filtered queries
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_id_review_status
    ON discovery_candidate (run_id, review_status);

-- Column documentation
COMMENT ON COLUMN discovery_candidate.review_status IS 'Review workflow status. Valid values: pending_review (awaiting review), approved (accepted by reviewer), rejected (dismissed by reviewer), deferred (skipped for now). Defaults to pending_review. Spec: Candidate Review and Approval Workflow (Increment 13).';
COMMENT ON COLUMN discovery_candidate.reviewed_by IS 'Freeform label identifying who performed the last review action (e.g., session ID, user name). Nullable for unreviewed candidates.';
COMMENT ON COLUMN discovery_candidate.reviewed_at IS 'Timestamp of when the last review action was performed. Nullable for unreviewed candidates.';
COMMENT ON COLUMN discovery_candidate.previous_review_status IS 'Captures the review_status value before the most recent review transition. Nullable when no transition has occurred yet. Enables lightweight audit trail.';
