package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.model.dto.migration.EpicCapturedDecisionsCountByEpicDto;
import com.example.architecturemodel.service.migration.EpicCapturedDecisionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Project-scoped read accessor for captured decisions: bulk count summary
 * across all epics in the project.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Follow-up #3.</p>
 *
 * <p>Sibling to {@link EpicCapturedDecisionsController}: the per-epic CRUD
 * surface lives under {@code /api/projects/{projectId}/epics/{epicWorkItemId}/
 * captured-decisions}. This controller exposes the project-wide summary, used
 * by the dashboard to render per-epic counts in one round-trip instead of
 * O(epic-count) GETs.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/captured-decisions")
@RequiredArgsConstructor
@Slf4j
public class EpicCapturedDecisionsProjectController {

    private final EpicCapturedDecisionService service;

    @GetMapping("/summary")
    public ResponseEntity<List<EpicCapturedDecisionsCountByEpicDto>> summary(
            @PathVariable UUID projectId) {
        log.debug(
            "[diag-ams] epic_captured_decisions summary projectId={}",
            projectId);
        List<EpicCapturedDecisionsCountByEpicDto> result =
            service.summaryByEpic(projectId);
        return ResponseEntity.ok(result);
    }
}
