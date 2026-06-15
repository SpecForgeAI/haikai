package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append}.
 *
 * <p>Carries one epic's phase-2 expansion result: the story (and any feature)
 * items to append under that epic inside {@code book_of_work_json.items[]},
 * plus the epic's new expansion state. The merge is performed SERVER-SIDE in
 * a single {@code @Transactional} operation (see
 * {@code GeneratedMigrationBookOfWorkService#appendItems}) — the client never
 * read-modify-writes, so concurrent per-epic appends during "Expand all"
 * cannot lose each other's writes.</p>
 *
 * <p>{@link #items} may be {@code null} / empty for a STATE-ONLY merge — the
 * gateway uses that to mark an epic {@code expanding} before its pipeline
 * runs, or {@code failed} when it aborts; the {@code expanded} state rides
 * with the story append itself.</p>
 *
 * <p>Wire format follows the existing migration-books-of-work DTO convention
 * (snake_case {@link JsonProperty}, matching
 * {@link SaveGeneratedMigrationBookOfWorkRequest} /
 * {@link GeneratedMigrationBookOfWorkDto} — no {@code @CamelCaseWire}, per the
 * repo wire rules). Belt-and-braces {@link JsonAlias} entries also accept the
 * camelCase spellings, mirroring the dual-tolerance precedent in
 * {@code ProjectSnapshotImportRequestDto}. Item maps inside {@link #items}
 * are passed through verbatim (their keys — {@code id}, {@code parentId},
 * {@code sequenceOrder}, ... — are data, not bean properties, so Jackson
 * naming strategies never rename them).</p>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Two-Phase Migration Delivery Plan Generation (Skeleton -&gt; Expand)
 * (2026-06-11) -- Task Group 2.</p>
 *
 * @param epicId Id of the epic being expanded (the namespaced
 *     {@code book_of_work_json.items[].id} value, e.g.
 *     {@code target_service_api_implementation:E1}). Required.
 * @param items Story / feature item maps to append under the epic. Each map is
 *     the full {@code MigrationBookOfWorkItem} shape produced by the gateway.
 *     Nullable / empty for a state-only merge.
 * @param expansionState The epic's new expansion state — one of
 *     {@code not_expanded | expanding | expanded | failed}. Required.
 */
public record AppendGeneratedMigrationBookOfWorkItemsRequest(
    @JsonProperty("epic_id")
    @JsonAlias({"epicId"})
    String epicId,

    @JsonProperty("items")
    List<Map<String, Object>> items,

    @JsonProperty("expansion_state")
    @JsonAlias({"expansionState"})
    String expansionState
) {

    /** Epic not yet expanded (the phase-1 skeleton seeds every epic with this). */
    public static final String STATE_NOT_EXPANDED = "not_expanded";
    /** Expansion pipeline in flight for this epic. */
    public static final String STATE_EXPANDING = "expanding";
    /** Expansion succeeded; stories appended. Terminal — never re-expanded. */
    public static final String STATE_EXPANDED = "expanded";
    /** Expansion failed after retry. Retryable. */
    public static final String STATE_FAILED = "failed";

    /**
     * The full per-epic expansion-state vocabulary. Lives INSIDE
     * {@code book_of_work_json} (an {@code expansionState} field on each epic
     * item) — deliberately NOT a {@code chk_gmbw_status} value and NOT a new
     * column: zero Liquibase change.
     */
    public static final Set<String> ALL_EXPANSION_STATES = Set.of(
        STATE_NOT_EXPANDED, STATE_EXPANDING, STATE_EXPANDED, STATE_FAILED
    );
}
