package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing the overview header in the User Journey Overview diagram contract v1.
 * Contains the business user identity and the diagram title.
 */
public record UserJourneyOverviewHeaderDto(
    @JsonProperty("business_user_id")
    String businessUserId,

    @JsonProperty("business_user_name")
    String businessUserName,

    @JsonProperty("title")
    String title
) {}
