package com.example.architecturemodel.model.dto;

/**
 * Row in the response of
 * {@code GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations}.
 *
 * <p>Derived annotation surfaced on a current-architecture element when:</p>
 *
 * <ul>
 *   <li>(a) the element has NO mapping into the project's active target, OR</li>
 *   <li>(b) every mapping it has points at a target element with
 *       {@code decommissioning_status='decommissioned'}.</li>
 * </ul>
 *
 * <p>Computed at read time -- the current architecture itself has no
 * decommissioning column of its own. The frontend table editor renders this
 * annotation as a chip / status pill on the current-side row in the
 * compare view.</p>
 *
 * <p><b>Endpoint placement decision:</b> a sibling endpoint (rather than
 * extending {@code unmapped-current-elements}) keeps both contracts single-
 * purpose -- "unmapped" answers "what hasn't been mapped at all?" and
 * "decommissioned-in-target-annotations" answers "what's effectively
 * decommissioned?" The two questions overlap (a no-mapping element is also
 * a decommissioned-in-target annotation in v1) but the panels render them
 * differently and the SQL paths differ enough that keeping them separate
 * avoids overloading the simpler endpoint.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 4.</p>
 *
 * @param elementId    canonical element id (the row id on the supertype
 *                     table)
 * @param elementType  one of {@code application_components} /
 *                     {@code interfaces} / {@code data_entity_points} /
 *                     {@code infrastructure_points}
 * @param name         human-readable element name (for UI rendering)
 * @param reason       human-readable reason: either
 *                     {@code "no-mapping-to-active-target"} or
 *                     {@code "all-mappings-decommissioned"}
 */
public record DecommissionedInTargetAnnotationDto(
    String elementId,
    String elementType,
    String name,
    String reason
) {
    public static final String REASON_NO_MAPPING = "no-mapping-to-active-target";
    public static final String REASON_ALL_DECOMMISSIONED = "all-mappings-decommissioned";
}
