package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Represents the priority field from a Jira issue.
 *
 * <p>Contains both the numeric {@code id} and human-readable {@code name}
 * of the priority level.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraPriorityField(
    String id,
    String name
) {}
