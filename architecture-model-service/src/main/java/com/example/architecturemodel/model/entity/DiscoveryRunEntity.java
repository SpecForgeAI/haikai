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
 * JPA Entity for discovery run.
 *
 * Tracks Phase 1 discovery execution runs with per-step status tracking.
 * Multiple historical runs per project are supported; the active-run constraint
 * (only one PENDING or RUNNING run at a time) is enforced at the service layer.
 *
 * The configSnapshot captures the full Phase 0 discovery config at run creation
 * time for immutability and reproducibility. The stepsPayload tracks per-step
 * status for steps 1a, 1b, 1c, 1d.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * - Task Group 2: Entity, DTO, Repository, Service, Controller
 *
 * Spec: V3 Discovery Pipeline Foundation
 * - Adds the `mode` column (A/B/C tier) populated at run creation.
 *
 * Spec: V3 Tier UX
 * - Adds `confirmed_llm_solo` (explicit Tier C opt-in) and `warnings`
 *   (JSON-encoded string[] surfaced verbatim on DTO) columns.
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * - Adds `architecture_id` (UUID NOT NULL, FK to architecture(id)) to bind
 *   every discovery run to exactly one architecture for life. The user picks
 *   the target architecture at run start; that id is persisted here and
 *   propagates through every Discovery endpoint and every save-back to
 *   architecture-model-service. Children (discovery_evidence,
 *   discovery_relationship, discovery_cluster, discovery_candidate,
 *   discovery_decision_task) inherit the bound architecture via their
 *   run_id FK -- single source of truth, no drift risk.
 *
 * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) -- Task Group 1
 * - Adds `discovery_kind` (VARCHAR(32) NOT NULL DEFAULT 'code') discriminator
 *   so the same table can carry code-based runs (existing) and database-based
 *   runs (new). Allowed values: 'code' | 'database' | 'combined'. The
 *   'combined' value is reserved for a future spec and not emitted in v1.
 *   This column is DISTINCT from `mode` (A/B/C V3 pipeline tier) -- `mode`
 *   is HOW the run computes, `discoveryKind` is WHAT the run sees.
 *
 * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
 * - Adds the advisory `degraded` (nullable BOOLEAN) flag PLUS `degraded_reasons`
 *   (nullable TEXT, JSON-encoded string[]) columns, mirroring the `warnings`
 *   entity field exactly (nullable, no backfill, TEXT for portability). The
 *   flag rides ALONGSIDE the `status` column's `COMPLETED` value -- it is NOT a
 *   new terminal status. Nullable so legacy rows and runs that have not yet
 *   computed a degraded signal remain valid. Backed by Liquibase changeset
 *   169-discovery-run-degraded.sql.
 */
@Entity
@Table(
    name = "discovery_run",
    indexes = {
        @Index(name = "idx_discovery_run_project_id", columnList = "project_id", unique = false),
        @Index(name = "idx_discovery_run_project_arch", columnList = "project_id, architecture_id", unique = false),
        @Index(name = "idx_discovery_run_discovery_kind", columnList = "discovery_kind", unique = false)
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiscoveryRunEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    /**
     * The architecture this discovery run is bound to for its entire lifetime.
     * Picked explicitly by the user at run start (defaults to the URL active
     * architecture in the picker) and persisted here. Every entity-fetch and
     * save-back call for this run reads from this id, NOT from the URL active
     * id at the time of the call -- the binding is locked at run start.
     *
     * Pre-existing runs created before spec #4 are silently backfilled to the
     * project's `Default` architecture (architecture.id = project.id, per
     * spec #1's deterministic-Default rule).
     *
     * Spec: Discovery Service architectureId Integration (Spec #4)
     */
    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    /**
     * Optional service ID linking this run to a specific service entity.
     * When present, the run is service-scoped (scans only this service's repo).
     * When null, the run is project-level (existing behavior).
     */
    @Column(name = "service_id")
    private String serviceId;

    /**
     * V3 pipeline computed tier for this run. Values: "A", "B", "C", or null.
     *   - "A" = language pack + framework pack match
     *   - "B" = language pack match only
     *   - "C" = neither match
     *
     * Nullable so legacy pre-V3 runs (and runs that have not yet computed a tier)
     * remain valid. Spec: V3 Discovery Pipeline Foundation.
     */
    @Column(name = "mode", length = 1)
    private String mode;

    /**
     * Explicit Tier C (LLM-solo) opt-in flag. TRUE only when the operator
     * acknowledged the Tier C warnings via `confirmLlmSolo: true` on the
     * discovery-service gate and the run proceeded in LLM-solo mode.
     * FALSE for Tier A, Tier B, and all legacy rows (no backfill).
     *
     * Spec: V3 Tier UX.
     */
    @Column(name = "confirmed_llm_solo", nullable = false)
    @Builder.Default
    private boolean confirmedLlmSolo = false;

    /**
     * Raw JSON-encoded `string[]` of tier warnings synthesized at run creation
     * (e.g. `["Discovery will run in language-only mode. ..."]` for Tier B).
     *
     * Stored verbatim — architecture-model-service does not parse or validate
     * the contents. Null for runs with no warnings (Tier A) and for legacy rows.
     *
     * Spec: V3 Tier UX.
     */
    @Column(name = "warnings", columnDefinition = "TEXT")
    private String warnings;

    /**
     * Advisory run-integrity flag. TRUE when the run COMPLETED but the captured
     * model may be partial/incomplete (e.g. a framework scanner threw at a
     * soft-fail catch site, the gap-fill stage failed or some files failed, a
     * method/token cap was hit, or a contract/runtime pass failed). The set of
     * concrete reasons is carried verbatim in {@link #degradedReasons}.
     *
     * This flag rides ALONGSIDE the {@code status} column's {@code COMPLETED}
     * value -- it is NOT a new terminal status and does NOT change the
     * discovery-service state machine. It is advisory only; a degraded run still
     * COMPLETES.
     *
     * Nullable (no backfill): legacy rows and runs that have not yet computed a
     * degraded signal remain valid with a null flag. The discovery-service is
     * the canonical producer; architecture-model-service persists/surfaces it.
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1.
     */
    @Column(name = "degraded")
    private Boolean degraded;

    /**
     * Raw JSON-encoded `string[]` of the reasons {@link #degraded} tripped
     * (e.g. `["scanner_failed", "files_failed", "method_cap_hit"]`).
     *
     * Stored verbatim — architecture-model-service does not parse or validate
     * the contents, exactly mirroring the {@link #warnings} precedent. Null when
     * the run is not degraded and for legacy rows. TEXT (not JSONB) for
     * Liquibase portability, matching `warnings`.
     *
     * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1.
     */
    @Column(name = "degraded_reasons", columnDefinition = "TEXT")
    private String degradedReasons;

    /**
     * Source kind of the run: what the run sees.
     *
     * Allowed values:
     *   - "code"     (default) -- existing code-pack discovery (filesystem scan,
     *                              framework adapters, language packs).
     *   - "database" -- a database discovery run via the PostgreSQL or Sybase
     *                   pack (introspection + profiling + relationship inference).
     *   - "combined" -- RESERVED for a future spec that mixes code + DB sources
     *                   in a single run. NOT emitted in v1; validators MUST
     *                   accept the value (it is in the allowed set) but no v1
     *                   producer path creates it.
     *
     * NOT NULL with DB DEFAULT 'code' (Liquibase changeset 137). The Java
     * field is initialised to "code" so a builder-constructed entity that
     * omits this field still satisfies the NOT NULL contract.
     *
     * This column is DISTINCT from `mode` (A/B/C V3 pipeline tier). `mode`
     * describes HOW the run is computed; `discoveryKind` describes WHAT the
     * run sees. Do NOT conflate.
     *
     * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) -- Task Group 1.
     */
    @Column(name = "discovery_kind", nullable = false, length = 32)
    @Builder.Default
    private String discoveryKind = "code";

    @Column(name = "status", nullable = false)
    @Builder.Default
    private String status = "PENDING";

    @Column(name = "current_step")
    private String currentStep;

    /**
     * Immutable snapshot of the Phase 0 discovery config JSON captured at run creation time.
     */
    @Type(JsonType.class)
    @Column(name = "config_snapshot", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> configSnapshot = new HashMap<>();

    /**
     * Per-step status tracking as JSONB.
     * Default structure: { "1a": { "status": "pending" }, "1b": { "status": "pending" },
     *                      "1c": { "status": "pending" }, "1d": { "status": "pending" } }
     */
    @Type(JsonType.class)
    @Column(name = "steps_payload", columnDefinition = "jsonb", nullable = false)
    @Builder.Default
    private Map<String, Object> stepsPayload = new HashMap<>(Map.of(
        "1a", Map.of("status", "pending"),
        "1b", Map.of("status", "pending"),
        "1c", Map.of("status", "pending"),
        "1d", Map.of("status", "pending")
    ));

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
        // Defence-in-depth: the @Builder.Default initializer on the field already
        // ensures `discoveryKind` is non-null for builder-constructed entities,
        // but the no-args/all-args constructors (used by Jackson / JPA reflection)
        // can bypass the initializer. Apply the 'code' default here so a freshly
        // persisted row never violates the NOT NULL contract regardless of the
        // construction path. Spec: Database Discovery Packs (2026-05-16) -- TG1.
        if (discoveryKind == null) {
            discoveryKind = "code";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
