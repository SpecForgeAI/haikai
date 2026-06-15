package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.entity.ApplicationPointDto;
import com.example.architecturemodel.model.dto.library.ApplicationPointFindOrCreateResponse;
import com.example.architecturemodel.service.ApplicationPointService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for ApplicationPoint find-by-target + find-or-create
 * endpoints.
 *
 * <p>Fix #5 (synthetic-placeholder removal): the discovery-service uses
 * these endpoints to resolve a real AP UUID for a Service or Library root
 * before pushing a {@code source_application_point_id} FK value to
 * {@code code_unit_dependencies}, instead of the previous synthetic
 * {@code service:svc-xxx} / {@code library:lib-xxx} placeholders that
 * violated the FK to {@code application_points.id}.</p>
 *
 * <p>Endpoints:</p>
 * <ul>
 *   <li>{@code GET /api/model/projects/{p}/architectures/{a}/application-points/by-target?targetType=&targetRefId=}
 *       -- look up an existing AP by canonical targeting tuple. Returns 200
 *       with {@link ApplicationPointDto} on hit, 404 on miss.</li>
 *   <li>{@code POST /api/model/projects/{p}/architectures/{a}/application-points}
 *       -- find-or-create on {@code (model_file_id, target_type,
 *       target_ref_id)}. Returns
 *       {@link ApplicationPointFindOrCreateResponse} with
 *       {@code is_new=true|false}.</li>
 * </ul>
 *
 * <p>snake_case JSON throughout (matches the {@link ApplicationPointDto}
 * field-naming convention).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}")
@RequiredArgsConstructor
@Slf4j
public class ApplicationPointController {

    private final ApplicationPointService applicationPointService;

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/application-points/by-target
     *
     * <p>Look up an existing AP by {@code (target_type, target_ref_id)} within
     * the (project, architecture) scope. Returns 200 with the AP DTO on hit,
     * 404 on miss.</p>
     */
    @GetMapping("/application-points/by-target")
    public ResponseEntity<ApplicationPointDto> getApplicationPointByTarget(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam("targetType") String targetType,
            @RequestParam("targetRefId") String targetRefId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/application-points/by-target targetType={} targetRefId={}",
            projectId, architectureId, targetType, targetRefId);

        return applicationPointService
            .findByTarget(projectId, architectureId, targetType, targetRefId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/application-points
     *
     * <p>Find-or-create on {@code (model_file_id, target_type,
     * target_ref_id)}. On insert, resolves a sentinel {@code application_id}
     * (FK to {@code applications.id}) from the first Application of the
     * model file.</p>
     */
    @PostMapping("/application-points")
    public ResponseEntity<ApplicationPointFindOrCreateResponse> findOrCreateApplicationPoint(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody ApplicationPointDto request) {
        log.debug("POST /api/model/projects/{}/architectures/{}/application-points targetType={} targetRefId={}",
            projectId, architectureId,
            request != null ? request.targetType() : null,
            request != null ? request.targetRefId() : null);

        ApplicationPointFindOrCreateResponse response =
            applicationPointService.findOrCreate(projectId, architectureId, request);
        return ResponseEntity.ok(response);
    }
}
