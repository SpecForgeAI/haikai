package com.example.jiraservice.service;

/**
 * Thrown by {@link TypeMappingService#resolveJiraIssueType} when the requested
 * tool type is intentionally configured to be skipped — i.e. the project's
 * {@code default-jira-type} yml block has the tool type as a key with a
 * null/blank value. Distinct from {@link IllegalArgumentException} (which
 * signals an unconfigured/missing mapping), so callers can treat the two
 * differently: misconfiguration is a 4xx error, intentional skip becomes a
 * SKIPPED status in the sync result.
 */
public class ToolTypeSkippedException extends RuntimeException {

    private final String toolType;
    private final String jiraProjectKey;

    public ToolTypeSkippedException(String toolType, String jiraProjectKey) {
        super("Tool type '" + toolType + "' is configured to skip in Jira project '"
            + jiraProjectKey + "' (blank value under jira.default-jira-type." + jiraProjectKey + ")");
        this.toolType = toolType;
        this.jiraProjectKey = jiraProjectKey;
    }

    public String getToolType() { return toolType; }
    public String getJiraProjectKey() { return jiraProjectKey; }
}
