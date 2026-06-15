package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO record for a Data Entity Data Store Hosting relationship (XR2).
 *
 * Cross-domain wiring: Data Entity (via data_entity_points) -> Data Store
 * Instance.
 *
 * confidence is BigDecimal (DECIMAL(4,3) at the DB layer); no DB CHECK and no
 * JPA validation -- range is documentation-only.
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 * model_file_id is server-side only and not exposed.
 */
public record DataEntityDataStoreHostingDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("data_entity_point_id")
    String dataEntityPointId,

    @JsonProperty("data_store_instance_id")
    String dataStoreInstanceId,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("database_name")
    String databaseName,

    @JsonProperty("schema_name")
    String schemaName,

    @JsonProperty("table_or_collection_name")
    String tableOrCollectionName,

    @JsonProperty("hosting_role")
    String hostingRole,

    @JsonProperty("evidence_source")
    String evidenceSource,

    @JsonProperty("confidence")
    BigDecimal confidence,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
