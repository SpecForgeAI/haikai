package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.model.dto.migration.AutoSeedEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.migration.CreateEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.migration.EpicCapturedDecisionDto;
import com.example.architecturemodel.model.dto.migration.UpdateEpicCapturedDecisionRequest;
import com.example.architecturemodel.service.migration.EpicCapturedDecisionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for {@code epic_captured_decisions}: epic-level CRUD that
 * feeds pass-2 {@code parent_rollup.epic.capturedDecisions[]} and is editable
 * by the architect via the dedicated panel.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Path scope: every row is keyed by {@code (projectId, epicWorkItemId)};
 * out-of-scope IDs (wrong project or wrong epic) 404 -- matches the
 * discovery-child controller convention.</p>
 *
 * <h2>Endpoints</h2>
 * <ul>
 *   <li>{@code GET    /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions}
 *       -- list all decision rows for the epic; status filter is the
 *       frontend's concern.</li>
 *   <li>{@code POST   /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions}
 *       -- create a user_added row.</li>
 *   <li>{@code PATCH  /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}}
 *       -- update with null-guarded fields; flips an {@code auto_extracted}
 *       source to {@code user_edited} (pinning the row against future
 *       auto-overwrite).</li>
 *   <li>{@code DELETE /api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions/{id}}
 *       -- delete; the response carries the final audit state
 *       ({@code lastEditedBy}, {@code updatedAt}) before the row is removed.</li>
 * </ul>
 *
 * <p>The {@code lastEditedBy} audit channel is accepted as a query string on
 * DELETE (callers without an auth filter chain can still record the audit
 * record); on POST and PATCH it travels in the JSON body.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/epics/{epicWorkItemId}/captured-decisions")
@RequiredArgsConstructor
@Slf4j
public class EpicCapturedDecisionsController {

    private final EpicCapturedDecisionService service;

    @GetMapping
    public ResponseEntity<List<EpicCapturedDecisionDto>> list(
            @PathVariable UUID projectId,
            @PathVariable UUID epicWorkItemId) {
        log.debug(
            "[diag-ams] epic_captured_decisions list projectId={} epicWorkItemId={}",
            projectId, epicWorkItemId);
        List<EpicCapturedDecisionDto> result = service.list(projectId, epicWorkItemId);
        return ResponseEntity.ok(result);
    }

    @PostMapping
    public ResponseEntity<EpicCapturedDecisionDto> create(
            @PathVariable UUID projectId,
            @PathVariable UUID epicWorkItemId,
            @RequestBody CreateEpicCapturedDecisionRequest request) {
        EpicCapturedDecisionDto created = service.create(projectId, epicWorkItemId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Auto-seed endpoint -- routes through
     * {@link EpicCapturedDecisionService#upsertAutoExtracted}. Rows created via
     * this path carry {@code source = auto_extracted}; existing pinned rows are
     * skipped. Returns 200 with the (possibly already-existing) row.
     */
    @PostMapping("/auto-seed")
    public ResponseEntity<EpicCapturedDecisionDto> autoSeed(
            @PathVariable UUID projectId,
            @PathVariable UUID epicWorkItemId,
            @RequestBody AutoSeedEpicCapturedDecisionRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body required");
        }
        return service.upsertAutoExtracted(
                projectId,
                epicWorkItemId,
                request.decisionKey(),
                request.decisionText(),
                request.sourceSpecGenerationId())
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PatchMapping("/{id}")
    public ResponseEntity<EpicCapturedDecisionDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID epicWorkItemId,
            @PathVariable UUID id,
            @RequestBody UpdateEpicCapturedDecisionRequest request) {
        EpicCapturedDecisionDto updated =
            service.update(projectId, epicWorkItemId, id, request);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<EpicCapturedDecisionDto> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID epicWorkItemId,
            @PathVariable UUID id,
            @RequestParam(value = "lastEditedBy", required = false) String lastEditedBy) {
        EpicCapturedDecisionDto deleted =
            service.delete(projectId, epicWorkItemId, id, lastEditedBy);
        return ResponseEntity.ok(deleted);
    }
}
