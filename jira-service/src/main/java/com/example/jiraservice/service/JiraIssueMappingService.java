package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.model.dto.jira.JiraIssue;
import com.example.jiraservice.util.AdfHelper;
import com.example.jiraservice.util.DeterministicIdGenerator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Service for mapping Jira issue objects to WorkItemDto records.
 *
 * <p>Handles all field mapping including deterministic ID generation,
 * type resolution via {@link TypeMappingService}, parent reference linkage,
 * and date parsing from Jira ISO-8601 strings.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class JiraIssueMappingService {

    private final TypeMappingService typeMappingService;

    /**
     * Maps a Jira issue to a WorkItemDto.
     *
     * @param issue             the Jira issue to map
     * @param jiraProjectKey    the Jira project key (for type mapping lookup)
     * @param toolProjectId     the tool project ID (for WorkItemDto.projectId and ID generation)
     * @param fetchedParentKeys set of issue keys that have been fetched (for parentId resolution)
     * @return a fully mapped WorkItemDto
     */
    public WorkItemDto mapToWorkItem(JiraIssue issue, String jiraProjectKey,
                                     String toolProjectId, Set<String> fetchedParentKeys) {
        return mapToWorkItem(issue, jiraProjectKey, toolProjectId, fetchedParentKeys, null);
    }

    /**
     * Same as {@link #mapToWorkItem(JiraIssue, String, String, Set)} but with an
     * optional per-request type-mapping override (Jira-issue-type → tool-type).
     */
    public WorkItemDto mapToWorkItem(JiraIssue issue, String jiraProjectKey,
                                     String toolProjectId, Set<String> fetchedParentKeys,
                                     Map<String, String> jiraToToolOverride) {
        UUID id = DeterministicIdGenerator.generateId(toolProjectId, issue.key());

        String issueTypeName = issue.fields().issuetype() != null
            ? issue.fields().issuetype().name()
            : null;
        String type = typeMappingService.resolveType(jiraProjectKey, issueTypeName, issue.key(), jiraToToolOverride);

        UUID parentId = resolveParentId(issue, toolProjectId, fetchedParentKeys);

        String description = AdfHelper.unwrap(issue.fields().description());

        String status = normalizeStatus(issue.fields().status() != null
            ? issue.fields().status().name()
            : null);

        Integer priority = resolvePriority(issue);

        Instant createdAt = parseInstant(issue.fields().created());
        Instant updatedAt = parseInstant(issue.fields().updated());

        return new WorkItemDto(
            id,
            toolProjectId,
            type,
            parentId,
            issue.fields().summary(),
            description,
            status,
            null,       // sortOrder
            priority,
            null,       // targetWindow
            null,       // tags
            "JIRA",
            issue.key(),
            createdAt,
            updatedAt
        );
    }

    private UUID resolveParentId(JiraIssue issue, String toolProjectId, Set<String> fetchedParentKeys) {
        if (issue.fields().parent() != null && issue.fields().parent().key() != null) {
            String parentKey = issue.fields().parent().key();
            if (fetchedParentKeys != null && fetchedParentKeys.contains(parentKey)) {
                return DeterministicIdGenerator.generateId(toolProjectId, parentKey);
            }
        }
        return null;
    }

    private Integer resolvePriority(JiraIssue issue) {
        if (issue.fields().priority() != null && issue.fields().priority().id() != null) {
            try {
                return Integer.parseInt(issue.fields().priority().id());
            } catch (NumberFormatException e) {
                log.debug("Could not parse priority id '{}' as integer for issue {}",
                    issue.fields().priority().id(), issue.key());
                return null;
            }
        }
        return null;
    }

    private Instant parseInstant(String dateString) {
        if (dateString == null || dateString.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(dateString);
        } catch (Exception e) {
            log.debug("Could not parse date string '{}' as Instant: {}", dateString, e.getMessage());
            return null;
        }
    }

    /**
     * Normalises a Jira status name (e.g. "In Progress", "To Do", "Done") into one of
     * the tool's allowed status values: PLANNED, IN_PROGRESS, DEV_COMPLETE, COMPLETED,
     * CANCELLED.
     *
     * <p>The tool's flow is:
     *   PLANNED -> IN_PROGRESS -> DEV_COMPLETE -> COMPLETED  (or CANCELLED at any point)
     * where DEV_COMPLETE means initial code/work has been written but verification and
     * Definition of Done sign-off haven't happened yet.</p>
     *
     * <p>Unknown statuses fall through to PLANNED with a WARN log. When this mapping
     * outgrows being hardcoded it should become per-project config under
     * {@code jira.statusMapping.<projectKey>} in application.yml, mirroring the
     * existing {@code type-mapping} block.</p>
     */
    static String normalizeStatus(String jiraStatusName) {
        if (jiraStatusName == null || jiraStatusName.isBlank()) {
            return "PLANNED";
        }
        String normalized = jiraStatusName.trim().toUpperCase().replace(' ', '_').replace('-', '_');
        switch (normalized) {
            // PLANNED -- not started
            case "TO_DO":
            case "TODO":
            case "OPEN":
            case "BACKLOG":
            case "NEW":
            case "PLANNED":
            case "SELECTED_FOR_DEVELOPMENT":
                return "PLANNED";
            // IN_PROGRESS -- actively being coded
            case "IN_PROGRESS":
            case "IN_DEVELOPMENT":
            case "ACTIVE":
                return "IN_PROGRESS";
            // DEV_COMPLETE -- code written, awaiting review/QA/verification
            case "IN_REVIEW":
            case "CODE_REVIEW":
            case "READY_FOR_REVIEW":
            case "IN_QA":
            case "READY_FOR_QA":
            case "AWAITING_QA":
            case "IN_TEST":
            case "IN_TESTING":
            case "READY_TO_TEST":
            case "READY_FOR_TESTING":
            case "IN_VERIFICATION":
            case "AWAITING_VERIFICATION":
            case "DEV_COMPLETE":
                return "DEV_COMPLETE";
            // COMPLETED -- done done
            case "DONE":
            case "CLOSED":
            case "RESOLVED":
            case "COMPLETED":
            case "VERIFIED":
                return "COMPLETED";
            // CANCELLED -- won't do
            case "CANCELLED":
            case "CANCELED":
            case "WON'T_DO":
            case "WONT_DO":
            case "WILL_NOT_DO":
            case "DEFERRED":
                return "CANCELLED";
            default:
                log.warn("Unmapped Jira status '{}' (normalised '{}'); defaulting to PLANNED. Add to JiraIssueMappingService.normalizeStatus if this is a known status.",
                    jiraStatusName, normalized);
                return "PLANNED";
        }
    }
}
