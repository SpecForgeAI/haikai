package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.DbMigrationPackTranslationDto;
import com.example.architecturemodel.model.dto.UpdateDbMigrationPackTranslationRequest;
import com.example.architecturemodel.model.dto.UpsertDbMigrationPackTranslationsRequest;
import com.example.architecturemodel.service.DbMigrationPackTranslationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for the per-object DB translation rows -- nested under the
 * existing pack controller path (Spec-2 surface alongside
 * {@link DbMigrationPackController}).
 *
 * <p><b>Endpoints (all scoped under
 * {@code /api/projects/{projectId}/db-migration-packs/{packId}/translations}):</b></p>
 * <ul>
 *   <li>{@code GET  /} -- all translation rows for the pack (every lifecycle
 *       field rides the DTO so the gateway computes the coverage summary).</li>
 *   <li>{@code GET  /{translationId}} -- single row.</li>
 *   <li>{@code PUT  /} -- bulk upsert by {@code translation_key} (seeding /
 *       regeneration re-link; sparse merge per row, optional
 *       {@code delete_absent}).</li>
 *   <li>{@code PATCH /{translationId}} -- sparse PATCH (pipeline state,
 *       draft + verdict together, disposition + drop_reason, review status +
 *       notes + reviewed_at).</li>
 * </ul>
 *
 * <p>Error conventions match {@link DbMigrationPackController}: unknown
 * pack/translation -&gt; 404; invalid body (bad enum value, blank/duplicate
 * keys, drop without reason) -&gt; 400 with {@code {"error": ...}}.</p>
 *
 * <p>Spec: LLM-Assisted DB Object Translation Drafts (2026-06-11) --
 * Task Group 2.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/db-migration-packs/{packId}/translations")
@RequiredArgsConstructor
@Slf4j
public class DbMigrationPackTranslationController {

    private final DbMigrationPackTranslationService service;

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}/translations
     */
    @GetMapping
    public ResponseEntity<?> listTranslations(
            @PathVariable UUID projectId,
            @PathVariable UUID packId) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}/translations", projectId, packId);
        try {
            List<DbMigrationPackTranslationDto> translations =
                service.listTranslations(projectId, packId);
            return ResponseEntity.ok(translations);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET /api/projects/{projectId}/db-migration-packs/{packId}/translations/{translationId}
     */
    @GetMapping("/{translationId}")
    public ResponseEntity<?> getTranslation(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID translationId) {
        log.debug("GET /api/projects/{}/db-migration-packs/{}/translations/{}",
            projectId, packId, translationId);
        try {
            return ResponseEntity.ok(service.getTranslation(projectId, packId, translationId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * PUT /api/projects/{projectId}/db-migration-packs/{packId}/translations
     *
     * <p>Bulk upsert by {@code translation_key} -- the seeding / regeneration
     * re-link surface. Returns 200 with the upserted rows in batch order.</p>
     */
    @PutMapping
    public ResponseEntity<?> upsertTranslations(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @RequestBody UpsertDbMigrationPackTranslationsRequest request) {
        log.debug("PUT /api/projects/{}/db-migration-packs/{}/translations (count={})",
            projectId, packId,
            request == null || request.translations() == null ? 0 : request.translations().size());
        try {
            List<DbMigrationPackTranslationDto> upserted =
                service.upsertTranslations(projectId, packId, request);
            return ResponseEntity.ok(upserted);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad translations upsert for pack {}: {}", packId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * PATCH /api/projects/{projectId}/db-migration-packs/{packId}/translations/{translationId}
     *
     * <p>Sparse PATCH; omitted fields untouched.</p>
     */
    @PatchMapping("/{translationId}")
    public ResponseEntity<?> updateTranslation(
            @PathVariable UUID projectId,
            @PathVariable UUID packId,
            @PathVariable UUID translationId,
            @RequestBody UpdateDbMigrationPackTranslationRequest patch) {
        log.debug("PATCH /api/projects/{}/db-migration-packs/{}/translations/{}",
            projectId, packId, translationId);
        try {
            return ResponseEntity.ok(
                service.updateTranslation(projectId, packId, translationId, patch));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad PATCH for pack {} translation {}: {}",
                packId, translationId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
