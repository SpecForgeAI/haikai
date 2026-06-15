package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.util.UUID;

/**
 * JPA Entity for discovery cluster member records.
 *
 * Each cluster member represents a reference to either an evidence atom (1a) or
 * a relationship (1b) that belongs to a cluster formed during Phase 1c cluster
 * formation. The member_type discriminator indicates whether the member_id
 * references the discovery_evidence table ('atom') or the discovery_relationship
 * table ('relationship').
 *
 * Referential integrity for member_id is enforced at the application layer
 * because the target table varies based on member_type (polymorphic reference).
 *
 * This entity has no separate REST controller -- members are managed through
 * the cluster service's bulk create and read operations.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 */
@Entity
@Table(
    name = "discovery_cluster_member",
    indexes = {
        @Index(name = "idx_discovery_cluster_member_cluster_id", columnList = "cluster_id", unique = false),
        @Index(name = "idx_discovery_cluster_member_cluster_id_type", columnList = "cluster_id, member_type", unique = false),
        @Index(name = "idx_discovery_cluster_member_member_id", columnList = "member_id", unique = false)
    },
    uniqueConstraints = {
        @UniqueConstraint(
            name = "uq_cluster_member_type_id",
            columnNames = {"cluster_id", "member_type", "member_id"}
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryClusterMemberEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "cluster_id", nullable = false)
    private UUID clusterId;

    @Column(name = "member_type", nullable = false)
    private String memberType;

    @Column(name = "member_id", nullable = false)
    private UUID memberId;
}
