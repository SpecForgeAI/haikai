package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Represents the fields object within a Jira issue from the search response.
 *
 * <p>Contains the specific fields requested via the {@code fields} query parameter
 * in the Jira search API call.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraIssueFields(
    String summary,
    JiraNamedField issuetype,
    JiraNamedField status,
    JiraPriorityField priority,
    JiraParentField parent,
    String created,
    String updated,
    Object description
) {}
