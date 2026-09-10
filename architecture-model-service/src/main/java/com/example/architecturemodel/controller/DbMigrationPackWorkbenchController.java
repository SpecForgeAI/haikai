package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.CreateTargetBuildRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.CreateTranslationAttemptRequest;
import com.example.architecturemodel.model.dto.DbMigrationPackWorkbenchRequests.PatchTargetBuildRequest;
import com.example.architecturemodel.model.entity.DbMigrationPackTargetBuildEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationAttemptEntity;
import com.example.architecturemodel.service.DbMigrationPackWorkbenchService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The translation workbench surface -- Stored Proc &amp; Function Behaviour
 * Program, Spec 4 (changeset 231). Mounted on the EXISTING pack base so the
 * gateway keeps one pack client.
 *
 * <pre>
 *   POST  .../translations/{translationId}/attempts -> 201 attempt | 409 duplicate attempt_no
 *   GET   .../translations/{translationId}/attempts -> [attempt] attempt_no ascending
 *   GET   .../translation-attempts                  -> [attempt] every attempt in the pack
 *   POST  .../target-builds                         -> 201 build (running, empty phases)
 *   PATCH .../target-builds/{buildId}               -> build (sparse)
 *   GET   .../target-builds                         -> [build] newest first
 *   GET   .../target-builds/latest                  -> build | 404
 * </pre>
 *
 * <p>{@code /target-builds/latest} is declared BEFORE {@code
 * /target-builds/{buildId}} has any GET twin, so the word "latest" never
 * reaches the uuid converter. Entities are returned verbatim (snake_case wire
 * by the AMS default).</p>
 *
 * <p>Error conventions match {@link DbMigrationPackTranslationController}:
 * unknown pack / translation / build -&gt; 404; invalid body -&gt; 400 with
 * {@code {"error": ...}}; a duplicate attempt number -&gt; 409 (attempts are
 * append-only evidence, never overwritten).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/db-migration-packs/{packId}")
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackWorkbenchController {

    private final DbMigrationPackWorkbenchService service;

    // -----------------------------------------------------------------
    // Attempt history
    // -----------------------------------------------------------------

    @PostMapping("/translations/{translationId}/attempts")
    public ResponseEntity<DbMigrationPackTranslationAttemptEntity> createAttempt(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID translationId,
            @RequestBody CreateTranslationAttemptRequest request) {
        DbMigrationPackTranslationAttemptEntity created =
            service.createAttempt(projectId, packId, translationId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/translations/{translationId}/attempts")
    public List<DbMigrationPackTranslationAttemptEntity> listAttempts(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID translationId) {
        return service.listAttempts(projectId, packId, translationId);
    }

    @GetMapping("/translation-attempts")
    public List<DbMigrationPackTranslationAttemptEntity> listPackAttempts(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        return service.listPackAttempts(projectId, packId);
    }

    // -----------------------------------------------------------------
    // Target builds
    // -----------------------------------------------------------------

    @PostMapping("/target-builds")
    public ResponseEntity<DbMigrationPackTargetBuildEntity> createTargetBuild(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestBody CreateTargetBuildRequest request) {
        DbMigrationPackTargetBuildEntity created =
            service.createTargetBuild(projectId, packId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PatchMapping("/target-builds/{buildId}")
    public ResponseEntity<DbMigrationPackTargetBuildEntity> patchTargetBuild(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID buildId,
            @RequestBody PatchTargetBuildRequest patch) {
        return ResponseEntity.ok(service.patchTargetBuild(projectId, packId, buildId, patch));
    }

    @GetMapping("/target-builds")
    public List<DbMigrationPackTargetBuildEntity> listTargetBuilds(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        return service.listTargetBuilds(projectId, packId);
    }

    @GetMapping("/target-builds/latest")
    public ResponseEntity<DbMigrationPackTargetBuildEntity> latestTargetBuild(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        return service.latestTargetBuild(projectId, packId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    // -----------------------------------------------------------------
    // Error rendering (local so the standalone slice matches production)
    // -----------------------------------------------------------------

    /** Unknown pack / translation / build -- 404, never a 500. */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Void> handleNotFound(ResourceNotFoundException ex) {
        log.debug("[diag-ams] db_migration_pack_workbench not_found message={}", ex.getMessage());
        return ResponseEntity.notFound().build();
    }

    /** A duplicate attempt number is a CONFLICT: attempts are append-only. */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleConflict(IllegalStateException ex) {
        log.warn("[diag-ams] db_migration_pack_workbench conflict message={}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(error(ex.getMessage()));
    }

    /** Invalid body / enum value -- 400 with {@code {"error": ...}}. */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleBadRequest(IllegalArgumentException ex) {
        log.warn("[diag-ams] db_migration_pack_workbench bad_request message={}", ex.getMessage());
        return ResponseEntity.badRequest().body(error(ex.getMessage()));
    }

    private static Map<String, Object> error(String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", message);
        return body;
    }
}
