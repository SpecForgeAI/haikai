package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.service.export.terraform.TerraformExportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link InfrastructureTerraformExportController}.
 *
 * <p>Mirrors {@link DiagramExportControllerTest} pattern.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 6.
 */
@ExtendWith(MockitoExtension.class)
class InfrastructureTerraformExportControllerTest {

    @Mock
    private TerraformExportService terraformExportService;

    private MockMvc mockMvc;

    private static final UUID PROJECT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID ARCH_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @BeforeEach
    void setUp() {
        InfrastructureTerraformExportController controller =
            new InfrastructureTerraformExportController(terraformExportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
    }

    @Test
    void exportTerraform_happyPath_returnsZipWithCorrectHeaders() throws Exception {
        String filename = "default_prod_20260508-090000_terraform.zip";
        byte[] zipBytes = new byte[]{0x50, 0x4B, 0x03, 0x04};

        TerraformExportService.TerraformExportResult result =
            new TerraformExportService.TerraformExportResult(zipBytes, filename, List.of(), null);

        when(terraformExportService.exportTerraform(
                eq(PROJECT_ID), eq(ARCH_ID), eq("env-1"),
                any(), any(), eq("GCP")))
            .thenReturn(result);

        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform",
                PROJECT_ID, ARCH_ID)
                .param("environmentId", "env-1")
                .param("provider", "GCP"))
            .andExpect(status().isOk())
            .andExpect(content().contentType("application/zip"))
            .andExpect(header().string("Content-Disposition",
                "attachment; filename=\"" + filename + "\""));
    }

    @Test
    void exportTerraform_missingEnvironmentId_returns400() throws Exception {
        when(terraformExportService.exportTerraform(
                any(), any(), any(), any(), any(), any()))
            .thenThrow(new IllegalArgumentException("environmentId is required"));

        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform",
                PROJECT_ID, ARCH_ID)
                .param("provider", "GCP"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void exportTerraform_unregisteredProvider_returns400() throws Exception {
        // 'AWS' is in iacSourceProviderOptions but not registered (V1 only GCP).
        when(terraformExportService.exportTerraform(
                any(), any(), any(), any(), any(), eq("AWS")))
            .thenThrow(new IllegalArgumentException(
                "provider not registered: 'AWS' (V1 only registers 'GCP')"));

        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform",
                PROJECT_ID, ARCH_ID)
                .param("environmentId", "env-1")
                .param("provider", "AWS"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void exportTerraform_unknownProvider_returns400() throws Exception {
        // 'ALIBABA' is not in iacSourceProviderOptions at all.
        when(terraformExportService.exportTerraform(
                any(), any(), any(), any(), any(), eq("ALIBABA")))
            .thenThrow(new IllegalArgumentException(
                "provider 'ALIBABA' is not in iacSourceProviderOptions"));

        mockMvc.perform(get("/api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform",
                PROJECT_ID, ARCH_ID)
                .param("environmentId", "env-1")
                .param("provider", "ALIBABA"))
            .andExpect(status().isBadRequest());
    }
}
