package com.example.architecturemodel.controller;

import com.example.architecturemodel.jackson.CamelCaseWire;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;
import java.util.UUID;

/**
 * Tiny REST controller exposing the project's active target architecture id.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 3.4.</p>
 *
 * <p>Required by the new gateway {@code target-state-decisions-context}
 * resolver (Task Group 6) so it can pivot from the active project to the
 * active target architecture without re-implementing the
 * {@code kind='target' AND draft_state='active' AND archived=false}
 * selection logic on the gateway side. Confirmed absent on the Architecture
 * Model Service controller surface via grep (per Q11 and
 * {@code feedback_trace_before_coding.md}) before being introduced here.</p>
 *
 * <p>The inline response record below is marked {@code @CamelCaseWire} because
 * the target-state UI speaks camelCase.</p>
 *
 * <p>Returns HTTP 200 with {@code "activeTargetArchitectureId": null} when
 * the project exists but has no active target architecture -- this keeps the
 * resolver's two-state distinction ("no target architecture defined yet" vs
 * "no decisions captured yet") on the gateway side rather than overloading a
 * 404 to mean "no active target".</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ActiveTargetArchitectureController {

    private static final String KIND_TARGET = "target";
    private static final String DRAFT_STATE_ACTIVE = "active";

    private final ArchitectureRepository architectureRepository;

    /**
     * GET /api/projects/{projectId}/active-target-architecture-id
     *
     * <p>Resolves the project's active target architecture id by selecting
     * the {@code kind='target' AND draft_state='active' AND archived=false}
     * row -- the same selection logic the existing target-architecture
     * promote / decommission services use ({@code findFirstByProjectId
     * AndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc}).</p>
     *
     * @return 200 with {@code activeTargetArchitectureId} populated when an
     *         active target row exists for the project, or {@code null} when
     *         it does not (the resolver maps the latter to the distinct
     *         "no target architecture defined yet" copy string)
     */
    @GetMapping("/api/projects/{projectId}/active-target-architecture-id")
    public ResponseEntity<ActiveTargetArchitectureIdResponse> getActiveTargetArchitectureId(
            @PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/active-target-architecture-id", projectId);

        Optional<ArchitectureEntity> activeTarget = architectureRepository
            .findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
                projectId, KIND_TARGET, DRAFT_STATE_ACTIVE);

        return ResponseEntity.ok(new ActiveTargetArchitectureIdResponse(
            activeTarget.map(ArchitectureEntity::getId).orElse(null)));
    }

    /**
     * Response envelope. Marked {@code @CamelCaseWire} because the target-state
     * UI speaks camelCase.
     */
    @CamelCaseWire
    public record ActiveTargetArchitectureIdResponse(UUID activeTargetArchitectureId) {}
}
