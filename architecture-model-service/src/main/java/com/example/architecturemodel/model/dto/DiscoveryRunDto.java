package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery run.
 *
 * Represents a discovery run persisted via the REST API, including
 * the config snapshot, per-step status payload, lifecycle status,
 * and metadata timestamps.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * Task Group 2: Entity, DTO, Repository, Service, Controller
 *
 * Spec: V3 Tier UX
 * - Adds `tier` (derived from `mode` on every read — same single-char A/B/C
 *   value, exposed under both names for API consumer clarity).
 * - Adds `warnings` (JSON-encoded string[] passed through verbatim from the
 *   discovery-service V3 gate; null for runs without warnings).
 * - Adds `confirmedLlmSolo` (TRUE iff the operator explicitly opted into the
 *   Tier C LLM-solo gate via `confirmLlmSolo: true`; FALSE otherwise).
 *
 * Spec: Discovery Run Robustness (2026-05-11) — Section 3
 * - Adds `architectureId` at record position 3 (between `projectId` and
 *   `serviceId`, matching `DiscoveryRunEntity` field order). The column has
 *   been NOT NULL in the DB since changeset 091; previously the DTO silently
 *   omitted the field which blocked the frontend "Save to canonical model"
 *   modal from resolving the architecture name.
 *
 * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) -- Task Group 1
 * - Adds `discoveryKind` (JSON property `discovery_kind`) carrying the source
 *   kind of the run ('code' | 'database' | 'combined'). Default 'code' for
 *   back-compat with existing clients that omit the field on create. The
 *   column is non-PATCH (set at create only) so update handlers must NOT
 *   overwrite it on PATCH/PUT.
 *
 * Spec: Oracle Integrity & Determinism (2026-05-30) -- Task Group 1
 * - Adds the advisory `degraded` (boxed Boolean, JSON property `degraded`) flag
 *   PLUS a structured `degradedReasons` (JSON-encoded string, JSON property
 *   `degraded_reasons`) payload, modelled EXACTLY on the existing advisory
 *   `warnings` field (per-field snake_case @JsonProperty, NO @CamelCaseWire,
 *   passed through verbatim, null when absent). The flag rides ALONGSIDE the
 *   `COMPLETED` status -- it is NOT a new terminal status enum value and does
 *   NOT touch the discovery-service `validateStatusTransition` state machine.
 *   Boxed Boolean (never primitive) so a PATCH carrying no value preserves the
 *   existing value rather than wiping it to false (see project memory
 *   primitive_double_dto_overwrite). The update handler applies a non-clobber
 *   null-guard, mirroring `warnings`.
 *
 * @param id Internal database UUID
 * @param projectId Project identifier
 * @param architectureId Architecture identifier (NOT NULL since changeset 091). Spec: Discovery Run Robustness.
 * @param serviceId Optional service identifier for service-scoped runs (null for project-level)
 * @param mode V3 pipeline computed tier ("A", "B", "C", or null). Spec: V3 Discovery Pipeline Foundation.
 * @param tier V3 tier derived from `mode` on every read (same value). Spec: V3 Tier UX.
 * @param warnings JSON-encoded string[] of tier warnings, passed through verbatim. Null when absent. Spec: V3 Tier UX.
 * @param confirmedLlmSolo TRUE when the run is an explicit Tier C LLM-solo opt-in. Spec: V3 Tier UX.
 * @param discoveryKind Source kind of the run ('code' | 'database' | 'combined'). Default 'code'. Spec: Database Discovery Packs.
 * @param degraded Advisory flag (boxed Boolean) -- TRUE when the run completed but the captured model may be partial/incomplete. Rides alongside COMPLETED; never a terminal status. Null when absent (legacy / not-yet-computed). Spec: Oracle Integrity & Determinism.
 * @param degradedReasons JSON-encoded string[] of the reasons `degraded` tripped, passed through verbatim. Null when absent. Spec: Oracle Integrity & Determinism.
 * @param status Run lifecycle status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
 * @param currentStep The step currently being executed
 * @param configSnapshot Immutable snapshot of Phase 0 discovery config
 * @param stepsPayload Per-step status tracking
 * @param errorMessage Error details if the run failed
 * @param createdAt ISO-8601 timestamp of creation
 * @param updatedAt ISO-8601 timestamp of last update
 */
public record DiscoveryRunDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("architecture_id")
    UUID architectureId,

    @JsonProperty("service_id")
    String serviceId,

    @JsonProperty("mode")
    String mode,

    @JsonProperty("tier")
    String tier,

    @JsonProperty("warnings")
    String warnings,

    @JsonProperty("confirmed_llm_solo")
    Boolean confirmedLlmSolo,

    @JsonProperty("discovery_kind")
    String discoveryKind,

    @JsonProperty("degraded")
    Boolean degraded,

    @JsonProperty("degraded_reasons")
    String degradedReasons,

    @JsonProperty("status")
    String status,

    @JsonProperty("current_step")
    String currentStep,

    @JsonProperty("config_snapshot")
    Map<String, Object> configSnapshot,

    @JsonProperty("steps_payload")
    Map<String, Object> stepsPayload,

    @JsonProperty("error_message")
    String errorMessage,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {}
