package com.example.architecturemodel.controller;

import com.example.architecturemodel.service.export.terraform.TerraformExportService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST controller exposing the Infrastructure Terraform export endpoint.
 *
 * <p>Single endpoint:
 * {@code GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform}
 *
 * <p>Returns {@code application/zip} with a {@code Content-Disposition: attachment}
 * header. Hard-fail cases return 4xx via {@link IllegalArgumentException}
 * (handled by {@code GlobalExceptionHandler} or via direct catch below for
 * standalone test setup compatibility).
 *
 * <p>This controller is intentionally NOT folded into {@code ModelController}
 * (locked contract from the spec).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 6.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model")
@RequiredArgsConstructor
@Slf4j
public class InfrastructureTerraformExportController {

    private final TerraformExportService terraformExportService;

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform
     */
    @GetMapping("/projects/{projectId}/architectures/{architectureId}/infrastructure/export-terraform")
    public ResponseEntity<byte[]> exportTerraform(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "environmentId", required = false) String environmentId,
            @RequestParam(name = "cloudAccountId", required = false) String cloudAccountId,
            @RequestParam(name = "locationId", required = false) String locationId,
            @RequestParam(name = "provider", required = false) String provider) {
        log.debug(
            "GET /api/model/projects/{}/architectures/{}/infrastructure/export-terraform"
                + " environmentId={} cloudAccountId={} locationId={} provider={}",
            projectId, architectureId, environmentId, cloudAccountId, locationId, provider);

        try {
            TerraformExportService.TerraformExportResult result =
                terraformExportService.exportTerraform(
                    projectId, architectureId, environmentId,
                    cloudAccountId, locationId, provider);

            return ResponseEntity.ok()
                .contentType(MediaType.valueOf("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + result.filename() + "\"")
                .body(result.zipBytes());
        } catch (IllegalArgumentException e) {
            log.warn("Bad request to terraform export: {}", e.getMessage());
            return ResponseEntity.badRequest()
                .body(e.getMessage().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }
}
