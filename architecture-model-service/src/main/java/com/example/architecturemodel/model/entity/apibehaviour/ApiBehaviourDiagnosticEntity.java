package com.example.architecturemodel.model.entity.apibehaviour;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.PrePersist;
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
 * Per-session diagnostic note emitted by the orchestrator and tools.
 *
 * <p>Useful for debugging which scenarios failed, why an endpoint was skipped,
 * why the LLM loop hit its hard limit, etc. {@code operation_id} and
 * {@code scenario_id} are nullable: a diagnostic may apply to the whole
 * session (e.g. {@code auth_failure} on the {@code test-api-connection}
 * probe) and not be tied to a specific operation/scenario.</p>
 *
 * <p>Allowed {@code diagnostic_type} values (validated at service layer):
 * failed_request, auth_failure, db_sample_failure, llm_generation_failure,
 * redaction_warning, endpoint_skipped, retry_exhausted.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Entity
@Table(
    name = "api_behaviour_diagnostics",
    indexes = {
        @Index(
            name = "idx_api_behaviour_diagnostic_session",
            columnList = "session_id"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourDiagnosticEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "operation_id")
    private UUID operationId;

    @Column(name = "scenario_id")
    private UUID scenarioId;

    @Column(name = "diagnostic_type", nullable = false)
    private String diagnosticType;

    @Column(name = "message", nullable = false)
    private String message;

    /**
     * Optional structured detail bag (e.g. response status, error code,
     * llm round count). Must be pre-redacted.
     */
    @Type(JsonType.class)
    @Column(name = "detail_json", columnDefinition = "jsonb")
    private Map<String, Object> detailJson;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }
}
