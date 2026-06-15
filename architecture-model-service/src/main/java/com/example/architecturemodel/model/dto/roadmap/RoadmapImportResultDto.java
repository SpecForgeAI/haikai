package com.example.architecturemodel.model.dto.roadmap;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.UUID;

/**
 * Data Transfer Object for roadmap import result.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 *
 * Returns summary of the import operation including detailed counts of:
 * - Inserted items (new IDs not in existing map)
 * - Updated items (existing IDs with field changes)
 * - Archived items (removed items with children, status set to ARCHIVED)
 * - Deleted items (removed items without children, fully deleted)
 *
 * Uses @JsonProperty for snake_case JSON output.
 */
public record RoadmapImportResultDto(
    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("artifact_revision")
    Integer artifactRevision,

    // Legacy fields for backward compatibility
    @JsonProperty("initiatives_created")
    Integer initiativesCreated,

    @JsonProperty("epics_created")
    Integer epicsCreated,

    // Detailed initiative counts
    @JsonProperty("initiatives_inserted")
    Integer initiativesInserted,

    @JsonProperty("initiatives_updated")
    Integer initiativesUpdated,

    @JsonProperty("initiatives_archived")
    Integer initiativesArchived,

    @JsonProperty("initiatives_deleted")
    Integer initiativesDeleted,

    // Detailed epic counts
    @JsonProperty("epics_inserted")
    Integer epicsInserted,

    @JsonProperty("epics_updated")
    Integer epicsUpdated,

    @JsonProperty("epics_archived")
    Integer epicsArchived,

    @JsonProperty("epics_deleted")
    Integer epicsDeleted
) {
    /**
     * Convenience constructor for backward compatibility.
     * Creates a result with only legacy counts (created = inserted + updated).
     */
    public RoadmapImportResultDto(UUID projectId, Integer artifactRevision,
                                   Integer initiativesCreated, Integer epicsCreated) {
        this(projectId, artifactRevision, initiativesCreated, epicsCreated,
             0, 0, 0, 0, 0, 0, 0, 0);
    }

    /**
     * Full constructor with detailed counts.
     * Legacy counts are computed from detailed counts.
     */
    public static RoadmapImportResultDto withDetailedCounts(
            UUID projectId,
            Integer artifactRevision,
            DetailedImportCounts initiativeCounts,
            DetailedImportCounts epicCounts) {
        return new RoadmapImportResultDto(
            projectId,
            artifactRevision,
            // Legacy: created = inserted + updated (for backward compatibility)
            initiativeCounts.inserted() + initiativeCounts.updated(),
            epicCounts.inserted() + epicCounts.updated(),
            // Detailed initiative counts
            initiativeCounts.inserted(),
            initiativeCounts.updated(),
            initiativeCounts.archived(),
            initiativeCounts.deleted(),
            // Detailed epic counts
            epicCounts.inserted(),
            epicCounts.updated(),
            epicCounts.archived(),
            epicCounts.deleted()
        );
    }
}
