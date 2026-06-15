package com.example.architecturemodel.model.parser;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Intermediate model representing an Epic parsed from roadmap markdown.
 *
 * Used during parsing before conversion to WorkItemEntity.
 * Supports both Format A (heading-based) and Format B/C (list-based) epics.
 *
 * V3 additions:
 * - normalizedTitle: lowercase, whitespace-collapsed version for ID generation
 * - computedId: deterministic UUID based on project, parent initiative, and normalized title
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * - Added features list for H4 (####) heading children
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EpicNode {

    /**
     * The title of the epic, sanitized (checkbox and "Epic:" prefix removed).
     * Preserved as-is from the markdown for display purposes.
     */
    private String title;

    /**
     * The normalized title used for deterministic ID generation.
     * Computed as: trim + collapse whitespace + lowercase.
     * Set by the parser during v3+ parsing.
     */
    private String normalizedTitle;

    /**
     * The deterministic UUID computed from projectId, parent initiative's normalizedTitle, and this epic's normalizedTitle.
     * Key format: "work_item|{projectId}|EPIC|{parentNormalizedTitle}|{normalizedTitle}"
     * Set by the parser during v3+ parsing.
     */
    private UUID computedId;

    /**
     * The description of the epic, containing collected detail bullets or
     * content under the epic heading. May be null if no details provided.
     */
    private String description;

    /**
     * The sort order of this epic within its parent initiative.
     * Based on appearance order in the markdown (0-indexed).
     */
    private int sortOrder;

    /**
     * The list of features belonging to this epic.
     * Spec 2026-01-10: Upload Book of Work from Markdown
     * Features are parsed from H4 (####) headings.
     * May be empty if the epic has no features defined.
     */
    @Builder.Default
    private List<FeatureNode> features = new ArrayList<>();
}
