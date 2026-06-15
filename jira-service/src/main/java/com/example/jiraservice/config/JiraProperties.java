package com.example.jiraservice.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Configuration properties for Jira Cloud API connectivity.
 *
 * <p>Binds to the {@code jira} prefix in application configuration.
 * Required fields are validated in the compact constructor, and sensible defaults
 * are applied for optional timeout settings.</p>
 *
 * <p>Follows the ConfluenceProperties pattern from architecture-read-service.</p>
 */
@ConfigurationProperties(prefix = "jira")
public record JiraProperties(
    String baseUrl,
    AuthMode authMode,
    String bearerToken,
    String username,
    String apiToken,
    int connectTimeoutMs,
    int readTimeoutMs,
    Map<String, Map<String, String>> typeMapping,
    /**
     * Reverse type mapping used when creating Jira issues from tool work items.
     * Outer key: Jira project key. Inner key: tool type (INITIATIVE, EPIC, ...).
     * Inner value: the Jira issue type name to use when creating from that tool type.
     * <p>Resolves the ambiguity that {@code typeMapping} can have multiple Jira
     * types collapsed onto a single tool type (e.g. Subtask/Request/Task -> TASK).</p>
     */
    Map<String, Map<String, String>> defaultJiraType,
    /**
     * Per-project tool-status -> ordered list of Jira target-status name candidates,
     * used by {@link com.example.jiraservice.service.JiraIssueTransitionService}.
     * <p>Outer key: Jira project key. Inner key: tool status (PLANNED, IN_PROGRESS,
     * DEV_COMPLETE, COMPLETED, CANCELLED). Inner value: ordered list of Jira
     * status names — first one whose available transition leads there wins.</p>
     * <p>When a project/tool-status combination is NOT configured here, the
     * service falls back to a hardcoded default list (see {@code DEFAULT_TOOL_STATUS_TO_JIRA_CANDIDATES}).
     * To add candidates without losing the defaults, list them all here for the
     * project — this map fully overrides defaults per (project, tool-status).</p>
     */
    Map<String, Map<String, List<String>>> statusMapping
) {

    /** Default connection timeout in milliseconds */
    public static final int DEFAULT_CONNECT_TIMEOUT_MS = 5000;

    /** Default read timeout in milliseconds */
    public static final int DEFAULT_READ_TIMEOUT_MS = 30000;

    /**
     * Authentication mode for Jira Cloud API requests.
     *
     * <p>BEARER uses a personal access token or OAuth bearer token.
     * BASIC uses Base64-encoded username:apiToken (Atlassian API token).</p>
     */
    public enum AuthMode {
        BEARER,
        BASIC
    }

    /**
     * Compact constructor that validates required fields and applies defaults.
     */
    public JiraProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");

        // Apply defaults for non-positive timeout values
        if (connectTimeoutMs <= 0) {
            connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS;
        }
        if (readTimeoutMs <= 0) {
            readTimeoutMs = DEFAULT_READ_TIMEOUT_MS;
        }

        // Default authMode to BEARER if not specified
        if (authMode == null) {
            authMode = AuthMode.BEARER;
        }

        // Default typeMapping to empty map if null
        if (typeMapping == null) {
            typeMapping = Map.of();
        }

        // Default defaultJiraType to empty map if null
        if (defaultJiraType == null) {
            defaultJiraType = Map.of();
        }

        // Default statusMapping to empty map if null
        if (statusMapping == null) {
            statusMapping = Map.of();
        }
    }
}
