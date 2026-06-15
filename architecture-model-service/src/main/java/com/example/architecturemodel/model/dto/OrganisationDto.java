package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

import java.util.List;

/**
 * DTO for Organisation entity with full details.
 *
 * Uses Java record with camelCase field names for API responses.
 * Maps to/from OrganisationEntity via OrganisationMapper.
 * All List<String> fields are guaranteed non-null (empty list if no data).
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed id from UUID to String
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added standards fields
 */
public record OrganisationDto(
    String id,
    String name,
    @JsonAlias("description")
    String description,
    @JsonAlias("docs_applied_to_all_sources")
    List<String> docsAppliedToAllSources,
    @JsonAlias("docs_applied_to_tech_stack")
    List<String> docsAppliedToTechStack,
    @JsonAlias("docs_applied_to_coding_styles")
    List<String> docsAppliedToCodingStyles,
    @JsonAlias("docs_applied_to_conventions")
    List<String> docsAppliedToConventions,
    @JsonAlias("docs_applied_to_error_handling")
    List<String> docsAppliedToErrorHandling,
    @JsonAlias("docs_applied_to_validation")
    List<String> docsAppliedToValidation,
    @JsonAlias("tech_standards_generated")
    Boolean techStandardsGenerated
) {
}
