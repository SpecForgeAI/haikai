package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/add-item}.
 *
 * <p>Spec: D5 — Net-new backlog items + provenance (2026-06-14, Spec 5 of 6).
 * The Migration Delivery Dashboard's "Add work item" action calls this endpoint
 * to add a MANUAL work item (genuinely-new {@code net_new} work, or
 * undiscoverable {@code carry_over} work like OS cron / vacuum schedules / ops
 * runbooks no parser finds) to a SAVED book of work BEFORE Migrate:</p>
 * <ul>
 *   <li>creates the {@code work_item} row ({@code type='STORY'},
 *       {@code status='PLANNED'}, {@code sortOrder = sequence_order}), reusing the
 *       same per-item create collaborator as save-to-backlog
 *       ({@code persistOne}); AND</li>
 *   <li>appends a {@code book_of_work_json.items[]} blob item
 *       ({@code type:"story"}, {@code sequenceOrder = sequence_order}) with the
 *       created {@code workItemId} + {@code saveState="saved"} + {@code provenance}
 *       stamped on it — all in ONE transaction (mirrors
 *       {@code append-capability-story} / the save-to-backlog write-back).</li>
 * </ul>
 *
 * <p>Modelled EXACTLY on {@link AppendCapabilityStoryRequest} (a top-level story
 * by default, lowercase {@code "story"} blob type so {@code selectEligibleStories}
 * consumes it, optional parent), with two differences that keep it OUT of D4's
 * discovered must-account set with NO gate code:</p>
 * <ul>
 *   <li>it carries {@code provenance} ({@code carry_over} | {@code net_new}),
 *       stamped on BOTH the {@code work_item} COLUMN (changeset 186) and the blob
 *       item; AND</li>
 *   <li>it carries NO {@code source_capability_id} and NO discovered-finding
 *       references — a manual add has no discovered capability/finding, so it is
 *       never a carry_over coverage obligation. The {@code kind} flavour
 *       ({@code api} | {@code operational}) only tunes the downstream spec-gen
 *       prompt orientation; it is NOT persisted as a {@code work_item} type and
 *       does NOT route the item through D3's discovered-capability path (manual
 *       adds are ALWAYS description-grounded).</li>
 * </ul>
 *
 * <p>Snake_case wire shape per AMS convention (the gateway client serialises
 * snake_case).</p>
 */
public record AddWorkItemRequest(

    /**
     * The like-for-like provenance marker for the manual add:
     * {@code carry_over} (default — undiscoverable like-for-like work, must match
     * current-state) or {@code net_new} (additive, deliberately outside the
     * like-for-like envelope). Defaults to {@code carry_over} when null/blank.
     * Stamped on BOTH the {@code work_item.provenance} COLUMN and the blob item.
     */
    @JsonProperty("provenance")
    String provenance,

    /**
     * The prompt FLAVOUR for the downstream description-grounded spec-gen:
     * {@code api} (API-endpoint orientation) or {@code operational} (non-API /
     * operational-effect-test orientation). This is NOT a {@code work_item} type
     * and is NOT persisted as a column — it rides the blob so the gateway can
     * tune the spec-gen prompt. Defaults to {@code api} when null/blank.
     */
    @JsonProperty("kind")
    String kind,

    /** The story title. REQUIRED. */
    @JsonProperty("title")
    String title,

    /**
     * The human description — the SOLE authoritative context for the manual add's
     * description-grounded spec-gen (it REPLACES the discovered-context resolver).
     */
    @JsonProperty("description")
    String description,

    /**
     * OPTIONAL parent blob-item id. A manual add is normally a top-level story (no
     * parent), so this is usually null; when supplied (and resolvable) the created
     * {@code STORY} work item parents to it, mirroring {@code append-capability-story}'s
     * loose, existence-only parent validation.
     */
    @JsonProperty("parent_book_item_id")
    String parentBookItemId,

    /**
     * The display order: used for BOTH the blob {@code sequenceOrder} and the
     * {@code work_item.sortOrder}. Defaults to 0 when null.
     */
    @JsonProperty("sequence_order")
    Integer sequenceOrder,

    /**
     * OPTIONAL, D6: the explicit, human-owned list of API operations this
     * {@code net_new} item adds, each a {@code <METHOD> <path>} string (e.g.
     * {@code ["POST /accounts"]}). It is the AUTHORITATIVE match source the D6
     * reconcile-time auto-disposition pass reads to recognise a {@code target_only}
     * diff as an EXPECTED additive endpoint (NOT {@code coveredEndpointIds}, NOT
     * spec-parsing). It rides the {@code book_of_work_json} blob item (NO column /
     * changeset — mirroring how {@code provenance} / {@code kind} /
     * {@code source_capability_id} / {@code workItemId} ride the blob), and is
     * stamped ONLY for {@code provenance=net_new} + {@code kind=api} items; a
     * null / empty list, or a non-net_new / non-api add, leaves it absent.
     * Defaults to absent when null/empty.
     */
    @JsonProperty("net_new_operations")
    List<String> netNewOperations,

    /**
     * OPTIONAL, carry-over triage (2026-07-26): the plane workstream stamped
     * onto the blob item (Spec V vocabulary, e.g.
     * {@code internal_processing_implementation}). The execution rail's
     * plane-grouping ({@code planeForStory}) reads it; absent means the story
     * defaults to the service plane. Not validated against the 14-value enum
     * here (the gateway triage validates before calling); stamped verbatim
     * when non-blank.
     */
    @JsonProperty("workstream")
    String workstream,

    /**
     * OPTIONAL, carry-over triage (2026-07-26): acceptance criteria stamped
     * onto the blob item's {@code acceptanceCriteria} list (blank entries
     * dropped). The spec generator grounds on them alongside the description.
     */
    @JsonProperty("acceptance_criteria")
    List<String> acceptanceCriteria,

    /**
     * OPTIONAL, carry-over triage (2026-07-26): {@code discovery_findings} ids
     * stamped onto the blob item's {@code discoveryFindingReferences} list.
     * The original D5 rationale ("a manual add has no discovered finding, so
     * it is never a D4 coverage obligation") still holds for a BARE add — but
     * the triage NEW-STORY disposition creates a story BECAUSE of a finding,
     * and the explicit reference here is what flips that finding to
     * {@code cited-by-story} in the D4 gate. Absent/empty keeps the original
     * out-of-gate behaviour unchanged.
     */
    @JsonProperty("discovery_finding_references")
    List<String> discoveryFindingReferences,

    /**
     * OPTIONAL, scaffold mint on a SAVED book (2026-08-14): free-form tags
     * stamped verbatim onto the blob item's {@code tags} list (blank entries
     * dropped). The gateway's scaffold-story mint marks the story
     * {@code seed_build_files} (+ {@code stream:<ws>} / {@code provenance:scaffold})
     * so the downstream deterministic bootstrap carriage recognises it — the
     * epic-expansion injection path cannot run on a saved book
     * ("items/append is only allowed on a draft book"), so this additive
     * add-item path is the saved-book equivalent. Absent/empty stamps nothing.
     */
    @JsonProperty("tags")
    List<String> tags
) {

    /** API-endpoint prompt flavour (the default). */
    public static final String KIND_API = "api";

    /** Operational / non-API (effect-oriented) prompt flavour. */
    public static final String KIND_OPERATIONAL = "operational";

    /**
     * Backward-compatible 7-arg constructor preserving the pre-2026-07-26
     * (D5/D6) canonical signature. Defaults the triage-era fields
     * ({@code workstream} / {@code acceptance_criteria} /
     * {@code discovery_finding_references}) and the 2026-08-14 {@code tags}
     * field to {@code null} so existing callers and tests compile and behave
     * unchanged.
     */
    public AddWorkItemRequest(
            String provenance,
            String kind,
            String title,
            String description,
            String parentBookItemId,
            Integer sequenceOrder,
            List<String> netNewOperations) {
        this(provenance, kind, title, description, parentBookItemId,
            sequenceOrder, netNewOperations, null, null, null, null);
    }

    /**
     * Backward-compatible 10-arg constructor preserving the pre-2026-08-14
     * canonical signature (defaults {@code tags} to {@code null}).
     */
    public AddWorkItemRequest(
            String provenance,
            String kind,
            String title,
            String description,
            String parentBookItemId,
            Integer sequenceOrder,
            List<String> netNewOperations,
            String workstream,
            List<String> acceptanceCriteria,
            List<String> discoveryFindingReferences) {
        this(provenance, kind, title, description, parentBookItemId,
            sequenceOrder, netNewOperations, workstream, acceptanceCriteria,
            discoveryFindingReferences, null);
    }
}
