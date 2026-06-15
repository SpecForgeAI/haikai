package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.roadmap.RoadmapImportResultDto;
import com.example.architecturemodel.service.RoadmapImportService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for Roadmap Import operations.
 *
 * Provides endpoint to import roadmap.md files from disk,
 * store them as versioned artifacts, and parse into work items.
 *
 * Base path: /api/model/projects/{projectId}/roadmap
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/roadmap")
@RequiredArgsConstructor
@Slf4j
public class RoadmapImportController {

    private final RoadmapImportService roadmapImportService;

    /**
     * POST /api/model/projects/{projectId}/roadmap/import
     *
     * Import a roadmap.md file from the agent-os folder structure.
     * Stores the raw content as a versioned artifact and parses
     * initiatives/epics into work items.
     *
     * Response codes:
     * - 200 OK: Import successful, returns summary with counts
     * - 404 Not Found: roadmap.md file not found at expected path
     * - 400 Bad Request: Parse failure or validation error
     * - 409 Conflict: FEATURE or STORY work items exist (v1 safety constraint)
     * - 500 Internal Server Error: Unexpected IO or system error
     *
     * @param projectId the project ID to import into
     * @return import result with artifact revision and counts
     */
    @PostMapping("/import")
    public ResponseEntity<RoadmapImportResultDto> importRoadmap(
            @PathVariable UUID projectId) {
        log.debug("POST /api/model/projects/{}/roadmap/import", projectId);

        RoadmapImportResultDto result = roadmapImportService.importFromAgentOsFile(projectId);
        return ResponseEntity.ok(result);
    }
}
