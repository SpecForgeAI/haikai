package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.AppendGeneratedMigrationBookOfWorkItemsRequest;
import com.example.architecturemodel.model.dto.AppendTestItemRequest;
import com.example.architecturemodel.model.dto.AppendTestItemResponse;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryRequest;
import com.example.architecturemodel.model.dto.AppendCapabilityStoryResponse;
import com.example.architecturemodel.model.dto.AddWorkItemRequest;
import com.example.architecturemodel.model.dto.AddWorkItemResponse;
import com.example.architecturemodel.model.dto.GeneratedMigrationBookOfWorkDto;
import com.example.architecturemodel.model.dto.RepairOrphanItemResponse;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkRequest;
import com.example.architecturemodel.model.dto.SaveGeneratedMigrationBookOfWorkResponse;
import com.example.architecturemodel.service.GeneratedMigrationBookOfWorkService;
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
 * REST Controller exposing the CRUD + save-to-backlog endpoints for
 * Migration Book of Work drafts.
 *
 * <p><b>Endpoints (all scoped under
 * {@code /api/projects/{projectId}/migration-books-of-work}):</b></p>
 * <ul>
 *   <li>{@code POST /} -- create a new draft.</li>
 *   <li>{@code GET  /?includeArchived=false} -- list drafts (active by
 *       default; pass {@code includeArchived=true} to include archived rows).</li>
 *   <li>{@code GET  /{bookId}} -- fetch a single draft (full
 *       {@code book_of_work_json} + sibling JSONB blobs).</li>
 *   <li>{@code PUT  /{bookId}} -- PATCH-style update of editable fields
 *       (canonical use: persist the frontend {@code saveStateById} back into
 *       {@code book_of_work_json} when the user clicks "Save draft").</li>
 *   <li>{@code POST /{bookId}/save-to-backlog} -- write selected items into the
 *       {@code work_item} table (per-item commit; see service Q-5 / Q-8 /
 *       Q-10 docs).</li>
 *   <li>{@code POST /{bookId}/items/append} -- atomic server-side merge of one
 *       epic's phase-2 expansion items + expansion state into
 *       {@code book_of_work_json} (spec 2026-06-11 Two-Phase Migration
 *       Delivery Plan Generation, Task Group 2).</li>
 * </ul>
 *
 * <p><b>Q-6 archive-on-regenerate.</b> {@code POST /} delegates to the service,
 * which archives any prior active draft for the same
 * {@code (projectId, currentArchitectureId, targetArchitectureId)} tuple
 * BEFORE inserting the new row. The {@code GET /} default of "active only"
 * means archived drafts disappear from the list view until the user toggles
 * {@code includeArchived=true}.</p>
 *
 * <p><b>Q-17 auth gating.</b> Matches the existing {@code product-manager--backlog}
 * task verbatim per spec.md -- no new role, permission flag, or gating layer
 * is introduced. The controller relies on the same upstream auth filter chain.</p>
 *
 * <p>Modeled structurally on {@code DiscoveryRunController}: same envelope
 * style, same project-scoped path-variable convention, same trivial 4xx
 * mapping (delegated to {@code GlobalExceptionHandler} for
 * {@code ResourceNotFoundException} and {@code IllegalArgumentException}).</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work
 * Generation (2026-05-17) --
 * {@code agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md}.
 * Task Groups 7 + 8.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/migration-books-of-work")
@RequiredArgsConstructor
@Slf4j
public class GeneratedMigrationBookOfWorkController {

    private final GeneratedMigrationBookOfWorkService service;

    /**
     * POST /api/projects/{projectId}/migration-books-of-work
     *
     * <p>Create a new draft. Per Q-6 the service auto-archives any active draft
     * for the same {@code (projectId, currentArchitectureId, targetArchitectureId)}
     * tuple BEFORE inserting the new row. Returns 201 Created.</p>
     */
    @PostMapping
    public ResponseEntity<?> createDraft(
            @PathVariable UUID projectId,
            @RequestBody GeneratedMigrationBookOfWorkDto request) {
        log.debug("POST /api/projects/{}/migration-books-of-work", projectId);
        try {
            GeneratedMigrationBookOfWorkDto created = service.createDraft(projectId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            log.warn("Bad request creating book of work for project {}: {}", projectId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/projects/{projectId}/migration-books-of-work?includeArchived=false
     *
     * <p>List drafts. Defaults to active drafts only (status not in
     * {@code {archived}}); pass {@code ?includeArchived=true} to include
     * archived rows (Q-6).</p>
     */
    @GetMapping
    public ResponseEntity<List<GeneratedMigrationBookOfWorkDto>> listDrafts(
            @PathVariable UUID projectId,
            @RequestParam(name = "includeArchived", required = false, defaultValue = "false")
                boolean includeArchived) {
        log.debug("GET /api/projects/{}/migration-books-of-work?includeArchived={}",
            projectId, includeArchived);
        List<GeneratedMigrationBookOfWorkDto> drafts = service.listDrafts(projectId, includeArchived);
        return ResponseEntity.ok(drafts);
    }

    /**
     * GET /api/projects/{projectId}/migration-books-of-work/{bookId}
     *
     * <p>Single-row fetch scoped to the project. 404 if the book does not exist
     * or belongs to a different project (cross-project leakage collapsed into
     * "not found").</p>
     */
    @GetMapping("/{bookId}")
    public ResponseEntity<?> getDraft(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId) {
        log.debug("GET /api/projects/{}/migration-books-of-work/{}", projectId, bookId);
        try {
            GeneratedMigrationBookOfWorkDto dto = service.getDraft(projectId, bookId);
            return ResponseEntity.ok(dto);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * PUT /api/projects/{projectId}/migration-books-of-work/{bookId}
     *
     * <p>PATCH-style update; null fields on the DTO leave existing columns
     * untouched. Editable fields per spec.md: {@code title}, {@code summary},
     * {@code status}, {@code book_of_work_json}. Other JSONB columns are
     * immutable post-create.</p>
     */
    @PutMapping("/{bookId}")
    public ResponseEntity<?> updateDraft(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody GeneratedMigrationBookOfWorkDto patch) {
        log.debug("PUT /api/projects/{}/migration-books-of-work/{}", projectId, bookId);
        try {
            GeneratedMigrationBookOfWorkDto updated = service.updateDraft(projectId, bookId, patch);
            return ResponseEntity.ok(updated);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request updating book of work {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/save-to-backlog
     *
     * <p>Save admitted draft items into the {@code work_item} table. Per-item
     * commit per Q-5 -- a single failure does not abort the batch. See
     * {@link GeneratedMigrationBookOfWorkService#saveToBacklog(UUID, UUID,
     * SaveGeneratedMigrationBookOfWorkRequest)} for the full filter +
     * parent-inclusion + idempotency semantics.</p>
     */
    @PostMapping("/{bookId}/save-to-backlog")
    public ResponseEntity<?> saveToBacklog(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody SaveGeneratedMigrationBookOfWorkRequest request) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/save-to-backlog (saveMode={})",
            projectId, bookId, request == null ? null : request.saveMode());
        try {
            SaveGeneratedMigrationBookOfWorkResponse response =
                service.saveToBacklog(projectId, bookId, request);
            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad save-to-backlog request for book {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append
     *
     * <p>Atomically append one epic's phase-2 expansion items AND merge that
     * epic's expansion state into {@code book_of_work_json} -- a single
     * server-side {@code @Transactional} merge, never a client
     * read-modify-write, so concurrent per-epic appends during "Expand all"
     * cannot lose each other's writes. See
     * {@link GeneratedMigrationBookOfWorkService#appendItems(UUID, UUID,
     * AppendGeneratedMigrationBookOfWorkItemsRequest)} for the full merge +
     * validation semantics (unknown epic id / non-draft book -&gt; 400;
     * unknown book -&gt; 404).</p>
     *
     * <p>Spec: Two-Phase Migration Delivery Plan Generation (Skeleton -&gt;
     * Expand) (2026-06-11) -- Task Group 2. NO Liquibase change.</p>
     */
    @PostMapping("/{bookId}/items/append")
    public ResponseEntity<?> appendItems(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody AppendGeneratedMigrationBookOfWorkItemsRequest request) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/append (epicId={})",
            projectId, bookId, request == null ? null : request.epicId());
        try {
            GeneratedMigrationBookOfWorkDto updated =
                service.appendItems(projectId, bookId, request);
            return ResponseEntity.ok(updated);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad items/append request for book {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/delete
     *
     * <p>Phase 1a (2026-07-20): delete a STORY the plan should never have
     * created (distinct from an unresolved problem). One story per call —
     * never bulk. The item is removed AND tombstoned in
     * {@code suppressed_item_ids} so re-expansion cannot resurrect it; a
     * linked WorkItem is best-effort archived. See
     * {@link GeneratedMigrationBookOfWorkService#deleteStoryItem}.</p>
     */
    @PostMapping("/{bookId}/items/{bookItemId}/delete")
    public ResponseEntity<?> deleteStoryItem(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @PathVariable String bookItemId) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/{}/delete",
            projectId, bookId, bookItemId);
        try {
            GeneratedMigrationBookOfWorkDto updated =
                service.deleteStoryItem(projectId, bookId, bookItemId);
            return ResponseEntity.ok(updated);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad items/delete request for book {} item {}: {}",
                bookId, bookItemId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/repair-orphan
     *
     * <p>One-click repair for an orphan {@code book_of_work_json.items[].workItemId}
     * surfaced by the Migration Delivery Dashboard. Clears the stale id and
     * re-creates the {@code WorkItem} in a single transaction. See
     * {@link GeneratedMigrationBookOfWorkService#repairOrphanItem(UUID, UUID, String)}
     * for the full semantics + validation rules.</p>
     *
     * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19)
     * follow-up #2.</p>
     */
    @PostMapping("/{bookId}/items/{bookItemId}/repair-orphan")
    public ResponseEntity<?> repairOrphanItem(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @PathVariable String bookItemId) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/{}/repair-orphan",
            projectId, bookId, bookItemId);
        try {
            RepairOrphanItemResponse response =
                service.repairOrphanItem(projectId, bookId, bookItemId);
            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad repair-orphan request for book {} item {}: {}",
                bookId, bookItemId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-test-item
     *
     * <p>Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4):
     * create ONE {@code TEST} work item AND append its {@code book_of_work_json}
     * blob item (with the created {@code workItemId} stamped on it) in a single
     * transaction, so the TEST sibling surfaces in BOTH the delivery dashboard
     * tree and the flat backlog. See
     * {@link GeneratedMigrationBookOfWorkService#appendTestItem(UUID, UUID, AppendTestItemRequest)}
     * for the full semantics.</p>
     */
    @PostMapping("/{bookId}/items/append-test-item")
    public ResponseEntity<?> appendTestItem(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody AppendTestItemRequest request) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/append-test-item",
            projectId, bookId);
        try {
            AppendTestItemResponse response = service.appendTestItem(projectId, bookId, request);
            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad append-test-item request for book {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-capability-story
     *
     * <p>Spec: D3 — Internal-behaviour implementation-ready spec generation
     * (2026-06-14, Spec 3 of 6): mint ONE {@code STORY} work item from an
     * approved {@code discovery_capability} AND append its
     * {@code book_of_work_json} blob item (with the created {@code workItemId} +
     * {@code source_capability_id} stamped on it) in a single transaction, so the
     * story is consumed UNCHANGED by the already-built migration spec generator
     * ({@code selectEligibleStories} already gates on {@code type === 'story'} +
     * a non-null {@code workItemId}). The blob {@code type} is the lowercase
     * {@code "story"} so the gateway filter matches; the provenance link rides
     * the blob (NO new Liquibase changeset). See
     * {@link GeneratedMigrationBookOfWorkService#appendCapabilityStory(UUID, UUID, AppendCapabilityStoryRequest)}
     * for the full semantics (missing {@code source_capability_id} / {@code title}
     * -&gt; 400; unknown book -&gt; 404).</p>
     */
    @PostMapping("/{bookId}/items/append-capability-story")
    public ResponseEntity<?> appendCapabilityStory(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody AppendCapabilityStoryRequest request) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/append-capability-story",
            projectId, bookId);
        try {
            AppendCapabilityStoryResponse response =
                service.appendCapabilityStory(projectId, bookId, request);
            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad append-capability-story request for book {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/add-item
     *
     * <p>Spec: D5 -- Net-new backlog items + provenance (2026-06-14, Spec 5 of
     * 6): add ONE MANUAL {@code STORY} work item (genuinely-new {@code net_new}
     * work, or undiscoverable {@code carry_over} work no parser finds) AND append
     * its {@code book_of_work_json} blob item (with the created
     * {@code workItemId} + {@code provenance} stamped on it) in a single
     * transaction, so the manual story surfaces in BOTH the delivery dashboard
     * tree and the flat backlog and is consumed UNCHANGED by the gateway's
     * description-grounded spec-gen ({@code selectEligibleStories} already gates
     * on {@code type === 'story'} + a non-null {@code workItemId}). The blob
     * {@code type} is the lowercase {@code "story"} so the gateway filter matches;
     * {@code provenance} is stamped on BOTH the {@code work_item} column
     * (changeset 186) and the blob; the {@code kind} flavour rides the blob to
     * tune the spec-gen prompt orientation. The item carries NO
     * {@code source_capability_id} / finding refs, keeping it OUT of D4's gate
     * with no gate code. See
     * {@link GeneratedMigrationBookOfWorkService#addItem(UUID, UUID, AddWorkItemRequest)}
     * for the full semantics (missing {@code title} / invalid {@code provenance} /
     * invalid {@code kind} -&gt; 400; unknown book -&gt; 404).</p>
     */
    @PostMapping("/{bookId}/items/add-item")
    public ResponseEntity<?> addItem(
            @PathVariable UUID projectId,
            @PathVariable UUID bookId,
            @RequestBody AddWorkItemRequest request) {
        log.debug("POST /api/projects/{}/migration-books-of-work/{}/items/add-item",
            projectId, bookId);
        try {
            AddWorkItemResponse response = service.addItem(projectId, bookId, request);
            return ResponseEntity.ok(response);
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad add-item request for book {}: {}", bookId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
