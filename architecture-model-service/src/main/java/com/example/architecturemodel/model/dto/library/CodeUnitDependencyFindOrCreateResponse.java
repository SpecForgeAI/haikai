package com.example.architecturemodel.model.dto.library;

import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response payload for the find-or-create CodeUnitDependency endpoint.
 *
 * <p>{@code is_new} is {@code true} when the request inserted a new
 * code_unit_dependencies row; {@code false} when the request matched an
 * existing row by the identity composite
 * {@code (source_application_point_id, target_application_point_id,
 * declared_name, declared_version)} (with NULL-tolerance for
 * {@code declared_version}).</p>
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 */
public record CodeUnitDependencyFindOrCreateResponse(
    @JsonProperty("id")
    String id,

    @JsonProperty("is_new")
    boolean isNew,

    @JsonProperty("code_unit_dependency")
    CodeUnitDependencyDto codeUnitDependency
) {}
