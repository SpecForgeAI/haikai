package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for ApplicationPoint entity.
 *
 * Spec: Expand Application Points to Reference Service/Class/Method
 * - target_type: SERVICE, CLASS, or METHOD
 * - target_ref_id: UUID of the targeted entity
 */
public record ApplicationPointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("application_id")
    String applicationId,

    @JsonProperty("application_component_id")
    String applicationComponentId,

    @JsonProperty("service_id")
    String serviceId,

    @JsonProperty("interface_id")
    String interfaceId,

    /**
     * Target type for precise targeting of Service, Class, or Method.
     * Valid values: SERVICE, CLASS, METHOD
     */
    @JsonProperty("target_type")
    String targetType,

    /**
     * Target reference ID - UUID of the targeted Service, Class, or Method.
     * Must reference a valid entity based on target_type.
     */
    @JsonProperty("target_ref_id")
    String targetRefId,

    @JsonProperty("point_type")
    String pointType,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
