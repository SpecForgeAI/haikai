package com.example.jiraservice.service;

import com.example.jiraservice.config.JiraProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Service for resolving Jira issue types to WorkItemDto type strings.
 *
 * <p>Uses the per-project type mapping configuration from {@link JiraProperties#typeMapping()}
 * to translate Jira issue type names (e.g., "Epic", "Story") into WorkItemDto type values
 * (e.g., "INITIATIVE", "FEATURE", "STORY").</p>
 *
 * <p>Lookup is case-sensitive on the Jira issue type name, matching the exact value
 * returned by the Jira API. Unmapped types default to "STORY" with a WARN-level log.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class TypeMappingService {

    /** Default type for unmapped Jira issue types */
    public static final String DEFAULT_TYPE = "STORY";

    private final JiraProperties jiraProperties;

    /**
     * Resolves the WorkItemDto type for a given Jira issue type.
     *
     * @param jiraProjectKey    the Jira project key (e.g., "PROJ")
     * @param jiraIssueTypeName the Jira issue type name as returned by the API (e.g., "Epic")
     * @param issueKey          the Jira issue key for logging (e.g., "PROJ-123")
     * @return the resolved WorkItemDto type string, or "STORY" if unmapped
     */
    public String resolveType(String jiraProjectKey, String jiraIssueTypeName, String issueKey) {
        return resolveType(jiraProjectKey, jiraIssueTypeName, issueKey, null);
    }

    /**
     * Resolves the WorkItemDto type for a given Jira issue type, with an optional
     * per-request override that takes precedence over the static yml mapping.
     *
     * @param jiraToToolOverride optional Jira-issue-type → tool-type map; if a mapping
     *                           exists for {@code jiraIssueTypeName} here, it is used
     *                           directly without consulting the static config
     */
    public String resolveType(String jiraProjectKey, String jiraIssueTypeName, String issueKey,
                              Map<String, String> jiraToToolOverride) {
        if (jiraIssueTypeName != null && jiraToToolOverride != null) {
            String overridden = jiraToToolOverride.get(jiraIssueTypeName);
            if (overridden != null) {
                return overridden;
            }
        }

        Map<String, Map<String, String>> typeMapping = jiraProperties.typeMapping();
        if (typeMapping != null) {
            Map<String, String> projectMapping = typeMapping.get(jiraProjectKey);
            if (projectMapping != null) {
                String resolvedType = projectMapping.get(jiraIssueTypeName);
                if (resolvedType != null) {
                    return resolvedType;
                }
            }
        }

        log.warn("Unmapped Jira issue type '{}' for project '{}' (issue {}). Defaulting to '{}'.",
            jiraIssueTypeName, jiraProjectKey, issueKey, DEFAULT_TYPE);
        return DEFAULT_TYPE;
    }

    /**
     * Resolves the Jira issue type to use when CREATING a new Jira issue from a tool
     * work item. Reverse direction of {@link #resolveType}.
     *
     * <p>Reads from {@link JiraProperties#defaultJiraType()} which is configured
     * per-project in application.yml under {@code jira.default-jira-type}. This is
     * needed because {@code typeMapping} is not invertible: multiple Jira types may
     * collapse onto one tool type (Subtask/Request/Task all -> TASK) so we must
     * explicitly declare which Jira type to pick when going the other way.</p>
     *
     * @param jiraProjectKey the Jira project key (e.g., "KAN")
     * @param toolType       the tool work item type (e.g., "TASK")
     * @return the Jira issue type name to use (e.g., "Task")
     * @throws IllegalArgumentException if no mapping is configured for the project/type
     */
    public String resolveJiraIssueType(String jiraProjectKey, String toolType) {
        return resolveJiraIssueType(jiraProjectKey, toolType, null);
    }

    /**
     * Same as {@link #resolveJiraIssueType(String, String)} but with an optional
     * per-request override (tool-type → jira-issue-type) that takes precedence
     * over the static {@code default-jira-type} yml config.
     */
    public String resolveJiraIssueType(String jiraProjectKey, String toolType,
                                       Map<String, String> toolToJiraOverride) {
        if (toolType != null && toolToJiraOverride != null) {
            String overridden = toolToJiraOverride.get(toolType);
            if (overridden != null && !overridden.isBlank()) {
                return overridden;
            }
        }

        Map<String, Map<String, String>> defaults = jiraProperties.defaultJiraType();
        if (defaults != null) {
            Map<String, String> projectDefaults = defaults.get(jiraProjectKey);
            if (projectDefaults != null && projectDefaults.containsKey(toolType)) {
                String jiraType = projectDefaults.get(toolType);
                // Blank value (key present but value null/empty) is the documented
                // sentinel for "skip this tool type entirely for this project".
                if (jiraType == null || jiraType.isBlank()) {
                    throw new ToolTypeSkippedException(toolType, jiraProjectKey);
                }
                return jiraType;
            }
        }
        throw new IllegalArgumentException(
            "No default-jira-type mapping configured for project '" + jiraProjectKey
                + "' and tool type '" + toolType + "'. Add it under jira.default-jira-type."
                + jiraProjectKey + " in application.yml, or supply a per-request override. "
                + "(Use a blank value to mark the tool type as intentionally skipped.)");
    }
}
