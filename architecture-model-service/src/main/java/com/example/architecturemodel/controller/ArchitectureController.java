package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.ElementInventoryResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse;
import com.example.architecturemodel.service.ArchitectureCloneService;
import com.example.architecturemodel.service.ArchitectureElementInventoryService;
import com.example.architecturemodel.service.ArchitectureSelectiveCopyService;
import com.example.architecturemodel.service.ArchitectureService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for Architecture operations.
 *
 * Spec #1 introduced the list endpoint:
 *   GET    /api/projects/{projectId}/architectures
 *
 * Spec #3 adds the CRUD endpoints used by the new TopBar modals:
 *   POST   /api/projects/{projectId}/architectures
 *   PATCH  /api/projects/{projectId}/architectures/{architectureId}
 *   POST   /api/projects/{projectId}/architectures/{architectureId}/archive
 *
 * Spec #6 adds the full-clone endpoint:
 *   POST   /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone
 *
 * Spec #7 adds the read-only inventory endpoint that drives the
 * SelectiveCopyElementPicker tree, plus the two-phase selective-copy
 * preflight + commit endpoints:
 *   GET    /api/projects/{projectId}/architectures/{architectureId}/elements-inventory
 *   POST   /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight
 *   POST   /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit
 *
 * Validation, name-uniqueness, and last-architecture protection live in
 * {@link ArchitectureService}; full-clone orchestration lives in
 * {@link ArchitectureCloneService}; inventory tree assembly lives in
 * {@link ArchitectureElementInventoryService}; selective-copy preflight +
 * commit live in {@link ArchitectureSelectiveCopyService}; HTTP status
 * mapping for the corresponding exceptions lives in
 * {@link com.example.architecturemodel.exception.GlobalExceptionHandler}.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
 * Spec: Multi-Architecture Full Clone (Spec #6)
 * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ArchitectureController {

    private final ArchitectureService architectureService;
    private final ArchitectureCloneService architectureCloneService;
    private final ArchitectureElementInventoryService architectureElementInventoryService;
    private final ArchitectureSelectiveCopyService architectureSelectiveCopyService;

    public ArchitectureController(ArchitectureService architectureService,
                                  ArchitectureCloneService architectureCloneService,
                                  ArchitectureElementInventoryService architectureElementInventoryService,
                                  ArchitectureSelectiveCopyService architectureSelectiveCopyService) {
        this.architectureService = architectureService;
        this.architectureCloneService = architectureCloneService;
        this.architectureElementInventoryService = architectureElementInventoryService;
        this.architectureSelectiveCopyService = architectureSelectiveCopyService;
    }

    /**
     * Body for {@code POST /api/projects/{projectId}/architectures}.
     *
     * Validation lives in the service layer (so the same rules apply to the
     * gateway-injected payload and to any future internal callers); the
     * record only normalises shape.
     *
     * @param name        required, non-empty after trim, <= 100 chars
     * @param description optional, <= 500 chars
     * @param tags        optional list; each non-empty, <= 50 chars, no
     *                    duplicates within the payload
     */
    public record CreateArchitectureRequest(
        String name,
        String description,
        List<String> tags
    ) {}

    /**
     * Body for {@code PATCH /api/projects/{projectId}/architectures/{id}}.
     *
     * Same shape as create; tags are REQUIRED (an empty list explicitly
     * clears all existing tags atomically alongside the name + description
     * update).
     *
     * @param name        required, non-empty after trim, <= 100 chars
     * @param description optional, <= 500 chars
     * @param tags        full replacement tag set (empty list clears all)
     */
    public record UpdateArchitectureRequest(
        String name,
        String description,
        List<String> tags
    ) {}

    /**
     * Body for
     * {@code POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone}.
     *
     * Same shape as {@link CreateArchitectureRequest} -- validation lives in
     * the service layer ({@link ArchitectureCloneService} delegates to the
     * shared validateAndTrim* helpers from {@link ArchitectureService}).
     * Tags default to an empty list per spec #6 decision #3 (Clone modal
     * starts with no chips pre-loaded).
     *
     * @param name        required, non-empty after trim, <= 100 chars
     * @param description optional, <= 500 chars
     * @param tags        optional list; each non-empty, <= 50 chars, no
     *                    duplicates within the payload
     */
    public record CloneArchitectureRequest(
        String name,
        String description,
        List<String> tags
    ) {}

    /**
     * GET /api/projects/{projectId}/architectures
     *
     * Lists all architectures for a project ordered by created_at ascending
     * (oldest first). The first non-archived item is the project's `Default`
     * architecture (consumers like the frontend ArchitectureContext and
     * discovery-service apply this rule client-side).
     *
     * @param projectId the project UUID
     * @return list of architectures with HTTP 200
     */
    @GetMapping
    public ResponseEntity<List<ArchitectureDto>> listArchitectures(
            @PathVariable UUID projectId) {
        log.debug("GET /api/projects/{}/architectures", projectId);
        List<ArchitectureDto> architectures = architectureService.listForProject(projectId);
        return ResponseEntity.ok(architectures);
    }

    /**
     * POST /api/projects/{projectId}/architectures
     *
     * Creates a new architecture. Returns 201 Created with the new row.
     *
     * Errors:
     *   400 -- name empty or > 100 chars; description > 500 chars; tag empty
     *           or > 50 chars; duplicate tag in payload
     *   409 -- name already exists in the project (case-insensitive)
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     */
    @PostMapping
    public ResponseEntity<ArchitectureDto> createArchitecture(
            @PathVariable UUID projectId,
            @RequestBody CreateArchitectureRequest request) {
        log.info("POST /api/projects/{}/architectures (name={})", projectId, request.name());
        ArchitectureDto created = architectureService.create(
            projectId,
            request.name(),
            request.description(),
            request.tags());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * PATCH /api/projects/{projectId}/architectures/{architectureId}
     *
     * Updates name, description, and the full tag set atomically. The tag
     * set in the payload REPLACES the existing tags (delete-all then
     * insert-all inside one transaction).
     *
     * Errors:
     *   400 -- validation failure (same rules as create)
     *   404 -- architectureId missing or belongs to a different project
     *   409 -- name collides with another architecture in the same project
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     */
    @PatchMapping("/{architectureId}")
    public ResponseEntity<ArchitectureDto> updateArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody UpdateArchitectureRequest request) {
        log.info("PATCH /api/projects/{}/architectures/{} (name={})",
            projectId, architectureId, request.name());
        ArchitectureDto updated = architectureService.update(
            projectId,
            architectureId,
            request.name(),
            request.description(),
            request.tags());
        return ResponseEntity.ok(updated);
    }

    /**
     * POST /api/projects/{projectId}/architectures/{architectureId}/archive
     *
     * Soft-deletes the architecture (sets {@code archived = true}). Returns
     * 200 with the updated row.
     *
     * Errors:
     *   404 -- architectureId missing or belongs to a different project
     *   422 -- would archive the last non-archived architecture in the project
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     */
    @PostMapping("/{architectureId}/archive")
    public ResponseEntity<ArchitectureDto> archiveArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.info("POST /api/projects/{}/architectures/{}/archive", projectId, architectureId);
        ArchitectureDto archived = architectureService.archive(projectId, architectureId);
        return ResponseEntity.ok(archived);
    }

    /**
     * POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone
     *
     * Atomically clones an existing architecture (and every architecture-scoped
     * meta-model row beneath it) into a brand-new architecture under the same
     * project. Returns 201 Created with the new architecture DTO (same shape
     * as the create response).
     *
     * Path-segment URL pattern is consistent with spec #1's Bucket A; gateway
     * proxy forwards verbatim.
     *
     * Errors:
     *   400 -- validation failure (name empty / too long, description too long,
     *          invalid tag) -- mapped from {@code IllegalArgumentException}
     *   404 -- sourceArchitectureId missing or belongs to a different project
     *   409 -- target name collides with an existing architecture (case-insensitive)
     *   422 -- source architecture is archived (envelope: {@code archived_source})
     *
     * Spec: Multi-Architecture Full Clone (Spec #6)
     */
    @PostMapping("/{sourceArchitectureId}/clone")
    public ResponseEntity<ArchitectureDto> cloneArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID sourceArchitectureId,
            @RequestBody CloneArchitectureRequest request) {
        log.info("POST /api/projects/{}/architectures/{}/clone (name={})",
            projectId, sourceArchitectureId, request.name());
        ArchitectureDto cloned = architectureCloneService.cloneArchitecture(
            projectId,
            sourceArchitectureId,
            request.name(),
            request.description(),
            request.tags());
        return ResponseEntity.status(HttpStatus.CREATED).body(cloned);
    }

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory
     *
     * Returns the read-only inventory tree that powers the
     * {@code SelectiveCopyElementPicker} on the frontend. Shape:
     *
     * <pre>
     * {domains: [{name, types: [{name, entityType, instances: [{id, name, archived}]}]}]}
     * </pre>
     *
     * Domains are returned in the canonical render order
     * {@code [Applications, Data, Business, UI, Behavioural, Diagrams]}. An
     * empty architecture still returns the six domain shells with empty
     * type lists.
     *
     * Errors:
     *   404 -- architectureId missing or belongs to a different project
     *          (mapped from {@code ArchitectureNotFoundException} by
     *          {@code GlobalExceptionHandler}).
     *
     * Excluded scopes (safety property (g) of spec #7): threads,
     * {@code discovery_*} tables, and project-scoped tables are NEVER
     * included in the inventory by construction (see
     * {@link ArchitectureElementInventoryService#TABLES_BY_DOMAIN}).
     *
     * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
     */
    @GetMapping("/{architectureId}/elements-inventory")
    public ResponseEntity<ElementInventoryResponse> getElementsInventory(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/projects/{}/architectures/{}/elements-inventory",
            projectId, architectureId);
        ElementInventoryResponse inventory =
            architectureElementInventoryService.getInventory(projectId, architectureId);
        return ResponseEntity.ok(inventory);
    }

    /**
     * POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight
     *
     * Computes the preflight conflict + auto-include report for a proposed
     * selective copy. Read-only — no state mutation. Returns 200 with the
     * preflight response shape:
     *
     * <pre>
     * {
     *   conflicts: [{elementId, elementType, name, conflictReason: 'same_uuid'}],
     *   autoIncluded: [{elementId, elementType, name, includedBecause}],
     *   summary: {totalSelected, conflictCount, autoIncludedCount, willCopyCount}
     * }
     * </pre>
     *
     * Errors:
     *   400 -- malformed body (e.g. {@code sourceArchitectureId} missing,
     *          unknown element id in the selection list)
     *   404 -- either {@code projectId / targetArchitectureId} or the
     *          body's {@code sourceArchitectureId} is missing
     *   422 -- {@code source == target} (envelope: {@code same_architecture})
     *   422 -- source architecture is archived (envelope: {@code archived_source})
     *
     * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
     */
    @PostMapping("/{targetArchitectureId}/selective-copy/preflight")
    public ResponseEntity<SelectiveCopyPreflightResponse> selectiveCopyPreflight(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @RequestBody SelectiveCopyPreflightRequest request) {
        log.info("POST /api/projects/{}/architectures/{}/selective-copy/preflight (source={}, selected={})",
            projectId, targetArchitectureId,
            request == null ? null : request.sourceArchitectureId(),
            request == null || request.elementIds() == null ? 0 : request.elementIds().size());
        SelectiveCopyPreflightResponse response =
            architectureSelectiveCopyService.preflight(projectId, targetArchitectureId, request);
        return ResponseEntity.ok(response);
    }

    /**
     * POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit
     *
     * Atomically commits the selective copy. The service wraps the entire
     * commit in a single Spring {@code @Transactional} boundary — any
     * thrown exception triggers a full rollback (safety property (a)).
     *
     * Returns 200 with summary counts that drive the post-copy toast:
     *
     * <pre>
     * {copied, skipped, overwritten, duplicated, autoIncluded}
     * </pre>
     *
     * Errors:
     *   400 -- malformed body (unknown action, missing source id, etc.)
     *   404 -- either {@code projectId / targetArchitectureId} or the
     *          body's {@code sourceArchitectureId} is missing
     *   422 -- {@code source == target} (envelope: {@code same_architecture})
     *   422 -- source architecture is archived (envelope: {@code archived_source})
     *   422 -- a selected element still has an unresolved missing FK
     *          reference at submit time (envelope: {@code missing_reference})
     *
     * Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)
     */
    @PostMapping("/{targetArchitectureId}/selective-copy/commit")
    public ResponseEntity<SelectiveCopyCommitResponse> selectiveCopyCommit(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @RequestBody SelectiveCopyCommitRequest request) {
        log.info("POST /api/projects/{}/architectures/{}/selective-copy/commit (source={}, selected={}, resolutions={})",
            projectId, targetArchitectureId,
            request == null ? null : request.sourceArchitectureId(),
            request == null || request.elementIds() == null ? 0 : request.elementIds().size(),
            request == null || request.resolutions() == null ? 0 : request.resolutions().size());
        SelectiveCopyCommitResponse response =
            architectureSelectiveCopyService.commit(projectId, targetArchitectureId, request);
        return ResponseEntity.ok(response);
    }
}
