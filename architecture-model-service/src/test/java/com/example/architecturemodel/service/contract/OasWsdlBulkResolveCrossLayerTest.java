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
 * Cross-layer strategic tests for the bulk-resolve OAS/WSDL parser flow.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 8.</p>
 *
 * <p>These tests fill genuine cross-layer gaps NOT covered by the per-layer
 * focused tests in Task Groups 1-7. They wire the real {@link
 * ContractFormatDetector} + {@link OasWsdlParserService} + {@link
 * OasWsdlContractIngestService} together (only the persistence adapters are
 * mocked) so the parse -> detect -> classify -> commit pipeline is exercised
 * end-to-end inside one JVM.</p>
 *
 * <p>Five tests, each closing a documented coverage gap:</p>
 * <ol>
 *   <li>End-to-end OAS preview -> commit happy path: every matched op produces
 *       a resolution row, summary counts line up, willCreateResolutions ==
 *       totalMatchedOperations.</li>
 *   <li>Idempotent re-upload: uploading the same OAS file TWICE in commit mode
 *       never creates a duplicate resolution row (the second pass classifies
 *       everything as ALREADY_RESOLVED).</li>
 *   <li>Per-file service-name override differentiation: two files with the
 *       SAME identifier but DIFFERENT user overrides produce DIFFERENT hash
 *       keys (file-A matches spec-A, file-B matches spec-B).</li>
 *   <li>Mixed-format batch sibling isolation: one OAS + one WSDL 1.1 + one
 *       malformed file in one upload -- two PARSED + one FAILED, the malformed
 *       file's failure does not abort the WSDL/OAS pipeline.</li>
 *   <li>WSDL 1.1 end-to-end commit: WSDL 1.1 file goes through detect -> parse
 *       -> classify -> commit and persists one resolution + one artefact.
 *       (Existing WSDL test only exercises preview classification.)</li>
 * </ol>
 *
 * <p>All five tests use the REAL parser + detector so they cover library
 * integration; only the database-layer collaborators are mocked. Inline byte
 * literals only (no fixtures on disk).</p>
 */
@ExtendWith(MockitoExtension.class)
class OasWsdlBulkResolveCrossLayerTest {

    @Mock private MissingInputResolutionRepository resolutionRepository;
    @Mock private MigrationStorySpecGenerationRepository specRepository;
    @Mock private MissingInputResolutionService resolutionService;
    @Mock private ProjectArtifactService projectArtifactService;

    private MissingInputKeyHasher hasher;
    private ContractFormatDetector detector;
    private OasWsdlParserService parserService;
    private OasWsdlContractIngestService ingestService;
    private UUID projectId;

    /** Minimal OAS 3.0 YAML -- one operation: placeOrder. */
    private static final byte[] OAS_PLACEORDER = (""
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

    /** Minimal WSDL 1.1 -- one operation: cancelOrder under PaymentsService. */
    private static final byte[] WSDL_11_CANCELORDER = (""
        + "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        + "<wsdl:definitions"
        + "    xmlns:wsdl=\"http://schemas.xmlsoap.org/wsdl/\""
        + "    xmlns:soap=\"http://schemas.xmlsoap.org/wsdl/soap/\""
        + "    xmlns:tns=\"http://example.com/payments\""
        + "    targetNamespace=\"http://example.com/payments\">"
        + "  <wsdl:message name=\"EmptyIn\"/>"
        + "  <wsdl:message name=\"EmptyOut\"/>"
        + "  <wsdl:portType name=\"PaymentsPortType\">"
        + "    <wsdl:operation name=\"CancelOrder\">"
        + "      <wsdl:input message=\"tns:EmptyIn\"/>"
        + "      <wsdl:output message=\"tns:EmptyOut\"/>"
        + "    </wsdl:operation>"
        + "  </wsdl:portType>"
        + "  <wsdl:binding name=\"PaymentsBinding\" type=\"tns:PaymentsPortType\">"
        + "    <soap:binding transport=\"http://schemas.xmlsoap.org/soap/http\"/>"
        + "    <wsdl:operation name=\"CancelOrder\">"
        + "      <soap:operation soapAction=\"cancelOrder\"/>"
        + "      <wsdl:input><soap:body use=\"literal\"/></wsdl:input>"
        + "      <wsdl:output><soap:body use=\"literal\"/></wsdl:output>"
        + "    </wsdl:operation>"
        + "  </wsdl:binding>"
        + "  <wsdl:service name=\"PaymentsService\">"
        + "    <wsdl:port name=\"PaymentsPort\" binding=\"tns:PaymentsBinding\">"
        + "      <soap:address location=\"http://example.com/payments\"/>"
        + "    </wsdl:port>"
        + "  </wsdl:service>"
        + "</wsdl:definitions>"
    ).getBytes(StandardCharsets.UTF_8);

    /** Plain text bytes that the detector returns UNKNOWN for. */
    private static final byte[] MALFORMED =
        "this is not a contract file at all\n".getBytes(StandardCharsets.UTF_8);

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
    // 1) End-to-end OAS preview -> commit happy path
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: OAS preview -> commit happy path produces one resolution + one artefact")
    void oasPreviewThenCommit_producesOneResolutionAndOneArtefact() {
        // Spec key: the OAS file emits 'placeorder' under suggested service
        // name 'orders api' (info.title lowercased).
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders api", "placeorder"));
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, expectedKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        // Preview first.
        FileEntry entry = new FileEntry("orders.yaml", OAS_PLACEORDER, null, null);
        ContractIngestResult preview = ingestService.ingestPreview(
            projectId, List.of(entry));

        assertThat(preview.previewOnly()).isTrue();
        assertThat(preview.totalNewResolutions()).isEqualTo(1);
        assertThat(preview.files()).hasSize(1);
        assertThat(preview.files().get(0).status()).isEqualTo(FileStatus.PARSED);
        OperationResult previewOp = preview.files().get(0).operations().get(0);
        assertThat(previewOp.status()).isEqualTo(OperationStatus.MATCHED);
        assertThat(previewOp.missingInputKey()).isEqualTo(expectedKey);

        // Preview must NOT have persisted anything.
        verify(projectArtifactService, never())
            .createArtifact(any(UUID.class), anyString(), any(ProjectArtifactDto.class));
        verify(resolutionService, never())
            .createWithSource(any(UUID.class),
                any(MissingInputResolutionCreateRequest.class),
                anyString(), any());

        // Now commit. Spec + resolution-list lookups still return the same
        // preview-stage shape (no resolution yet -> matched).
        UUID artifactId = UUID.randomUUID();
        stubArtifactCreate(artifactId);
        stubResolutionCreate();

        ContractIngestResult commit = ingestService.ingestCommit(
            projectId, List.of(entry), "alice@example.com");

        assertThat(commit.previewOnly()).isFalse();
        assertThat(commit.totalNewResolutions()).isEqualTo(1);
        assertThat(commit.totalMatchedSpecs()).isEqualTo(1);

        // Exactly one artefact + one resolution persisted on commit.
        verify(projectArtifactService, times(1)).createArtifact(
            eq(projectId),
            eq(ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD),
            any(ProjectArtifactDto.class));
        verify(resolutionService, times(1)).createWithSource(
            eq(projectId), any(MissingInputResolutionCreateRequest.class),
            eq(MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD),
            eq(artifactId));
    }

    // -----------------------------------------------------------------------
    // 2) Idempotent re-upload: second commit creates no duplicate row
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: re-uploading the same OAS file in commit mode is idempotent (no duplicate row)")
    void reUploadingSameOas_isIdempotent() {
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders api", "placeorder"));
        UUID specId = UUID.randomUUID();
        MigrationStorySpecGenerationEntity spec = buildSpec(specId, expectedKey);
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(spec));

        // Second-pass lookup returns the resolution already created by the
        // first commit. The service must then classify the same op as
        // ALREADY_RESOLVED and write nothing.
        UUID existingResolutionId = UUID.randomUUID();
        MissingInputResolutionEntity existing = MissingInputResolutionEntity.builder()
            .id(existingResolutionId)
            .projectId(projectId)
            .missingInputKey(expectedKey)
            .missingInputType(MissingInputResolutionService.TYPE_API_CONTRACT)
            .resolvedAt(Instant.now())
            .resolvedBy("alice@example.com")
            .softDeleted(Boolean.FALSE)
            .build();
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of(existing));

        FileEntry entry = new FileEntry("orders.yaml", OAS_PLACEORDER, null, null);
        ContractIngestResult result = ingestService.ingestCommit(
            projectId, List.of(entry), "alice@example.com");

        // Zero new resolutions, op classified as ALREADY_RESOLVED.
        assertThat(result.totalNewResolutions()).isEqualTo(0);
        OperationResult op = result.files().get(0).operations().get(0);
        assertThat(op.status()).isEqualTo(OperationStatus.ALREADY_RESOLVED);
        assertThat(op.existingResolutionId()).isEqualTo(existingResolutionId);

        // CRITICAL: neither artefact nor resolution persisted on the
        // second commit pass. This is what makes the upload idempotent.
        verify(projectArtifactService, never())
            .createArtifact(any(UUID.class), anyString(), any(ProjectArtifactDto.class));
        verify(resolutionService, never())
            .createWithSource(any(UUID.class),
                any(MissingInputResolutionCreateRequest.class),
                anyString(), any());
    }

    // -----------------------------------------------------------------------
    // 3) Per-file service-name override differentiation
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: two files with DIFFERENT overrides produce DIFFERENT hash keys")
    void perFileServiceNameOverride_producesDifferentKeys() {
        // Two specs, each keyed by a different service-name+identifier hash.
        // 'orders-svc' service-name override applied to file A; 'payments-svc'
        // applied to file B. Both files carry the SAME operation identifier
        // ('placeorder') so any cross-contamination would surface as the
        // wrong file matching the wrong spec.
        String keyA = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("orders-svc", "placeorder"));
        String keyB = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("payments-svc", "placeorder"));
        // Sanity: per-file override differentiation is meaningless if the
        // two hash keys collide.
        assertThat(keyA).isNotEqualTo(keyB);

        UUID specAId = UUID.randomUUID();
        UUID specBId = UUID.randomUUID();
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of(
            buildSpec(specAId, keyA),
            buildSpec(specBId, keyB)));
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry fileA = new FileEntry("orders.yaml", OAS_PLACEORDER, null, "orders-svc");
        FileEntry fileB = new FileEntry("payments.yaml", OAS_PLACEORDER, null, "payments-svc");
        ContractIngestResult preview = ingestService.ingestPreview(
            projectId, List.of(fileA, fileB));

        assertThat(preview.files()).hasSize(2);
        FileResult resultA = preview.files().get(0);
        FileResult resultB = preview.files().get(1);

        assertThat(resultA.finalServiceName()).isEqualTo("orders-svc");
        assertThat(resultB.finalServiceName()).isEqualTo("payments-svc");

        OperationResult opA = resultA.operations().get(0);
        OperationResult opB = resultB.operations().get(0);

        // Each file matches ITS OWN spec, NOT the sibling's spec.
        assertThat(opA.status()).isEqualTo(OperationStatus.MATCHED);
        assertThat(opA.missingInputKey()).isEqualTo(keyA);
        assertThat(opA.matchedSpecIds()).containsExactly(specAId);

        assertThat(opB.status()).isEqualTo(OperationStatus.MATCHED);
        assertThat(opB.missingInputKey()).isEqualTo(keyB);
        assertThat(opB.matchedSpecIds()).containsExactly(specBId);

        // Total: 2 distinct new resolutions, 2 affected specs.
        assertThat(preview.totalNewResolutions()).isEqualTo(2);
        assertThat(preview.totalMatchedSpecs()).isEqualTo(2);
    }

    // -----------------------------------------------------------------------
    // 4) Mixed-format batch sibling isolation
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: OAS + WSDL + malformed in one batch -- two PARSED, one FAILED, sibling isolation holds")
    void mixedFormatBatch_siblingIsolation() {
        when(specRepository.findByProjectId(projectId)).thenReturn(List.of());
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        FileEntry oas = new FileEntry("orders.yaml", OAS_PLACEORDER, null, null);
        FileEntry wsdl = new FileEntry("payments.wsdl", WSDL_11_CANCELORDER, null, null);
        FileEntry malformed = new FileEntry("garbage.txt", MALFORMED, null, null);

        ContractIngestResult preview = ingestService.ingestPreview(
            projectId, List.of(oas, wsdl, malformed));

        assertThat(preview.files()).hasSize(3);

        // File 0 -- OAS: parsed, one op identified as 'placeorder'.
        FileResult fOas = preview.files().get(0);
        assertThat(fOas.status()).isEqualTo(FileStatus.PARSED);
        assertThat(fOas.operations()).hasSize(1);
        assertThat(fOas.operations().get(0).identifier()).isEqualTo("placeorder");

        // File 1 -- WSDL: parsed, one op identified as 'cancelorder' (lowercased).
        FileResult fWsdl = preview.files().get(1);
        assertThat(fWsdl.status()).isEqualTo(FileStatus.PARSED);
        assertThat(fWsdl.suggestedServiceName()).isEqualTo("paymentsservice");
        assertThat(fWsdl.operations()).hasSize(1);
        assertThat(fWsdl.operations().get(0).identifier()).isEqualTo("cancelorder");

        // File 2 -- malformed: failed with the unrecognised-format reason.
        FileResult fBad = preview.files().get(2);
        assertThat(fBad.status()).isEqualTo(FileStatus.FAILED);
        assertThat(fBad.failureReason())
            .isEqualTo(OasWsdlContractIngestService.REASON_UNRECOGNISED_FORMAT);
        assertThat(fBad.operations()).isEmpty();
    }

    // -----------------------------------------------------------------------
    // 5) WSDL 1.1 end-to-end commit
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Cross-layer: WSDL 1.1 file goes through commit -- one resolution + one artefact persisted")
    void wsdl11_commitPipeline_persistsResolutionAndArtefact() {
        // Spec key: WSDL emits 'cancelorder' under suggested service name
        // 'paymentsservice' (from <wsdl:service name="PaymentsService">,
        // lowercased and trimmed).
        String expectedKey = hasher.computeKey(
            MissingInputResolutionService.TYPE_API_CONTRACT,
            hasher.canonicalDescriptorForApiContract("paymentsservice", "cancelorder"));
        UUID specId = UUID.randomUUID();
        when(specRepository.findByProjectId(projectId))
            .thenReturn(List.of(buildSpec(specId, expectedKey)));
        when(resolutionRepository.findByProjectIdAndSoftDeletedFalse(projectId))
            .thenReturn(List.of());

        UUID artifactId = UUID.randomUUID();
        stubArtifactCreate(artifactId);
        stubResolutionCreate();

        FileEntry wsdl = new FileEntry("payments.wsdl", WSDL_11_CANCELORDER, null, null);
        ContractIngestResult commit = ingestService.ingestCommit(
            projectId, List.of(wsdl), "alice@example.com");

        assertThat(commit.totalNewResolutions()).isEqualTo(1);
        assertThat(commit.files().get(0).status()).isEqualTo(FileStatus.PARSED);
        OperationResult op = commit.files().get(0).operations().get(0);
        assertThat(op.identifier()).isEqualTo("cancelorder");
        assertThat(op.missingInputKey()).isEqualTo(expectedKey);
        assertThat(op.status()).isEqualTo(OperationStatus.MATCHED);

        // Verify the commit path passed the correct service-name + identifier
        // through to the resolution-service stamp.
        ArgumentCaptor<MissingInputResolutionCreateRequest> reqCap =
            ArgumentCaptor.forClass(MissingInputResolutionCreateRequest.class);
        verify(resolutionService, times(1)).createWithSource(
            eq(projectId), reqCap.capture(),
            eq(MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD),
            eq(artifactId));
        MissingInputResolutionCreateRequest sent = reqCap.getValue();
        assertThat(sent.missingInputKey()).isEqualTo(expectedKey);
        assertThat(sent.serviceName()).isEqualTo("paymentsservice");
        assertThat(sent.operationName()).isEqualTo("cancelorder");
        assertThat(sent.resolvedBy()).isEqualTo("alice@example.com");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void stubArtifactCreate(UUID artifactId) {
        when(projectArtifactService.createArtifact(eq(projectId),
                eq(ProjectArtifactService.ARTIFACT_TYPE_MISSING_INPUT_CONTRACT_UPLOAD),
                any(ProjectArtifactDto.class)))
            .thenAnswer(inv -> {
                ProjectArtifactDto in = inv.getArgument(2);
                return new ProjectArtifactDto(
                    artifactId, in.projectId(), in.artifactType(),
                    in.content(), in.source(), 1, Instant.now());
            });
    }

    private void stubResolutionCreate() {
        when(resolutionService.createWithSource(eq(projectId),
                any(MissingInputResolutionCreateRequest.class),
                eq(MissingInputResolutionService.RESOLUTION_SOURCE_OAS_WSDL_UPLOAD),
                any()))
            .thenAnswer(inv -> {
                MissingInputResolutionCreateRequest req = inv.getArgument(1);
                return new MissingInputResolutionDto(
                    UUID.randomUUID(), projectId, req.missingInputKey(),
                    req.missingInputType(), req.resolutionPayload(),
                    Instant.now(), req.resolvedBy(),
                    Boolean.FALSE, null, null, Instant.now(), Instant.now());
            });
    }

    private MigrationStorySpecGenerationEntity buildSpec(UUID id, String key) {
        return MigrationStorySpecGenerationEntity.builder()
            .id(id)
            .projectId(projectId)
            .workItemId(UUID.randomUUID())
            .status(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT)
            .missingInputKeysJson(new ArrayList<>(List.of(key)))
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }
}
