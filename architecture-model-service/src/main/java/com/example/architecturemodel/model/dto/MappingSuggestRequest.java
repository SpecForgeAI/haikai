package com.example.architecturemodel.model.dto;

/**
 * Body for
 * {@code POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest}.
 *
 * <p><b>Read-only contract.</b> The AMS-side endpoint returns up to three
 * candidate current-architecture elements ranked by simple name similarity
 * (substring + token-overlap, NO LLM call) so the frontend can render a hint
 * chip when the user is adding a target element. The LLM augmentation lives
 * in the gateway (Task Group 5) -- AMS deliberately stays read-only here so
 * the contract can be exercised without an LLM hop.</p>
 *
 * <p>Per the v1 design call in Task Group 4 sub-task 4.4 header, the AMS-side
 * endpoint exists to host the contract on the AMS side -- the gateway calls
 * into AMS for the read-side candidate list (avoiding cross-service network
 * hops between the LLM-rerank step in gateway and AMS) and then runs the LLM
 * rerank in gateway.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param targetElementId       id of the target-side element the user is
 *                              shaping (may be null when the user has not
 *                              yet saved a draft row)
 * @param targetElementSnapshot a lightweight summary of the target element
 *                              the user is shaping; the only field strictly
 *                              required by the v1 read path is
 *                              {@link MappingSuggestTargetSnapshot#name()}
 */
public record MappingSuggestRequest(
    String targetElementId,
    MappingSuggestTargetSnapshot targetElementSnapshot
) {
    /** Hard cap on the number of candidates AMS will return per call. */
    public static final int MAX_CANDIDATES = 3;
}
