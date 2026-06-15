package com.example.architecturemodel.model.dto;

/**
 * DTO for Organisation list items (subset for autocomplete/list responses).
 *
 * Contains only id and name for efficient list rendering.
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed id from UUID to String
 */
public record OrganisationListItemDto(
    String id,
    String name
) {
}
