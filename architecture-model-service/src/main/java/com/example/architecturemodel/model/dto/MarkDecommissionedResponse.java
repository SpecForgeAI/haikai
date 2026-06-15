package com.example.architecturemodel.model.dto;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchId}/decommission}.
 *
 * <p>Returns the identifiers of the newly created target-side element row and
 * the mapping row so the frontend can refresh its in-memory model cache (per
 * {@code project_appshell_model_cache.md}) without an additional round trip.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param newTargetElementId    id of the new target-side row inserted into
 *                              the supertype table
 * @param newTargetElementType  the supertype table the new row lives on (same
 *                              as the {@code currentElementType} in the
 *                              request)
 * @param mappingId             id of the new
 *                              {@code architecture_element_mappings} row
 *                              connecting current -> new target with
 *                              {@code mapping_type='decommissioned'}
 */
public record MarkDecommissionedResponse(
    String newTargetElementId,
    String newTargetElementType,
    java.util.UUID mappingId
) {
}
