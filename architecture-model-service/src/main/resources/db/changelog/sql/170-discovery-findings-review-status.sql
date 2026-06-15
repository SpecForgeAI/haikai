-- 170-discovery-findings-review-status.sql
-- Spec: Normalize Findings Review Actions (Spec F) (2026-06-02) -- Task Group 1
--
-- Makes discovery FINDINGS speak the same review-disposition vocabulary as
-- architecture CANDIDATES (Approve / Reject / Defer). Renames the overloaded
-- `status` column to `review_status`, migrates its stored values to the
-- candidate disposition set, and adds a `previous_review_status` audit trail
-- (mirrors discovery_candidate added in 074-candidate-review-fields.sql).
--
-- Net end state:
--   * discovery_findings.review_status (renamed from status): TEXT NOT NULL,
--     default 'pending_review', values {pending_review, approved, rejected,
--     deferred}. NO CHECK constraint (preserve 135's free-text +
--     pack-extensibility design).
--   * discovery_findings.previous_review_status: nullable TEXT, set on each
--     transition.
--   * exactly ONE status index, now on review_status.
--
-- `resolved` collapses into `approved` (Decision 5) and `new` becomes
-- `pending_review` (Decision 2 / Q7); both legacy values are retired by the
-- value migration below so the single column afterward carries only the four
-- dispositions.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; 135-discovery-findings.sql is NOT
-- edited.

-- 1. Rename the column (keep TEXT NOT NULL).
ALTER TABLE discovery_findings RENAME COLUMN status TO review_status;

-- 2. Change the column DEFAULT from 'new' to the candidate-parity default.
ALTER TABLE discovery_findings ALTER COLUMN review_status SET DEFAULT 'pending_review';

-- 3. Add the audit-trail column (nullable, no default) -- mirrors
--    discovery_candidate.previous_review_status (074-candidate-review-fields.sql).
ALTER TABLE discovery_findings ADD COLUMN IF NOT EXISTS previous_review_status TEXT;

-- 4. Rebuild the single status index on the renamed column (keep exactly ONE).
DROP INDEX IF EXISTS idx_discovery_finding_status;
CREATE INDEX IF NOT EXISTS idx_discovery_finding_review_status
  ON discovery_findings (review_status);

-- 5. Value migration for pre-existing rows (mirrors the explicit-UPDATE idiom
--    of 074-candidate-review-fields.sql:29-34). End state: the column carries
--    only {pending_review, approved, rejected, deferred}.
UPDATE discovery_findings SET review_status = 'approved'       WHERE review_status = 'accepted';
UPDATE discovery_findings SET review_status = 'rejected'       WHERE review_status = 'ignored';
UPDATE discovery_findings SET review_status = 'deferred'       WHERE review_status = 'needs_review';
UPDATE discovery_findings SET review_status = 'pending_review' WHERE review_status = 'new';
UPDATE discovery_findings SET review_status = 'approved'       WHERE review_status = 'resolved';

-- 6. Refresh / add column documentation to the new vocabulary.
COMMENT ON COLUMN discovery_findings.review_status IS
  'Reviewer disposition (candidate-parity vocabulary). Valid values: pending_review (default on emit), approved, rejected, deferred. Stored as TEXT for pack-extensibility without DDL. Renamed from `status` and value-migrated by Spec F (2026-06-02): accepted->approved, ignored->rejected, needs_review->deferred, new->pending_review, resolved->approved.';

COMMENT ON COLUMN discovery_findings.previous_review_status IS
  'Captures the review_status value before the most recent review transition. Nullable when no transition has occurred yet. Enables lightweight audit trail.';
