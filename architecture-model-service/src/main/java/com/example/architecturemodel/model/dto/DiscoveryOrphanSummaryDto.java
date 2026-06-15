package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for discovery orphan detection and cleanup summary.
 *
 * Reports counts of orphaned records: evidence and candidates whose run_id
 * does not exist in discovery_runs, and stale FAILED/CANCELLED runs older
 * than a configurable threshold.
 *
 * Used by both GET /discovery/orphans (detection) and POST /discovery/cleanup
 * (deletion summary) endpoints.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Task Group 4: Orphan Detection and Cleanup Endpoints
 *
 * @param orphanedEvidenceCount      count of evidence records with no valid run
 * @param orphanedCandidateCount     count of candidate records with no valid run
 * @param orphanedRelationshipCount  count of relationship records with no valid run
 * @param orphanedClusterCount       count of cluster records with no valid run
 * @param orphanedDecisionTaskCount  count of decision task records with no valid run
 * @param staleRunCount              count of FAILED/CANCELLED runs older than threshold
 */
public record DiscoveryOrphanSummaryDto(
    @JsonProperty("orphaned_evidence_count")
    long orphanedEvidenceCount,

    @JsonProperty("orphaned_candidate_count")
    long orphanedCandidateCount,

    @JsonProperty("orphaned_relationship_count")
    long orphanedRelationshipCount,

    @JsonProperty("orphaned_cluster_count")
    long orphanedClusterCount,

    @JsonProperty("orphaned_decision_task_count")
    long orphanedDecisionTaskCount,

    @JsonProperty("stale_run_count")
    long staleRunCount
) {}
