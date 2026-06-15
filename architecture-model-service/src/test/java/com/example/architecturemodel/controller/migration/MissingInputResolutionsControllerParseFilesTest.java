package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.entity.ProjectEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.ContractIngestResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileEntry;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.FileStatus;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationResult;
import com.example.architecturemodel.service.contract.OasWsdlContractIngestService.OperationStatus;
import com.example.architecturemodel.service.migration.MissingInputCrossStoryMatcherService;
import com.example.architecturemodel.service.migration.MissingInputResolutionBulkService;
import com.example.architecturemodel.service.migration.MissingInputResolutionCascadeService;
import com.example.architecturemodel.service.migration.MissingInputResolutionService;
import com.example.architecturemodel.model.dto.migration.ContractFormat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for the new parse-files endpoint on
 * {@link MissingInputResolutionsController}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Four focused tests covering Task 4.1's contract:</p>
 * <ol>
 *   <li>Preview mode returns per-file results without persisting.</li>
 *   <li>Commit mode delegates to ingestCommit() with the right resolvedBy.</li>
 *   <li>File-size cap enforcement: file > cap is marked failed with reason
 *       'file_too_large' and never read into the service layer.</li>
 *   <li>Multipart with mixed valid + invalid files: valid ones processed,
 *       invalid ones reported (sibling-file failure isolation).</li>
 * </ol>
 *
 * <p>The controller is mocked with the new field-injected
 * {@link OasWsdlContractIngestService} + {@link ProjectRepository}
 * collaborators via {@link ReflectionTestUtils} since the original
 * 4-arg constructor still accepts only the bulk-resolve dependencies.</p>
 */
@ExtendWith(MockitoExtension.class)
class MissingInputResolutionsControllerParseFilesTest {

    @Mock private MissingInputResolutionService resolutionService;
    @Mock private MissingInputResolutionBulkService bulkService;
    @Mock private MissingInputResolutionCascadeService cascadeService;
    @Mock private MissingInputCrossStoryMatcherService matcherService;
    @Mock private OasWsdlContractIngestService contractIngestService;
    @Mock private ProjectRepository projectRepository;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID =
        UUID.fromString("99999999-1111-2222-3333-444444444444");

    @BeforeEach
    void setUp() {
        MissingInputResolutionsController controller = new MissingInputResolutionsController(
            resolutionService, bulkService, cascadeService, matcherService);
        // Field-inject the parse-files collaborators.
        ReflectionTestUtils.setField(controller, "contractIngestService", contractIngestService);
        ReflectionTestUtils.setField(controller, "projectRepository", projectRepository);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    // -----------------------------------------------------------------------
    // 1) Preview mode returns per-file results, no commit-delegation
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Preview mode (commit=false) delegates to ingestPreview() and returns results without persisting")
    void parseFiles_previewReturnsResults() throws Exception {
        // Project uses default cap (column null -> 10MB fallback).
        when(projectRepository.findById(PROJECT_ID))
            .thenReturn(Optional.of(projectWithCap(null)));

        UUID specId = UUID.randomUUID();
        OperationResult op = new OperationResult(
            "placeorder", "abc123def4567890",
            OperationStatus.MATCHED, List.of(specId), null);
        FileResult fr = new FileResult(
            "orders.yaml", 100L,
            ContractFormat.OAS_3_0,
            FileStatus.PARSED, null,
            "orders api", "orders api",
            List.of(op));
        ContractIngestResult result = new ContractIngestResult(
            List.of(fr), 1, 1, true);
        when(contractIngestService.ingestPreview(eq(PROJECT_ID), any()))
            .thenReturn(result);

        MockMultipartFile filePart = new MockMultipartFile(
            "files", "orders.yaml", "application/x-yaml",
            "openapi: 3.0.3\n".getBytes());

        mockMvc.perform(multipart(
                "/api/projects/{p}/missing-input-resolutions/parse-files", PROJECT_ID)
                .file(filePart)
                .param("commit", "false"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.previewOnly").value(true))
            .andExpect(jsonPath("$.files.length()").value(1))
            .andExpect(jsonPath("$.files[0].fileName").value("orders.yaml"))
            .andExpect(jsonPath("$.files[0].status").value("PARSED"))
            .andExpect(jsonPath("$.files[0].operations.length()").value(1))
            .andExpect(jsonPath("$.files[0].operations[0].status").value("MATCHED"))
            .andExpect(jsonPath("$.summary.totalOperations").value(1))
            .andExpect(jsonPath("$.summary.matched").value(1))
            .andExpect(jsonPath("$.summary.willCreateResolutions").value(1))
            .andExpect(jsonPath("$.summary.affectedSpecCount").value(1));

        // Critical: commit path NEVER hit on preview.
        verify(contractIngestService, never())
            .ingestCommit(any(UUID.class), any(), anyString());
        verify(contractIngestService, times(1))
            .ingestPreview(eq(PROJECT_ID), any());
    }

    // -----------------------------------------------------------------------
    // 2) Commit mode delegates to ingestCommit with the right resolvedBy
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Commit mode (commit=true) delegates to ingestCommit() with the X-User-Id audit channel")
    void parseFiles_commitDelegatesToIngestCommit() throws Exception {
        when(projectRepository.findById(PROJECT_ID))
            .thenReturn(Optional.of(projectWithCap(null)));

        ContractIngestResult committed = new ContractIngestResult(
            List.of(new FileResult(
                "orders.yaml", 100L,
                ContractFormat.OAS_3_0,
                FileStatus.PARSED, null,
                "orders api", "orders api",
                List.of())),
            0, 0, false);
        when(contractIngestService.ingestCommit(eq(PROJECT_ID), any(), eq("alice@example.com")))
            .thenReturn(committed);

        MockMultipartFile filePart = new MockMultipartFile(
            "files", "orders.yaml", "application/x-yaml",
            "openapi: 3.0.3\n".getBytes());

        mockMvc.perform(multipart(
                "/api/projects/{p}/missing-input-resolutions/parse-files", PROJECT_ID)
                .file(filePart)
                .header("X-User-Id", "alice@example.com")
                .param("commit", "true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.previewOnly").value(false));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FileEntry>> entryCap =
            ArgumentCaptor.forClass(List.class);
        verify(contractIngestService, times(1))
            .ingestCommit(eq(PROJECT_ID), entryCap.capture(), eq("alice@example.com"));
        verify(contractIngestService, never()).ingestPreview(any(UUID.class), any());

        List<FileEntry> entries = entryCap.getValue();
        assertThat(entries).hasSize(1);
        assertThat(entries.get(0).fileName()).isEqualTo("orders.yaml");
    }

    // -----------------------------------------------------------------------
    // 3) File-size cap enforcement: oversize file is rejected before service
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("File > cap is marked failed with reason 'file_too_large' and never reaches the service")
    void parseFiles_fileSizeCapMarksFileFailed() throws Exception {
        // Project cap = 1MB.
        when(projectRepository.findById(PROJECT_ID))
            .thenReturn(Optional.of(projectWithCap(1)));

        // The service-side path will see an empty entries list when the
        // only file exceeds the cap, so it returns an empty result.
        when(contractIngestService.ingestPreview(eq(PROJECT_ID), any()))
            .thenReturn(new ContractIngestResult(List.of(), 0, 0, true));

        // Build a 2MB payload (above the 1MB cap).
        byte[] big = new byte[2 * 1024 * 1024];
        for (int i = 0; i < big.length; i++) big[i] = (byte) ('a' + (i % 26));

        MockMultipartFile bigPart = new MockMultipartFile(
            "files", "huge.yaml", "application/x-yaml", big);

        mockMvc.perform(multipart(
                "/api/projects/{p}/missing-input-resolutions/parse-files", PROJECT_ID)
                .file(bigPart)
                .param("commit", "false"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.files.length()").value(1))
            .andExpect(jsonPath("$.files[0].fileName").value("huge.yaml"))
            .andExpect(jsonPath("$.files[0].status").value("FAILED"))
            .andExpect(jsonPath("$.files[0].failureReason").value("file_too_large"));

        // The service was called with an empty entries list (the oversize
        // file was never passed in -- bytes never read beyond the cap).
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FileEntry>> entryCap =
            ArgumentCaptor.forClass(List.class);
        verify(contractIngestService, times(1))
            .ingestPreview(eq(PROJECT_ID), entryCap.capture());
        assertThat(entryCap.getValue()).isEmpty();
    }

    // -----------------------------------------------------------------------
    // 4) Mixed valid + invalid files: valid ones processed, invalid reported
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Mixed valid + oversize files: valid file processed, oversize file reported as file_too_large")
    void parseFiles_mixedFilesSiblingIsolation() throws Exception {
        when(projectRepository.findById(PROJECT_ID))
            .thenReturn(Optional.of(projectWithCap(1)));

        // The good file is small; the bad file is 2MB > 1MB cap.
        MockMultipartFile goodPart = new MockMultipartFile(
            "files", "good.yaml", "application/x-yaml",
            "openapi: 3.0.3\n".getBytes());
        byte[] big = new byte[2 * 1024 * 1024];
        MockMultipartFile badPart = new MockMultipartFile(
            "files", "bad.yaml", "application/x-yaml", big);

        // Service handles the good file only (the controller filters the
        // oversize file out before delegating).
        FileResult goodFr = new FileResult(
            "good.yaml", 15L,
            ContractFormat.OAS_3_0,
            FileStatus.PARSED, null,
            "ok", "ok", List.of());
        when(contractIngestService.ingestPreview(eq(PROJECT_ID), any()))
            .thenReturn(new ContractIngestResult(List.of(goodFr), 0, 0, true));

        mockMvc.perform(multipart(
                "/api/projects/{p}/missing-input-resolutions/parse-files", PROJECT_ID)
                .file(goodPart)
                .file(badPart)
                .param("commit", "false"))
            .andExpect(status().isOk())
            // Two file blocks: the oversize FAILED block FIRST (controller
            // prepends oversize blocks), then the service's PARSED block.
            .andExpect(jsonPath("$.files.length()").value(2))
            .andExpect(jsonPath("$.files[0].fileName").value("bad.yaml"))
            .andExpect(jsonPath("$.files[0].status").value("FAILED"))
            .andExpect(jsonPath("$.files[0].failureReason").value("file_too_large"))
            .andExpect(jsonPath("$.files[1].fileName").value("good.yaml"))
            .andExpect(jsonPath("$.files[1].status").value("PARSED"));

        // Service was passed the good file only.
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FileEntry>> entryCap =
            ArgumentCaptor.forClass(List.class);
        verify(contractIngestService).ingestPreview(eq(PROJECT_ID), entryCap.capture());
        assertThat(entryCap.getValue()).hasSize(1);
        assertThat(entryCap.getValue().get(0).fileName()).isEqualTo("good.yaml");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static ProjectEntity projectWithCap(Integer capMb) {
        ProjectEntity project = new ProjectEntity();
        project.setId(PROJECT_ID);
        project.setName("test-project");
        project.setMaxContractUploadFileSizeMb(capMb);
        return project;
    }
}
