package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto;
import com.example.architecturemodel.service.discovery.DbSurfaceInventoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * GET /api/projects/{projectId}/architectures/{architectureId}/db-surface-inventory
 *
 * <p>Spec Q (Data-Tier Oracle Program): computed-on-read DB surface inventory
 * with the unclaimed-surface derivation. snake_case wire (global default).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/db-surface-inventory")
@RequiredArgsConstructor
@Slf4j
// No-db mode (app.features.include-database=false) runs without JPA
// repositories; every DB-backed controller carries this guard (2026-08-24
// sweep).
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DbSurfaceInventoryController {

    private final DbSurfaceInventoryService service;

    @GetMapping
    public ResponseEntity<DbSurfaceInventoryDto> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.info("GET /api/projects/{}/architectures/{}/db-surface-inventory",
            projectId, architectureId);
        return ResponseEntity.ok(service.build(projectId, architectureId));
    }
}
