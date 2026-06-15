package com.example.jiraservice.model.dto.jira;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * Represents a Jira field that has a {@code name} property.
 *
 * <p>Used for fields like {@code issuetype} and {@code status} which share
 * the same structure of containing a human-readable name.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record JiraNamedField(
    String name
) {}
