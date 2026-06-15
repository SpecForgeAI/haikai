package com.example.architecturemodel.model.entity.apibehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Per-operation scenario proposed by the LLM (or seeded from OAS examples /
 * DB samples / user edits).
 *
 * <p>Each scenario describes a single intended request shape; the
 * {@link ApiBehaviourCaptureEntity captures} table records actual execution
 * attempts against it.</p>
 *
 * <h2>Allowed enum-style values</h2>
 * <ul>
 *   <li>{@code scenario_type}: happy_path, not_found, validation_error,
 *       empty_result, boundary_value, auth_error, business_edge_case,
 *       generated_candidate.</li>
 *   <li>{@code status}: draft, executed_success, executed_error, accepted,
 *       rejected, needs_review.</li>
 *   <li>{@code generation_source}: oas_example, db_sample, llm_generated,
 *       llm_refined, user_edited.</li>
 * </ul>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Entity
@Table(
    name = "api_behaviour_scenarios",
    indexes = {
        @Index(name = "idx_api_behaviour_scenario_session", columnList = "session_id"),
        @Index(name = "idx_api_behaviour_scenario_operation", columnList = "operation_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourScenarioEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "operation_id", nullable = false)
    private UUID operationId;

    @Column(name = "scenario_name", nullable = false)
    private String scenarioName;

    @Column(name = "scenario_type", nullable = false)
    @Builder.Default
    private String scenarioType = "happy_path";

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "draft";

    @Column(name = "generation_source", nullable = false)
    @Builder.Default
    private String generationSource = "llm_generated";

    @Column(name = "request_method", nullable = false)
    private String requestMethod;

    @Column(name = "request_path", nullable = false)
    private String requestPath;

    @Type(JsonType.class)
    @Column(name = "request_query_json", columnDefinition = "jsonb")
    private Map<String, Object> requestQueryJson;

    @Type(JsonType.class)
    @Column(name = "request_headers_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> requestHeadersRedactedJson;

    @Type(JsonType.class)
    @Column(name = "request_body_json", columnDefinition = "jsonb")
    private Map<String, Object> requestBodyJson;

    @Column(name = "notes")
    private String notes;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    protected void onCreate() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
