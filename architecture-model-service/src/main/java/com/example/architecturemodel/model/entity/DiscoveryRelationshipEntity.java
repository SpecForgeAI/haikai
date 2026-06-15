package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * JPA Entity for discovery relationship records.
 *
 * Each relationship represents an inferred link between two Phase 1a evidence
 * atoms (source and target) during Phase 1b relationship inference. Relationships
 * are scoped to a discovery run and carry a confidence score and type-specific
 * data payload.
 *
 * The data field is a type-specific JSONB payload whose shape depends on the
 * relationship type (imports, calls, extends, contains, uses_data, defines,
 * references).
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 2: Relationship JPA Stack (1b)
 */
@Entity
@Table(
    name = "discovery_relationship",
    indexes = {
        @Index(name = "idx_discovery_relationship_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_discovery_relationship_run_id_type", columnList = "run_id, relationship_type", unique = false),
        @Index(name = "idx_discovery_relationship_source_atom_id", columnList = "source_atom_id", unique = false),
        @Index(name = "idx_discovery_relationship_target_atom_id", columnList = "target_atom_id", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryRelationshipEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "source_atom_id", nullable = false)
    private UUID sourceAtomId;

    @Column(name = "target_atom_id", nullable = false)
    private UUID targetAtomId;

    @Column(name = "relationship_type", nullable = false)
    private String relationshipType;

    @Column(name = "confidence", nullable = false)
    private double confidence;

    /**
     * Type-specific relationship payload stored as JSONB.
     */
    @Type(JsonType.class)
    @Column(name = "data", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> data = new HashMap<>();

    @Column(name = "inferred_at", nullable = false)
    @Builder.Default
    private Instant inferredAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (inferredAt == null) {
            inferredAt = Instant.now();
        }
    }
}
