package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery candidates.
 *
 * Represents a synthesized meta-model element proposal produced during Phase 1d
 * candidate synthesis. Used for both request (bulk insert, update) and response
 * (query) payloads on the REST API.
 *
 * Data flow: 1a atoms -> 1b relationships -> 1c clusters -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 4: Candidate JPA Stack (1d)
 *
 * Extended: Phase 1d Candidate Generation (Increment 10)
 * Task Group 6: parentCandidateId field
 *
 * Extended: Candidate Review and Approval Workflow (Increment 13)
 * Task Group 1: reviewStatus, reviewedBy, reviewedAt, previousReviewStatus fields
 *
 * Extended: Log-based Discovery Enrichment (Increment 14)
 * Task Group 1: logEnrichment JSONB field for log enrichment metadata
 *
 * Extended: Model-Aware Discovery -- Dedup + Enrichment/Link (Spec 2026-05-30)
 * Task Group 1: operation dimension (create / enrich / link)
 *
 * @param id Candidate UUID
 * @param runId Discovery run UUID this candidate belongs to
 * @param candidateType Meta-model element type (application, app_component, service, etc.)
 * @param name Proposed name for the meta-model element
 * @param confidence Confidence score (0.0 to 1.0). Boxed Double so the PATCH-style
 *                   update endpoint can distinguish "field omitted" (null, leave
 *                   the persisted value alone) from "field set to 0.0". Read paths
 *                   auto-box from the entity's primitive double and so are never null.
 * @param status Lifecycle status (proposed, accepted, rejected, merged)
 * @param sourceClusterIds JSONB array of UUID strings referencing source cluster IDs
 * @param data JSONB payload with proposed properties
 * @param synthesizedAt ISO-8601 timestamp of synthesis
 * @param parentCandidateId Optional self-referencing FK to another candidate's UUID (nullable)
 * @param reviewStatus Review workflow status (pending_review, approved, rejected, deferred)
 * @param reviewedBy Freeform label identifying who performed the review (nullable)
 * @param reviewedAt ISO-8601 timestamp of the review action (nullable)
 * @param previousReviewStatus Previous review_status before the last transition (nullable)
 * @param logEnrichment JSONB metadata summarizing log enrichment (nullable)
 * @param operation Candidate operation dimension (create / enrich / link). NOT a new
 *                  entity/relationship type -- a dimension on the candidate row.
 *                  Null on write coerces to "create" via the entity default, so
 *                  operation-agnostic callers and existing rows round-trip as create.
 */
public record DiscoveryCandidateDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("candidate_type")
    String candidateType,

    @JsonProperty("name")
    String name,

    @JsonProperty("confidence")
    Double confidence,

    @JsonProperty("status")
    String status,

    @JsonProperty("source_cluster_ids")
    List<String> sourceClusterIds,

    @JsonProperty("data")
    Map<String, Object> data,

    @JsonProperty("synthesized_at")
    String synthesizedAt,

    @JsonProperty("parent_candidate_id")
    UUID parentCandidateId,

    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewed_by")
    String reviewedBy,

    @JsonProperty("reviewed_at")
    String reviewedAt,

    @JsonProperty("previous_review_status")
    String previousReviewStatus,

    @JsonProperty("log_enrichment")
    Map<String, Object> logEnrichment,

    @JsonProperty("operation")
    String operation
) {}
