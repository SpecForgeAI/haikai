package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryClusterMemberEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryClusterMemberEntity.
 *
 * Provides finder methods for cluster members. Members are primarily managed
 * through the cluster entity's @OneToMany cascade, but this repository is
 * available for cases where members need to be queried independently (e.g.,
 * if members are not eagerly loaded with the cluster).
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 */
@Repository
public interface DiscoveryClusterMemberRepository extends JpaRepository<DiscoveryClusterMemberEntity, UUID> {

    /**
     * Find all members for a specific cluster.
     *
     * @param clusterId the cluster UUID
     * @return list of member entities belonging to the cluster
     */
    List<DiscoveryClusterMemberEntity> findByClusterId(UUID clusterId);
}
