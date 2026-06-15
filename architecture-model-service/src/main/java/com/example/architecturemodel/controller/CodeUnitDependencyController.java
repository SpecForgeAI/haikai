package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.library.CodeUnitDependencyFindOrCreateResponse;
import com.example.architecturemodel.model.dto.relationship.CodeUnitDependencyDto;
import com.example.architecturemodel.service.CodeUnitDependencyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for CodeUnitDependency find-or-create endpoint.
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 *
 * <p>Endpoint:</p>
 * <ul>
 *   <li>{@code POST /api/model/projects/{p}/architectures/{a}/code-unit-dependencies}
 *       -- deterministic find-or-create on
 *       {@code (source_application_point_id, target_application_point_id,
 *       declared_name, declared_version)} with NULL-tolerance for
 *       {@code declared_version}. Returns
 *       {@link CodeUnitDependencyFindOrCreateResponse} with
 *       {@code is_new=true|false}.</li>
 * </ul>
 *
 * <p>snake_case JSON throughout.</p>
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
public class CodeUnitDependencyController {

    private final CodeUnitDependencyService codeUnitDependencyService;

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/code-unit-dependencies
     */
    @PostMapping("/code-unit-dependencies")
    public ResponseEntity<CodeUnitDependencyFindOrCreateResponse> findOrCreateCodeUnitDependency(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody CodeUnitDependencyDto request) {
        log.debug(
            "POST /api/model/projects/{}/architectures/{}/code-unit-dependencies "
                + "srcAp={} tgtAp={} declared={}@{}",
            projectId, architectureId,
            request != null ? request.sourceApplicationPointId() : null,
            request != null ? request.targetApplicationPointId() : null,
            request != null ? request.declaredName() : null,
            request != null ? request.declaredVersion() : null);

        CodeUnitDependencyFindOrCreateResponse response = codeUnitDependencyService
            .findOrCreate(projectId, architectureId, request);
        return ResponseEntity.ok(response);
    }
}
