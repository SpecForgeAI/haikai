package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing the journey object in the User Journey diagram contract v1.
 * Contains journey metadata with resolved linked entity names.
 */
public record UserJourneyDiagramJourneyDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("user_role_id")
    String userRoleId,

    @JsonProperty("user_role_name")
    String userRoleName,

    @JsonProperty("parent_business_process_id")
    String parentBusinessProcessId,

    @JsonProperty("parent_business_process_name")
    String parentBusinessProcessName
) {}
