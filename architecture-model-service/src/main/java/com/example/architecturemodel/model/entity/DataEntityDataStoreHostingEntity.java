package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * JPA entity representing a Data Entity Data Store Hosting relationship (XR2).
 *
 * Wires a Data Entity (via data_entity_points) to a Data Store Instance.
 *
 * Q7: environment_id is nullable on all 4 cross-domain relationships.
 *
 * description and tags are non-null TEXT (envelope contract). confidence is
 * nullable BigDecimal at scale 3 (no DB CHECK).
 *
 * Spec: 2026-05-05-infrastructure-cross-domain-integration
 */
@Entity
@Table(name = "data_entity_data_store_hostings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DataEntityDataStoreHostingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "data_entity_point_id", nullable = false)
    private String dataEntityPointId;

    @Column(name = "data_store_instance_id", nullable = false)
    private String dataStoreInstanceId;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "database_name")
    private String databaseName;

    @Column(name = "schema_name")
    private String schemaName;

    @Column(name = "table_or_collection_name")
    private String tableOrCollectionName;

    @Column(name = "hosting_role")
    private String hostingRole;

    @Column(name = "evidence_source")
    private String evidenceSource;

    @Column(name = "confidence", precision = 4, scale = 3)
    private BigDecimal confidence;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;
}
