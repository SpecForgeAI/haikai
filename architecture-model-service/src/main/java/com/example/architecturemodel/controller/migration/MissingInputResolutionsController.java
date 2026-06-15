package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.BulkResolveRequest;
import com.example.architecturemodel.model.dto.migration.BulkResolveResponse;
import com.example.architecturemodel.model.dto.migration.ContractIngestResponse;
import com.example.architecturemodel.model.dto.migration.CreateResolutionResponse;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.dto.migration.SoftDeleteResolutionResponse;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.ContractIngestResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileEntry;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationStatus;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolveItem;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService.BulkResolvePreviewRow;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService.CascadeResult;
import com.example.architecturemodel.service.migration.MissingInputResolutionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * REST controller for the {@code missing_input_resolutions} surface.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 4 added the
 * {@code POST .../parse-files} multipart endpoint. The new endpoint is co-
 * located on this controller because it shares the
 * {@code /api/projects/{projectId}/missing-input-resolutions} URL prefix and
 * writes into the same aggregate -- a separate controller would have forced
 * an awkward route split.</p>
 *
 * <h2>Endpoints</h2>
 * <ul>
 *   <li>{@code POST   /api/projects/{projectId}/missing-input-resolutions}
 *       -- create a single resolution; returns 201 with
 *       {@link CreateResolutionResponse} (the new DTO + affected spec ids).
 *       Returns 409 Conflict on duplicate active key (via
 *       {@code GlobalExceptionHandler}).</li>
 *   <li>{@code POST   /api/projects/{projectId}/missing-input-resolutions/bulk}
 *       -- bulk preview / commit. {@code commit=false} returns the preview
 *       shape with no writes; {@code commit=true} writes all resolutions in a
 *       single transaction. Delegates to
 *       {@link MissingInputResolutionBulkService#bulkResolve}.</li>
 *   <li>{@code POST   /api/projects/{projectId}/missing-input-resolutions/parse-files}
 *       -- multipart parse + classify (+ optionally commit) for OAS / WSDL
 *       uploads. {@code commit=false} returns per-file + per-operation
 *       classification without writes; {@code commit=true} persists one
 *       {@code project_artifact} row per matched file plus one
 *       {@code missing_input_resolutions} row per matched operation, all in
 *       one transaction. Delegates to
 *       {@link OasWsdlContractIngestService}.</li>
 *   <li>{@code DELETE /api/projects/{projectId}/missing-input-resolutions/{id}}
 *       -- soft-delete with cross-story cascade. Optional
 *       {@code ?deletedBy=...} query param threads the audit channel. Returns
 *       {@link SoftDeleteResolutionResponse}. Delegates to
 *       {@link MissingInputResolutionCascadeService#softDeleteWithCascade}.</li>
 *   <li>{@code GET    /api/projects/{projectId}/missing-input-resolutions}
 *       -- list active resolutions for the project. The {@code type} and
 *       {@code missingInputKey} filters are applied in the controller against
 *       the service's already-active-only list (no extra service surface).</li>
 * </ul>
 *
 * <h2>Why a separate controller from {@code MigrationStorySpecGenerationController}</h2>
 * The resolutions table is its own aggregate (no FK from spec-generations to
 * resolutions) and the lifecycle is independent of any single spec. Co-locating
 * with the resolver-flow services keeps the file footprint coherent and matches
 * the {@code EpicCapturedDecisionsController} / {@code EpicCapturedDecisionsProjectController}
 * pattern of one controller per resource aggregate.
 *
 * <h2>Boxed types and PATCH-safety</h2>
 * All request / response DTOs use boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}. Validation lives in the
 * service layer; the controller is a thin transport with no business logic
 * other than {@code deletedBy} default-applying.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/missing-input-resolutions")
@RequiredArgsConstructor
@Slf4j
public class MissingInputResolutionsController {

    /** Fallback audit channel when {@code ?deletedBy=...} is omitted on DELETE. */
    static final String DEFAULT_DELETED_BY = "system";

    /**
     * Defence-in-depth fallback for the per-project upload size cap. Mirrors
     * the gateway-side fallback so a project row with NULL
     * {@code max_contract_upload_file_size_mb} still gets a sane limit.
     *
     * <p>Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 4.</p>
     */
    static final int DEFAULT_MAX_CONTRACT_UPLOAD_MB = 10;

    /**
     * Safety multiplier: the total upload size across all parts in one
     * request is capped at this many times the per-file cap. Protects
     * against a caller submitting many "just under the cap" files that
     * would otherwise sum to gigabytes of in-memory bytes.
     */
    static final int TOTAL_UPLOAD_MULTIPLIER = 5;

    /** Audit-channel default when neither {@code X-User-Id} header nor
     *  {@code resolvedBy} form field is supplied on commit. */
    static final String DEFAULT_RESOLVED_BY = "system";

    /** Reason string stamped on files rejected by the per-project size cap. */
    static final String REASON_FILE_TOO_LARGE = "file_too_large";

    private final MissingInputResolutionService resolutionService;
    private final MissingInputResolutionBulkService bulkService;
    private final MissingInputResolutionCascadeService cascadeService;
    private final MissingInputCrossStoryMatcherService matcherService;

    /**
     * Optional collaborators -- only autowired when the parse-files Spec is
     * active. Marked optional via {@link Autowired#required()} = false so
     * tests that wire ONLY the original resolver-flow surface can boot the
     * controller without the contract-ingest dependencies. Production
     * deployments always populate both beans.
     */
    @Autowired(required = false)
    private OasWsdlContractIngestService contractIngestService;

    @Autowired(required = false)
    private ProjectRepository projectRepository;

    // -----------------------------------------------------------------------
    // POST -- create a single resolution
    // -----------------------------------------------------------------------

    @PostMapping
    public ResponseEntity<CreateResolutionResponse> create(
            @PathVariable UUID projectId,
            @RequestBody MissingInputResolutionCreateRequest request) {
        log.debug(
            "[diag-ams] missing_input_resolutions create projectId={} type={}",
            projectId, request == null ? null : request.missingInputType());

        MissingInputResolutionDto dto = resolutionService.create(projectId, request);
        List<UUID> affectedSpecIds = collectAffectedSpecIds(projectId, dto.missingInputKey());
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(new CreateResolutionResponse(dto, affectedSpecIds));
    }

    // -----------------------------------------------------------------------
    // POST /bulk -- preview / commit
    // -----------------------------------------------------------------------

    @PostMapping("/bulk")
    public ResponseEntity<BulkResolveResponse> bulk(
            @PathVariable UUID projectId,
            @RequestBody BulkResolveRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Request body required");
        }
        boolean isCommit = Boolean.TRUE.equals(request.commit());
        log.debug(
            "[diag-ams] missing_input_resolutions bulk projectId={} itemsIn={} commit={}",
            projectId,
            request.items() == null ? 0 : request.items().size(),
            isCommit);

        List<BulkResolveItem> serviceItems = unwrapItems(request.items());
        MissingInputResolutionBulkService.BulkResolveResponse svcResponse =
            bulkService.bulkResolve(
                projectId,
                serviceItems,
                request.commit(),
                request.resolvedBy());

        List<BulkResolveResponse.BulkResolveRow> rows = new ArrayList<>(
            svcResponse.resolutions() == null ? 0 : svcResponse.resolutions().size());
        Set<UUID> uniqueSpecs = new HashSet<>();
        if (svcResponse.resolutions() != null) {
            for (BulkResolvePreviewRow r : svcResponse.resolutions()) {
                if (r == null) continue;
                List<UUID> ids = r.affectedSpecIds() == null
                    ? List.of()
                    : new ArrayList<>(r.affectedSpecIds());
                uniqueSpecs.addAll(ids);
                rows.add(new BulkResolveResponse.BulkResolveRow(
                    r.key(),
                    r.missingInputType(),
                    r.descriptor(),
                    ids,
                    r.resolutionPayload()));
            }
        }
        Boolean previewOnly = svcResponse.previewOnly();
        Boolean committed = Boolean.FALSE.equals(previewOnly) ? Boolean.TRUE : Boolean.FALSE;
        return ResponseEntity.ok(new BulkResolveResponse(
            rows,
            previewOnly,
            committed,
            uniqueSpecs.size()));
    }

    // -----------------------------------------------------------------------
    // POST /parse-files -- multipart parse + classify + (optional) commit
    // -----------------------------------------------------------------------

    /**
     * Multipart upload endpoint for OAS / WSDL contract files.
     *
     * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 4.</p>
     *
     * <p>Workflow:</p>
     * <ol>
     *   <li>Resolve per-project file-size cap (project entity column with a
     *       10MB fallback when the column is NULL).</li>
     *   <li>For each {@link MultipartFile}: if size exceeds the cap, build a
     *       synthetic FAILED file block with reason {@code file_too_large}
     *       (bytes never read into memory beyond the cap); otherwise read the
     *       bytes and append to the {@link FileEntry} list passed to the
     *       service.</li>
     *   <li>Aggregate total bytes; if the sum exceeds {@link
     *       #TOTAL_UPLOAD_MULTIPLIER} times the cap, fail-fast with a 413.</li>
     *   <li>Delegate to {@link OasWsdlContractIngestService#ingestPreview} or
     *       {@link OasWsdlContractIngestService#ingestCommit} per the
     *       {@code commit} flag.</li>
     *   <li>Merge service-stage results with any oversize-stage entries and
     *       build the response DTO.</li>
     * </ol>
     */
    @PostMapping(
        value = "/parse-files",
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<ContractIngestResponse> parseFiles(
            @PathVariable UUID projectId,
            @RequestPart(value = "files", required = false) MultipartFile[] files,
            @RequestParam(value = "serviceNames", required = false) List<String> serviceNames,
            @RequestParam(value = "commit", defaultValue = "false") boolean commit,
            @RequestParam(value = "resolvedBy", required = false) String resolvedByParam,
            @RequestHeader(value = "X-User-Id", required = false) String userIdHeader) {

        if (contractIngestService == null) {
            throw new IllegalStateException(
                "OasWsdlContractIngestService is not wired -- the bulk-resolve "
                + "parse-files feature is unavailable in this deployment.");
        }

        int maxFileSizeMb = resolveMaxFileSizeMb(projectId);
        long maxFileSizeBytes = (long) maxFileSizeMb * 1024L * 1024L;
        long maxTotalBytes = maxFileSizeBytes * TOTAL_UPLOAD_MULTIPLIER;

        log.debug(
            "[diag-ams] parse_files projectId={} files={} commit={} maxFileSizeMb={}",
            projectId, files == null ? 0 : files.length, commit, maxFileSizeMb);

        // Step 1 - split incoming multipart parts into accepted-for-parse and
        // synthetic-oversize blocks. The oversize-stage blocks bypass the
        // service entirely so we never load oversized bytes into memory.
        List<FileEntry> acceptedEntries = new ArrayList<>();
        List<ContractIngestResponse.FileBlock> oversizeBlocks = new ArrayList<>();
        long runningTotal = 0L;

        if (files != null) {
            for (int i = 0; i < files.length; i++) {
                MultipartFile mf = files[i];
                if (mf == null) continue;
                long size = mf.getSize();
                String name = mf.getOriginalFilename();
                if (size > maxFileSizeBytes) {
                    oversizeBlocks.add(new ContractIngestResponse.FileBlock(
                        name,
                        size,
                        /* format */ null,
                        /* status */ "FAILED",
                        REASON_FILE_TOO_LARGE,
                        /* suggestedServiceName */ null,
                        /* finalServiceName */ null,
                        List.of()));
                    continue;
                }
                runningTotal += size;
                if (runningTotal > maxTotalBytes) {
                    log.warn(
                        "[diag-ams] parse_files projectId={} aborted -- total upload {}B > cap {}B",
                        projectId, runningTotal, maxTotalBytes);
                    return ResponseEntity
                        .status(HttpStatus.PAYLOAD_TOO_LARGE)
                        .body(emptyResponse(commit));
                }

                byte[] bytes;
                try {
                    bytes = mf.getBytes();
                } catch (Exception readErr) {
                    log.warn(
                        "[diag-ams] parse_files file read failed name={} err={}",
                        name, readErr.toString());
                    oversizeBlocks.add(new ContractIngestResponse.FileBlock(
                        name, size, null, "FAILED",
                        "file_read_error",
                        null, null, List.of()));
                    continue;
                }
                String userOverride = positionalServiceName(serviceNames, i);
                acceptedEntries.add(new FileEntry(
                    name,
                    bytes,
                    /* suggestedServiceName */ null,
                    userOverride));
            }
        }

        // Step 2 - delegate to the service. The service handles the
        // detect -> parse -> classify -> (optionally) persist orchestration
        // in one transaction per its @Transactional posture.
        ContractIngestResult result;
        if (commit) {
            String resolvedBy = resolveAuditChannel(resolvedByParam, userIdHeader);
            result = contractIngestService.ingestCommit(projectId, acceptedEntries, resolvedBy);
        } else {
            result = contractIngestService.ingestPreview(projectId, acceptedEntries);
        }

        // Step 3 - merge oversize blocks at the head of the file list (their
        // order in the response mirrors the client's upload order modulo the
        // accepted/oversize split). The summary block excludes oversize
        // entries from the operation counts (they have zero operations).
        List<ContractIngestResponse.FileBlock> allFiles =
            new ArrayList<>(oversizeBlocks.size() + result.files().size());
        allFiles.addAll(oversizeBlocks);
        for (FileResult fr : result.files()) {
            allFiles.add(toFileBlock(fr));
        }

        int matched = result.countByStatus(OperationStatus.MATCHED);
        int alreadyResolved = result.countByStatus(OperationStatus.ALREADY_RESOLVED);
        int noMatch = result.countByStatus(OperationStatus.NO_MATCH);
        int totalOps = result.totalOperations();
        int affectedSpecs = result.distinctAffectedSpecCount();
        int willCreate = matched;

        ContractIngestResponse.Summary summary = new ContractIngestResponse.Summary(
            totalOps, matched, alreadyResolved, noMatch, willCreate, affectedSpecs);

        return ResponseEntity.ok(new ContractIngestResponse(
            allFiles, summary, !commit));
    }

    private static ContractIngestResponse emptyResponse(boolean commit) {
        return new ContractIngestResponse(
            List.of(),
            new ContractIngestResponse.Summary(0, 0, 0, 0, 0, 0),
            !commit);
    }

    private int resolveMaxFileSizeMb(UUID projectId) {
        if (projectRepository == null) {
            return DEFAULT_MAX_CONTRACT_UPLOAD_MB;
        }
        Optional<ProjectEntity> opt = projectRepository.findById(projectId);
        if (opt.isEmpty()) {
            return DEFAULT_MAX_CONTRACT_UPLOAD_MB;
        }
        Integer configured = opt.get().getMaxContractUploadFileSizeMb();
        if (configured == null || configured < 1) {
            return DEFAULT_MAX_CONTRACT_UPLOAD_MB;
        }
        return configured;
    }

    private static String positionalServiceName(List<String> serviceNames, int index) {
        if (serviceNames == null) return null;
        if (index < 0 || index >= serviceNames.size()) return null;
        String v = serviceNames.get(index);
        return (v == null || v.isBlank()) ? null : v;
    }

    private static String resolveAuditChannel(String resolvedByParam, String userIdHeader) {
        if (resolvedByParam != null && !resolvedByParam.isBlank()) return resolvedByParam;
        if (userIdHeader != null && !userIdHeader.isBlank()) return userIdHeader;
        return DEFAULT_RESOLVED_BY;
    }

    private static ContractIngestResponse.FileBlock toFileBlock(FileResult fr) {
        return new ContractIngestResponse.FileBlock(
            fr.fileName(),
            fr.fileSize(),
            fr.format() == null ? null : fr.format().name().toLowerCase(),
            fr.status() == null ? null : fr.status().name(),
            fr.failureReason(),
            fr.suggestedServiceName(),
            fr.finalServiceName(),
            toOperationBlocks(fr.operations()));
    }

    private static List<ContractIngestResponse.OperationBlock> toOperationBlocks(
            List<OperationResult> ops) {
        if (ops == null || ops.isEmpty()) return List.of();
        List<ContractIngestResponse.OperationBlock> out = new ArrayList<>(ops.size());
        for (OperationResult op : ops) {
            if (op == null) continue;
            out.add(new ContractIngestResponse.OperationBlock(
                op.identifier(),
                op.missingInputKey(),
                op.status() == null ? null : op.status().name(),
                op.matchedSpecIds() == null ? List.of() : op.matchedSpecIds(),
                op.existingResolutionId()));
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // DELETE -- soft-delete with cascade
    // -----------------------------------------------------------------------

    @DeleteMapping("/{resolutionId}")
    public ResponseEntity<SoftDeleteResolutionResponse> softDelete(
            @PathVariable UUID projectId,
            @PathVariable UUID resolutionId,
            @RequestParam(value = "deletedBy", required = false) String deletedBy) {
        String effectiveDeletedBy =
            (deletedBy == null || deletedBy.isBlank()) ? DEFAULT_DELETED_BY : deletedBy;
        log.debug(
            "[diag-ams] missing_input_resolutions soft_delete projectId={} resolutionId={} deletedBy={}",
            projectId, resolutionId, effectiveDeletedBy);

        CascadeResult result = cascadeService.softDeleteWithCascade(
            projectId, resolutionId, effectiveDeletedBy);
        return ResponseEntity.ok(new SoftDeleteResolutionResponse(
            result.resolution(),
            result.affectedSpecCount(),
            result.affectedSpecIds()));
    }

    // -----------------------------------------------------------------------
    // GET -- list active resolutions
    // -----------------------------------------------------------------------

    @GetMapping
    public ResponseEntity<List<MissingInputResolutionDto>> list(
            @PathVariable UUID projectId,
            @RequestParam(value = "type", required = false) String type,
            @RequestParam(value = "missingInputKey", required = false) String missingInputKey) {
        List<MissingInputResolutionDto> all = resolutionService.list(projectId);
        if (all == null || all.isEmpty()) {
            return ResponseEntity.ok(List.of());
        }
        if ((type == null || type.isBlank())
                && (missingInputKey == null || missingInputKey.isBlank())) {
            return ResponseEntity.ok(all);
        }
        List<MissingInputResolutionDto> filtered = new ArrayList<>(all.size());
        for (MissingInputResolutionDto dto : all) {
            if (dto == null) continue;
            if (type != null && !type.isBlank()
                    && !type.equalsIgnoreCase(dto.missingInputType())) {
                continue;
            }
            if (missingInputKey != null && !missingInputKey.isBlank()
                    && !missingInputKey.equalsIgnoreCase(dto.missingInputKey())) {
                continue;
            }
            filtered.add(dto);
        }
        return ResponseEntity.ok(filtered);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Compute the affected-spec list for a freshly-resolved key by walking the
     * project's spec-generation rows via the matcher service. The matcher's
     * {@code findAffectedSpecs} returns every spec whose
     * {@code missing_input_keys_json} contains the key, regardless of status,
     * which is the contract the frontend expects (the "X of Y resolved" badge
     * may need refreshing on rows that are still {@code insufficient_context}).
     */
    private List<UUID> collectAffectedSpecIds(UUID projectId, String missingInputKey) {
        List<MigrationStorySpecGenerationEntity> affected =
            matcherService.findAffectedSpecs(projectId, missingInputKey);
        if (affected == null || affected.isEmpty()) {
            return List.of();
        }
        Set<UUID> dedupe = new LinkedHashSet<>(affected.size());
        for (MigrationStorySpecGenerationEntity spec : affected) {
            if (spec != null && spec.getId() != null) {
                dedupe.add(spec.getId());
            }
        }
        return new ArrayList<>(dedupe);
    }

    /**
     * Unwrap web-tier {@link BulkResolveRequest.BulkResolveItem}s into the
     * service-layer {@link BulkResolveItem} record. We keep the two records
     * separate so the service layer does not depend on web-tier types.
     */
    private static List<BulkResolveItem> unwrapItems(
            List<BulkResolveRequest.BulkResolveItem> items) {
        if (items == null || items.isEmpty()) {
            return List.of();
        }
        List<BulkResolveItem> out = new ArrayList<>(items.size());
        for (BulkResolveRequest.BulkResolveItem in : items) {
            if (in == null) continue;
            out.add(new BulkResolveItem(
                in.type(),
                in.serviceName(),
                in.operationName(),
                in.sourceElementId(),
                in.targetElementId(),
                in.targetElementLogicalName(),
                in.payload()));
        }
        return out;
    }

    /**
     * Optional fallback when ResourceNotFoundException happens inside this
     * controller's transactional boundary. The GlobalExceptionHandler maps
     * this to a 404 in production deployments; included here for parity with
     * the existing controller's resolution-not-found semantics.
     */
    @SuppressWarnings("unused")
    private static ResponseEntity<Object> notFound(ResourceNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(ex.getMessage());
    }
}
