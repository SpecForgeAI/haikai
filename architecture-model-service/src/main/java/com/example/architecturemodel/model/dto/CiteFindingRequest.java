package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/cite-finding}.
 *
 * <p>Spec: Carry-over triage (2026-07-26,
 * {@code agent-os/planning/2026-07-26-carry-over-triage-build-plan.md}) —
 * the CITE disposition onto an EXISTING story: add ONE
 * {@code discovery_finding} id to the story blob item's
 * {@code discoveryFindingReferences} list so the D4 carry-over completeness
 * gate reads the finding as {@code cited-by-story}. The citation mechanism is
 * the SAME {@code discoveryFindingReferences} array the plan generator writes
 * — the gate's {@code collectCitedFindingIds} consumes it unchanged.</p>
 *
 * <p>Idempotent: citing an already-cited finding is a no-op success (the gate
 * result is identical either way). Snake_case wire per AMS convention.</p>
 */
public record CiteFindingRequest(

    /** The {@code discovery_findings} UUID (as a string) to cite. REQUIRED. */
    @JsonProperty("finding_id")
    String findingId
) {}
