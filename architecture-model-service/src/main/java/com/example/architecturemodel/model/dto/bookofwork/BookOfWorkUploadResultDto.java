package com.example.architecturemodel.model.dto.bookofwork;

import com.example.architecturemodel.model.dto.WorkItemDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * Result DTO for Book of Work upload operation.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 2.3: Create BookOfWorkUploadResultDto
 *
 * Contains the project ID, list of all created work items, and import summary counts.
 * Provides counts for each work item type: initiatives, epics, features, stories.
 */
public record BookOfWorkUploadResultDto(
    /**
     * The project UUID that the work items were imported into.
     */
    @JsonProperty("project_id")
    UUID projectId,

    /**
     * List of all work items created during the import.
     * Includes all levels: INITIATIVE, EPIC, FEATURE, STORY.
     */
    @JsonProperty("work_items")
    List<WorkItemDto> workItems,

    /**
     * Import summary with counts by work item type.
     */
    @JsonProperty("import_summary")
    ImportSummary importSummary
) {
    /**
     * Import summary containing counts of created items by type.
     */
    public record ImportSummary(
        /**
         * Number of INITIATIVE work items created.
         */
        @JsonProperty("initiatives_created")
        int initiativesCreated,

        /**
         * Number of EPIC work items created.
         */
        @JsonProperty("epics_created")
        int epicsCreated,

        /**
         * Number of FEATURE work items created.
         */
        @JsonProperty("features_created")
        int featuresCreated,

        /**
         * Number of STORY work items created.
         */
        @JsonProperty("stories_created")
        int storiesCreated,

        /**
         * Total number of work items created across all types.
         */
        @JsonProperty("total_created")
        int totalCreated
    ) {
        /**
         * Factory method to create an ImportSummary with computed total.
         */
        public static ImportSummary of(int initiatives, int epics, int features, int stories) {
            return new ImportSummary(
                initiatives,
                epics,
                features,
                stories,
                initiatives + epics + features + stories
            );
        }
    }

    /**
     * Factory method to create a result DTO.
     *
     * @param projectId the project ID
     * @param workItems the list of created work items
     * @param initiatives count of initiatives created
     * @param epics count of epics created
     * @param features count of features created
     * @param stories count of stories created
     * @return the result DTO
     */
    public static BookOfWorkUploadResultDto of(
            UUID projectId,
            List<WorkItemDto> workItems,
            int initiatives,
            int epics,
            int features,
            int stories) {
        return new BookOfWorkUploadResultDto(
            projectId,
            workItems,
            ImportSummary.of(initiatives, epics, features, stories)
        );
    }
}
