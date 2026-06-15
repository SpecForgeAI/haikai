package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST controller for the migration discovery context aggregation endpoint.
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1
 * (D1).</p>
 *
 * <p>Single POST endpoint -- POST is used (rather than GET) to accept a body
 * of filters/limits per the shaping note D1. Path is project-scoped; the
 * current architecture (and optional target architecture) are carried in the
 * request body so callers can drive the scope without negotiating multiple
 * path segments.</p>
 *
 * <p>Validation + error mapping flows through the existing
 * {@code GlobalExceptionHandler}: {@code ResourceNotFoundException} -> 404 and
 * {@code IllegalArgumentException} -> 400.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/migration-discovery-context")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationDiscoveryContextController {

    private final MigrationDiscoveryContextService service;

    @PostMapping
    public ResponseEntity<MigrationDiscoveryContextDto> build(
            @PathVariable UUID projectId,
            @RequestBody MigrationDiscoveryContextRequestDto request) {
        log.debug("POST /api/projects/{}/migration-discovery-context (request={})",
            projectId, request);
        final long start = System.currentTimeMillis();
        MigrationDiscoveryContextDto dto = service.build(projectId, request);
        // Structured diag log: counts + timing + project prefix only. Never
        // log the full projectId, the request body, or any finding titles /
        // evidence bodies. The runbook pairs `[diag-ams]` lines with
        // `[diag-gw] resolver=migration-discovery-context ...` and
        // `[diag-amvs] op=context_fetch ...`.
        int findings = 0;
        int mappings = 0;
        if (dto != null) {
            if (dto.highPriorityFindings() != null) {
                findings = dto.highPriorityFindings().size();
            }
            if (dto.architectureMappingsSummary() != null
                    && dto.architectureMappingsSummary().totalMappings() != null) {
                mappings = dto.architectureMappingsSummary().totalMappings();
            }
        }
        final String projectPrefix = projectId == null
                ? "00000000"
                : projectId.toString().substring(0, Math.min(8, projectId.toString().length()));
        log.info(
            "[diag-ams] op=migration_context project={} elapsed_ms={} findings={} mappings={}",
            projectPrefix,
            System.currentTimeMillis() - start,
            findings,
            mappings
        );
        return ResponseEntity.ok(dto);
    }
}
