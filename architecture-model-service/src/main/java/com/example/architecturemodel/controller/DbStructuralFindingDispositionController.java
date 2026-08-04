package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbStructuralFindingDispositionDto;
import com.example.architecturemodel.model.dto.UpsertDbStructuralFindingDispositionRequest;
import com.example.architecturemodel.service.DbStructuralFindingDispositionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the per-project DB structural-finding disposition rows
 * (Spec 2 surface alongside {@link DbMigrationPackController} -- but scoped
 * to the PROJECT, not a pack, so dispositions survive pack regeneration).
 *
 * <p><b>Endpoints (all scoped under
 * {@code /api/projects/{projectId}/db-structural-finding-dispositions}):</b></p>
 * <ul>
 *   <li>{@code GET    /} -- all disposition rows for the project.</li>
 *   <li>{@code PUT    /{findingKey}} -- upsert by stable finding key
 *       ({@code kind:subject}, e.g. {@code no_primary_keys:all_tables};
 *       the {@code {findingKey:.+}} regex keeps colon/dot-bearing keys intact
 *       in the path segment). Create requires disposition + kind + subject;
 *       update is a sparse merge.</li>
 *   <li>{@code DELETE /{findingKey}} -- un-disposition (204 / 404).</li>
 * </ul>
 *
 * <p>Error conventions match {@link DbMigrationPackTranslationController}:
 * unknown row -&gt; 404; invalid body (bad disposition, missing note for
 * accepted/known_gap, missing kind/subject on create) -&gt; 400 with
 * {@code {"error": ...}}.</p>
 *
 * <p>Spec: Structural findings dispositions (2026-08-04) -- Spec 2.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/db-structural-finding-dispositions")
@RequiredArgsConstructor
@Slf4j
public class DbStructuralFindingDispositionController {

    private final DbStructuralFindingDispositionService service;

    /**
     * GET /api/projects/{projectId}/db-structural-finding-dispositions
     */
    @GetMapping
    public ResponseEntity<?> listDispositions(@PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/db-structural-finding-dispositions", projectId);
        List<DbStructuralFindingDispositionDto> dispositions =
            service.listByProject(projectId);
        return ResponseEntity.ok(dispositions);
    }

    /**
     * PUT /api/projects/{projectId}/db-structural-finding-dispositions/{findingKey}
     *
     * <p>Upsert by stable finding key ({@code kind:subject}). Returns 200 with
     * the upserted row.</p>
     */
    @PutMapping("/{findingKey:.+}")
    public ResponseEntity<?> upsertDisposition(
            @PathVariable UUID projectId,
            @PathVariable String findingKey,
            @RequestBody UpsertDbStructuralFindingDispositionRequest request) {
        log.debug("PUT /api/projects/{}/db-structural-finding-dispositions/{}",
            projectId, findingKey);
        try {
            return ResponseEntity.ok(service.upsert(projectId, findingKey, request));
        } catch (IllegalArgumentException e) {
            log.warn("Bad disposition upsert for project {} finding {}: {}",
                projectId, findingKey, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * DELETE /api/projects/{projectId}/db-structural-finding-dispositions/{findingKey}
     *
     * <p>Un-disposition a finding: 204 when removed, 404 when absent.</p>
     */
    @DeleteMapping("/{findingKey:.+}")
    public ResponseEntity<?> deleteDisposition(
            @PathVariable UUID projectId,
            @PathVariable String findingKey) {
        log.debug("DELETE /api/projects/{}/db-structural-finding-dispositions/{}",
            projectId, findingKey);
        try {
            service.delete(projectId, findingKey);
            return ResponseEntity.noContent().build();
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
