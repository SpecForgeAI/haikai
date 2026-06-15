package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.List;
import java.util.UUID;

/**
 * Request body for the selective-copy commit endpoint.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>{@code POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit}</p>
 *
 * <p>The optional {@code autoMap} field triggers an in-transaction write of one
 * {@code ArchitectureElementMappingEntity} per element actually copied
 * (mapping_type=equivalent / status=confirmed / confidence=1.0 /
 * created_by_task=selective-copy-with-auto-map). When omitted or false, the
 * existing copy behaviour is unchanged (default {@code false} for backward
 * compatibility).</p>
 *
 * @param sourceArchitectureId the source architecture (same as the one in
 *                             the preflight request that produced
 *                             {@code resolutions}).
 * @param elementIds           the user's tick-set from the picker tree
 *                             (same as the preflight request).
 * @param resolutions          one entry per same-UUID conflict, with the
 *                             user's chosen action (defaulting to
 *                             {@code "skip"} per the resolution UI). Elements
 *                             without a same-UUID conflict are inserted
 *                             verbatim and need no resolution entry.
 * @param autoMap              when {@code true}, write one
 *                             {@code architecture_element_mappings} row per
 *                             element actually copied, under the same
 *                             {@code @Transactional} boundary. When
 *                             {@code false} (default for backward compat),
 *                             behaviour is unchanged.
 */
@CamelCaseWire
public record SelectiveCopyCommitRequest(
    UUID sourceArchitectureId,
    List<UUID> elementIds,
    List<ResolutionItem> resolutions,
    Boolean autoMap
) {

    /**
     * Convenience constructor preserving the pre-spec wire shape — used by
     * existing tests + callers that don't supply {@code autoMap}. Defaults
     * the flag to {@code false} so legacy clients see no behavioural change.
     */
    public SelectiveCopyCommitRequest(
        UUID sourceArchitectureId,
        List<UUID> elementIds,
        List<ResolutionItem> resolutions
    ) {
        this(sourceArchitectureId, elementIds, resolutions, Boolean.FALSE);
    }

    /**
     * One per-element resolution decision.
     *
     * @param elementId the conflicting id (must match a {@code conflicts}
     *                  entry from the preflight response).
     * @param action    one of {@code "skip"} (do not copy), {@code "overwrite"}
     *                  (UPDATE the target row in place preserving id), or
     *                  {@code "duplicate"} (INSERT new row with a freshly
     *                  generated UUID + intra-copy-set FK rewiring).
     */
    @CamelCaseWire
    public record ResolutionItem(
        UUID elementId,
        String action
    ) {}
}
