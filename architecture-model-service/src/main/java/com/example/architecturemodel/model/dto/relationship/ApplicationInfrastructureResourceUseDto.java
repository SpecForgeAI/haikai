package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for an Application Infrastructure Resource Use relationship
 * (XR3).
 *
 * Cross-domain wiring: Application (via application_points) -> Infrastructure
 * Resource (bucket, queue, topic, cache, secret store, scheduler, registry,
 * CDN, etc.).
 *
 * confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK and no
 * JPA validation -- range is documentation-only.
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 * model_file_id is server-side only and not exposed.
 */
public record ApplicationInfrastructureResourceUseDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("application_point_id")
    String applicationPointId,

    @JsonProperty("infrastructure_resource_id")
    String infrastructureResourceId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("dependency_type")
    String dependencyType,

    @JsonProperty("protocol")
    String protocol,

    @JsonProperty("endpoint_or_topic")
    String endpointOrTopic,

    @JsonProperty("access_mode")
    String accessMode,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
