package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.dto.DecommissionedInTargetAnnotationDto;
import com.example.architecturemodel.model.dto.MappingSuggestRequest;
import com.example.architecturemodel.model.dto.MappingSuggestResponse;
import com.example.architecturemodel.model.dto.MarkDecommissionedRequest;
import com.example.architecturemodel.model.dto.MarkDecommissionedResponse;
import com.example.architecturemodel.model.dto.MarkStaleRequest;
import com.example.architecturemodel.model.dto.MarkStaleResponse;
import com.example.architecturemodel.model.dto.PromoteTargetArchitectureResponse;
import com.example.architecturemodel.model.dto.SeedTargetArchitectureRequest;
import com.example.architecturemodel.model.dto.SuggestFromCurrentRequest;
import com.example.architecturemodel.model.dto.SuggestFromCurrentResponse;
import com.example.architecturemodel.model.dto.UnmappedCurrentElementDto;
import com.example.architecturemodel.service.DecommissionedInTargetAnnotationService;
import com.example.architecturemodel.service.MappingSuggestService;
import com.example.architecturemodel.service.SuggestFromCurrentService;
import com.example.architecturemodel.service.TargetArchitectureDecommissionService;
import com.example.architecturemodel.service.TargetArchitecturePromoteService;
import com.example.architecturemodel.service.TargetArchitectureSeedService;
import com.example.architecturemodel.service.TargetArchitectureStaleMarkService;
import com.example.architecturemodel.service.UnmappedCurrentElementsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for Target Architecture authoring operations.
 *
 * <p>v1 endpoints:</p>
 * <ul>
 *   <li><b>Task Group 2:</b>
 *     <ul>
 *       <li>{@code POST /api/projects/{projectId}/target-architectures/seed}
 *           -- creates a new target architecture (clone-current / blank /
 *           from-template, 501 in v1).</li>
 *     </ul>
 *   </li>
 *   <li><b>Task Group 3:</b>
 *     <ul>
 *       <li>{@code GET  /api/projects/{projectId}/target-architectures} --
 *           lists every {@code kind='target'} row (active + drafts).</li>
 *       <li>{@code POST /api/projects/{projectId}/target-architectures/{id}/promote}
 *           -- promotes the chosen draft to active, demotes prior active, and
 *           returns the impact-preview count of specs marked stale.</li>
 *       <li>{@code DELETE /api/projects/{projectId}/target-architectures/{id}}
 *           -- soft-deletes (archived=true); 409 if {@code draft_state='active'}.</li>
 *       <li>{@code GET  /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements}
 *           -- LEFT JOIN gap of current-arch elements with no mapping into
 *           the active target.</li>
 *       <li>{@code POST /api/projects/{projectId}/specs/mark-stale} --
 *           manual entry point for the active-target save path with
 *           AMS-side debounce gate.</li>
 *     </ul>
 *   </li>
 *   <li><b>Task Group 4:</b>
 *     <ul>
 *       <li>{@code POST /api/projects/{projectId}/target-architectures/{id}/decommission}
 *           -- writes a NEW target-side row with
 *           {@code provenance='user-authored'} and
 *           {@code decommissioning_status='decommissioned'}, plus a
 *           {@code mapping_type='decommissioned'} mapping row, atomically.</li>
 *       <li>{@code GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations}
 *           -- derived current-side annotation list (no mapping to active
 *           target, OR all mappings point at decommissioned target rows).</li>
 *       <li>{@code POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest}
 *           -- READ-ONLY name-similarity candidate list (no LLM); gateway
 *           layer reranks with the LLM.</li>
 *     </ul>
 *   </li>
 * </ul>
 *
 * <p>The {@code mark-stale} and {@code unmapped-current-elements} endpoints
 * live on this controller for spatial locality with the rest of the
 * target-architecture surface, even though their URLs are scoped under
 * {@code /api/projects/{projectId}/specs} and
 * {@code /api/projects/{projectId}/architectures/{archId}} respectively.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Groups 2, 3, and 4.</p>
 */
@RestController
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class TargetArchitectureController {

    private final TargetArchitectureSeedService seedService;
    private final TargetArchitecturePromoteService promoteService;
    private final TargetArchitectureStaleMarkService staleMarkService;
    private final UnmappedCurrentElementsService unmappedService;
    private final TargetArchitectureDecommissionService decommissionService;
    private final DecommissionedInTargetAnnotationService decomAnnotationService;
    private final MappingSuggestService mappingSuggestService;
    private final SuggestFromCurrentService suggestFromCurrentService;

    public TargetArchitectureController(
            TargetArchitectureSeedService seedService,
            TargetArchitecturePromoteService promoteService,
            TargetArchitectureStaleMarkService staleMarkService,
            UnmappedCurrentElementsService unmappedService,
            TargetArchitectureDecommissionService decommissionService,
            DecommissionedInTargetAnnotationService decomAnnotationService,
            MappingSuggestService mappingSuggestService,
            SuggestFromCurrentService suggestFromCurrentService) {
        this.seedService = seedService;
        this.promoteService = promoteService;
        this.staleMarkService = staleMarkService;
        this.unmappedService = unmappedService;
        this.decommissionService = decommissionService;
        this.decomAnnotationService = decomAnnotationService;
        this.mappingSuggestService = mappingSuggestService;
        this.suggestFromCurrentService = suggestFromCurrentService;
    }

    // -----------------------------------------------------------------------
    // Task Group 2: seed
    // -----------------------------------------------------------------------

    /**
     * POST /api/projects/{projectId}/target-architectures/seed
     *
     * <p>Creates a new target architecture per the requested mode.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>201 Created -- seed succeeded; body is the new architecture DTO</li>
     *   <li>400 Bad Request -- missing / unknown {@code mode}</li>
     *   <li>404 Not Found -- {@code currentArchitectureId} (when supplied) is
     *       missing or belongs to a different project; or the project has no
     *       current-kind architecture to clone in {@code clone-current} mode</li>
     *   <li>409 Conflict -- auto-generated or explicit {@code draftName}
     *       collides with an existing architecture (case-insensitive)</li>
     *   <li>422 Unprocessable Entity -- source is archived (defence in depth)</li>
     *   <li>501 Not Implemented -- {@code from-template} mode in v1</li>
     * </ul>
     */
    @PostMapping("/api/projects/{projectId}/target-architectures/seed")
    public ResponseEntity<ArchitectureDto> seedTargetArchitecture(
            @PathVariable UUID projectId,
            @RequestBody SeedTargetArchitectureRequest request) {
        log.info("POST /api/projects/{}/target-architectures/seed (mode={})",
            projectId, request == null ? null : request.mode());
        ArchitectureDto seeded = seedService.seed(projectId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(seeded);
    }

    // -----------------------------------------------------------------------
    // Target State Sub-tab + Deterministic Suggest (Spec: 2026-05-24)
    // -----------------------------------------------------------------------

    /**
     * POST /api/projects/{projectId}/target-architectures/suggest-from-current
     *
     * <p>Deterministically clones the supplied current architecture 1:1 into a
     * new target draft and writes equivalence mapping rows for every cloned
     * element. The single {@code @Transactional} boundary inside
     * {@code SuggestFromCurrentService} ensures Phase 2 (clone) and Phase 3
     * (mapping inserts) commit or roll back together.</p>
     *
     * <p>The request body carries the {@code currentArchitectureId} captured
     * at click time on the frontend so a mid-flight architecture switch on
     * the client cannot redirect the clone to the wrong source -- this is
     * the only source attribution the server consults.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>201 Created -- suggest succeeded; body carries the new draft id +
     *       resolved auto-name + cloned-element / mapping-row counts</li>
     *   <li>400 Bad Request -- missing {@code currentArchitectureId}</li>
     *   <li>404 Not Found -- {@code currentArchitectureId} missing or
     *       belongs to a different project</li>
     *   <li>409 Conflict -- a draft with the resolved auto-generated name was
     *       created within the last 5 seconds (server-side double-click
     *       guard); envelope {@code code: "recent_duplicate_suggest"}</li>
     *   <li>422 Unprocessable Entity -- the source current architecture has
     *       zero in-scope elements; envelope
     *       {@code code: "empty_current_architecture"} with message
     *       {@code "Current architecture has no elements to suggest from"}</li>
     * </ul>
     *
     * <p>The existing {@code POST /target-architectures/seed} endpoint and its
     * {@code clone-current} / {@code blank} / {@code from-template} modes are
     * untouched -- this endpoint is independent.</p>
     *
     * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24).</p>
     */
    @PostMapping("/api/projects/{projectId}/target-architectures/suggest-from-current")
    public ResponseEntity<SuggestFromCurrentResponse> suggestFromCurrent(
            @PathVariable UUID projectId,
            @RequestBody SuggestFromCurrentRequest request) {
        log.info("POST /api/projects/{}/target-architectures/suggest-from-current "
                + "(currentArchitectureId={})",
            projectId, request == null ? null : request.currentArchitectureId());
        SuggestFromCurrentResponse response =
            suggestFromCurrentService.suggestFromCurrent(projectId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // -----------------------------------------------------------------------
    // Task Group 3: list / promote / delete
    // -----------------------------------------------------------------------

    /**
     * GET /api/projects/{projectId}/target-architectures
     *
     * <p>Lists every {@code kind='target'} architecture row in the project,
     * sorted active-first then most-recent. Includes drafts.</p>
     */
    @GetMapping("/api/projects/{projectId}/target-architectures")
    public ResponseEntity<List<ArchitectureDto>> listTargetArchitectures(
            @PathVariable UUID projectId) {
        log.info("GET /api/projects/{}/target-architectures", projectId);
        return ResponseEntity.ok(promoteService.listTargets(projectId));
    }

    /**
     * POST /api/projects/{projectId}/target-architectures/{targetArchId}/promote
     *
     * <p>Transitions the chosen draft to {@code draft_state='active'} and
     * demotes the prior active target to {@code draft} with a
     * "(superseded YYYY-MM-DD)" name suffix. Fires the stale-mark pipeline
     * against every element whose mapping changed between the prior active
     * and the new active.</p>
     *
     * <p>Returns the updated architecture DTO + impact-preview count. The
     * impact preview is computed BEFORE the transition so the count returned
     * by this call matches what a "dry-run" preview would have surfaced;
     * with no concurrent writes the preview equals the actual stale-marked
     * count. The UI confirm modal renders this number.</p>
     *
     * <p><b>Dry-run mode:</b> when {@code ?dryRun=true} is supplied, the
     * handler routes through {@link TargetArchitecturePromoteService#previewPromote(UUID, UUID)}
     * which validates the request and computes the impact-preview count
     * WITHOUT committing the transition. The confirm modal calls this first
     * to render "Promoting this draft will mark N specs stale. Continue?";
     * the same endpoint (with {@code dryRun=false} or omitted) commits.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>200 OK -- promote succeeded (or preview computed in dry-run)</li>
     *   <li>400 Bad Request -- architecture is not {@code kind='target'} or
     *       is already active</li>
     *   <li>404 Not Found -- architecture missing / cross-project</li>
     * </ul>
     */
    @PostMapping("/api/projects/{projectId}/target-architectures/{targetArchId}/promote")
    public ResponseEntity<PromoteTargetArchitectureResponse> promoteTargetArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchId,
            @RequestParam(name = "dryRun", required = false, defaultValue = "false") boolean dryRun) {
        log.info("POST /api/projects/{}/target-architectures/{}/promote (dryRun={})",
            projectId, targetArchId, dryRun);
        if (dryRun) {
            return ResponseEntity.ok(promoteService.previewPromote(projectId, targetArchId));
        }
        return ResponseEntity.ok(promoteService.promote(projectId, targetArchId));
    }

    /**
     * DELETE /api/projects/{projectId}/target-architectures/{targetArchId}
     *
     * <p>Soft-deletes a target architecture by setting {@code archived=true}.
     * Rejected with 409 when the architecture is the current active target;
     * the user must promote another draft first.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>204 No Content -- delete succeeded</li>
     *   <li>400 Bad Request -- architecture is not {@code kind='target'}</li>
     *   <li>404 Not Found -- architecture missing / cross-project</li>
     *   <li>409 Conflict -- architecture is the active target</li>
     * </ul>
     */
    @DeleteMapping("/api/projects/{projectId}/target-architectures/{targetArchId}")
    public ResponseEntity<Void> deleteTargetArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchId,
            @RequestParam(name = "force", required = false, defaultValue = "false") boolean force) {
        log.info("DELETE /api/projects/{}/target-architectures/{}?force={}",
            projectId, targetArchId, force);
        promoteService.delete(projectId, targetArchId, force);
        return ResponseEntity.noContent().build();
    }

    // -----------------------------------------------------------------------
    // Task Group 3: unmapped-current-elements
    // -----------------------------------------------------------------------

    /**
     * GET /api/projects/{projectId}/architectures/{archId}/unmapped-current-elements
     *
     * <p>Returns the LEFT JOIN gap: every element on the four supertype
     * tables tied to {@code archId} that has no mapping into the project's
     * active target. Powers the right-side warning panel in the authoring
     * workspace.</p>
     *
     * <p>When the project has no active target row, every current element is
     * unmapped by definition; the endpoint returns the full inventory.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>200 OK -- empty list when nothing is unmapped</li>
     *   <li>404 Not Found -- architecture missing / cross-project</li>
     * </ul>
     */
    @GetMapping("/api/projects/{projectId}/architectures/{archId}/unmapped-current-elements")
    public ResponseEntity<List<UnmappedCurrentElementDto>> getUnmappedCurrentElements(
            @PathVariable UUID projectId,
            @PathVariable UUID archId,
            @RequestParam(name = "targetArchitectureId", required = false) UUID targetArchitectureId) {
        log.info("GET /api/projects/{}/architectures/{}/unmapped-current-elements?targetArchitectureId={}",
            projectId, archId, targetArchitectureId);
        return ResponseEntity.ok(
            unmappedService.findUnmapped(projectId, archId, targetArchitectureId));
    }

    // -----------------------------------------------------------------------
    // Task Group 3: mark-stale (active-target save path)
    // -----------------------------------------------------------------------

    /**
     * POST /api/projects/{projectId}/specs/mark-stale
     *
     * <p>Frontend coordination is intentionally avoided -- the AMS-side
     * debounce stamp on
     * {@code architecture.last_marked_stale_at} is the durable choice (per
     * spec direction). The gateway proxy passes save events straight through;
     * AMS gates the actual mark-stale work using the
     * {@link TargetArchitectureStaleMarkService} debounce.</p>
     *
     * <p>The handler is gated on
     * {@code kind='target' AND draft_state='active'}: a draft-state
     * architecture id returns {@code markedCount=0, debounceSkipped=false}
     * without touching any spec rows. Draft edits NEVER mark specs stale.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>200 OK -- always (the response payload signals what happened)</li>
     *   <li>400 Bad Request -- malformed body</li>
     * </ul>
     *
     * <p>v1 design choice: a single mark-stale endpoint serves both the
     * frontend save-path call (via the gateway proxy) and the LLM
     * suggest-target task. Future revisions may split this if the two paths
     * need divergent semantics.</p>
     */
    @PostMapping("/api/projects/{projectId}/specs/mark-stale")
    public ResponseEntity<MarkStaleResponse> markSpecsStale(
            @PathVariable UUID projectId,
            @RequestBody MarkStaleRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body is required");
        }
        UUID architectureId = request.activeTargetArchId();
        if (architectureId == null) {
            throw new IllegalArgumentException(
                "activeTargetArchId is required so the AMS-side debounce can target the correct row");
        }
        log.info("POST /api/projects/{}/specs/mark-stale (arch={}, changedElements={})",
            projectId, architectureId,
            request.changedElementIds() == null ? 0 : request.changedElementIds().size());
        MarkStaleResponse result = staleMarkService.markStaleIfActiveAndDebounced(
            projectId, architectureId, request.changedElementIds());
        return ResponseEntity.ok(result);
    }

    // -----------------------------------------------------------------------
    // Task Group 4: decommissioning (write path)
    // -----------------------------------------------------------------------

    /**
     * POST /api/projects/{projectId}/target-architectures/{targetArchId}/decommission
     *
     * <p>Writes a NEW target-side row with
     * {@code provenance='user-authored'} and
     * {@code decommissioning_status='decommissioned'}, plus a
     * {@code mapping_type='decommissioned'} mapping row pointing from the
     * supplied current element to the new target-side row. Both writes are
     * atomic via {@code @Transactional}.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>201 Created -- decommissioning succeeded; body carries the new
     *       target-element id + mapping id so the UI can refresh the model
     *       cache</li>
     *   <li>400 Bad Request -- malformed body, unknown element type, or the
     *       referenced architecture is not {@code kind='target'}</li>
     *   <li>404 Not Found -- target architecture missing / cross-project, or
     *       the source element id is missing from the supertype table</li>
     *   <li>409 Conflict -- the target architecture is archived, or has no
     *       model files to anchor the new row</li>
     * </ul>
     */
    @PostMapping("/api/projects/{projectId}/target-architectures/{targetArchId}/decommission")
    public ResponseEntity<MarkDecommissionedResponse> markDecommissioned(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchId,
            @RequestBody MarkDecommissionedRequest request) {
        log.info("POST /api/projects/{}/target-architectures/{}/decommission "
                + "(currentElementType={}, currentElementId={})",
            projectId, targetArchId,
            request == null ? null : request.currentElementType(),
            request == null ? null : request.currentElementId());
        MarkDecommissionedResponse response =
            decommissionService.markDecommissioned(projectId, targetArchId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // -----------------------------------------------------------------------
    // Task Group 4: derived decommissioned-in-target annotations (read)
    // -----------------------------------------------------------------------

    /**
     * GET /api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations
     *
     * <p>Returns the derived "decommissioned in target" annotation list for
     * a current architecture. Two conditions surface a row:</p>
     *
     * <ol>
     *   <li>no mapping into the project's active target, OR</li>
     *   <li>every mapping points at a target element with
     *       {@code decommissioning_status='decommissioned'}.</li>
     * </ol>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>200 OK -- empty list when no annotations apply</li>
     *   <li>404 Not Found -- architecture missing / cross-project</li>
     * </ul>
     */
    @GetMapping("/api/projects/{projectId}/architectures/{archId}/decommissioned-in-target-annotations")
    public ResponseEntity<List<DecommissionedInTargetAnnotationDto>> getDecommissionedInTargetAnnotations(
            @PathVariable UUID projectId,
            @PathVariable UUID archId,
            @RequestParam(name = "targetArchitectureId", required = false) UUID targetArchitectureId) {
        log.info("GET /api/projects/{}/architectures/{}/decommissioned-in-target-annotations?targetArchitectureId={}",
            projectId, archId, targetArchitectureId);
        return ResponseEntity.ok(
            decomAnnotationService.findAnnotations(projectId, archId, targetArchitectureId));
    }

    // -----------------------------------------------------------------------
    // Task Group 4: mapping-suggest (AMS-side read-only candidate list)
    // -----------------------------------------------------------------------

    /**
     * POST /api/projects/{projectId}/architectures/{archId}/mapping-suggest
     *
     * <p>Returns up to three current-architecture element candidates ranked
     * by name similarity for the supplied target element snapshot.
     * READ-ONLY: no row mutations occur. The LLM rerank lives in the gateway
     * proxy layer; AMS deliberately stays deterministic so the contract can
     * be exercised without an LLM hop.</p>
     *
     * <p>Status codes:</p>
     * <ul>
     *   <li>200 OK -- always (candidates list may be empty)</li>
     *   <li>400 Bad Request -- missing request body</li>
     *   <li>404 Not Found -- architecture missing / cross-project</li>
     * </ul>
     */
    @PostMapping("/api/projects/{projectId}/architectures/{archId}/mapping-suggest")
    public ResponseEntity<MappingSuggestResponse> mappingSuggest(
            @PathVariable UUID projectId,
            @PathVariable UUID archId,
            @RequestBody MappingSuggestRequest request) {
        log.info("POST /api/projects/{}/architectures/{}/mapping-suggest "
                + "(targetName={})",
            projectId, archId,
            request == null || request.targetElementSnapshot() == null
                ? null : request.targetElementSnapshot().name());
        return ResponseEntity.ok(mappingSuggestService.suggest(projectId, archId, request));
    }
}
