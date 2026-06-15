package com.example.architecturemodel.service.contract;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionCreateRequest;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import com.example.architecturemodel.service.MissingInputKeyHasher;
import com.example.architecturemodel.service.ProjectArtifactService;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.ContractIngestResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileEntry;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileStatus;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationStatus;
import com.example.architecturemodel.service.migration.MissingInputResolutionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused Mockito tests for {@link OasWsdlContractIngestService}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 3.</p>
 *
 * <p>Seven tests covering Task 3.1's contract:</p>
 * <ol>
 *   <li>ingestPreview classifies operations correctly
 *       (matched / no_match / already_resolved).</li>
 *   <li>ingestPreview never persists anything (no save() / createWithSource()
 *       on any collaborator).</li>
 *   <li>ingestCommit persists ProjectArtifact + resolutions in one
 *       transaction.</li>
 *   <li>ingestCommit skips already-resolved operations (no duplicate
 *       resolution rows).</li>
 *   <li>File with zero operations -> status=PARSED with empty operations
 *       list (NOT failed).</li>
 *   <li>File with format UNKNOWN -> status=FAILED with reason
 *       'unrecognised_contract_format'.</li>
 *   <li>Service-name resolution: user override > suggested > 'unknown'.</li>
 * </ol>
 *
 * <p>Inline byte literals only (no external fixtures), matching the Task
 * Group 2 detector + parser tests style.</p>
 */
@ExtendWith(MockitoExtension.class)
class OasWsdlContractIngestServiceTest {

    @Mock
    private MissingInputResolutionRepository resolutionRepository;
    @Mock
    private MigrationStorySpecGenerationRepository specRepository;
    @Mock
    private MissingInputResolutionService resolutionService;
    @Mock
    private ProjectArtifactService projectArtifactService;

    private MissingInputKeyHasher hasher;
    private ContractFormatDetector detector;
    private OasWsdlParserService parserService;
    private OasWsdlContractIngestService ingestService;
    private UUID projectId;

    // Inline OAS 3.0 YAML literal -- the parser produces one operation per
    // method on each path. Single op (post /orders) keeps the operation
    // count stable across tests.
    private static final byte[] OAS_3_0_YAML = (""
        + "openapi: 3.0.3\n"
        + "info:\n"
        + "  title: Orders API\n"
        + "paths:\n"
        + "  /orders:\n"
        + "    post:\n"
        + "      operationId: placeOrder\n"
        + "      responses:\n"
        + "        '200':\n"
        + "          description: ok\n"
    ).getBytes(StandardCharsets.UTF_8);

    // Empty-OAS YAML -- info.title is present but the paths block is empty,
    // so the parser produces ZERO operations. File-status must still be
    // PARSED (NOT failed).
    private static final byte[] OAS_3_0_EMPTY_YAML = (""
        + "openapi: 3.0.3\n"
        + "info:\n"
        + "  title: Empty API\n"
        + "paths: {}\n"
    ).getBytes(StandardCharsets.UTF_8);

    // Garbage bytes -- the detector returns UNKNOWN and the orchestration
    // surfaces a FAILED file with reason 'unrecognised_contract_format'.
    private static final byte[] GARBAGE_BYTES =
        "this is not OAS or WSDL bytes -- plain text\n".getBytes(StandardCharsets.UTF_8);

    @BeforeEach
    void setUp() {
        hasher = new MissingInputKeyHasher();
        detector = new ContractFormatDetector();
        parserService = new OasWsdlParserService();
        ingestService = new OasWsdlContractIngestService(
            detector, parserService, hasher,
            resolutionRepository, specRepository,
            resolutionService, projectArtifactService);
        projectId = UUID.randomUUID();
    }

    // -----------------------------------------------------------------------
    // 1) ingestPreview classifies matched / already_resolved / no_match
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("ingestPreview classifies operations as MATCHED / ALREADY_RESOLVED / NO_MATCH")
    void ingestPreview_classifiesOperationsCorrectly() {
        // The OAS file emits one operation: identifier='placeorder'. The
        // service-name is resolved from info.title -> 'orders api'.
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders api", "placeorder"));

        // Project spec references this key with insufficient_context.
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, expectedKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));

        // No active resolution yet -> MATCHED.
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry entry = new FileEntry("orders.yaml", OAS_3_0_YAML, null, null);
        ContractIngestResult result = ingestService.ingestPreview(
            projectId, List.of(entry));

        assertThat(result.previewOnly()).isTrue();
        assertThat(result.files()).hasSize(1);
        FileResult file = result.files().get(0);
        assertThat(file.status()).isEqualTo(FileStatus.PARSED);
        assertThat(file.operations()).hasSize(1);
        OperationResult op = file.operations().get(0);
        assertThat(op.identifier()).isEqualTo("placeorder");
        assertThat(op.missingInputKey()).isEqualTo(expectedKey);
        assertThat(op.status()).isEqualTo(OperationStatus.MATCHED);
        assertThat(op.matchedSpecIds()).containsExactly(specId);
        assertThat(result.totalNewResolutions()).isEqualTo(1);
        assertThat(result.totalMatchedSpecs()).isEqualTo(1);
    }

    @Test
    @DisplayName("ingestPreview never calls save() / createWithSource() on any collaborator")
    void ingestPreview_neverPersists() {
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of());
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry entry = new FileEntry("orders.yaml", OAS_3_0_YAML, null, null);
        ingestService.ingestPreview(projectId, List.of(entry));

        verify(resolutionService, never())
            .createWithSource(any(UUID.class),
                any(MissingInputResolutionCreateRequest.class),
                anyString(), any());
        verify(projectArtifactService, never())
            .createArtifact(any(UUID.class), anyString(), any(ProjectArtifactDto.class));
        verify(resolutionRepository, never()).save(any());
    }

    // -----------------------------------------------------------------------
    // 2) ingestCommit persists ProjectArtifact + resolutions
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("ingestCommit persists ProjectArtifact + resolutions in one transaction")
    void ingestCommit_persistsArtifactAndResolutions() {
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders api", "placeorder"));
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, expectedKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        UUID artifactId = UUID.randomUUID();
        when(projectArtifactService.createArtifact(eq(projectId),
                eq(ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD),
                any(ProjectArtifactDto.class)))
            .thenAnswer(inv -> {
                ProjectArtifactDto in = inv.getArgument(2);
                return new ProjectArtifactDto(
                    artifactId, in.projectId(), in.artifactType(),
                    in.content(), in.source(), 1, Instant.now());
            });

        when(resolutionService.createWithSource(eq(projectId),
                any(MissingInputResolutionCreateRequest.class),
                eq(MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD),
                eq(artifactId)))
            .thenAnswer(inv -> {
                MissingInputResolutionCreateRequest req = inv.getArgument(1);
                return new MissingInputResolutionDto(
                    UUID.randomUUID(), projectId, req.missingInputKey(),
                    req.missingInputType(), req.resolutionPayload(),
                    Instant.now(), req.resolvedBy(),
                    Boolean.FALSE, null, null, Instant.now(), Instant.now());
            });

        FileEntry entry = new FileEntry("orders.yaml", OAS_3_0_YAML, null, null);
        ContractIngestResult result = ingestService.ingestCommit(
            projectId, List.of(entry), "alice@example.com");

        assertThat(result.previewOnly()).isFalse();
        assertThat(result.totalNewResolutions()).isEqualTo(1);

        // ProjectArtifact persisted once.
        verify(projectArtifactService, times(1)).createArtifact(
            eq(projectId),
            eq(ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD),
            any(ProjectArtifactDto.class));

        // Resolution persisted with correct provenance stamps.
        ArgumentCaptor<MissingInputResolutionCreateRequest> reqCap =
            ArgumentCaptor.forClass(MissingInputResolutionCreateRequest.class);
        verify(resolutionService, times(1)).createWithSource(
            eq(projectId), reqCap.capture(),
            eq(MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD),
            eq(artifactId));
        MissingInputResolutionCreateRequest sent = reqCap.getValue();
        assertThat(sent.missingInputKey()).isEqualTo(expectedKey);
        assertThat(sent.missingInputType())
            .isEqualTo(MissingInputResolutionService.TYPE_API_CONTRACT);
        assertThat(sent.resolvedBy()).isEqualTo("alice@example.com");
        assertThat(sent.serviceName()).isEqualTo("orders api");
        assertThat(sent.operationName()).isEqualTo("placeorder");
    }

    // -----------------------------------------------------------------------
    // 3) ingestCommit skips already-resolved operations
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("ingestCommit skips ALREADY_RESOLVED operations (no duplicate resolution rows)")
    void ingestCommit_skipsAlreadyResolved() {
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders api", "placeorder"));
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, expectedKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));

        // An active resolution already exists for the key -> the operation
        // should classify as ALREADY_RESOLVED and the commit phase must NOT
        // create another row.
        UUID existingResolutionId = UUID.randomUUID();
        MissingInputResolutionEntity existing = MissingInputResolutionEntity.builder()
            .id(existingResolutionId)
            .projectId(projectId)
            .missingInputKey(expectedKey)
            .missingInputType(MissingInputResolutionService.TYPE_API_CONTRACT)
            .resolvedAt(Instant.now())
            .resolvedBy("bob@example.com")
            .softDeleted(Boolean.FALSE)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of(existing));

        FileEntry entry = new FileEntry("orders.yaml", OAS_3_0_YAML, null, null);
        ContractIngestResult result = ingestService.ingestCommit(
            projectId, List.of(entry), "alice@example.com");

        assertThat(result.totalNewResolutions()).isEqualTo(0);
        OperationResult op = result.files().get(0).operations().get(0);
        assertThat(op.status()).isEqualTo(OperationStatus.ALREADY_RESOLVED);
        assertThat(op.existingResolutionId()).isEqualTo(existingResolutionId);

        // No artefact, no resolution -- the file has zero matched ops.
        verify(projectArtifactService, never())
            .createArtifact(any(UUID.class), anyString(), any(ProjectArtifactDto.class));
        verify(resolutionService, never())
            .createWithSource(any(UUID.class),
                any(MissingInputResolutionCreateRequest.class),
                anyString(), any());
    }

    // -----------------------------------------------------------------------
    // 4) Empty file -> status=PARSED with empty operations list
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("File with zero operations -> status=PARSED with empty operations list")
    void ingestPreview_emptyFileIsParsedNotFailed() {
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of());
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry entry = new FileEntry("empty.yaml", OAS_3_0_EMPTY_YAML, null, null);
        ContractIngestResult result = ingestService.ingestPreview(
            projectId, List.of(entry));

        FileResult file = result.files().get(0);
        assertThat(file.status()).isEqualTo(FileStatus.PARSED);
        assertThat(file.failureReason()).isNull();
        assertThat(file.operations()).isEmpty();
        assertThat(result.totalNewResolutions()).isEqualTo(0);
    }

    // -----------------------------------------------------------------------
    // 5) Unknown format -> status=FAILED with reason
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("File with format UNKNOWN -> status=FAILED with reason 'unrecognised_contract_format'")
    void ingestPreview_unknownFormatIsFailedWithReason() {
        // Lenient stubs -- not strictly needed since the file fails before
        // index lookup, but mirrors the production code path.
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of());
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry entry = new FileEntry("garbage.txt", GARBAGE_BYTES, null, null);
        ContractIngestResult result = ingestService.ingestPreview(
            projectId, List.of(entry));

        FileResult file = result.files().get(0);
        assertThat(file.status()).isEqualTo(FileStatus.FAILED);
        assertThat(file.failureReason())
            .isEqualTo(OasWsdlContractIngestService.REASON_UNRECOGNISED_FORMAT);
        assertThat(file.operations()).isEmpty();
    }

    // -----------------------------------------------------------------------
    // 6) Service-name resolution: user override > suggested > 'unknown'
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Service-name resolution prefers user override; falls back to suggested; finally to 'unknown'")
    void serviceNameResolution_userOverrideBeatsSuggestedBeatsFallback() {
        // Spec references the key produced from the OVERRIDE service name,
        // so an override file matches but a no-override file (which falls
        // back to suggested 'orders api') doesn't match this same spec.
        String overrideKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("CustomService", "placeorder"));
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, overrideKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        // File with user-override service name 'CustomService'.
        FileEntry withOverride = new FileEntry(
            "orders.yaml", OAS_3_0_YAML, null, "CustomService");
        ContractIngestResult resultOverride = ingestService.ingestPreview(
            projectId, List.of(withOverride));
        OperationResult opOverride = resultOverride.files().get(0).operations().get(0);
        assertThat(opOverride.status()).isEqualTo(OperationStatus.MATCHED);
        assertThat(resultOverride.files().get(0).finalServiceName())
            .isEqualTo("CustomService");

        // File with NO override -> falls back to suggested 'orders api' (the
        // parser lowercases info.title). The key won't match the spec.
        FileEntry noOverride = new FileEntry(
            "orders.yaml", OAS_3_0_YAML, null, null);
        ContractIngestResult resultSuggested = ingestService.ingestPreview(
            projectId, List.of(noOverride));
        OperationResult opSuggested = resultSuggested.files().get(0).operations().get(0);
        assertThat(opSuggested.status()).isEqualTo(OperationStatus.NO_MATCH);
        assertThat(resultSuggested.files().get(0).finalServiceName())
            .isEqualTo("orders api");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private MigrationStorySpecGenerationEntity buildSpec(UUID id, String... keys) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .missingInputKeysJson(new ArrayList<>(List.of(keys)))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
