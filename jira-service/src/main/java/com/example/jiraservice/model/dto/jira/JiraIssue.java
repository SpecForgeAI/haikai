package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Represents a single issue from the Jira Cloud REST API search response.
 *
 * <p>Contains the issue key (e.g., "PROJ-123") and a nested fields object
 * with the requested field values.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraIssue(
    String key,
    JiraIssueFields fields
) {}
