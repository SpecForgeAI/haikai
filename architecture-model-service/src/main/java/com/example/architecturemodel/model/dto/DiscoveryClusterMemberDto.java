package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * DTO for discovery cluster members.
 *
 * Represents a single member of a discovery cluster -- either an evidence atom
 * (member_type='atom') or a relationship (member_type='relationship'). Members
 * are nested within the cluster DTO and managed through cluster operations.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 *
 * @param id Member UUID
 * @param clusterId UUID of the parent cluster
 * @param memberType Member type discriminator ('atom' or 'relationship')
 * @param memberId UUID of the referenced atom or relationship
 */
public record DiscoveryClusterMemberDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("cluster_id")
    UUID clusterId,

    @JsonProperty("member_type")
    String memberType,

    @JsonProperty("member_id")
    UUID memberId
) {}
