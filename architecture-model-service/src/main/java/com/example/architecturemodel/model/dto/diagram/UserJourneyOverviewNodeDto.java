package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing a node in the User Journey Overview diagram contract v1.
 * Each node corresponds to a single User Journey, positioned within a lane
 * (Business Process) and carrying metadata about its contents and relationships.
 */
public record UserJourneyOverviewNodeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("lane_id")
    String laneId,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("primary_business_user_id")
    String primaryBusinessUserId,

    @JsonProperty("primary_business_user_name")
    String primaryBusinessUserName,

    @JsonProperty("parent_business_process_id")
    String parentBusinessProcessId,

    @JsonProperty("parent_business_process_name")
    String parentBusinessProcessName,

    @JsonProperty("metadata")
    UserJourneyOverviewNodeMetadataDto metadata,

    @JsonProperty("link")
    UserJourneyOverviewNodeLinkDto link
) {

    /**
     * Sub-record carrying computed metadata counts for a journey node.
     */
    public record UserJourneyOverviewNodeMetadataDto(
        @JsonProperty("step_count")
        int stepCount,

        @JsonProperty("application_count")
        int applicationCount,

        @JsonProperty("relationship_in_count")
        int relationshipInCount,

        @JsonProperty("relationship_out_count")
        int relationshipOutCount
    ) {}

    /**
     * Sub-record carrying child diagram link resolution data for a journey node.
     * The link field is always present (never null) with link_status always populated.
     *
     * Valid link_status values:
     * - "LINKED": exactly one matching child USER_JOURNEY diagram found
     * - "UNLINKED": no matching child diagram found
     * - "AMBIGUOUS_RESOLVED": multiple matches found, deterministically resolved to one
     */
    public record UserJourneyOverviewNodeLinkDto(
        @JsonProperty("linked_diagram_id")
        String linkedDiagramId,

        @JsonProperty("linked_diagram_name")
        String linkedDiagramName,

        @JsonProperty("link_status")
        String linkStatus
    ) {}
}
