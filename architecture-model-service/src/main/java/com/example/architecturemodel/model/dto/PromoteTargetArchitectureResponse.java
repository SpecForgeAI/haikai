package com.example.architecturemodel.model.dto;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchId}/promote}.
 *
 * <p>Carries the updated target architecture DTO plus the impact-preview count
 * (the number of {@code migration_story_spec_generations} rows that were
 * marked stale by the promote transition). The UI confirm modal renders the
 * preview count BEFORE the user confirms; the same endpoint commits the
 * transition and returns the actual count, which MUST match the preview when
 * no concurrent writes intervene.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 *
 * @param architecture         the updated (now active) target architecture
 * @param previousActiveId     id of the prior active target that was demoted
 *                             to {@code draft_state='draft'} and renamed with
 *                             a " (superseded YYYY-MM-DD)" suffix; null when
 *                             no prior active target existed
 * @param specsMarkedStale     number of spec-generation rows whose
 *                             {@code focused_context_refs_json} cited a
 *                             changed element and were flipped to
 *                             {@code stale=true}
 */
public record PromoteTargetArchitectureResponse(
    ArchitectureDto architecture,
    java.util.UUID previousActiveId,
    int specsMarkedStale
) {
}
