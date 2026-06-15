package com.example.architecturemodel.model.dto.migration;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * Request body DTO for
 * {@code POST /api/projects/{projectId}/migration-spec-context}.
 *
 * <p>Drives the focused-migration-context resolver (A-5) used by the PM
 * shape-spec batch generator. Distinct from
 * {@link MigrationDiscoveryContextRequestDto} (Spec migration-discovery-context
 * 2026-05-16): that resolver returns a project-level base context, this one
 * returns a per-story drill-down keyed by {@code workItemId} + {@code bookItemId}.</p>
 *
 * <p>All fields are boxed reference types (never primitives) per
 * {@code project_primitive_double_dto_overwrite.md}: missing JSON arrives as
 * {@code null} rather than a primitive default that would silently shift
 * resolver behaviour. The service applies sensible defaults via
 * {@code maxFindingsOrDefault()} etc. when the caller omits the caps.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 7.</p>
 * <p>Extended: Cross-Story Context Injection (2026-05-20) -- Task Group 3 adds
 * the optional {@code pass} and {@code passOneSpecIdsInScope} fields used by
 * the two-pass loop. Both are nullable so callers that omit them get today's
 * pass-1-only behaviour, preserving the existing-endpoint backwards
 * compatibility contract from spec.md Specific Requirements.</p>
 * <p>Extended: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14) adds the optional {@code sourceCapabilityId} field driving the
 * 7th {@code operational_capability} context block. Nullable; the legacy 9-arg
 * and 11-arg constructors below default it to null so every existing caller is
 * unchanged.</p>
 *
 * @param bookOfWorkId            Originating book-of-work UUID (Spec 1 row).
 * @param bookItemId              Hierarchy-item id within the BoW JSONB blob.
 * @param workItemId              Saved-story WorkItem UUID (the persisted story).
 * @param currentArchitectureId   Current-state architecture UUID.
 * @param targetArchitectureId    Target-state architecture UUID (may be null for
 *                                prerequisite-only stories).
 * @param contextTypes            Requested context-type blocks
 *                                (subset of {@code service|api|soap|data|infrastructure|test_pack|operational_capability}).
 * @param maxFindings             Per-block cap on returned discovery findings.
 * @param maxEvidenceItems        Per-block cap on returned evidence highlights.
 * @param maxBaselineItems        Per-block cap on returned API-behaviour baselines.
 * @param pass                    OPTIONAL: 1 (pass-1, no sibling context) or 2
 *                                (pass-2, sibling-aware). When null the resolver
 *                                still emits the new top-level blocks if the
 *                                workspace can populate them; sibling-summaries
 *                                are only returned when {@code pass == 2}.
 *                                Hard cap at 2 enforced at the gateway boundary
 *                                (Task Group 5).
 * @param passOneSpecIdsInScope   OPTIONAL: list of {@code migration_story_spec_generations}
 *                                ids that pass-2 may read as sibling context. The
 *                                resolver loads these rows, filters out failed /
 *                                insufficient_context regardless of caller intent
 *                                (loop guardrail surfaced at the resolver
 *                                boundary), then keeps only the subset whose
 *                                {@code workItemId} sits under the same parent
 *                                epic/feature as the current story.
 * @param sourceCapabilityId      OPTIONAL (D3, 2026-06-14): the
 *                                {@code discovery_capability} UUID this story was
 *                                minted from (read from the WorkItem's
 *                                {@code book_of_work_json} blob item's
 *                                {@code source_capability_id} by the gateway and
 *                                passed through). Drives the 7th
 *                                {@code operational_capability} context block: the
 *                                resolver loads the capability (PREFERRED source)
 *                                by this id, then falls back to a behaviour-bearing
 *                                {@code operational_artifact} finding when it is
 *                                null / unresolved. NO DDL — the link rides the
 *                                blob, never a column.
 */
public record MigrationSpecContextRequestDto(
    @JsonProperty("bookOfWorkId")
    UUID bookOfWorkId,

    @JsonProperty("bookItemId")
    String bookItemId,

    @JsonProperty("workItemId")
    UUID workItemId,

    @JsonProperty("currentArchitectureId")
    UUID currentArchitectureId,

    @JsonProperty("targetArchitectureId")
    UUID targetArchitectureId,

    @JsonProperty("contextTypes")
    List<String> contextTypes,

    @JsonProperty("maxFindings")
    Integer maxFindings,

    @JsonProperty("maxEvidenceItems")
    Integer maxEvidenceItems,

    @JsonProperty("maxBaselineItems")
    Integer maxBaselineItems,

    @JsonProperty("pass")
    Integer pass,

    @JsonProperty("passOneSpecIdsInScope")
    List<UUID> passOneSpecIdsInScope,

    @JsonProperty("sourceCapabilityId")
    UUID sourceCapabilityId
) {

    /** Default cap applied when {@link #maxFindings} is null. */
    public static final int DEFAULT_MAX_FINDINGS = 25;

    /** Default cap applied when {@link #maxEvidenceItems} is null. */
    public static final int DEFAULT_MAX_EVIDENCE_ITEMS = 25;

    /** Default cap applied when {@link #maxBaselineItems} is null. */
    public static final int DEFAULT_MAX_BASELINE_ITEMS = 10;

    /** Context-type identifier constants used across the resolver + tests. */
    public static final String CTX_SERVICE = "service";
    public static final String CTX_API = "api";
    public static final String CTX_SOAP = "soap";
    public static final String CTX_DATA = "data";
    public static final String CTX_INFRASTRUCTURE = "infrastructure";
    public static final String CTX_TEST_PACK = "test_pack";

    /**
     * The 7th migration spec-context type (D3, 2026-06-14): a non-API D2
     * {@code discovery_capability} grouping (batch pipeline / monitoring / FTP
     * ingestion / deployment / housekeeping) OR a behaviour-bearing
     * {@code operational_artifact} finding fallback. The single wire token is
     * used whether the source is a capability or a finding.
     */
    public static final String CTX_OPERATIONAL_CAPABILITY = "operational_capability";

    /**
     * Legacy 9-arg constructor for backwards compatibility with existing
     * callers and tests that predate the cross-story-context-injection
     * additions (Task Group 3, 2026-05-20). Defaults the new optional fields to
     * null so behaviour is unchanged.
     */
    public MigrationSpecContextRequestDto(
        UUID bookOfWorkId,
        String bookItemId,
        UUID workItemId,
        UUID currentArchitectureId,
        UUID targetArchitectureId,
        List<String> contextTypes,
        Integer maxFindings,
        Integer maxEvidenceItems,
        Integer maxBaselineItems
    ) {
        this(
            bookOfWorkId,
            bookItemId,
            workItemId,
            currentArchitectureId,
            targetArchitectureId,
            contextTypes,
            maxFindings,
            maxEvidenceItems,
            maxBaselineItems,
            null,
            null,
            null
        );
    }

    /**
     * 11-arg constructor for callers that supply the cross-story-context-injection
     * fields ({@code pass} + {@code passOneSpecIdsInScope}) but predate the D3
     * {@code sourceCapabilityId} addition (2026-06-14). Defaults
     * {@code sourceCapabilityId} to null so the pass-2 callers are unchanged.
     */
    public MigrationSpecContextRequestDto(
        UUID bookOfWorkId,
        String bookItemId,
        UUID workItemId,
        UUID currentArchitectureId,
        UUID targetArchitectureId,
        List<String> contextTypes,
        Integer maxFindings,
        Integer maxEvidenceItems,
        Integer maxBaselineItems,
        Integer pass,
        List<UUID> passOneSpecIdsInScope
    ) {
        this(
            bookOfWorkId,
            bookItemId,
            workItemId,
            currentArchitectureId,
            targetArchitectureId,
            contextTypes,
            maxFindings,
            maxEvidenceItems,
            maxBaselineItems,
            pass,
            passOneSpecIdsInScope,
            null
        );
    }

    public int maxFindingsOrDefault() {
        return maxFindings != null && maxFindings > 0 ? maxFindings : DEFAULT_MAX_FINDINGS;
    }

    public int maxEvidenceItemsOrDefault() {
        return maxEvidenceItems != null && maxEvidenceItems > 0
            ? maxEvidenceItems : DEFAULT_MAX_EVIDENCE_ITEMS;
    }

    public int maxBaselineItemsOrDefault() {
        return maxBaselineItems != null && maxBaselineItems > 0
            ? maxBaselineItems : DEFAULT_MAX_BASELINE_ITEMS;
    }

    /**
     * Pass selector with default. Returns 1 when {@link #pass} is null so
     * callers that omit the new field get pass-1 (no sibling-summaries)
     * semantics by default. Values other than 1 / 2 are treated as 1 at the
     * resolver boundary (the hard cap at 2 is enforced upstream in the
     * gateway handler -- the resolver simply does not emit sibling-summaries
     * for any non-2 value).
     */
    public int passOrDefault() {
        return pass != null && pass == 2 ? 2 : 1;
    }
}
