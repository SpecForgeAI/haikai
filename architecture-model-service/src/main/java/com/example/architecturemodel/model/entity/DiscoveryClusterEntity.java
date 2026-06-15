package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for discovery cluster records.
 *
 * Each cluster represents a group of related evidence atoms and/or relationships
 * formed during Phase 1c cluster formation. Clusters are scoped to a discovery
 * run and carry a confidence score, cluster type, and optional name. Cluster
 * membership is managed via a @OneToMany relationship to DiscoveryClusterMemberEntity
 * with CascadeType.ALL and orphanRemoval.
 *
 * The data field is a JSONB payload containing cluster metadata such as dominant
 * language, directory root, member summary counts, etc.
 *
 * Data flow position: 1a atoms -> 1b relationships -> **1c clusters** -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 */
@Entity
@Table(
    name = "discovery_cluster",
    indexes = {
        @Index(name = "idx_discovery_cluster_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_discovery_cluster_run_id_type", columnList = "run_id, cluster_type", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryClusterEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "cluster_type", nullable = false)
    private String clusterType;

    @Column(name = "name")
    private String name;

    @Column(name = "confidence", nullable = false)
    private double confidence;

    /**
     * Cluster metadata stored as JSONB.
     */
    @Type(JsonType.class)
    @Column(name = "data", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> data = new HashMap<>();

    @Column(name = "formed_at", nullable = false)
    @Builder.Default
    private Instant formedAt = Instant.now();

    /**
     * Cluster members -- atoms and/or relationships that belong to this cluster.
     * Cascaded so that persisting a cluster also persists its members.
     */
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @JoinColumn(name = "cluster_id", referencedColumnName = "id")
    @Builder.Default
    private List<DiscoveryClusterMemberEntity> members = new ArrayList<>();

    @PrePersist
    protected void onCreate() {
        if (formedAt == null) {
            formedAt = Instant.now();
        }
    }
}
