package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationDeliveryDashboardDto;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.MigrationDeliveryDashboardService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST Controller exposing the read-only Migration Delivery Dashboard endpoint.
 *
 * <p><b>Single endpoint (AC 19): the ONLY new backend route in the
 * Migration Delivery Progress and Evidence Tracking spec (2026-05-19).</b></p>
 *
 * <p>{@code GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard}
 * (Q-10: architecture-scoped path lives on the frontend; AMS layer is
 * project-scoped, matching the precedent set by
 * {@link GeneratedMigrationBookOfWorkController}).</p>
 *
 * <p><b>Status code contract.</b></p>
 * <ul>
 *   <li>{@code 200} for every populated dashboard, including the partial-failure
 *       case -- per Q-11 / AC 16 the service surfaces subsection failures via
 *       {@code warnings[]} and the endpoint never returns 5xx for a partial
 *       roll-up.</li>
 *   <li>{@code 404} if {@code projectId} does not exist OR if the book does
 *       not belong to that project (cross-project leakage collapsed into "not
 *       found"). Mapped via {@link ResourceNotFoundException} handled by the
 *       service-wide {@code GlobalExceptionHandler}.</li>
 * </ul>
 *
 * <p>Modeled structurally on
 * {@link com.example.architecturemodel.controller.DiscoveryRunController} +
 * {@link GeneratedMigrationBookOfWorkController}: same project-scoped
 * path-variable convention, same trivial 4xx mapping delegated to the global
 * exception handler.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 1, AC 19. Task Group 4.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/migration-books-of-work")
@RequiredArgsConstructor
@Slf4j
public class MigrationDeliveryDashboardController {

    private final MigrationDeliveryDashboardService dashboardService;
    private final ProjectRepository projectRepository;

    /**
     * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/delivery-dashboard
     *
     * <p>Returns the full read-only dashboard roll-up for a single book of
     * work. The service layer (Q-11, AC 16) is responsible for tolerating
     * partial subsection failures and surfacing them via the response's
     * {@code warnings[]} list; this controller NEVER converts a partial
     * failure into a 5xx.</p>
     *
     * @param projectId the owning project UUID
     * @param bookId the book of work UUID
     * @return 200 with the dashboard DTO, or 404 if either id is unknown /
     *         the book does not belong to the project
     */
    @GetMapping("/{bookId}/delivery-dashboard")
    public ResponseEntity<MigrationDeliveryDashboardDto> getDeliveryDashboard(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        log.debug("GET /api/projects/{}/migration-books-of-work/{}/delivery-dashboard",
            projectId, bookId);

        // Validate project existence before touching the book layer so we can
        // return a clean 404 with no leakage of the book row's existence
        // across project boundaries.
        if (projectId == null || !projectRepository.existsById(projectId)) {
            log.debug("[diag-ams] delivery_dashboard project_not_found projectId={}", projectId);
            return ResponseEntity.notFound().build();
        }

        try {
            MigrationDeliveryDashboardDto dto = dashboardService.loadDashboard(projectId, bookId);
            return ResponseEntity.ok(dto);
        } catch (ResourceNotFoundException e) {
            log.debug("[diag-ams] delivery_dashboard book_not_found projectId={} bookId={}",
                projectId, bookId);
            return ResponseEntity.notFound().build();
        }
    }
}
