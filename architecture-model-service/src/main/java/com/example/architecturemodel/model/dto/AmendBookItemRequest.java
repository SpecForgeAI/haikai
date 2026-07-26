package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/amend}.
 *
 * <p>Spec: Carry-over triage (2026-07-26,
 * {@code agent-os/planning/2026-07-26-carry-over-triage-build-plan.md}) —
 * the AMEND-STORY disposition: a carry-over finding sits in story X's scope but
 * X's text doesn't address it, so the story is EDITED to fold the finding in.
 * One atomic transaction applies, on the story blob item:</p>
 * <ul>
 *   <li>{@code description} — REPLACES the blob item description when non-blank
 *       (the caller sends the full amended text, not a diff); best-effort
 *       mirrored onto the linked {@code work_item.description};</li>
 *   <li>{@code append_acceptance_criteria} — each non-blank entry is APPENDED
 *       to the blob item's {@code acceptanceCriteria} list (never replaces —
 *       the amendment ADDS criteria covering the finding);</li>
 *   <li>{@code cite_finding_id} — when present, the finding id is added to
 *       {@code discoveryFindingReferences} (same idempotent mechanics as the
 *       cite-finding endpoint) so the D4 gate reads it as cited; AND</li>
 *   <li>the linked work item's spec-generation rows are MARKED STALE
 *       ({@code stale=TRUE} + {@code stale_reason} + {@code stale_marked_at}
 *       — the {@code MissingInputResolutionCascadeService} stamping precedent)
 *       so the story DROPS OUT of stage spec-readiness until its spec is
 *       regenerated with the amended text folded in. Regeneration clears the
 *       stamp (the existing persist-path contract).</li>
 * </ul>
 *
 * <p>Snake_case wire per AMS convention. NO Liquibase change — the stale
 * columns exist (Target Architecture Authoring Flow) and everything else rides
 * {@code book_of_work_json}.</p>
 */
public record AmendBookItemRequest(

    /**
     * The FULL amended story description (replaces the current one). Optional —
     * null/blank leaves the description untouched (an AC-only amendment).
     */
    @JsonProperty("description")
    String description,

    /**
     * Acceptance criteria to APPEND (each a plain string). Optional; blank
     * entries are dropped.
     */
    @JsonProperty("append_acceptance_criteria")
    List<String> appendAcceptanceCriteria,

    /**
     * The {@code discovery_findings} UUID this amendment folds in — cited onto
     * {@code discoveryFindingReferences} in the same transaction. Optional but
     * canonical for the triage flow (an amendment exists BECAUSE of a finding).
     */
    @JsonProperty("cite_finding_id")
    String citeFindingId,

    /**
     * The {@code stale_reason} stamped on the story's spec-generation rows.
     * Defaults to {@code story_amended_for_finding:<cite_finding_id>} (or the
     * bare {@code story_amended} when no finding id is supplied).
     */
    @JsonProperty("stale_reason")
    String staleReason
) {}
