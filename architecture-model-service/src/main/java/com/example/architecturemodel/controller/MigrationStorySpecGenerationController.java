package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationStorySpecGenerationDto;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BatchPersistResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.BulkRecomputeQualityResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManualEditProtectedException;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.RecomputeQualityResult;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.SpecGenerationSummary;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.StaleSpecSummary;
import com.example.architecturemodel.service.MigrationStorySpecGenerationService.UpdateRowRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller exposing the spec-generation persistence endpoints used by
 * the gateway batch handler and the frontend workspace.
 *
 * <p>Endpoints (Path B per
 * {@code planning/group-1-persistence-decision.txt}):</p>
 * <ul>
 *   <li>{@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/batch}
 *       -- persist a batch of per-story results from the gateway. Partial-
 *       failure tolerant (R-12).</li>
 *   <li>{@code GET  /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations}
 *       -- list all rows for a book.</li>
 *   <li>{@code GET  /api/projects/{projectId}/work-items/{workItemId}/spec-generations}
 *       -- list rows for a single WorkItem (R-9 chip lookup).</li>
 *   <li>{@code PUT  /api/projects/{projectId}/spec-generations/{generationId}}
 *       -- update a single row. Honours manual-edit protection (acceptance
 *       signal 17); returns 409 on overwrite of a manually-edited row without
 *       {@code confirmOverwrite=true}.</li>
 *   <li>{@code GET  /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary}
 *       -- per-book counts + {@code nextBatchStart} + {@code nextBatchSize}.</li>
 * </ul>
 *
 * <p>Auth gating: identical to Spec 1's
 * {@code GeneratedMigrationBookOfWorkController} (R-11) -- relies on the
 * upstream auth filter chain.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 8.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MigrationStorySpecGenerationController {

    private final MigrationStorySpecGenerationService service;

    @PostMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/batch")
    public ResponseEntity<?> batchPersist(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody List<MigrationStorySpecGenerationDto> batchResults) {
        try {
            BatchPersistResult result = service.persistBatchResults(projectId, bookId, batchResults);
            return ResponseEntity.ok(result.toResponseMap());
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] spec_generation batch_persist_bad_request bookId={} reason={}",
                bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations")
    public ResponseEntity<?> listByBookOfWork(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        try {
            return ResponseEntity.ok(service.listByBookOfWork(projectId, bookId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/api/projects/{projectId}/work-items/{workItemId}/spec-generations")
    public ResponseEntity<?> listByWorkItem(
            @PathVariable UUID projectId,
            @PathVariable UUID workItemId) {
        try {
            return ResponseEntity.ok(service.listByWorkItem(projectId, workItemId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PutMapping("/api/projects/{projectId}/spec-generations/{generationId}")
    public ResponseEntity<?> updateRow(
            @PathVariable UUID projectId,
            @PathVariable UUID generationId,
            @RequestBody UpdateRowRequest request) {
        try {
            return ResponseEntity.ok(service.updateRow(projectId, generationId, request));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (ManualEditProtectedException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of(
                    "error", "manual_edit_protected",
                    "message", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generation-summary")
    public ResponseEntity<?> getSummary(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        try {
            SpecGenerationSummary summary = service.getSummary(projectId, bookId);
            return ResponseEntity.ok(summary);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET /api/projects/{projectId}/spec-generations/stale-count
     *
     * <p>Project-scoped stale-spec count + WorkItem id list driving the
     * Migration Delivery Dashboard's stale-spec indicator and "Regenerate
     * stale" action (Target Architecture Authoring Flow spec, Task Group 9).</p>
     *
     * <p>Response shape: {@code { staleCount: int, staleWorkItemIds: [string] }}.
     * Backed by the composite index {@code idx_msg_project_stale} on
     * {@code (project_id, stale)}.</p>
     */
    @GetMapping("/api/projects/{projectId}/spec-generations/stale-count")
    public ResponseEntity<?> getStaleSpecCount(@PathVariable UUID projectId) {
        StaleSpecSummary summary = service.getStaleSpecSummary(projectId);
        return ResponseEntity.ok(summary);
    }

    /**
     * POST /api/projects/{projectId}/spec-generations/{specId}/recompute-quality
     *
     * <p>Single-row recompute. Reloads the entity, runs the deterministic
     * {@code SpecQualityScorer} via the shared persist-path helper, captures
     * the previous score, writes the four quality columns, and returns the
     * post-recompute values plus an optional {@code message}.</p>
     *
     * <p>Edge cases:</p>
     * <ul>
     *   <li>Status {@code insufficient_context} / {@code failed} -> 200 with
     *       all four quality fields null and {@code message} =
     *       {@code "N/A: no spec text to assess"}; the row is not modified.</li>
     *   <li>Spec id not found -> 404.</li>
     *   <li>Spec id belongs to a different project -> 404 (matches the
     *       existing controller pattern; never leaks ownership).</li>
     * </ul>
     *
     * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 4.</p>
     */
    @PostMapping("/api/projects/{projectId}/spec-generations/{specId}/recompute-quality")
    public ResponseEntity<?> recomputeQuality(
            @PathVariable UUID projectId,
            @PathVariable UUID specId) {
        try {
            RecomputeQualityResult result =
                service.recomputeQualityForSpec(projectId, specId);
            return ResponseEntity.ok(result);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * POST /api/projects/{projectId}/spec-generations/recompute-quality-bulk
     *
     * <p>Project-wide bulk recompute. Iterates every spec-generation row owned
     * by the project; rows with status {@code insufficient_context} or
     * {@code failed} are skipped (counted into {@code totalSkipped} and
     * {@code gradeBreakdown.na}). All other rows are scored and the resulting
     * grade increments the appropriate {@code gradeBreakdown[A|B|C|D|F]}
     * counter.</p>
     *
     * <p>Synchronous within request scope per spec.md "Out of Scope" (no async
     * job in v1). Returns {@code { totalScored, totalSkipped, gradeBreakdown:
     * { A, B, C, D, F, na } }}.</p>
     *
     * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 4.</p>
     */
    @PostMapping("/api/projects/{projectId}/spec-generations/recompute-quality-bulk")
    public ResponseEntity<?> recomputeQualityBulk(@PathVariable UUID projectId) {
        BulkRecomputeQualityResult result =
            service.bulkRecomputeQualityForProject(projectId);
        return ResponseEntity.ok(result);
    }

    // -----------------------------------------------------------------------
    // In-Product Spec Editor + Confirm-Overwrite endpoints (2026-05-20)
    // -----------------------------------------------------------------------

    /**
     * Wire shape for the {@code manual-edit} request body. Restricted to a
     * single {@code specText} field; {@code editedBy} is sourced from the
     * {@code X-User-Id} request header (NOT the body) so the audit field is
     * not spoofable from the client.
     */
    public record ManualEditRequest(String specText) {}

    /**
     * POST /api/projects/{projectId}/spec-generations/{specId}/manual-edit
     *
     * <p>Persist a user-authored manual edit. Delegates to
     * {@link MigrationStorySpecGenerationService#applyManualEdit} which
     * re-runs the parser + scorer and captures the prior spec text into
     * {@code previous_spec_text}. The {@code editedBy} value comes from the
     * {@code X-User-Id} header.</p>
     *
     * <p>Errors:</p>
     * <ul>
     *   <li>Missing / empty {@code specText} -> 400.</li>
     *   <li>Unknown specId or cross-project specId -> 404 (never leaks
     *       ownership).</li>
     * </ul>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.2.</p>
     */
    @PostMapping("/api/projects/{projectId}/spec-generations/{specId}/manual-edit")
    public ResponseEntity<?> applyManualEdit(
            @PathVariable UUID projectId,
            @PathVariable UUID specId,
            @org.springframework.web.bind.annotation.RequestHeader(value = "X-User-Id", required = false)
                String editedBy,
            @RequestBody ManualEditRequest body) {
        if (body == null || body.specText() == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "specText is required"));
        }
        try {
            MigrationStorySpecGenerationDto dto =
                service.applyManualEdit(projectId, specId, body.specText(), editedBy);
            return ResponseEntity.ok(dto);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET /api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope
     *
     * <p>Return the set of manually-edited spec-generation rows currently in
     * scope for a Generate-all run against this Book of Work. Powers the
     * frontend's bulk-overwrite picker step 2. Optional query parameter
     * {@code workItemIds} narrows the scope to the retry-batch candidate
     * set; when absent, every manually-edited row in the book is returned.</p>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.4.</p>
     */
    @GetMapping("/api/projects/{projectId}/migration-books-of-work/{bookId}/spec-generations/manually-edited-in-scope")
    public ResponseEntity<?> listManuallyEditedInScope(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @org.springframework.web.bind.annotation.RequestParam(value = "workItemIds", required = false)
                List<UUID> workItemIds) {
        try {
            return ResponseEntity.ok(
                service.listManuallyEditedInScope(projectId, bookId, workItemIds));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * POST /api/projects/{projectId}/spec-generations/{specId}/regenerate
     *
     * <p>Single-row LLM-regenerate persist endpoint. Body is the new spec
     * row content (a {@link MigrationStorySpecGenerationDto} patch); the
     * optional {@code overwriteManuallyEdited} query param gates overwrite
     * of a row that carries {@code manually_edited=true}. When false on
     * a manually-edited row, returns HTTP 409 with a structured envelope
     * the frontend modal branches on.</p>
     *
     * <p>When true, the row is regenerated AND the four manual-edit columns
     * ({@code manually_edited}, {@code last_manually_edited_at},
     * {@code last_manually_edited_by}, {@code previous_spec_text}) are
     * cleared back to their defaults -- the row is LLM-generated again.</p>
     *
     * <p>Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) --
     * Task Group 3.3.</p>
     */
    @PostMapping("/api/projects/{projectId}/spec-generations/{specId}/regenerate")
    public ResponseEntity<?> regenerateSingleStory(
            @PathVariable UUID projectId,
            @PathVariable UUID specId,
            @org.springframework.web.bind.annotation.RequestParam(
                value = "overwriteManuallyEdited", required = false, defaultValue = "false")
                boolean overwriteManuallyEdited,
            @RequestBody(required = false) MigrationStorySpecGenerationDto patch) {
        try {
            MigrationStorySpecGenerationDto dto = service.regenerateSingleStory(
                projectId, specId, patch, overwriteManuallyEdited);
            return ResponseEntity.ok(dto);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (com.example.architecturemodel.service.MigrationStorySpecGenerationService.ManuallyEditedSkipRequiredException e) {
            Map<String, Object> envelope = new java.util.LinkedHashMap<>();
            envelope.put("code", "manually_edited_skip_required");
            envelope.put("message",
                "Refusing to regenerate manually-edited spec without overwriteManuallyEdited=true");
            envelope.put("specId", e.specId());
            envelope.put("lastManuallyEditedBy", e.lastManuallyEditedBy());
            envelope.put("lastManuallyEditedAt", e.lastManuallyEditedAt());
            return ResponseEntity.status(HttpStatus.CONFLICT).body(envelope);
        }
    }
}
