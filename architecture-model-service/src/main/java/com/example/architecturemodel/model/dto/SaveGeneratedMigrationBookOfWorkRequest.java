package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog}.
 *
 * <p>Defines the filter mode, selection lists, and per-call options that drive
 * the save-to-backlog flow (per spec.md AMS section + Q-5 / Q-8 / Q-10):</p>
 * <ul>
 *   <li>{@link #saveMode} selects the admission filter ({@code all}, {@code selected},
 *       {@code high_confidence_only}, {@code ready_for_spec_only}).</li>
 *   <li>{@link #selectedItemIds} is consulted only when {@code saveMode='selected'};
 *       in other modes it is ignored.</li>
 *   <li>{@link #excludedItemIds} is consulted by every save mode -- callers can
 *       exclude individual items even within a broader filter.</li>
 *   <li>{@link #statusForCreatedItems} controls the {@code work_item.status} of
 *       every newly-created row. Defaults to the existing WorkItem default
 *       ({@code PLANNED}) when null.</li>
 *   <li>{@link #includeTraceabilityInDescription} appends the per-item
 *       {@code traceabilitySummary} to the saved {@code work_item.description}.</li>
 *   <li>{@link #includeReadinessInDescription} appends {@code readiness} +
 *       {@code readinessReasons[]}.</li>
 *   <li>{@link #tagPrefix} prefixes each saved tag (Q-10 idempotent additive).</li>
 * </ul>
 *
 * <p>All fields are boxed reference types so a PATCH/POST that omits a field
 * does not silently default to a primitive value -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) -- Task Group 8.</p>
 *
 * @param selectedItemIds Ids of draft items to admit when {@code saveMode='selected'}; otherwise ignored.
 * @param excludedItemIds Ids of draft items to skip; consulted in every save mode.
 * @param saveMode One of {@code all | selected | high_confidence_only | ready_for_spec_only}.
 * @param statusForCreatedItems Status applied to every created {@code work_item}; null defaults to {@code PLANNED}.
 * @param includeTraceabilityInDescription Whether to append per-item traceability summary to the saved description.
 * @param includeReadinessInDescription Whether to append readiness + reasons to the saved description.
 * @param tagPrefix Optional prefix applied to every saved tag; {@code null} means no prefix.
 */
public record SaveGeneratedMigrationBookOfWorkRequest(
    @JsonProperty("selected_item_ids")
    List<String> selectedItemIds,

    @JsonProperty("excluded_item_ids")
    List<String> excludedItemIds,

    @JsonProperty("save_mode")
    String saveMode,

    @JsonProperty("status_for_created_items")
    String statusForCreatedItems,

    @JsonProperty("include_traceability_in_description")
    Boolean includeTraceabilityInDescription,

    @JsonProperty("include_readiness_in_description")
    Boolean includeReadinessInDescription,

    @JsonProperty("tag_prefix")
    String tagPrefix
) {

    /** Save every item that is not in {@link #excludedItemIds}. */
    public static final String MODE_ALL = "all";
    /** Save exactly the items in {@link #selectedItemIds}. */
    public static final String MODE_SELECTED = "selected";
    /** Admit items with {@code confidence='high'} only. */
    public static final String MODE_HIGH_CONFIDENCE_ONLY = "high_confidence_only";
    /** Admit items with {@code readiness='ready_for_spec'} only. */
    public static final String MODE_READY_FOR_SPEC_ONLY = "ready_for_spec_only";
}
