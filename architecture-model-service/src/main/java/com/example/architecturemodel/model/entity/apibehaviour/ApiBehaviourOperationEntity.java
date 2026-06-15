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
 * Per-session inventory of OAS operations parsed for one capture session.
 *
 * <p>One row per HTTP method+path. Populated by the new service's
 * {@code POST /capture-sessions/{id}/parse-oas} action endpoint.</p>
 *
 * <h2>Selection vs. execution gating</h2>
 * <ul>
 *   <li>{@code included} — user-toggle in wizard step 4.</li>
 *   <li>{@code safe_to_execute} — server-set: TRUE for GET/HEAD/OPTIONS, plus
 *       PUT/POST/PATCH/DELETE only when the parent session has
 *       {@code mutating_calls_confirmed = TRUE}.</li>
 * </ul>
 *
 * <p>The {@code execute_http_request} tool gates on
 * {@code (included = TRUE AND safe_to_execute = TRUE)}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Entity
@Table(
    name = "api_behaviour_operations",
    indexes = {
        @Index(
            name = "idx_api_behaviour_operation_session",
            columnList = "session_id"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourOperationEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    /** OAS {@code operationId} when present in the spec — may be null. */
    @Column(name = "operation_id")
    private String operationId;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "path", nullable = false)
    private String path;

    @Column(name = "summary")
    private String summary;

    @Column(name = "description")
    private String description;

    /**
     * Boxed {@link Boolean} so PATCH preserves {@code null} when omitted.
     * Defaults to {@link Boolean#TRUE} on insert.
     */
    @Column(name = "included", nullable = false)
    @Builder.Default
    private Boolean included = Boolean.TRUE;

    /**
     * Server-set guard. Boxed {@link Boolean} so PATCH preserves {@code null}.
     */
    @Column(name = "safe_to_execute", nullable = false)
    @Builder.Default
    private Boolean safeToExecute = Boolean.FALSE;

    @Type(JsonType.class)
    @Column(name = "request_schema_json", columnDefinition = "jsonb")
    private Map<String, Object> requestSchemaJson;

    @Type(JsonType.class)
    @Column(name = "response_schema_json", columnDefinition = "jsonb")
    private Map<String, Object> responseSchemaJson;

    /**
     * The dereferenced OAS Operation Object (parameters, request body,
     * responses, etc.) verbatim.
     */
    @Type(JsonType.class)
    @Column(name = "oas_operation_json", columnDefinition = "jsonb", nullable = false)
    private Map<String, Object> oasOperationJson;

    /**
     * Reason an in-scope committed model endpoint was explicitly EXCLUDED
     * from capture. The row is persisted with {@code included = false} +
     * this reason; persistence IS the accounting record -- an
     * excluded-with-reason row still ACCOUNTS for its endpoint in inventory
     * reconciliation. {@code null} for ordinary (non-exclusion) rows.
     *
     * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1
     * (changeset 178).</p>
     */
    @Column(name = "exclusion_reason")
    private String exclusionReason;

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
