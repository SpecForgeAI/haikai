package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for a ResourceSubnetHosting relationship (R1).
 *
 * Polymorphic source via infrastructure_point_id; the relationship attaches an
 * infrastructure point (e.g. compute resource, load balancer, infrastructure
 * resource) to a subnet within an environment.
 *
 * Q4: confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK
 * and no JPA validation -- range is documentation-only.
 *
 * Spec: 2026-05-04-infrastructure-domain-backend-foundation
 * model_file_id is server-side only and not exposed.
 */
public record ResourceSubnetHostingDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("infrastructure_point_id")
    String infrastructurePointId,

    @JsonProperty("subnet_id")
    String subnetId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("relationship_role")
    String relationshipRole,

    @JsonProperty("primary_ip")
    String primaryIp,

    @JsonProperty("private_ip")
    String privateIp,

    @JsonProperty("public_ip")
    String publicIp,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("tags")
    String tags
,

    // ========================================================================
    // Provenance fields (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
    // ========================================================================

    @JsonProperty("source_origin")
    String sourceOrigin,

    @JsonProperty("source_system")
    String sourceSystem,

    @JsonProperty("source_reference")
    String sourceReference,

    @JsonProperty("generation_status")
    String generationStatus,

    @JsonProperty("generation_notes")
    String generationNotes,

    @JsonProperty("last_verified_at")
    String lastVerifiedAt
) {}
