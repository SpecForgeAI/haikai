package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.util.AdfHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Service for writing updates to a single Jira Cloud issue.
 *
 * <p>Calls {@code PUT /rest/api/3/issue/{key}} with PATCH semantics: only fields
 * supplied non-null on the request are sent to Jira. Null fields are not touched.</p>
 *
 * <p>Writable subset (v1): {@code summary}, {@code description}, {@code priority},
 * {@code parent}. Status, type, dates and other fields are intentionally not
 * supported here.</p>
 */
@Service
@Slf4j
public class JiraIssueUpdateService {

    private final RestClient jiraRestClient;

    public JiraIssueUpdateService(@Qualifier("jiraRestClient") RestClient jiraRestClient) {
        this.jiraRestClient = jiraRestClient;
    }

    /**
     * Sends a partial update to a Jira issue.
     *
     * <p>Two parallel mechanisms drive what gets written:
     * <ul>
     *   <li><b>Set values</b>: any non-null field on {@code workItem} (plus
     *       {@code parentExternalKey} if provided) is sent to Jira as a new value.</li>
     *   <li><b>Clear values</b>: any field name in {@code clearFields} is sent to
     *       Jira as {@code null}, which clears the field on the Jira side.
     *       Currently supports: {@code description}, {@code priority}, {@code parent}.
     *       Title is intentionally not clearable (Jira requires a non-empty summary).</li>
     * </ul>
     *
     * @param externalKey       the Jira issue key (e.g. "KAN-2"); must not be null/blank
     * @param parentExternalKey optional Jira parent key; if non-null, sets {@code parent.key}
     * @param workItem          the body fields; only non-null entries are written
     * @param clearFields       optional set of field names to clear (null becomes empty)
     * @return the number of fields actually written (0 means no-op was requested)
     */
    public int updateIssue(String externalKey, String parentExternalKey, WorkItemDto workItem, Set<String> clearFields) {
        // LinkedHashMap is used because Map.of() rejects null values (which we need for clears).
        Map<String, Object> fields = new LinkedHashMap<>();

        // ---- SET values ----
        if (workItem.title() != null) {
            fields.put("summary", workItem.title());
        }
        if (workItem.description() != null) {
            fields.put("description", AdfHelper.wrap(workItem.description()));
        }
        if (workItem.priority() != null) {
            fields.put("priority", Map.of("id", String.valueOf(workItem.priority())));
        }
        if (parentExternalKey != null && !parentExternalKey.isBlank()) {
            fields.put("parent", Map.of("key", parentExternalKey));
        }

        // ---- CLEAR values via fields.X = null ----
        // Notes:
        //  * `description` and `parent` accept null in Jira Cloud REST v3.
        //  * `priority` does NOT — Jira's standard priority scheme is enum-only
        //    (no null option), so we skip with a warn rather than fail the call.
        //  * `title` is never cleared — Jira requires a non-empty summary.
        //  * If a field is in both SET and CLEAR, CLEAR wins (we overwrite).
        if (clearFields != null) {
            for (String field : clearFields) {
                switch (field) {
                    case "description", "parent" -> fields.put(field, null);
                    case "priority" -> log.warn(
                        "Skipping 'priority' clear for {} -- Jira's priority scheme has no null value; "
                            + "clear it manually in the Jira UI if needed.",
                        externalKey);
                    case "title" -> log.warn(
                        "Refusing to clear 'title' for {} -- Jira requires a non-empty summary",
                        externalKey);
                    default -> log.warn(
                        "Unsupported clearFields entry '{}' for {}; ignoring", field, externalKey);
                }
            }
        }

        if (fields.isEmpty()) {
            log.warn("updateIssue called with no writable fields for {}", externalKey);
            return 0;
        }

        Map<String, Object> body = Map.of("fields", fields);

        log.info("Updating Jira issue {} | fields: {}", externalKey, fields.keySet());

        jiraRestClient.put()
            .uri("/rest/api/3/issue/{key}", externalKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .toBodilessEntity();

        return fields.size();
    }
}
