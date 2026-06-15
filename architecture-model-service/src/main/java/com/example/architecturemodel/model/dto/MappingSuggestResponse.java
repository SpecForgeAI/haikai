package com.example.architecturemodel.model.dto;

import java.util.List;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest}.
 *
 * <p>Up to three candidates (see {@link MappingSuggestRequest#MAX_CANDIDATES})
 * sorted by descending confidence.</p>
 *
 * <p>The endpoint is READ-ONLY: no row mutation occurs to compute the
 * candidate list. The persistence assertion in Task Group 4 test 4 enforces
 * this contract.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param candidates  list (possibly empty) of up to three candidates ranked
 *                    by descending confidence
 */
public record MappingSuggestResponse(
    List<MappingSuggestCandidate> candidates
) {
}
