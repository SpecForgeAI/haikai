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
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Root JPA entity for an API Behaviour capture session.
 *
 * <p>Each row represents a single configured / in-flight / terminal run of the
 * LLM-guided capture loop against a non-prod current-state API, OR a replay
 * session driven by {@code targetReplayRunner.ts} against a target URL (see
 * the kind discriminator below). The session is project- and architecture-
 * scoped (mirrors the pattern from
 * {@link com.example.architecturemodel.model.entity.DiscoveryRunEntity}).</p>
 *
 * <h2>Status lifecycle</h2>
 * Valid {@code status} values (validated at the service layer):
 * <ul>
 *   <li>{@code draft} — wizard step 1-4, secrets not yet supplied.</li>
 *   <li>{@code configured} — wizard committed, plaintext secrets held in the
 *       new service's in-memory {@code secretsStore}, ready to start.</li>
 *   <li>{@code running} — orchestrator executing scenarios.</li>
 *   <li>{@code completed} — terminal: all scenarios attempted.</li>
 *   <li>{@code failed} — terminal: aborted (notable {@code error_message}
 *       value: {@code secrets_lost_during_run}).</li>
 *   <li>{@code cancelled} — terminal: user-cancelled.</li>
 * </ul>
 *
 * <h2>Secrets policy</h2>
 * Plaintext credentials are NEVER persisted here — only the
 * {@code *_redacted_json} columns hold structural shape (auth_type, header
 * names with values omitted, base URL, db host/port/db, schema, username).
 * Plaintext lives in the new service's in-memory {@code secretsStore} only
 * while {@code status} is {@code configured} or {@code running}; purged on
 * any terminal status. Process restart loses secrets — UI re-prompts or marks
 * any session that was {@code running} {@code failed} with
 * {@code error_message='secrets_lost_during_run'} (startup reconciliation).
 *
 * <h2>Kind discriminator (Spec: 2026-05-25 API Test Harness — Target-Side Capture)</h2>
 * <p>The {@code kind} column distinguishes a current-state capture session
 * (LLM-driven) from a target-side replay session driven by
 * {@code targetReplayRunner.ts}. Valid values: {@code current} | {@code target}.
 * Validated at the service layer. {@code sourceBaselineId} is the FK from a
 * target session at the source current-state baseline it is replaying;
 * service-layer invariant: target sessions MUST have a non-null source;
 * current sessions MUST have it null. ON DELETE SET NULL keeps a target
 * session alive as a historical record if its source baseline is deleted.</p>
 *
 * <p>Spec: API Behaviour Baseline Capture Service (2026-05-15) — Task Group 1
 * (initial fields). API Test Harness — Target-Side Capture (2026-05-25) —
 * Task Group 1 (kind + sourceBaselineId).</p>
 */
@Entity
@Table(
    name = "api_behaviour_capture_sessions",
    indexes = {
        @Index(
            name = "idx_api_behaviour_capture_session_proj_arch_status",
            columnList = "project_id, architecture_id, status"
        )
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ApiBehaviourCaptureSessionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Column(name = "name")
    private String name;

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "draft";

    @Column(name = "environment_name")
    private String environmentName;

    @Column(name = "api_base_url")
    private String apiBaseUrl;

    @Column(name = "auth_type")
    private String authType;

    /**
     * Redacted auth shape (auth_type, header names with values omitted).
     * Plaintext credentials NEVER persisted — only structural shape lands
     * here. See class Javadoc for the full secrets policy.
     */
    @Type(JsonType.class)
    @Column(name = "auth_config_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> authConfigRedactedJson;

    /**
     * Default request headers with secret values redacted (header NAMES
     * retained, values stripped to placeholder).
     */
    @Type(JsonType.class)
    @Column(name = "default_headers_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> defaultHeadersRedactedJson;

    /**
     * List of OAS source refs (existing Interface ids selected in step 1
     * and/or ad-hoc upload metadata). Raw OAS bytes are NOT persisted here.
     */
    @Type(JsonType.class)
    @Column(name = "oas_spec_refs_json", columnDefinition = "jsonb")
    private Map<String, Object> oasSpecRefsJson;

    /**
     * Optional DB sampling config (host/port/db/schema/username + dbType +
     * allowlists). Password NEVER persisted; lives in the new service
     * {@code secretsStore} only.
     */
    @Type(JsonType.class)
    @Column(name = "db_config_redacted_json", columnDefinition = "jsonb")
    private Map<String, Object> dbConfigRedactedJson;

    /**
     * Per-session confirmation that mutating verbs (PUT/POST/PATCH/DELETE) are
     * allowed. Toggleable in the wizard while {@code status} is {@code draft};
     * locked once {@code status} moves to {@code configured}.
     *
     * <p><b>Boxed</b> {@link Boolean} so PATCH semantics preserve {@code null}
     * when the client omits the field — primitive {@code boolean} silently
     * defaults to {@code false} during Jackson deserialisation, which would
     * corrupt a previously-confirmed value. See project memory note
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "mutating_calls_confirmed", nullable = false)
    @Builder.Default
    private Boolean mutatingCallsConfirmed = Boolean.FALSE;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    /**
     * Terminal-failure detail. Notable value: {@code secrets_lost_during_run}
     * (set by startup reconciliation when a session was {@code running} at
     * process restart).
     */
    @Column(name = "error_message")
    private String errorMessage;

    /**
     * Per-run scenario outcome tallies (changeset 171, misleading-COMPLETED
     * fix). A session is {@code completed} whenever there is no INFRASTRUCTURE
     * error — every scenario can fail and it still reads COMPLETED; these
     * tallies let the dashboard render "Completed — 0 of N scenarios captured".
     * Nullable: legacy rows (and sessions whose runner predates the fix) carry
     * {@code null} = "counts not recorded".
     *
     * <p>Boxed {@link Integer} — PATCH-mutable numerics must be boxed per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "scenarios_attempted")
    private Integer scenariosAttempted;

    @Column(name = "scenarios_completed")
    private Integer scenariosCompleted;

    @Column(name = "scenarios_errored")
    private Integer scenariosErrored;

    /**
     * Discriminator. Valid values: {@code current} | {@code target}.
     * Validated at the service layer.
     *
     * <p>Reference type ({@link String}) — no primitive-wipe risk per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "kind", nullable = false)
    @Builder.Default
    private String kind = "current";

    /**
     * FK from a target session at the source current-state baseline it is
     * replaying. Service-layer invariant: target sessions MUST have a non-null
     * source; current sessions MUST have it null.
     *
     * <p>Reference type ({@link UUID}) — no primitive-wipe risk per
     * {@code project_primitive_double_dto_overwrite.md}.</p>
     */
    @Column(name = "source_baseline_id")
    private UUID sourceBaselineId;

    /**
     * Persisted interface scope for inventory reconciliation (JSON array of
     * Interface ids). {@code null} = whole-architecture scope (ad-hoc upload
     * sessions, legacy sessions) -- nothing silently absent. Written by
     * {@code parse-oas} (interface-selected branch) and by the inventory
     * reconciliation endpoint when {@code persist_scope=true}.
     *
     * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1
     * (changeset 178).</p>
     */
    @Type(JsonType.class)
    @Column(name = "scope_interface_ids_json", columnDefinition = "jsonb")
    private List<String> scopeInterfaceIdsJson;

    /**
     * Justification persisted when session Start is explicitly overridden
     * while in-scope committed endpoints are unaccounted. {@code null} = no
     * override. Spec: Model-Seeded Capture Inventory (2026-06-11), changeset
     * 178.
     */
    @Column(name = "coverage_override_justification")
    private String coverageOverrideJustification;

    /**
     * Unaccounted in-scope endpoint count AT OVERRIDE TIME (audit record).
     * Boxed {@link Integer} -- PATCH-mutable numerics must be boxed per
     * {@code project_primitive_double_dto_overwrite.md}.
     */
    @Column(name = "coverage_override_unaccounted_count")
    private Integer coverageOverrideUnaccountedCount;

    /** Timestamp of the Start coverage override. {@code null} = no override. */
    @Column(name = "coverage_override_at")
    private Instant coverageOverrideAt;

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
