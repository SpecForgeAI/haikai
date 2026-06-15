package com.example.jiraservice.service;

import com.example.jiraservice.config.JiraProperties;
import com.example.jiraservice.util.AdfHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Service for creating new Jira Cloud issues from tool work items.
 *
 * <p>Calls {@code POST /rest/api/3/issue} with a fields payload. Reverses the
 * tool-type to Jira-issue-type via {@link TypeMappingService#resolveJiraIssueType}
 * (configured under {@code jira.default-jira-type} in application.yml).</p>
 *
 * <p>Writable subset (v1, matching the update path): {@code summary},
 * {@code description}, {@code priority}, {@code parent}. {@code status} is not
 * settable on create -- new issues land in their workflow's first status.</p>
 */
@Service
@Slf4j
public class JiraIssueCreateService {

    private final RestClient jiraRestClient;
    private final TypeMappingService typeMappingService;
    private final JiraProperties jiraProperties;

    public JiraIssueCreateService(@Qualifier("jiraRestClient") RestClient jiraRestClient,
                                  TypeMappingService typeMappingService,
                                  JiraProperties jiraProperties) {
        this.jiraRestClient = jiraRestClient;
        this.typeMappingService = typeMappingService;
        this.jiraProperties = jiraProperties;
    }

    /**
     * Result of a successful create operation.
     */
    public record CreateResult(String externalKey, String externalUrl) {}

    /**
     * Create a Jira issue under the given project.
     *
     * @param jiraProjectKey    the Jira project key (e.g., "KAN")
     * @param toolType          the tool work item type (e.g., "STORY")
     * @param title             the issue summary (required, mapped to {@code fields.summary})
     * @param description       optional plain text -- wrapped in ADF
     * @param priority          optional Jira priority id (integer; mapped to {@code fields.priority.id} as String)
     * @param parentExternalKey optional parent issue key to set on the new issue
     * @return key + browse URL of the new issue
     */
    public CreateResult createIssue(
        String jiraProjectKey,
        String toolType,
        String title,
        String description,
        Integer priority,
        String parentExternalKey
    ) {
        return createIssue(jiraProjectKey, toolType, null, title, description, priority, parentExternalKey);
    }

    /**
     * Same as the simpler overload but with an explicit {@code jiraIssueTypeOverride}.
     * When non-blank, this Jira issue type is used directly, bypassing the
     * {@code default-jira-type} yml lookup. Used by the dynamic-mapping sync flow
     * where the type mapping is computed per-sync from the root's anchor.
     */
    public CreateResult createIssue(
        String jiraProjectKey,
        String toolType,
        String jiraIssueTypeOverride,
        String title,
        String description,
        Integer priority,
        String parentExternalKey
    ) {
        if (jiraProjectKey == null || jiraProjectKey.isBlank()) {
            throw new IllegalArgumentException("jiraProjectKey must not be blank");
        }
        if (toolType == null || toolType.isBlank()) {
            throw new IllegalArgumentException("toolType must not be blank");
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("title must not be blank");
        }

        String jiraIssueType = (jiraIssueTypeOverride != null && !jiraIssueTypeOverride.isBlank())
            ? jiraIssueTypeOverride
            : typeMappingService.resolveJiraIssueType(jiraProjectKey, toolType);

        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("project", Map.of("key", jiraProjectKey));
        fields.put("issuetype", Map.of("name", jiraIssueType));
        fields.put("summary", title);
        if (description != null && !description.isBlank()) {
            fields.put("description", AdfHelper.wrap(description));
        }
        if (priority != null) {
            fields.put("priority", Map.of("id", String.valueOf(priority)));
        }
        if (parentExternalKey != null && !parentExternalKey.isBlank()) {
            fields.put("parent", Map.of("key", parentExternalKey));
        }

        Map<String, Object> body = Map.of("fields", fields);

        log.info("Creating Jira issue in {} as {} (toolType={}, parent={})",
            jiraProjectKey, jiraIssueType, toolType, parentExternalKey);

        Map<?, ?> response = jiraRestClient.post()
            .uri("/rest/api/3/issue")
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(Map.class);

        if (response == null || response.get("key") == null) {
            throw new IllegalStateException("Jira create returned no issue key");
        }

        String key = String.valueOf(response.get("key"));
        String browseUrl = jiraProperties.baseUrl().replaceAll("/+$", "") + "/browse/" + key;

        log.info("Created Jira issue {} (toolType={}, jiraType={})", key, toolType, jiraIssueType);
        return new CreateResult(key, browseUrl);
    }
}
