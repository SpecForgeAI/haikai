package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing a step in the User Journey diagram contract v1.
 * Each step corresponds to one ActivityStep, ordered by sequence_order.
 */
public record UserJourneyDiagramStepDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("journey_id")
    String journeyId,

    @JsonProperty("order")
    int order,

    @JsonProperty("lane_id")
    String laneId,

    @JsonProperty("process_activity_id")
    String processActivityId,

    @JsonProperty("process_activity_name")
    String processActivityName,

    @JsonProperty("name")
    String name,

    @JsonProperty("diagram_label")
    String diagramLabel,

    @JsonProperty("description")
    String description,

    @JsonProperty("business_user_id")
    String businessUserId,

    @JsonProperty("business_user_name")
    String businessUserName,

    @JsonProperty("activity_issues")
    String activityIssues,

    @JsonProperty("ui_issues")
    String uiIssues
) {}
