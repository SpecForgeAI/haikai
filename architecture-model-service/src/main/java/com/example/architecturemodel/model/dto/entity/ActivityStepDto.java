package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ActivityStepDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("user_journey_id")
    String userJourneyId,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("sequence_order")
    Integer sequenceOrder,

    @JsonProperty("process_activity_id")
    String processActivityId,

    @JsonProperty("business_user_id")
    String businessUserId,

    @JsonProperty("application_id")
    String applicationId,

    @JsonProperty("diagram_label")
    String diagramLabel,

    @JsonProperty("activity_issues")
    String activityIssues,

    @JsonProperty("ui_issues")
    String uiIssues
) {}
