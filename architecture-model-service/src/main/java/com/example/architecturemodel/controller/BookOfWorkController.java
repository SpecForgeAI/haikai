package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.bookofwork.BookOfWorkUploadRequestDto;
import com.example.architecturemodel.model.dto.bookofwork.BookOfWorkUploadResultDto;
import com.example.architecturemodel.service.BookOfWorkUploadService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for Book of Work upload operations.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 3.2: Create BookOfWorkController
 *
 * Provides endpoint to upload a Book of Work markdown file,
 * parse the 4-level hierarchy (Initiative, Epic, Feature, Story),
 * and persist the work items.
 *
 * Base path: /api/projects/{projectId}/book-of-work
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/book-of-work")
@RequiredArgsConstructor
@Slf4j
public class BookOfWorkController {

    private final BookOfWorkUploadService bookOfWorkUploadService;

    /**
     * POST /api/projects/{projectId}/book-of-work/upload
     *
     * Upload a Book of Work markdown file to import work items.
     *
     * The markdown content is parsed to extract a 4-level hierarchy:
     * - H2 (##) = INITIATIVE
     * - H3 (###) = EPIC
     * - H4 (####) = FEATURE
     * - H5 (#####) = STORY
     *
     * Uses destructive sync strategy: deletes all existing work items
     * for the project before inserting new ones.
     *
     * Response codes:
     * - 200 OK: Upload successful, returns work items and import summary
     * - 400 Bad Request: Empty content, no valid headings, or validation error
     * - 404 Not Found: Project not found
     * - 500 Internal Server Error: Unexpected error
     *
     * @param projectId the project ID (project name) to import into
     * @param request the upload request containing markdown content
     * @return upload result with work items and counts
     */
    @PostMapping("/upload")
    public ResponseEntity<BookOfWorkUploadResultDto> uploadBookOfWork(
            @PathVariable UUID projectId,
            @Valid @RequestBody BookOfWorkUploadRequestDto request) {
        log.debug("POST /api/projects/{}/book-of-work/upload", projectId);

        BookOfWorkUploadResultDto result = bookOfWorkUploadService.uploadBookOfWork(
                projectId, request.content());

        return ResponseEntity.ok(result);
    }
}
