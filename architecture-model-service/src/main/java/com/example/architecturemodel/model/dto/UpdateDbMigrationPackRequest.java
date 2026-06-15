package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Sparse PATCH body for
 * {@code PATCH /api/projects/{projectId}/db-migration-packs/{packId}}.
 *
 * <p>Only the three operator-mutable fields are PATCHable -- the DB-epic
 * attachment ({@code work_item_id}) and the staleness pair ({@code status} +
 * {@code stale_reason}). Generation-output fields (coverage counts,
 * {@code seed_margin}, {@code manifest_json}, files) are NOT reachable from
 * this surface at all, so a sparse PATCH can never wipe them -- the
 * boxed-type/null-guard contract per
 * {@code project_primitive_double_dto_overwrite.md} (see also the
 * {@code UpdateApiBehaviourCaptureSessionRequest} precedent).</p>
 *
 * <p>Null-guard contract: an omitted (null) field leaves the existing column
 * untouched. To CLEAR the DB-epic attachment, send {@code work_item_id} as an
 * empty string -- the service maps blank to {@code null}.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 *
 * @param workItemId DB-epic book-of-work item id; null = untouched, blank =
 *     clear.
 * @param status {@code generated | stale}; null = untouched.
 * @param staleReason Staleness reason; null = untouched.
 */
public record UpdateDbMigrationPackRequest(
    @JsonProperty("work_item_id")
    String workItemId,

    @JsonProperty("status")
    String status,

    @JsonProperty("stale_reason")
    String staleReason
) {}
