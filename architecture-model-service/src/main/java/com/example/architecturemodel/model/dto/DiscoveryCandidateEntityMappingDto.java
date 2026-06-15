package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * DTO for discovery candidate entity mappings (provenance tracking).
 *
 * Represents a mapping between a discovery candidate and a canonical meta-model
 * entity produced during a save-back operation. Used for both request (bulk insert)
 * and response (query) payloads on the REST API.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 *
 * @param id Mapping UUID
 * @param candidateId FK to discovery_candidate.id
 * @param runId Discovery run UUID this mapping was created during
 * @param entityType The model array key (e.g., applications, services)
 * @param entityId The generated or matched entity ID string (e.g., svc-mk8r1ccg-bd7tv)
 * @param action Whether the entity was created or reused
 * @param createdAt ISO-8601 timestamp of mapping creation
 */
public record DiscoveryCandidateEntityMappingDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("candidate_id")
    UUID candidateId,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("entity_type")
    String entityType,

    @JsonProperty("entity_id")
    String entityId,

    @JsonProperty("action")
    String action,

    @JsonProperty("created_at")
    String createdAt
) {}
