package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery clusters.
 *
 * Represents a group of related evidence atoms and/or relationships formed
 * during Phase 1c cluster formation. Includes a nested list of member DTOs
 * so that membership is managed through the cluster's bulk insert and read
 * operations.
 *
 * Data flow position: 1a atoms -> 1b relationships -> **1c clusters** -> 1d candidates
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 *
 * @param id Cluster UUID
 * @param runId Discovery run UUID this cluster belongs to
 * @param clusterType Cluster type (service_boundary, data_domain, shared_library, api_layer, ui_module)
 * @param name Optional human-readable cluster label
 * @param confidence Confidence score (0.0 to 1.0)
 * @param members List of cluster member DTOs (atoms and/or relationships)
 * @param data Cluster metadata JSONB payload
 * @param formedAt ISO-8601 timestamp of cluster formation
 */
public record DiscoveryClusterDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("cluster_type")
    String clusterType,

    @JsonProperty("name")
    String name,

    @JsonProperty("confidence")
    double confidence,

    @JsonProperty("members")
    List<DiscoveryClusterMemberDto> members,

    @JsonProperty("data")
    Map<String, Object> data,

    @JsonProperty("formed_at")
    String formedAt
) {}
