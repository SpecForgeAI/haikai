package com.example.jiraservice.controller;

import com.example.jiraservice.model.dto.WorkItemDto;
import com.example.jiraservice.model.dto.jira.JiraIssue;
import com.example.jiraservice.model.dto.jira.JiraSearchResponse;
import com.example.jiraservice.service.ChildExpansionService;
import com.example.jiraservice.service.JiraIssueAttachmentService;
import com.example.jiraservice.service.JiraIssueCreateService;
import com.example.jiraservice.service.JiraIssueMappingService;
import com.example.jiraservice.service.JiraIssueTransitionService;
import com.example.jiraservice.service.JiraIssueUpdateService;
import com.example.jiraservice.service.JiraSearchService;
import com.example.jiraservice.service.ToolTypeSkippedException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * REST controller for querying Jira Cloud issues and returning WorkItemDto objects.
 *
 * <p>Exposes {@code GET /jira/issues} which queries Jira Cloud via JQL,
 * maps results to WorkItemDto, and optionally expands child issues.</p>
 */
@RestController
@RequestMapping("/jira")
@RequiredArgsConstructor
@Slf4j
public class JiraIssueController {

    private final JiraSearchService jiraSearchService;
    private final JiraIssueMappingService jiraIssueMappingService;
    private final ChildExpansionService childExpansionService;
    private final JiraIssueUpdateService jiraIssueUpdateService;
    private final JiraIssueCreateService jiraIssueCreateService;
    private final JiraIssueTransitionService jiraIssueTransitionService;
    private final JiraIssueAttachmentService jiraIssueAttachmentService;

    /**
     * Queries Jira Cloud for issues and returns them as WorkItemDto objects.
     *
     * @param jiraProjectKey the Jira project key (required, e.g., "PROJ")
     * @param toolProjectId  the tool project ID for WorkItemDto.projectId (required)
     * @param jql            optional JQL override; defaults to {@code project = <jiraProjectKey> ORDER BY created DESC}
     * @param maxResults     maximum number of results (default 50)
     * @param expandChildren whether to fetch and include direct child issues (default false)
     * @return HTTP 200 with a flat JSON array of WorkItemDto objects
     */
    @GetMapping("/issues")
    public ResponseEntity<List<WorkItemDto>> getIssues(
        @RequestParam String jiraProjectKey,
        @RequestParam String toolProjectId,
        @RequestParam(required = false) String jql,
        @RequestParam(defaultValue = "50") int maxResults,
        @RequestParam(defaultValue = "false") boolean expandChildren,
        @RequestParam(required = false) String typeMappingJson
    ) {
        // Validate required parameters are not blank
        if (jiraProjectKey == null || jiraProjectKey.isBlank()) {
            throw new IllegalArgumentException("jiraProjectKey must not be blank");
        }
        if (toolProjectId == null || toolProjectId.isBlank()) {
            throw new IllegalArgumentException("toolProjectId must not be blank");
        }

        // Parse optional per-request type-mapping override (Jira issue type → tool type).
        // Caller passes URL-encoded JSON, e.g. {"Epic":"INITIATIVE","Story":"EPIC"}.
        Map<String, String> jiraToToolOverride = parseTypeMappingJson(typeMappingJson);

        // Build default JQL if not provided
        String effectiveJql = (jql != null && !jql.isBlank())
            ? jql
            : "project = " + jiraProjectKey + " ORDER BY created DESC";

        log.info("Fetching Jira issues: projectKey={}, toolProjectId={}, jql={}, maxResults={}, expandChildren={}, override={}",
            jiraProjectKey, toolProjectId, effectiveJql, maxResults, expandChildren,
            jiraToToolOverride != null ? jiraToToolOverride.keySet() : "(none)");

        // Search for parent issues
        JiraSearchResponse searchResponse = jiraSearchService.searchIssues(effectiveJql, maxResults);

        List<JiraIssue> parentIssues = searchResponse != null && searchResponse.issues() != null
            ? searchResponse.issues()
            : List.of();

        // Collect parent issue keys for parent reference resolution
        Set<String> parentKeys = parentIssues.stream()
            .map(JiraIssue::key)
            .collect(Collectors.toSet());

        // Map parent issues to WorkItemDto (with optional type override)
        List<WorkItemDto> result = new ArrayList<>();
        for (JiraIssue issue : parentIssues) {
            result.add(jiraIssueMappingService.mapToWorkItem(issue, jiraProjectKey, toolProjectId, parentKeys, jiraToToolOverride));
        }

        // Optionally expand child issues
        if (expandChildren && !parentKeys.isEmpty()) {
            List<JiraIssue> childIssues = childExpansionService.fetchChildren(new ArrayList<>(parentKeys));

            // Build a combined set of all known keys for parent linkage (parents + children's parents)
            Set<String> allKnownKeys = parentKeys;

            for (JiraIssue child : childIssues) {
                result.add(jiraIssueMappingService.mapToWorkItem(child, jiraProjectKey, toolProjectId, allKnownKeys, jiraToToolOverride));
            }
        }

        log.info("Returning {} WorkItemDto objects (parents: {}, total: {})",
            result.size(), parentKeys.size(), result.size());

        return ResponseEntity.ok(result);
    }

    /**
     * Updates a single Jira issue with the writable subset of WorkItemDto fields.
     *
     * <p>PATCH semantics: only non-null fields in the body (and the optional
     * {@code parentExternalKey} query param) are sent to Jira. After the write,
     * the issue is re-read and returned so the caller sees the canonical post-write
     * state from Jira.</p>
     *
     * <p>Writable fields: {@code title}, {@code description}, {@code priority},
     * plus {@code parentExternalKey} (passed as a query param because the body's
     * {@code parent_id} is a tool-side UUID with no inverse to a Jira key).</p>
     *
     * @param externalKey       the Jira issue key in the path (e.g. "KAN-2")
     * @param parentExternalKey optional new parent's Jira key
     * @param workItem          the WorkItemDto carrying the fields to update
     * @return HTTP 200 with the re-read {@link WorkItemDto}
     */
    @PutMapping("/issues/{externalKey}")
    public ResponseEntity<WorkItemDto> updateIssue(
        @PathVariable String externalKey,
        @RequestParam(required = false) String parentExternalKey,
        @RequestParam(required = false) Set<String> clearFields,
        @RequestBody WorkItemDto workItem
    ) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey path variable must not be blank");
        }
        if (workItem.externalKey() != null && !externalKey.equals(workItem.externalKey())) {
            throw new IllegalArgumentException(
                "external_key in body (" + workItem.externalKey() + ") does not match path (" + externalKey + ")");
        }
        if (workItem.projectId() == null || workItem.projectId().isBlank()) {
            throw new IllegalArgumentException("project_id in body must not be blank (needed for re-read)");
        }

        String jiraProjectKey = deriveJiraProjectKey(externalKey);
        String toolProjectId = workItem.projectId();

        Set<String> effectiveClearFields = clearFields != null ? clearFields : Collections.emptySet();

        log.info("Updating Jira issue {} (parentExternalKey={}, toolProjectId={}, clearFields={})",
            externalKey, parentExternalKey, toolProjectId, effectiveClearFields);

        int written = jiraIssueUpdateService.updateIssue(externalKey, parentExternalKey, workItem, effectiveClearFields);
        if (written == 0) {
            throw new IllegalArgumentException(
                "no writable fields supplied (title, description, priority, parentExternalKey all null, and no clearFields)");
        }

        // Re-read the issue from Jira to return the canonical post-write state.
        JiraSearchResponse rereadResponse = jiraSearchService.searchIssues("key = " + externalKey, 1);
        if (rereadResponse == null || rereadResponse.issues() == null || rereadResponse.issues().isEmpty()) {
            throw new IllegalStateException(
                "Update succeeded but issue " + externalKey + " could not be re-read");
        }
        JiraIssue rereadIssue = rereadResponse.issues().get(0);

        // Build a "known parents" set so the response's parent_id resolves whether the
        // parent change came from this request or was already set in Jira.
        Set<String> knownParents = new HashSet<>();
        knownParents.add(externalKey);
        if (parentExternalKey != null && !parentExternalKey.isBlank()) {
            knownParents.add(parentExternalKey);
        }
        if (rereadIssue.fields().parent() != null && rereadIssue.fields().parent().key() != null) {
            knownParents.add(rereadIssue.fields().parent().key());
        }

        WorkItemDto updated = jiraIssueMappingService.mapToWorkItem(
            rereadIssue, jiraProjectKey, toolProjectId, knownParents);

        log.info("Update completed for {} ({} field(s) written)", externalKey, written);
        return ResponseEntity.ok(updated);
    }

    /**
     * Creates a new Jira issue from the writable subset of WorkItemDto fields.
     *
     * <p>Used by the sync-execute path (gateway) to push tool-only items into Jira.
     * Returns the new Jira key and browse URL so the caller can write them back to
     * the corresponding tool work item's external_key/external_url.</p>
     *
     * <p>Required body fields: {@code project_id} (tool project for context),
     * {@code type} (tool type, reverse-mapped via default-jira-type config),
     * {@code title}. Optional: {@code description}, {@code priority},
     * {@code parent_external_key}.</p>
     *
     * <p>Status is intentionally not settable here -- new Jira issues land in the
     * project workflow's first status. Status changes go via the (deferred)
     * transitions API.</p>
     *
     * @param jiraProjectKey the Jira project key in which to create the issue
     * @param body           the WorkItemDto carrying the writable fields
     * @param parentExternalKey optional Jira parent issue key
     * @return HTTP 201 with the new key + browse URL
     */
    @PostMapping("/issues")
    public ResponseEntity<?> createIssue(
        @RequestParam String jiraProjectKey,
        @RequestParam(required = false) String parentExternalKey,
        @RequestParam(required = false) String jiraIssueType,
        @RequestBody WorkItemDto body
    ) {
        if (jiraProjectKey == null || jiraProjectKey.isBlank()) {
            throw new IllegalArgumentException("jiraProjectKey query param must not be blank");
        }
        if (body.type() == null || body.type().isBlank()) {
            throw new IllegalArgumentException("type in body must not be blank");
        }
        if (body.title() == null || body.title().isBlank()) {
            throw new IllegalArgumentException("title in body must not be blank");
        }

        log.info("POST /jira/issues -- creating in {} (type={}, jiraIssueTypeOverride={}, parent={})",
            jiraProjectKey, body.type(), jiraIssueType, parentExternalKey);

        try {
            JiraIssueCreateService.CreateResult result = jiraIssueCreateService.createIssue(
                jiraProjectKey,
                body.type(),
                jiraIssueType,
                body.title(),
                body.description(),
                body.priority(),
                parentExternalKey
            );
            return ResponseEntity.status(HttpStatus.CREATED).body(result);
        } catch (ToolTypeSkippedException skipped) {
            // Tool type is intentionally configured to skip in this project (blank
            // yml value). Surface as 422 with a specific code so the gateway can
            // mark the action as SKIPPED rather than FAILED.
            log.info("Skipping create for {} -- tool type '{}' is configured to skip in {}",
                body.type(), skipped.getToolType(), skipped.getJiraProjectKey());
            return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                "code", "TOOL_TYPE_SKIPPED",
                "message", skipped.getMessage(),
                "toolType", skipped.getToolType(),
                "jiraProjectKey", skipped.getJiraProjectKey()
            ));
        }
    }

    /**
     * Returns the issue types available in a Jira project plus their hierarchy
     * level, used by the dynamic-mapping sync flow to compute auto-shift mapping.
     * Optionally also returns the issue type of an "anchor" issue, which is the
     * sync root used to compute the level offset.
     */
    @GetMapping("/projects/{projectKey}/issue-types")
    public ResponseEntity<JiraSearchService.ProjectIssueTypesResponse> getProjectIssueTypes(
        @PathVariable String projectKey,
        @RequestParam(required = false) String anchorKey
    ) {
        if (projectKey == null || projectKey.isBlank()) {
            throw new IllegalArgumentException("projectKey path variable must not be blank");
        }
        return ResponseEntity.ok(jiraSearchService.getProjectIssueTypes(projectKey, anchorKey));
    }

    /**
     * Transitions a Jira issue toward a tool status (E2 status sync).
     *
     * <p>Looks up available transitions via {@code GET /rest/api/3/issue/{key}/transitions},
     * picks the first whose target status name matches a candidate for the supplied
     * tool status, and executes via {@code POST /rest/api/3/issue/{key}/transitions}.
     * Candidates are hardcoded in {@link JiraIssueTransitionService} (mirrors of
     * {@code normalizeStatus}).</p>
     *
     * <p>Responses:</p>
     * <ul>
     *   <li>200 {@code Transitioned} — transitioned successfully</li>
     *   <li>200 {@code AlreadyAtTarget} — issue was already at the target (no-op)</li>
     *   <li>422 {@code NoMatchingTransition} — no available transition matched the
     *       tool status's candidates; body lists what was available so the caller
     *       can surface a clear note in the sync result</li>
     * </ul>
     */
    @PostMapping("/issues/{externalKey}/transitions")
    public ResponseEntity<?> transitionIssue(
        @PathVariable String externalKey,
        @RequestParam String targetStatus
    ) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey path variable must not be blank");
        }
        if (targetStatus == null || targetStatus.isBlank()) {
            throw new IllegalArgumentException("targetStatus query param must not be blank");
        }

        log.info("POST /jira/issues/{}/transitions targetStatus={}", externalKey, targetStatus);

        JiraIssueTransitionService.TransitionResult result = jiraIssueTransitionService.transitionTo(externalKey, targetStatus);

        return switch (result) {
            case JiraIssueTransitionService.TransitionResult.Transitioned t ->
                ResponseEntity.ok(Map.of(
                    "status", "TRANSITIONED",
                    "toStatusName", t.toStatusName()
                ));
            case JiraIssueTransitionService.TransitionResult.AlreadyAtTarget a ->
                ResponseEntity.ok(Map.of(
                    "status", "ALREADY_AT_TARGET",
                    "currentStatusName", a.currentStatusName()
                ));
            case JiraIssueTransitionService.TransitionResult.NoMatchingTransition n ->
                ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                    "code", "NO_MATCHING_TRANSITION",
                    "message", "No available transition leads to a status matching tool status '"
                        + n.toolStatus() + "'.",
                    "toolStatus", n.toolStatus(),
                    "candidates", n.candidates(),
                    "availableTargets", n.availableTargets()
                ));
        };
    }

    /**
     * Lists the filenames of attachments currently on a Jira issue. Used by the
     * gateway's spec-upload sync flow to short-circuit re-uploads that would be
     * a no-op (filename = idempotency key).
     */
    @GetMapping("/issues/{externalKey}/attachments")
    public ResponseEntity<Map<String, List<String>>> listAttachments(
        @PathVariable String externalKey
    ) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey path variable must not be blank");
        }
        List<String> filenames = jiraIssueAttachmentService.listAttachmentFilenames(externalKey);
        return ResponseEntity.ok(Map.of("filenames", filenames));
    }

    /**
     * Uploads a single spec file as a Jira attachment and posts a notification
     * comment. Caller is responsible for choosing a unique filename (slugified
     * increment title + ".md") and verifying via {@link #listAttachments} that
     * it's not already attached.
     *
     * <p>Two HTTP calls in sequence (multipart attachment, then comment). If the
     * attachment fails the comment is skipped; if the comment fails the
     * attachment remains. Errors propagate as upstream HTTP errors so the
     * gateway can surface PARTIAL_FAILURE.</p>
     */
    @PostMapping("/issues/{externalKey}/specs")
    public ResponseEntity<Map<String, String>> uploadSpec(
        @PathVariable String externalKey,
        @RequestBody UploadSpecRequest body
    ) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey path variable must not be blank");
        }
        if (body == null) {
            throw new IllegalArgumentException("request body must not be null");
        }
        if (body.filename() == null || body.filename().isBlank()) {
            throw new IllegalArgumentException("filename must not be blank");
        }
        if (body.content() == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        if (body.commentText() == null || body.commentText().isBlank()) {
            throw new IllegalArgumentException("commentText must not be blank");
        }

        log.info("POST /jira/issues/{}/specs filename={} ({} chars)",
            externalKey, body.filename(), body.content().length());

        jiraIssueAttachmentService.uploadSpec(externalKey, body.filename(), body.content(), body.commentText());

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
            "externalKey", externalKey,
            "filename", body.filename()
        ));
    }

    /**
     * Body for {@link #uploadSpec}. Snake_case field names because the global
     * Jackson SNAKE_CASE strategy is in effect.
     *
     * @param filename     the unique filename for the attachment (e.g., "add-priority-toggle.md")
     * @param content      the markdown spec content as plain text
     * @param commentText  plain-text comment to post after successful upload
     */
    public record UploadSpecRequest(String filename, String content, String commentText) {}

    /** Parses a JSON object string into a Map<String,String>. Tolerant of null/blank input. */
    private static Map<String, String> parseTypeMappingJson(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return new ObjectMapper().readValue(json, new TypeReference<Map<String, String>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid typeMappingJson — must be a JSON object of strings: " + e.getMessage(), e);
        }
    }

    private static String deriveJiraProjectKey(String externalKey) {
        int dash = externalKey.indexOf('-');
        if (dash <= 0) {
            throw new IllegalArgumentException(
                "externalKey '" + externalKey + "' does not look like a Jira key (expected PREFIX-NUMBER)");
        }
        return externalKey.substring(0, dash);
    }
}
