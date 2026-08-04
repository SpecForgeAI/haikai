package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Bulk-upsert body for the gap-proposal queue
 * ({@code PUT /api/projects/{projectId}/db-gap-proposals}). Snake_case wire
 * per the AMS global default.
 *
 * <p>Upsert-by-{@code proposal_key} semantics (service-enforced):</p>
 * <ul>
 *   <li>NEW keys create rows with {@code review_status=unreviewed}.</li>
 *   <li>EXISTING rows are REFRESHED ({@code payload_json} / {@code rationale}
 *       / {@code confidence}) ONLY while still {@code unreviewed} -- approved
 *       / rejected / needs_rework rows are human state and are left verbatim
 *       (still returned).</li>
 *   <li>Blank or in-batch duplicate {@code proposal_key}, blank
 *       {@code finding_key}, missing {@code payload_json}, or an invalid
 *       {@code kind} / {@code origin} / {@code confidence} enum value -&gt;
 *       {@link IllegalArgumentException} (400).</li>
 * </ul>
 *
 * <p>Spec: LLM gap-proposal queue (2026-08-04) -- Spec 4.</p>
 *
 * @param proposals The batch; each item is one proposal upsert.
 */
public record UpsertDbGapProposalsRequest(
    @JsonProperty("proposals")
    List<Proposal> proposals
) {

    /**
     * One proposal in the bulk-upsert batch.
     *
     * @param proposalKey Stable identity {@code fk--<relationship_id>} /
     *     {@code pk--<table>}; required, unique within the batch.
     * @param findingKey The structural finding addressed; required.
     * @param kind One of {@code fk_join | primary_key}; required.
     * @param payloadJson Kind-shaped proposed change; required.
     * @param rationale The proposer's reasoning (optional).
     * @param confidence One of {@code high | medium | low} (optional).
     * @param origin One of {@code llm | manual} (optional; defaults to
     *     {@code llm} on create).
     */
    public record Proposal(
        @JsonProperty("proposal_key")
        String proposalKey,

        @JsonProperty("finding_key")
        String findingKey,

        @JsonProperty("kind")
        String kind,

        @JsonProperty("payload_json")
        Map<String, Object> payloadJson,

        @JsonProperty("rationale")
        String rationale,

        @JsonProperty("confidence")
        String confidence,

        @JsonProperty("origin")
        String origin
    ) {}
}
