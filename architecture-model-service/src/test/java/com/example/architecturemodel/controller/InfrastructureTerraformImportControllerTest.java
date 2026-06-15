package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.service.import_.terraform.ImportReviewResult;
import com.example.architecturemodel.service.import_.terraform.TerraformImportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link InfrastructureTerraformImportController}.
 *
 * <p>Mirrors {@link InfrastructureTerraformExportControllerTest} pattern.
 * The {@link TerraformImportService} is mocked: tests only check the
 * controller's request mapping, multipart parsing, JSON response shape, and
 * the {@code IllegalArgumentException} -> 400 mapping.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 5.1
 */
@ExtendWith(MockitoExtension.class)
class InfrastructureTerraformImportControllerTest {

    @Mock
    private TerraformImportService terraformImportService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ARCH_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @BeforeEach
    void setUp() {
        InfrastructureTerraformImportController controller =
            new InfrastructureTerraformImportController(terraformImportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void importTerraform_happyPath_returns200WithJsonImportReviewResult() throws Exception {
        // Mock service returns a non-empty review result.
        ImportReviewResult.ProposedIaCSource src = new ImportReviewResult.ProposedIaCSource(
            "GCP", null, null, null, null, null
        );
        ImportReviewResult mockResult = ImportReviewResult.build(
            src,
            List.of(),
            List.of(),
            List.of(),
            List.of()
        );
        when(terraformImportService.runImport(
                eq(PROJECT_ID), eq(ARCH_ID),
                any(MultipartFile[].class),
                argThat(opts -> opts != null
                    && "env-1".equals(opts.environmentId())
                    && "GCP".equals(opts.provider()))))
            .thenReturn(mockResult);

        MockMultipartFile filePart = new MockMultipartFile(
            "files", "main.tf", "text/plain",
            "resource \"google_compute_network\" \"vpc\" {}".getBytes(StandardCharsets.UTF_8)
        );

        mockMvc.perform(
                multipart("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
                    PROJECT_ID, ARCH_ID)
                    .file(filePart)
                    .param("environmentId", "env-1")
                    .param("provider", "GCP"))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/json"))
            .andExpect(jsonPath("$.iac_source.provider").value("GCP"))
            .andExpect(jsonPath("$.summary.will_create_count").value(0))
            .andExpect(jsonPath("$.summary.will_update_count").value(0));
    }

    @Test
    void importTerraform_missingFiles_returns400() throws Exception {
        when(terraformImportService.runImport(any(), any(), any(), any()))
            .thenThrow(new IllegalArgumentException("at least one file part is required"));

        mockMvc.perform(
                multipart("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
                    PROJECT_ID, ARCH_ID)
                    .param("environmentId", "env-1")
                    .param("provider", "GCP"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void importTerraform_missingEnvironmentId_returns400() throws Exception {
        when(terraformImportService.runImport(any(), any(), any(), any()))
            .thenThrow(new IllegalArgumentException("environmentId is required"));

        MockMultipartFile filePart = new MockMultipartFile(
            "files", "main.tf", "text/plain", "".getBytes(StandardCharsets.UTF_8)
        );
        mockMvc.perform(
                multipart("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
                    PROJECT_ID, ARCH_ID)
                    .file(filePart)
                    .param("provider", "GCP"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void importTerraform_invalidProvider_returns400() throws Exception {
        when(terraformImportService.runImport(any(), any(), any(),
                argThat(opts -> opts != null && "AWS".equals(opts.provider()))))
            .thenThrow(new IllegalArgumentException(
                "provider not registered: 'AWS' (V1 only registers 'GCP')"));

        MockMultipartFile filePart = new MockMultipartFile(
            "files", "main.tf", "text/plain", "".getBytes(StandardCharsets.UTF_8)
        );
        mockMvc.perform(
                multipart("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
                    PROJECT_ID, ARCH_ID)
                    .file(filePart)
                    .param("environmentId", "env-1")
                    .param("provider", "AWS"))
            .andExpect(status().isBadRequest());
    }
}
