package com.example.architecturemodel.model.dto;

/**
 * Row in the response of
 * {@code GET /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements}.
 *
 * <p>Each item is a current-architecture element with no row in
 * {@code architecture_element_mappings} that targets the project's active
 * target. The frontend renders these in the right-side warning panel so the
 * user can either "mark decommissioned" (creates a target-side row + mapping
 * via Task Group 4) or open an existing target element to add a mapping.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
 *
 * @param elementId    canonical element id (the row id on the supertype table)
 * @param elementType  one of {@code application_components} /
 *                     {@code interfaces} / {@code data_entity_points} /
 *                     {@code infrastructure_points}
 * @param name         human-readable element name (for UI rendering)
 */
public record UnmappedCurrentElementDto(
    String elementId,
    String elementType,
    String name
) {
}
