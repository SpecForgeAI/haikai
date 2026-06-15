package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Data Transfer Object for work items.
 *
 * Uses Java record with @JsonProperty annotations for snake_case JSON serialization.
 * Represents hierarchical work items (Initiative, Epic, Feature, Story).
 *
 * <p>Spec 2026-06-12 (Implementation-Service Init and Integration Repair --
 * Task Group 1): added the implementation git-outcome fields
 * {@code implementation_branch} / {@code implementation_pr_url} /
 * {@code implementation_logs_url}. All nullable Strings with null-guarded
 * update semantics (absent on update = unchanged) -- see
 * {@code WorkItemMapper.updateEntityFromDto}. A 16-arg compatibility
 * constructor preserves the pre-existing signature for callers and fixtures.</p>
 *
 * <p>Spec 2026-06-14 (Migrate Button + Migration Execution Driver, Spec 3 of 4
 * -- Task Group 1): added the {@code deferred} flag (CD-7). Boxed
 * {@link Boolean}, snake_case wire, null-guarded update semantics so an omitted
 * field never flips the column (per
 * {@code project_primitive_double_dto_overwrite.md}). A 19-arg compatibility
 * constructor (the pre-defer canonical signature) defaults {@code deferred} to
 * {@code false} so existing positional call sites continue to compile.</p>
 *
 * <p>Spec 2026-06-14 (D4 -- Carry-over Completeness Gate, Spec 4 of 6 -- Task
 * Group 1): added {@code source_capability_id} (Liquibase changeset 185). Boxed
 * {@link UUID}, snake_case wire, null-guarded update semantics so an omitted
 * field never wipes the column. This is the column the gateway's carry_over
 * completeness gate reads off the work-items list it already fetches to derive
 * the cited-capability set (a capability is cited-by-story iff a work_item
 * exists with {@code source_capability_id == capability.id}). A 20-arg
 * compatibility constructor (the pre-D4 canonical signature) defaults
 * {@code source_capability_id} to {@code null} so existing positional call
 * sites continue to compile.</p>
 *
 * <p>Spec 2026-06-14 (D5 -- Net-new backlog items + provenance, Spec 5 of 6 --
 * Task Group 1): added {@code provenance} (Liquibase changeset 186). The
 * like-for-like marker {@code carry_over} (default) | {@code net_new}; a plain
 * snake_case-wired {@link String} with null-guarded update semantics so an
 * omitted field never wipes the column (per
 * {@code project_primitive_double_dto_overwrite.md}, mirroring {@code deferred}
 * / {@code source_capability_id}). COLUMN-authoritative and column-only: dispatch
 * ignores it; the D6 reconcile consumer reads rows directly. A 21-arg
 * compatibility constructor (the pre-D5 canonical signature) defaults
 * {@code provenance} to {@code 'carry_over'} (mirroring the DB default) so
 * existing positional call sites that pass {@code source_capability_id} continue
 * to compile.</p>
 */
public record WorkItemDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("type")
    String type,

    @JsonProperty("parent_id")
    UUID parentId,

    @JsonProperty("title")
    String title,

    @JsonProperty("description")
    String description,

    @JsonProperty("status")
    String status,

    @JsonProperty("sort_order")
    Integer sortOrder,

    @JsonProperty("priority")
    Integer priority,

    @JsonProperty("target_window")
    String targetWindow,

    @JsonProperty("tags")
    Map<String, Object> tags,

    @JsonProperty("external_system")
    String externalSystem,

    @JsonProperty("external_key")
    String externalKey,

    @JsonProperty("external_url")
    String externalUrl,

    @JsonProperty("created_at")
    Instant createdAt,

    @JsonProperty("updated_at")
    Instant updatedAt,

    @JsonProperty("implementation_branch")
    String implementationBranch,

    @JsonProperty("implementation_pr_url")
    String implementationPrUrl,

    @JsonProperty("implementation_logs_url")
    String implementationLogsUrl,

    @JsonProperty("deferred")
    Boolean deferred,

    @JsonProperty("source_capability_id")
    UUID sourceCapabilityId,

    @JsonProperty("provenance")
    String provenance
) {

    /** Default provenance value (like-for-like): mirrors the DB DEFAULT. */
    public static final String PROVENANCE_CARRY_OVER = "carry_over";

    /**
     * Backward-compatible 16-arg constructor preserving the
     * pre-Implementation-Init signature. Delegates to the canonical constructor
     * with the three implementation git-outcome fields, {@code deferred},
     * {@code source_capability_id}, AND {@code provenance} defaulted (null git
     * fields / {@code false} {@code deferred} / null {@code source_capability_id}
     * / {@code 'carry_over'} {@code provenance}).
     *
     * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
     */
    public WorkItemDto(
            UUID id,
            UUID projectId,
            String type,
            UUID parentId,
            String title,
            String description,
            String status,
            Integer sortOrder,
            Integer priority,
            String targetWindow,
            Map<String, Object> tags,
            String externalSystem,
            String externalKey,
            String externalUrl,
            Instant createdAt,
            Instant updatedAt) {
        this(id, projectId, type, parentId, title, description, status,
            sortOrder, priority, targetWindow, tags, externalSystem,
            externalKey, externalUrl, createdAt, updatedAt,
            null, null, null, Boolean.FALSE, null, PROVENANCE_CARRY_OVER);
    }

    /**
     * Backward-compatible 19-arg constructor preserving the pre-defer canonical
     * signature (the Implementation-Init shape). Delegates to the canonical
     * constructor with {@code deferred} defaulted to {@code false} (mirroring the
     * DB default), {@code source_capability_id} defaulted to {@code null}, AND
     * {@code provenance} defaulted to {@code 'carry_over'}, so existing positional
     * call sites that pass the three implementation git-outcome fields continue to
     * compile.
     *
     * Spec 2026-06-14: Migrate Button + Migration Execution Driver -- Task Group 1
     */
    public WorkItemDto(
            UUID id,
            UUID projectId,
            String type,
            UUID parentId,
            String title,
            String description,
            String status,
            Integer sortOrder,
            Integer priority,
            String targetWindow,
            Map<String, Object> tags,
            String externalSystem,
            String externalKey,
            String externalUrl,
            Instant createdAt,
            Instant updatedAt,
            String implementationBranch,
            String implementationPrUrl,
            String implementationLogsUrl) {
        this(id, projectId, type, parentId, title, description, status,
            sortOrder, priority, targetWindow, tags, externalSystem,
            externalKey, externalUrl, createdAt, updatedAt,
            implementationBranch, implementationPrUrl, implementationLogsUrl,
            Boolean.FALSE, null, PROVENANCE_CARRY_OVER);
    }

    /**
     * Backward-compatible 20-arg constructor preserving the pre-D4 canonical
     * signature (the Migrate-Button shape). Delegates to the canonical 22-arg
     * constructor with {@code source_capability_id} defaulted to {@code null} AND
     * {@code provenance} defaulted to {@code 'carry_over'} (both mirroring the DB
     * default), so existing positional call sites that pass {@code deferred}
     * continue to compile.
     *
     * Spec 2026-06-14: D4 -- Carry-over Completeness Gate -- Task Group 1
     */
    public WorkItemDto(
            UUID id,
            UUID projectId,
            String type,
            UUID parentId,
            String title,
            String description,
            String status,
            Integer sortOrder,
            Integer priority,
            String targetWindow,
            Map<String, Object> tags,
            String externalSystem,
            String externalKey,
            String externalUrl,
            Instant createdAt,
            Instant updatedAt,
            String implementationBranch,
            String implementationPrUrl,
            String implementationLogsUrl,
            Boolean deferred) {
        this(id, projectId, type, parentId, title, description, status,
            sortOrder, priority, targetWindow, tags, externalSystem,
            externalKey, externalUrl, createdAt, updatedAt,
            implementationBranch, implementationPrUrl, implementationLogsUrl,
            deferred, null, PROVENANCE_CARRY_OVER);
    }

    /**
     * Backward-compatible 21-arg constructor preserving the pre-D5 canonical
     * signature (the D4 shape). Delegates to the canonical 22-arg constructor
     * with {@code provenance} defaulted to {@code 'carry_over'} (mirroring the DB
     * default), so existing positional call sites that pass
     * {@code source_capability_id} continue to compile.
     *
     * Spec 2026-06-14: D5 -- Net-new backlog items + provenance -- Task Group 1
     */
    public WorkItemDto(
            UUID id,
            UUID projectId,
            String type,
            UUID parentId,
            String title,
            String description,
            String status,
            Integer sortOrder,
            Integer priority,
            String targetWindow,
            Map<String, Object> tags,
            String externalSystem,
            String externalKey,
            String externalUrl,
            Instant createdAt,
            Instant updatedAt,
            String implementationBranch,
            String implementationPrUrl,
            String implementationLogsUrl,
            Boolean deferred,
            UUID sourceCapabilityId) {
        this(id, projectId, type, parentId, title, description, status,
            sortOrder, priority, targetWindow, tags, externalSystem,
            externalKey, externalUrl, createdAt, updatedAt,
            implementationBranch, implementationPrUrl, implementationLogsUrl,
            deferred, sourceCapabilityId, PROVENANCE_CARRY_OVER);
    }
}
