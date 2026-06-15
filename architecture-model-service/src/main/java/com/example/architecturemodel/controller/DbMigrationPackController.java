package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.BulkResolveDbMigrationPackDecisionsRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackDecisionDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDriftReportDto;
import com.example.architecturemodel.model.dto.DbMigrationPackDto;
import com.example.architecturemodel.model.dto.DbMigrationPackFileDto;
import com.example.architecturemodel.model.dto.ResolveDbMigrationPackDecisionRequest;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackRequest;
import com.example.architecturemodel.service.DbMigrationPackService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the DB schema + data migration pack persistence stack.
 *
 * <p><b>Endpoints (all scoped under
 * {@code /api/projects/{projectId}/db-migration-packs}):</b></p>
 * <ul>
 *   <li>{@code PUT  /} -- create/regenerate upsert keyed by
 *       {@code (projectId, architecture_id)}: pack upserted in place, files
 *       replaced wholesale, decisions upserted by {@code decision_key} -- one
 *       logical operation (spec stage 6).</li>
 *   <li>{@code GET  /?architecture_id=...} -- list packs (optionally one per
 *       architecture).</li>
 *   <li>{@code GET  /{packId}} -- single pack (manifest included).</li>
 *   <li>{@code PATCH /{packId}} -- sparse PATCH of {@code work_item_id}
 *       (DB-epic attachment) + the staleness pair; null-guarded.</li>
 *   <li>{@code GET  /{packId}/files} -- the generated file rows in pack
 *       order (the zip is assembled by the gateway on demand).</li>
 *   <li>{@code GET  /{packId}/decisions?status=&amp;category=} -- the
 *       decision queue.</li>
 *   <li>{@code POST /{packId}/decisions/{decisionId}/resolve} -- resolve one
 *       decision; flips {@code open -> resolved} and marks the pack
 *       stale.</li>
 *   <li>{@code POST /{packId}/decisions/resolve-bulk} -- bulk resolve with
 *       the same resolution (atomic; 400 on any foreign id).</li>
 *   <li>{@code GET  /{packId}/drift-reports} -- append-only verification
 *       history, newest first.</li>
 *   <li>{@code POST /{packId}/drift-reports} -- append one verification run
 *       (201).</li>
 * </ul>
 *
 * <p>Error conventions match the existing AMS controllers
 * ({@link GeneratedMigrationBookOfWorkController}): unknown pack/project or
 * decision -&gt; 404; invalid body (bad status/category/file_kind, missing
 * resolution_json, foreign decision id in a bulk) -&gt; 400 with
 * {@code {"error": ...}}.</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * {@code agent-os/specs/2026-06-11-db-schema-and-data-migration-pack/spec.md},
 * Task Group 1.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/db-migration-packs")
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackController {

    private final DbMigrationPackService service;

    /**
     * PUT /api/projects/{projectId}/db-migration-packs
     *
     * <p>Create/regenerate upsert keyed by {@code (projectId,
     * architecture_id)}. Returns 200 with the persisted pack (same id across
     * regenerations).</p>
     */
    @PutMapping
    public ResponseEntity<?> upsertPack(
            @PathVariable UUID projectId,
            @RequestBody UpsertDbMigrationPackRequest request) {
        log.debug("PUT /api/projects/{}/db-migration-packs (architectureId={})",
            projectId, request == null ? null : request.architectureId());
        try {
            DbMigrationPackDto upserted = service.upsertPack(projectId, request);
            return ResponseEntity.ok(upserted);
        } catch (IllegalArgumentException e) {
            log.warn("Bad upsert request for db migration pack (project {}): {}",
                projectId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs?architecture_id=...
     *
     * <p>List packs for the project (one per architecture), optionally
     * filtered to a single architecture.</p>
     */
    @GetMapping
    public ResponseEntity<List<DbMigrationPackDto>> listPacks(
            @PathVariable UUID projectId,
            @RequestParam(name = "architecture_id", required = false) UUID architectureId) {
        log.debug("GET /api/projects/{}/db-migration-packs?architecture_id={}",
            projectId, architectureId);
        return ResponseEntity.ok(service.listPacks(projectId, architectureId));
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}
     */
    @GetMapping("/{packId}")
    public ResponseEntity<?> getPack(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}", projectId, packId);
        try {
            return ResponseEntity.ok(service.getPack(projectId, packId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * PATCH /api/projects/{projectId}/db-migration-packs/{packId}
     *
     * <p>Sparse PATCH of {@code work_item_id} / {@code status} /
     * {@code stale_reason}; omitted fields untouched.</p>
     */
    @PatchMapping("/{packId}")
    public ResponseEntity<?> updatePack(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestBody UpdateDbMigrationPackRequest patch) {
        log.debug("PATCH /api/projects/{}/db-migration-packs/{}", projectId, packId);
        try {
            return ResponseEntity.ok(service.updatePack(projectId, packId, patch));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad PATCH for db migration pack {}: {}", packId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}/files
     */
    @GetMapping("/{packId}/files")
    public ResponseEntity<?> listFiles(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}/files", projectId, packId);
        try {
            List<DbMigrationPackFileDto> files = service.listFiles(projectId, packId);
            return ResponseEntity.ok(files);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}/decisions
     */
    @GetMapping("/{packId}/decisions")
    public ResponseEntity<?> listDecisions(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "category", required = false) String category) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}/decisions?status={}&category={}",
            projectId, packId, status, category);
        try {
            List<DbMigrationPackDecisionDto> decisions =
                service.listDecisions(projectId, packId, status, category);
            return ResponseEntity.ok(decisions);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/db-migration-packs/{packId}/decisions/{decisionId}/resolve
     */
    @PostMapping("/{packId}/decisions/{decisionId}/resolve")
    public ResponseEntity<?> resolveDecision(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID decisionId,
            @RequestBody ResolveDbMigrationPackDecisionRequest request) {
        log.debug("POST /api/projects/{}/db-migration-packs/{}/decisions/{}/resolve",
            projectId, packId, decisionId);
        try {
            DbMigrationPackDecisionDto resolved =
                service.resolveDecision(projectId, packId, decisionId, request);
            return ResponseEntity.ok(resolved);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad resolve request for pack {} decision {}: {}",
                packId, decisionId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/db-migration-packs/{packId}/decisions/resolve-bulk
     */
    @PostMapping("/{packId}/decisions/resolve-bulk")
    public ResponseEntity<?> resolveDecisionsBulk(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestBody BulkResolveDbMigrationPackDecisionsRequest request) {
        log.debug("POST /api/projects/{}/db-migration-packs/{}/decisions/resolve-bulk (count={})",
            projectId, packId,
            request == null || request.decisionIds() == null ? 0 : request.decisionIds().size());
        try {
            List<DbMigrationPackDecisionDto> resolved =
                service.resolveDecisionsBulk(projectId, packId, request);
            return ResponseEntity.ok(resolved);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad bulk-resolve request for pack {}: {}", packId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}/drift-reports
     */
    @GetMapping("/{packId}/drift-reports")
    public ResponseEntity<?> listDriftReports(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}/drift-reports", projectId, packId);
        try {
            List<DbMigrationPackDriftReportDto> reports =
                service.listDriftReports(projectId, packId);
            return ResponseEntity.ok(reports);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * POST /api/projects/{projectId}/db-migration-packs/{packId}/drift-reports
     *
     * <p>Append one verification run to the history (201). Rows are
     * append-only -- never updated or overwritten.</p>
     */
    @PostMapping("/{packId}/drift-reports")
    public ResponseEntity<?> appendDriftReport(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestBody DbMigrationPackDriftReportDto request) {
        log.debug("POST /api/projects/{}/db-migration-packs/{}/drift-reports", projectId, packId);
        try {
            DbMigrationPackDriftReportDto appended =
                service.appendDriftReport(projectId, packId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(appended);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad drift-report append for pack {}: {}", packId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
