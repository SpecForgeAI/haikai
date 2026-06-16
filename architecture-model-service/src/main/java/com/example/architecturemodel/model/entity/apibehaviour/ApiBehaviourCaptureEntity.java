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
 * Per-attempt request/response capture row.
 *
 * <p>The {@code execute_http_request} tool writes one row per attempt (up to 3
 * retries per scenario per spec). Reviewer accept/reject toggles
 * {@code accepted}; only accepted captures become baseline items.</p>
 *
 * <p>All persisted JSON columns are pre-redacted by the new service's
 * {@code src/services/redactor.ts} — secret values must never appear in this
 * table.</p>
 *
 * <p><b>Numeric columns</b> ({@code attempt_number}, {@code response_status},
 * {@code duration_ms}) are <b>boxed</b> {@link Integer} so PATCH semantics
 * preserve {@code null} when the client omits the field. Primitive
 * {@code int} silently defaults to {@code 0} on missing JSON, which would
 * corrupt the column. See project memory note
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1</p>
 */
@Entity
@Table(
    name = "api_behaviour_captures",
    indexes = {
        @Index(name = "idx_api_behaviour_capture_session", columnList = "session_id"),
        @Index(name = "idx_api_behaviour_capture_scenario", columnList = "scenario_id"),
        @Index(name = "idx_api_behaviour_capture_operation", columnList = "operation_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourCaptureEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "scenario_id", nullable = false)
    private UUID scenarioId;

    @Column(name = "operation_id", nullable = false)
    private UUID operationId;

    /**
     * 1-indexed attempt counter (1, 2, 3 max per scenario per spec).
     * Boxed {@link Integer} so PATCH preserves {@code null}.
     */
    @Column(name = "attempt_number", nullable = false)
    @Builder.Default
    private Integer attemptNumber = 1;

    @Column(name = "request_method", nullable = false)
    private String requestMethod;

    /**
     * Fully-resolved request URL with any token/secret query params redacted.
     */
    @Column(name = "request_url_redacted", nullable = false)
    private String requestUrlRedacted;

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

    /** Boxed {@link Integer} so PATCH preserves {@code null}. */
    @Column(name = "response_status")
    private Integer responseStatus;

    @Type(JsonType.class)
    @Column(name = "response_headers_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> responseHeadersRedactedJson;

    @Type(JsonType.class)
    @Column(name = "response_body_json", columnDefinition = "jsonb")
    private Map<String, Object> responseBodyJson;

    /** Boxed {@link Integer} so PATCH preserves {@code null}. */
    @Column(name = "duration_ms")
    private Integer durationMs;

    /**
     * Optional taxonomy: timeout, connection_refused, http_error,
     * redaction_warning, etc. Free-text — not constrained at the DB level.
     */
    @Column(name = "error_type")
    private String errorType;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "captured_at", nullable = false)
    private Instant capturedAt;

    /**
     * Reviewer flag. Boxed {@link Boolean} so PATCH preserves {@code null}.
     * Only accepted captures are eligible to land in {@code baseline_items}
     * on save-as-baseline.
     */
    @Column(name = "accepted", nullable = false)
    @Builder.Default
    private Boolean accepted = Boolean.FALSE;

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "reviewer_notes")
    private String reviewerNotes;

    /**
     * Empirically-measured volatility envelope {@code { paths, volatility_source,
     * k }} (and optionally {@code array_paths}) MEASURED at capture time by the
     * capture-time volatility probe (in {@code execute_http_request}, the only
     * moment the current system is authoritative and callable through a live
     * executor). Carried forward verbatim onto the source baseline item's own
     * {@code volatile_paths_json} on Save-as-baseline, where the reconcile diff
     * engine consumes it. The current-state baseline is pinned by a
     * frontend-&gt;AMS write, NOT a server-side route, so the envelope cannot be
     * measured at pin time -- it is measured at capture and carried forward.
     *
     * <p>{@code null} means NO volatility recorded =&gt; strict comparison (the
     * backward-compatible default; today's behaviour). {@code null} is
     * distinguishable from a probed-but-non-JSON body (a non-null envelope
     * tagged {@code volatility_source: "non_json"}). Write-once at capture
     * create time; there is deliberately NO PATCH path.</p>
     *
     * <p>Spec: Reconcile-Time Determinism &amp; Volatile-Value Handling
     * (2026-06-16) — FU-2 (probe-at-capture wiring).</p>
     */
    @Type(JsonType.class)
    @Column(name = "volatile_paths_json", columnDefinition = "jsonb")
    private Map<String, Object> volatilePathsJson;

    @PrePersist
    protected void onCreate() {
        if (capturedAt == null) {
            capturedAt = Instant.now();
        }
    }
}
