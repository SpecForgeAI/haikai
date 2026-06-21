package com.example.architecturemodel.model.dto.discovery;

import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;

import java.util.List;
import java.util.UUID;

/**
 * Response body for {@code POST .../candidates/bulk-edit}.
 *
 * <p>The bulk-edit endpoint is ATOMIC (all-or-nothing within one
 * {@code @Transactional}, mirroring {@code DiscoveryCascadeReviewService}). So on
 * a successful return EVERY curated patch was applied; this response therefore
 * carries {@code appliedCount} plus the FULL list of updated
 * {@link DiscoveryCandidateDto}s ({@code applied}) so the caller can refresh its
 * grid rows directly from the persisted result without a follow-up GET (the
 * panel's "Fix &amp; Save" needs the post-patch candidate state to re-evaluate
 * what now commits). {@code requestedCount} echoes how many patches were
 * submitted; under the atomic contract it always equals {@code appliedCount} on a
 * 2xx return (a partial failure rolled the whole batch back and surfaced as a 4xx
 * instead).</p>
 *
 * <p>There is deliberately NO per-item {@code failed[]} arm: the chosen contract
 * is ATOMIC (per spec.md -- "applied in one {@code @Transactional}", mirroring the
 * atomic {@code bulkReviewCascade}), so any failure aborts the whole batch and is
 * reported via the controller's exception-&gt;status mapping (an unknown / out-of-
 * scope id -&gt; 404; a bad request -&gt; 400) rather than a best-effort
 * per-row result list. This is the opposite of a best-effort
 * {@code failed[]}-style batch.</p>
 *
 * <p>Wire format is snake_case (global Jackson SNAKE_CASE strategy); no
 * {@code @CamelCaseWire} needed. {@code appliedCount} -&gt; {@code applied_count},
 * {@code requestedCount} -&gt; {@code requested_count}, {@code applied} stays
 * {@code applied} (each element is a {@link DiscoveryCandidateDto}, already
 * snake_case via its explicit {@code @JsonProperty} annotations). {@code ids}
 * lists the applied candidate UUIDs for a lightweight summary.</p>
 *
 * <p>Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 3; modelled on
 * {@link BulkReviewCascadeResponse}.</p>
 */
public record BulkCandidateEditResponse(
    int appliedCount,
    int requestedCount,
    List<UUID> ids,
    List<DiscoveryCandidateDto> applied
) {}
