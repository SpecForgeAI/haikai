package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.migration.ContractFormat;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.OasWsdlParseResult;
import com.example.architecturemodel.model.dto.migration.OasWsdlParsedOperation;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import com.example.architecturemodel.service.ProjectArtifactService;
import com.example.architecturemodel.service.migration.MissingInputResolutionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Orchestrates the OAS / WSDL parse-then-match flow for the bulk-resolve
 * parse-files endpoint.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Two entry points:</p>
 * <ul>
 *   <li>{@link #ingestPreview(UUID, List)} -- parses + classifies every
 *       operation in every file without writing anything. Returns the
 *       per-file + per-operation status block the controller wraps into the
 *       response.</li>
 *   <li>{@link #ingestCommit(UUID, List, String)} -- runs the same parse +
 *       classify pass and, on the matched-and-not-already-resolved subset,
 *       persists one {@code project_artifact} row per parsed file plus one
 *       {@code missing_input_resolutions} row per matched operation. The
 *       persist-stage runs inside one {@code @Transactional} method so a
 *       mid-commit failure rolls back ALL artefact + resolution writes (no
 *       partial commits).</li>
 * </ul>
 *
 * <h2>Per-file file-status flow</h2>
 * <ul>
 *   <li>{@link FileStatus#FAILED} -- format unknown OR underlying parser
 *       threw; the file's {@code failureReason} carries the diagnostic and
 *       sibling files in the same batch keep going.</li>
 *   <li>{@link FileStatus#PARSED} -- parser ran cleanly; operations may be
 *       empty (the endpoint surfaces that as the "yellow info row" -- NOT a
 *       failure).</li>
 * </ul>
 *
 * <h2>Per-operation classification</h2>
 * <ul>
 *   <li>{@link OperationStatus#MATCHED} -- key intersects with at least one
 *       project-scoped spec whose status is {@code insufficient_context} and
 *       no active resolution row exists for the {@code (projectId, key)}
 *       tuple. On commit this operation gets one new resolution row.</li>
 *   <li>{@link OperationStatus#ALREADY_RESOLVED} -- an active
 *       {@code missing_input_resolutions} row already exists for the
 *       {@code (projectId, key)} tuple; the row's id is surfaced so the UI
 *       can deep-link to the side panel.</li>
 *   <li>{@link OperationStatus#NO_MATCH} -- the key did not intersect with
 *       any project-scoped {@code insufficient_context} spec; nothing to do
 *       (no commit on this operation).</li>
 * </ul>
 *
 * <h2>Service-name resolution order</h2>
 * <ol>
 *   <li>The per-file {@link FileEntry#userOverrideServiceName()} when
 *       non-null and non-blank;</li>
 *   <li>otherwise the parser-suggested name
 *       ({@link OasWsdlParseResult#suggestedServiceName()});</li>
 *   <li>otherwise the literal string {@code "unknown"} (last-resort fallback
 *       so the hash is still deterministic).</li>
 * </ol>
 *
 * <h2>Hash key derivation</h2>
 * For every operation we feed {@code (resolvedServiceName, operation.identifier)}
 * through {@link MissingInputKeyHasher#canonicalDescriptorForApiContract} +
 * {@link MissingInputKeyHasher#computeKey} so OAS/WSDL-parsed keys are
 * byte-identical to manual-entry keys created via the bulk-resolve modal.
 *
 * <h2>Transactional posture</h2>
 * {@link #ingestPreview(UUID, List)} carries no {@code @Transactional} (we
 * never write) and runs read-only repository queries. {@link
 * #ingestCommit(UUID, List, String)} is wrapped in a single
 * {@code @Transactional} so a duplicate-key collision (e.g., a sibling
 * already-resolved row appearing mid-batch) rolls every artefact + resolution
 * write back together. The {@code MissingInputResolutionService.createWithSource}
 * call participates in that surrounding transaction.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class OasWsdlContractIngestService {

    /**
     * Last-resort fallback service name when neither a user override nor a
     * parser-suggested {@code info.title}/{@code <service name>} is available.
     * Used so the hash key is still deterministic for empty-service files;
     * the caller can re-upload with an explicit override if the resulting
     * key did not match.
     */
    public static final String FALLBACK_SERVICE_NAME = "unknown";

    /**
     * Reason string stamped on {@link FileStatus#FAILED} files whose
     * detector returned {@link ContractFormat#UNKNOWN}. Echoed verbatim in
     * the endpoint response so the frontend can map to UI copy.
     */
    public static final String REASON_UNRECOGNISED_FORMAT = "unrecognised_contract_format";

    private final ContractFormatDetector detector;
    private final OasWsdlParserService parserService;
    private final MissingInputKeyHasher hasher;
    private final MissingInputResolutionRepository resolutionRepository;
    private final MigrationStorySpecGenerationRepository specRepository;
    private final MissingInputResolutionService resolutionService;
    private final ProjectArtifactService projectArtifactService;

    /**
     * Preview mode: parse + classify without persisting anything.
     */
    public ContractIngestResult ingestPreview(UUID projectId, List<FileEntry> files) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (files == null) {
            return new ContractIngestResult(List.of(), 0, 0, true);
        }
        return runIngest(projectId, files, /* commit */ false, /* resolvedBy */ null);
    }

    /**
     * Commit mode: parse + classify + persist {@code project_artifact} rows
     * and {@code missing_input_resolutions} rows in one transaction.
     */
    @Transactional
    public ContractIngestResult ingestCommit(UUID projectId, List<FileEntry> files, String resolvedBy) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (resolvedBy == null || resolvedBy.isBlank()) {
            throw new IllegalArgumentException("resolvedBy is required on commit");
        }
        if (files == null) {
            return new ContractIngestResult(List.of(), 0, 0, false);
        }
        return runIngest(projectId, files, /* commit */ true, resolvedBy);
    }

    // -----------------------------------------------------------------------
    // Core orchestration
    // -----------------------------------------------------------------------

    private ContractIngestResult runIngest(
            UUID projectId,
            List<FileEntry> files,
            boolean commit,
            String resolvedBy) {

        // Step 1 - parse pass (no writes either branch).
        List<FileParseStage> stages = new ArrayList<>(files.size());
        for (FileEntry entry : files) {
            if (entry == null) {
                continue;
            }
            FileParseStage stage = parseOne(entry);
            stages.add(stage);
        }

        // Step 2 - cross-reference index: build project-scoped key -> spec-id
        // map for every insufficient_context spec, plus a key -> existing
        // resolution-id map for every active resolution. Both queries run
        // ONCE per batch so a 100-operation upload doesn't hammer the DB.
        Map<String, List<UUID>> keyToAffectedSpecIds =
            buildKeyToSpecIndex(projectId);
        Map<String, UUID> keyToExistingResolutionId =
            buildKeyToExistingResolutionIndex(projectId);

        // Step 3 - classify every operation in every successfully-parsed
        // file. Stages with FAILED status produce zero operations.
        for (FileParseStage stage : stages) {
            if (stage.fileStatus != FileStatus.PARSED) {
                continue;
            }
            classifyOperations(stage, keyToAffectedSpecIds, keyToExistingResolutionId);
        }

        // Step 4 - on commit, persist ProjectArtifact rows + resolution
        // rows in this same transaction. Stage carries its own
        // projectArtifactId so the per-resolution stamp uses the right
        // artefact id.
        int totalNewResolutions = 0;
        int totalMatchedSpecs;
        if (commit) {
            for (FileParseStage stage : stages) {
                if (stage.fileStatus != FileStatus.PARSED) {
                    continue;
                }
                // Persist artefact ONLY if the file has at least one
                // operation that will produce a resolution row. Empty
                // files and all-no_match files don't get an artefact.
                boolean willCreateAny = stage.operations.stream()
                    .anyMatch(o -> o.status == OperationStatus.MATCHED);
                if (willCreateAny) {
                    UUID artifactId = persistArtifact(projectId, stage);
                    stage.projectArtifactId = artifactId;
                }
                for (OperationStage op : stage.operations) {
                    if (op.status != OperationStatus.MATCHED) {
                        continue;
                    }
                    persistResolution(projectId, stage, op, resolvedBy);
                    totalNewResolutions++;
                }
            }
        } else {
            for (FileParseStage stage : stages) {
                if (stage.fileStatus != FileStatus.PARSED) {
                    continue;
                }
                for (OperationStage op : stage.operations) {
                    if (op.status == OperationStatus.MATCHED) {
                        totalNewResolutions++;
                    }
                }
            }
        }

        // Step 5 - compute total affected-spec count (distinct spec ids
        // across every MATCHED operation in every file).
        Set<UUID> distinctSpecs = new LinkedHashSet<>();
        for (FileParseStage stage : stages) {
            if (stage.fileStatus != FileStatus.PARSED) continue;
            for (OperationStage op : stage.operations) {
                if (op.status == OperationStatus.MATCHED && op.matchedSpecIds != null) {
                    distinctSpecs.addAll(op.matchedSpecIds);
                }
            }
        }
        totalMatchedSpecs = distinctSpecs.size();

        // Step 6 - flatten stages -> response DTOs.
        List<FileResult> fileResults = new ArrayList<>(stages.size());
        for (FileParseStage stage : stages) {
            fileResults.add(stage.toFileResult());
        }

        log.info(
            "[diag-ams] oas_wsdl_ingest projectId={} files={} commit={} newResolutions={} matchedSpecs={}",
            shortPrefix(projectId), fileResults.size(), commit,
            totalNewResolutions, totalMatchedSpecs);

        return new ContractIngestResult(
            fileResults,
            totalNewResolutions,
            totalMatchedSpecs,
            !commit);
    }

    // -----------------------------------------------------------------------
    // Per-file parse stage
    // -----------------------------------------------------------------------

    private FileParseStage parseOne(FileEntry entry) {
        FileParseStage stage = new FileParseStage();
        stage.fileName = entry.fileName();
        stage.fileBytes = entry.fileBytes();
        stage.fileSize = entry.fileBytes() == null ? 0L : (long) entry.fileBytes().length;
        stage.suggestedServiceName = entry.suggestedServiceName();
        stage.userOverrideServiceName = entry.userOverrideServiceName();

        // Pre-empt empty / null files with a synthetic FAILED stage rather
        // than running through the detector for byte-zero input.
        if (entry.fileBytes() == null || entry.fileBytes().length == 0) {
            stage.fileStatus = FileStatus.FAILED;
            stage.failureReason = REASON_UNRECOGNISED_FORMAT;
            stage.format = ContractFormat.UNKNOWN;
            stage.operations = new ArrayList<>();
            return stage;
        }

        ContractFormat detected = detector.detect(entry.fileBytes());
        stage.format = detected;

        if (detected == ContractFormat.UNKNOWN) {
            stage.fileStatus = FileStatus.FAILED;
            stage.failureReason = REASON_UNRECOGNISED_FORMAT;
            stage.operations = new ArrayList<>();
            return stage;
        }

        OasWsdlParseResult parseResult = parserService.parse(
            entry.fileBytes(), detected, entry.fileName(), stage.fileSize);

        if (parseResult.status() == OasWsdlParseResult.Status.FAILED) {
            stage.fileStatus = FileStatus.FAILED;
            stage.failureReason = parseResult.failureReason();
            stage.operations = new ArrayList<>();
            return stage;
        }

        stage.fileStatus = FileStatus.PARSED;
        stage.failureReason = null;
        // Suggested name -- preserve caller-supplied suggestion if the
        // FileEntry already carried one; otherwise take the parser's.
        if (stage.suggestedServiceName == null || stage.suggestedServiceName.isBlank()) {
            stage.suggestedServiceName = parseResult.suggestedServiceName();
        }
        stage.parsedOperations = parseResult.operations() == null
            ? Collections.emptyList()
            : parseResult.operations();
        stage.operations = new ArrayList<>(stage.parsedOperations.size());
        return stage;
    }

    private String resolveServiceName(FileParseStage stage) {
        if (stage.userOverrideServiceName != null && !stage.userOverrideServiceName.isBlank()) {
            return stage.userOverrideServiceName;
        }
        if (stage.suggestedServiceName != null && !stage.suggestedServiceName.isBlank()) {
            return stage.suggestedServiceName;
        }
        return FALLBACK_SERVICE_NAME;
    }

    // -----------------------------------------------------------------------
    // Classification
    // -----------------------------------------------------------------------

    private void classifyOperations(
            FileParseStage stage,
            Map<String, List<UUID>> keyToAffectedSpecIds,
            Map<String, UUID> keyToExistingResolutionId) {
        String serviceName = resolveServiceName(stage);
        stage.finalServiceName = serviceName;
        List<OperationStage> classified = new ArrayList<>(stage.parsedOperations.size());
        for (OasWsdlParsedOperation parsedOp : stage.parsedOperations) {
            if (parsedOp == null || parsedOp.identifier() == null) {
                continue;
            }
            String identifier = parsedOp.identifier();
            String descriptor = hasher.canonicalDescriptorForApiContract(
                serviceName, identifier);
            String key = hasher.computeKey(
                MissingInputResolutionService.TYPE_API_CONTRACT, descriptor);

            OperationStage op = new OperationStage();
            op.identifier = identifier;
            op.missingInputKey = key;

            UUID existingResolutionId = keyToExistingResolutionId.get(key);
            if (existingResolutionId != null) {
                op.status = OperationStatus.ALREADY_RESOLVED;
                op.existingResolutionId = existingResolutionId;
                op.matchedSpecIds = List.of();
            } else {
                List<UUID> affected = keyToAffectedSpecIds.get(key);
                if (affected != null && !affected.isEmpty()) {
                    op.status = OperationStatus.MATCHED;
                    op.matchedSpecIds = Collections.unmodifiableList(new ArrayList<>(affected));
                } else {
                    op.status = OperationStatus.NO_MATCH;
                    op.matchedSpecIds = List.of();
                }
            }
            classified.add(op);
        }
        stage.operations = classified;
    }

    private Map<String, List<UUID>> buildKeyToSpecIndex(UUID projectId) {
        List<MigrationStorySpecGenerationEntity> projectSpecs =
            specRepository.findByProjectId(projectId);
        Map<String, List<UUID>> out = new LinkedHashMap<>();
        if (projectSpecs == null) {
            return out;
        }
        for (MigrationStorySpecGenerationEntity spec : projectSpecs) {
            if (spec == null) continue;
            if (!MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT
                    .equals(spec.getStatus())) {
                continue;
            }
            List<String> keys = spec.getMissingInputKeysJson();
            if (keys == null || keys.isEmpty()) continue;
            for (String k : keys) {
                if (k == null) continue;
                out.computeIfAbsent(k, kk -> new ArrayList<>()).add(spec.getId());
            }
        }
        return out;
    }

    private Map<String, UUID> buildKeyToExistingResolutionIndex(UUID projectId) {
        List<MissingInputResolutionEntity> rows =
            resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId);
        Map<String, UUID> out = new LinkedHashMap<>();
        if (rows == null) {
            return out;
        }
        for (MissingInputResolutionEntity row : rows) {
            if (row == null || row.getMissingInputKey() == null) continue;
            out.putIfAbsent(row.getMissingInputKey(), row.getId());
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Persistence helpers
    // -----------------------------------------------------------------------

    private UUID persistArtifact(UUID projectId, FileParseStage stage) {
        String content = stage.fileBytes == null
            ? ""
            : new String(stage.fileBytes, StandardCharsets.UTF_8);
        ProjectArtifactDto dto = new ProjectArtifactDto(
            /* id */ null,
            projectId,
            ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD,
            content,
            /* source */ "TOOL",
            /* revision */ null,
            /* createdAt */ null);
        ProjectArtifactDto saved = projectArtifactService.createArtifact(
            projectId,
            ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD,
            dto);
        return saved.id();
    }

    private void persistResolution(
            UUID projectId,
            FileParseStage stage,
            OperationStage op,
            String resolvedBy) {
        MissingInputResolutionCreateRequest req = new MissingInputResolutionCreateRequest(
            /* missingInputKey */ op.missingInputKey,
            MissingInputResolutionService.TYPE_API_CONTRACT,
            /* canonicalDescriptor */ null,
            /* serviceName */ stage.finalServiceName,
            /* operationName */ op.identifier,
            /* sourceElementId */ null,
            /* targetElementId */ null,
            /* targetElementLogicalName */ null,
            /* payload */ buildResolutionPayload(stage),
            resolvedBy);
        resolutionService.createWithSource(
            projectId, req,
            MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD,
            stage.projectArtifactId);
    }

    private static Map<String, Object> buildResolutionPayload(FileParseStage stage) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (stage.fileName != null) payload.put("filename", stage.fileName);
        if (stage.format != null) payload.put("format", stage.format.name().toLowerCase());
        if (stage.projectArtifactId != null) payload.put("projectArtifactId",
            stage.projectArtifactId.toString());
        return payload;
    }

    // -----------------------------------------------------------------------
    // Internal state
    // -----------------------------------------------------------------------

    private static class FileParseStage {
        String fileName;
        byte[] fileBytes;
        Long fileSize;
        ContractFormat format;
        FileStatus fileStatus;
        String failureReason;
        String suggestedServiceName;
        String userOverrideServiceName;
        String finalServiceName;
        UUID projectArtifactId;
        List<OasWsdlParsedOperation> parsedOperations = Collections.emptyList();
        List<OperationStage> operations = new ArrayList<>();

        FileResult toFileResult() {
            List<OperationResult> opResults = new ArrayList<>(operations.size());
            for (OperationStage op : operations) {
                opResults.add(new OperationResult(
                    op.identifier,
                    op.missingInputKey,
                    op.status,
                    op.matchedSpecIds == null ? List.of() : op.matchedSpecIds,
                    op.existingResolutionId));
            }
            return new FileResult(
                fileName,
                fileSize,
                format,
                fileStatus,
                failureReason,
                suggestedServiceName,
                finalServiceName == null
                    ? (userOverrideServiceName == null ? suggestedServiceName : userOverrideServiceName)
                    : finalServiceName,
                Collections.unmodifiableList(opResults));
        }
    }

    private static class OperationStage {
        String identifier;
        String missingInputKey;
        OperationStatus status;
        List<UUID> matchedSpecIds = List.of();
        UUID existingResolutionId;
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }

    // -----------------------------------------------------------------------
    // Public request / response shapes
    // -----------------------------------------------------------------------

    /**
     * Per-file input descriptor. The controller layer (Task Group 4) builds
     * one of these per multipart file part.
     *
     * @param fileName                  original multipart filename (echoed back).
     * @param fileBytes                 raw file bytes; null or empty -> the
     *                                  parse stage produces FAILED.
     * @param suggestedServiceName      caller-supplied suggestion (rare;
     *                                  normally the parser surfaces this from
     *                                  {@code info.title} / {@code <service name>}).
     * @param userOverrideServiceName   per-file override from the multipart
     *                                  request; wins over the parser-suggested
     *                                  name when non-null and non-blank.
     */
    public record FileEntry(
        String fileName,
        byte[] fileBytes,
        String suggestedServiceName,
        String userOverrideServiceName
    ) {}

    /** Per-file terminal status surfaced to the client. */
    public enum FileStatus { PARSED, FAILED }

    /** Per-operation classification. */
    public enum OperationStatus { MATCHED, ALREADY_RESOLVED, NO_MATCH }

    /**
     * Per-file result row in the response.
     */
    public record FileResult(
        String fileName,
        Long fileSize,
        ContractFormat format,
        FileStatus status,
        String failureReason,
        String suggestedServiceName,
        String finalServiceName,
        List<OperationResult> operations
    ) {}

    /**
     * Per-operation result row under each {@link FileResult}.
     */
    public record OperationResult(
        String identifier,
        String missingInputKey,
        OperationStatus status,
        List<UUID> matchedSpecIds,
        UUID existingResolutionId
    ) {}

    /**
     * Top-level response wrapping the per-file list + the summary counts.
     *
     * @param files                  per-file results.
     * @param totalNewResolutions    sum across files of operations with status
     *                               {@link OperationStatus#MATCHED}; on commit
     *                               this is also the count of rows inserted.
     * @param totalMatchedSpecs      DISTINCT count of spec-generation ids
     *                               touched by at least one matched operation
     *                               across the batch.
     * @param previewOnly            {@code true} when no writes happened; the
     *                               same value the endpoint surfaces as
     *                               {@code previewOnly} in its response.
     */
    public record ContractIngestResult(
        List<FileResult> files,
        int totalNewResolutions,
        int totalMatchedSpecs,
        boolean previewOnly
    ) {

        /** Convenience: total operations across every PARSED file. */
        public int totalOperations() {
            int count = 0;
            if (files == null) return 0;
            for (FileResult f : files) {
                if (f != null && f.operations() != null) {
                    count += f.operations().size();
                }
            }
            return count;
        }

        /** Convenience: count of operations with a given status. */
        public int countByStatus(OperationStatus status) {
            int count = 0;
            if (files == null || status == null) return 0;
            for (FileResult f : files) {
                if (f == null || f.operations() == null) continue;
                for (OperationResult op : f.operations()) {
                    if (op != null && status.equals(op.status())) count++;
                }
            }
            return count;
        }

        /** Hash-set helper for the controller's summary block. */
        public int distinctAffectedSpecCount() {
            if (files == null) return 0;
            Set<UUID> distinct = new HashSet<>();
            for (FileResult f : files) {
                if (f == null || f.operations() == null) continue;
                for (OperationResult op : f.operations()) {
                    if (op == null || op.matchedSpecIds() == null) continue;
                    if (op.status() == OperationStatus.MATCHED) {
                        distinct.addAll(op.matchedSpecIds());
                    }
                }
            }
            return distinct.size();
        }
    }
}
