-- Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
-- Task Group 2: Idempotent Evidence, Relationship, Cluster, and Candidate Persistence
--
-- Ensures unique constraints exist on stable identifier columns for all four
-- discovery entity types. Since all four tables already use `id UUID PRIMARY KEY`,
-- the PK inherently enforces uniqueness on the id column.
--
-- This migration adds explicit UNIQUE indexes only where the PK does not already
-- provide them. In practice, these are no-ops for the current schema because
-- PRIMARY KEY implies UNIQUE, but the indexes are created IF NOT EXISTS to guard
-- against future schema changes that might alter the PK strategy.
--
-- Additionally, this migration adds a comment documenting the upsert contract:
-- bulk-save endpoints use ON CONFLICT (id) DO UPDATE semantics so that
-- re-persisting the same records by stable ID is idempotent.

-- discovery_evidence: id is already PRIMARY KEY (unique). Add explicit unique index for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_evidence_id ON discovery_evidence (id);

-- discovery_relationship: id is already PRIMARY KEY (unique). Add explicit unique index for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_relationship_id ON discovery_relationship (id);

-- discovery_cluster: id is already PRIMARY KEY (unique). Add explicit unique index for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_cluster_id ON discovery_cluster (id);

-- discovery_candidate: id is already PRIMARY KEY (unique). Add explicit unique index for clarity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_discovery_candidate_id ON discovery_candidate (id);

-- Document the upsert contract on each table
COMMENT ON TABLE discovery_evidence IS 'Stores individual evidence atoms extracted during Phase 1a universal extraction. Bulk-save uses ON CONFLICT (id) DO UPDATE for idempotent upsert semantics. Spec: Phase 1a (Increment 6), Hardening (Increment 16).';
COMMENT ON TABLE discovery_relationship IS 'Stores inferred relationships between evidence atoms during Phase 1b. Bulk-save uses ON CONFLICT (id) DO UPDATE for idempotent upsert semantics. Spec: Phase 1b (Increment 7), Hardening (Increment 16).';
COMMENT ON TABLE discovery_cluster IS 'Stores formed clusters grouping atoms and relationships during Phase 1c. Bulk-save uses ON CONFLICT (id) DO UPDATE for idempotent upsert semantics. Spec: Phase 1c (Increment 7), Hardening (Increment 16).';
COMMENT ON TABLE discovery_candidate IS 'Stores synthesized discovery candidates during Phase 1d. Bulk-save uses ON CONFLICT (id) DO UPDATE for idempotent upsert semantics. Spec: Phase 1d (Increment 7), Hardening (Increment 16).';
