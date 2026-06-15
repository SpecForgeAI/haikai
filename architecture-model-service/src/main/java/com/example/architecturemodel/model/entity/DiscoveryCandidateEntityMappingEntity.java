package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for discovery candidate entity mapping records (provenance tracking).
 *
 * Each mapping records which discovery candidate was mapped to which canonical
 * meta-model entity during a save-back operation. The action field indicates
 * whether the entity was newly created or reused (matched an existing entity
 * by name).
 *
 * This enables richer querying and traceability of which discovery run and
 * candidate produced each entity in the canonical model.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 */
@Entity
@Table(
    name = "discovery_candidate_entity_mapping",
    indexes = {
        @Index(name = "idx_candidate_entity_mapping_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_candidate_entity_mapping_candidate_id", columnList = "candidate_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryCandidateEntityMappingEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "candidate_id", nullable = false)
    private UUID candidateId;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "entity_type", nullable = false)
    private String entityType;

    @Column(name = "entity_id", nullable = false)
    private String entityId;

    @Column(name = "action", nullable = false)
    private String action;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
