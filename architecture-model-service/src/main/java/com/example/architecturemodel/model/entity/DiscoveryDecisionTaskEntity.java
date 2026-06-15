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
 * JPA Entity for discovery decision task records.
 *
 * Each decision task represents an ambiguous or competing candidate relationship
 * that requires LLM resolution during Phase 1b relationship inference triage.
 * Tasks are scoped to a discovery run and carry structured input/output data
 * payloads for the LLM resolution process.
 *
 * Task types:
 * - confirm_relationship: single ambiguous candidate requiring LLM confirmation
 * - resolve_competing_relationships: multiple competing candidates for same source
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * - Task Group 5: Liquibase Migration and JPA Entity Stack
 */
@Entity
@Table(
    name = "discovery_decision_task",
    indexes = {
        @Index(name = "idx_discovery_decision_task_run_id", columnList = "run_id", unique = false),
        @Index(name = "idx_discovery_decision_task_run_id_status", columnList = "run_id, status", unique = false),
        @Index(name = "idx_discovery_decision_task_run_id_task_type", columnList = "run_id, task_type", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryDecisionTaskEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "run_id", nullable = false)
    private UUID runId;

    @Column(name = "task_type", nullable = false)
    private String taskType;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "pending";

    /**
     * Structured input data for the LLM resolution process, stored as JSONB.
     * Shape depends on task_type (ConfirmRelationshipInput or ResolveCompetingInput).
     */
    @Type(JsonType.class)
    @Column(name = "input_data", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> inputData = new HashMap<>();

    /**
     * LLM decision and reasoning output, stored as JSONB.
     * Nullable; populated when status transitions to resolved or failed.
     */
    @Type(JsonType.class)
    @Column(name = "output_data", columnDefinition = "jsonb")
    private Map<String, Object> outputData;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (status == null) {
            status = "pending";
        }
    }
}
