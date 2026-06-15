package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for a single behavioural BREAK in a Migration Execution reconcile run
 * (Liquibase changeset 183).
 *
 * <p>Wire shape for the gateway-facing break &lt;-&gt; bug lifecycle +
 * disposition endpoints (Task Group 1). The gateway loop (Groups 2/3/4) calls
 * these to bulk-create breaks from a reconcile result, read a run's breaks,
 * PATCH a break's disposition, increment the attempt counter, set the
 * circuit-breaker / escalation flags, and stamp the {@code bug_id} on send.
 * Modeled structurally on {@link MigrationExecutionRunDto} (record type,
 * snake_case {@link JsonProperty} naming -- the global AMS wire default).</p>
 *
 * <p>NEW reconciliation-lifecycle consumer -- snake_case wire (NO
 * {@code @CamelCaseWire}): the gateway loop client reads snake_case, matching
 * every other AMS consumer.</p>
 *
 * <p>All fields are boxed reference types ({@link UUID}, {@link String},
 * {@link Integer}, {@link Boolean}, {@link Map}). No Java primitives -- per
 * {@code project_primitive_double_dto_overwrite.md}, primitives would silently
 * default to {@code 0} / {@code false} on a PATCH that omits the field and could
 * wipe column content. This is particularly critical for {@link #attemptCount}
 * (the circuit-breaker counter), {@link #circuitBroken}, {@link #needsHuman},
 * and {@link #bugId}.</p>
 *
 * <p>PATCH null-guard contract: the update handler in
 * {@code MigrationReconciliationBreakMapper#updateEntityFromDto} null-guards
 * every editable field. Omitted JSON fields arrive as {@code null} on this
 * record and the existing column survives the update untouched.</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1.</p>
 *
 * @param id                     Internal database UUID.
 * @param runId                  Owning reconcile run UUID (run-scoped; FK -&gt; migration_execution_run).
 * @param pinnedBaselineId       The kind='current' ApiBehaviourBaseline this break was reconciled against (CD-1 oracle anchor); nullable.
 * @param sourceBaselineItemId   The replayable source baseline_item behind the break (CD-6 scoped-re-reconcile key); nullable.
 * @param diffItemId             The referenced api_behaviour_diff_item (no break-payload duplication); nullable.
 * @param detailJson             The inline break detail (method/path/summary/diff) for the review surface + BreakEvidence; nullable.
 * @param dispositionStatus      The break lifecycle / disposition (see {@code MigrationReconciliationBreakStatus}).
 * @param bugId                  The bug-report correlation key, set on send; nullable.
 * @param attemptCount           The circuit-breaker round / attempt counter; boxed, defaults 0.
 * @param circuitBroken          TRUE once the bounded re-run round tripped the threshold; boxed.
 * @param needsHuman             TRUE once escalated for human review; boxed.
 * @param errorDetail            Failure / escalation detail; nullable.
 * @param createdAt              ISO-8601 timestamp of creation.
 * @param updatedAt              ISO-8601 timestamp of last update.
 */
public record MigrationReconciliationBreakDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("pinned_baseline_id")
    UUID pinnedBaselineId,

    @JsonProperty("source_baseline_item_id")
    UUID sourceBaselineItemId,

    @JsonProperty("diff_item_id")
    UUID diffItemId,

    @JsonProperty("detail_json")
    Map<String, Object> detailJson,

    @JsonProperty("disposition_status")
    String dispositionStatus,

    @JsonProperty("bug_id")
    String bugId,

    @JsonProperty("attempt_count")
    Integer attemptCount,

    @JsonProperty("circuit_broken")
    Boolean circuitBroken,

    @JsonProperty("needs_human")
    Boolean needsHuman,

    @JsonProperty("error_detail")
    String errorDetail,

    @JsonProperty("created_at")
    String createdAt,

    @JsonProperty("updated_at")
    String updatedAt
) {
}
