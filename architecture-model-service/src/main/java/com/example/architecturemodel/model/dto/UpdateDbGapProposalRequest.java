package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Sparse PATCH body for one gap-proposal row
 * ({@code PATCH /api/projects/{projectId}/db-gap-proposals/{proposalId}}).
 * Snake_case wire per the AMS global default. EVERY field is nullable and
 * null-guarded in the service (per
 * {@code project_primitive_double_dto_overwrite.md}): an omitted field leaves
 * the column untouched.
 *
 * <p>Validation (service-enforced):</p>
 * <ul>
 *   <li>{@code review_status} must be one of
 *       {@code unreviewed | approved | rejected | needs_rework} whenever
 *       supplied; a supplied value stamps {@code reviewed_at}.</li>
 *   <li>{@code applied_at} must parse as an ISO-8601 instant whenever
 *       supplied (stamped by the caller when the model write-back
 *       succeeded).</li>
 * </ul>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 *
 * @param reviewStatus One of
 *     {@code unreviewed | approved | rejected | needs_rework}; stamps
 *     {@code reviewed_at} when supplied.
 * @param reviewerNotes Reviewer commentary.
 * @param appliedAt ISO-8601 instant of the successful model write-back.
 */
public record UpdateDbGapProposalRequest(
    @JsonProperty("review_status")
    String reviewStatus,

    @JsonProperty("reviewer_notes")
    String reviewerNotes,

    @JsonProperty("applied_at")
    String appliedAt
) {}
