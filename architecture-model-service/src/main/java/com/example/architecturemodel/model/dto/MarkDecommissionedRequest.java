package com.example.architecturemodel.model.dto;

/**
 * Body for
 * {@code POST /api/projects/{projectId}/target-architectures/{targetArchId}/decommission}.
 *
 * <p>The frontend unmapped-elements panel surfaces a "mark decommissioned"
 * action per row. Clicking it writes a NEW target-side row with
 * {@code provenance='user-authored'} and
 * {@code decommissioning_status='decommissioned'}, plus a single
 * {@code architecture_element_mappings} row with
 * {@code mapping_type='decommissioned'} and
 * {@code createdByTask='unmapped-panel-mark-decom'} from the supplied current
 * element to the new target-side row. Both writes are atomic per the spec
 * acceptance criteria.</p>
 *
 * <p>The target architecture id ({@code targetArchId}) is taken from the URL
 * path; the body only carries the source element identity and the source
 * architecture id (so the mapping row can record the architecture pair without
 * a round trip to look it up).</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param currentElementId        canonical id of the current-architecture
 *                                element being marked decommissioned
 * @param currentElementType      one of {@code application_components} /
 *                                {@code interfaces} /
 *                                {@code data_entity_points} /
 *                                {@code infrastructure_points}
 * @param currentArchitectureId   the architecture id the current element
 *                                belongs to (used to record the mapping
 *                                pair); the controller resolves the
 *                                project's canonical current architecture if
 *                                this is null
 */
public record MarkDecommissionedRequest(
    String currentElementId,
    String currentElementType,
    java.util.UUID currentArchitectureId
) {
    /** createdByTask stamp recorded on the mapping row. */
    public static final String MARK_DECOM_CREATED_BY_TASK = "unmapped-panel-mark-decom";

    /** mapping_type value for the mapping row. */
    public static final String MAPPING_TYPE_DECOMMISSIONED = "decommissioned";

    /** provenance value stamped on the new target-side row. */
    public static final String PROVENANCE_USER_AUTHORED = "user-authored";

    /** decommissioning_status value stamped on the new target-side row. */
    public static final String DECOM_STATUS_DECOMMISSIONED = "decommissioned";
}
