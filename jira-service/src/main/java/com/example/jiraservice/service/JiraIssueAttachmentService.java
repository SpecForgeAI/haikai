package com.example.jiraservice.service;

import com.example.jiraservice.util.AdfHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Drives Jira's attachment + comment APIs for spec uploads.
 *
 * <p>Used by the Tool→Jira spec upload flow: when a tool work item (story) has
 * persisted spec markdown for one or more increments, the gateway sync-execute
 * pipeline calls this service to attach each spec file and post a notification
 * comment.</p>
 *
 * <p>Idempotency is implemented at the caller level by checking existing
 * filenames via {@link #listAttachmentFilenames(String)}; this service does
 * not re-check before uploading.</p>
 */
@Service
@Slf4j
public class JiraIssueAttachmentService {

    private final RestClient jiraRestClient;

    public JiraIssueAttachmentService(@Qualifier("jiraRestClient") RestClient jiraRestClient) {
        this.jiraRestClient = jiraRestClient;
    }

    /**
     * Lists the filenames of all attachments currently on a Jira issue.
     * Used by the gateway to short-circuit re-uploads of specs that are already
     * attached (filename = idempotency key).
     */
    public List<String> listAttachmentFilenames(String externalKey) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey must not be blank");
        }

        Map<?, ?> response = jiraRestClient.get()
            .uri(uriBuilder -> uriBuilder
                .path("/rest/api/3/issue/{key}")
                .queryParam("fields", "attachment")
                .build(externalKey))
            .retrieve()
            .body(Map.class);

        if (response == null || !(response.get("fields") instanceof Map<?, ?> fields)) {
            return List.of();
        }
        if (!(fields.get("attachment") instanceof List<?> attachments)) {
            return List.of();
        }

        List<String> filenames = new ArrayList<>();
        for (Object att : attachments) {
            if (att instanceof Map<?, ?> attMap && attMap.get("filename") instanceof String fn) {
                filenames.add(fn);
            }
        }
        return filenames;
    }

    /**
     * Uploads a single spec file to a Jira issue and posts a notification comment.
     *
     * <p>Two HTTP calls in order: the multipart attachment upload, then the
     * comment. If the attachment fails the comment is not posted; if the
     * comment fails the attachment remains (caller treats as PARTIAL_FAILURE).</p>
     *
     * @param externalKey  the Jira issue key (e.g., "KAN-2")
     * @param filename     the unique filename — by convention slugified increment title + ".md"
     * @param content      the markdown content as UTF-8 text
     * @param commentText  plain-text comment to post (e.g., {@code New spec "X" has been added})
     */
    public void uploadSpec(String externalKey, String filename, String content, String commentText) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey must not be blank");
        }
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("filename must not be blank");
        }
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        if (commentText == null || commentText.isBlank()) {
            throw new IllegalArgumentException("commentText must not be blank");
        }

        log.info("Uploading spec {} to {} ({} bytes)", filename, externalKey, content.getBytes(StandardCharsets.UTF_8).length);

        // 1) Attachment: multipart/form-data with X-Atlassian-Token: no-check.
        // ByteArrayResource needs an overridden filename so Jira sees the right name.
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        ByteArrayResource fileResource = new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        };

        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", fileResource);

        jiraRestClient.post()
            .uri("/rest/api/3/issue/{key}/attachments", externalKey)
            .header("X-Atlassian-Token", "no-check")
            .contentType(MediaType.MULTIPART_FORM_DATA)
            .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
            .body(form)
            .retrieve()
            .toBodilessEntity();

        // 2) Comment: ADF wrapper (Jira Cloud v3 requires ADF for comment.body).
        Map<String, Object> commentBody = Map.of("body", AdfHelper.wrap(commentText));
        jiraRestClient.post()
            .uri("/rest/api/3/issue/{key}/comment", externalKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(commentBody)
            .retrieve()
            .toBodilessEntity();

        log.info("Successfully uploaded spec {} and posted comment to {}", filename, externalKey);
    }
}
