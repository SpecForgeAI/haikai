package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Represents the parent field from a Jira issue.
 *
 * <p>Contains the key of the parent issue (e.g., "PROJ-100") when the issue
 * has a parent relationship configured in Jira Cloud.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraParentField(
    String key
) {}
