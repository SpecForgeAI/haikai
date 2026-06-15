package com.example.architecturemodel.controller;

import com.example.architecturemodel.service.import_.terraform.ImportOptions;
import com.example.architecturemodel.service.import_.terraform.ImportReviewResult;
import com.example.architecturemodel.service.import_.terraform.TerraformImportService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

/**
 * REST controller exposing the Infrastructure Terraform import endpoint.
 *
 * <p>Single endpoint:
 * {@code POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform}
 *
 * <p>Accepts {@code multipart/form-data} with one or more {@code .tf} file
 * parts (or exactly one {@code .zip}) under {@code files} plus form fields:
 * {@code environmentId} (required), {@code cloudAccountId} / {@code locationId}
 * (optional), {@code provider} (required, V1: must be {@code GCP}), and the
 * five optional IaC-source metadata fields.
 *
 * <p>Returns {@code application/json} with the {@link ImportReviewResult}
 * payload. Hard-fail cases bubble {@link IllegalArgumentException} which
 * either flows through {@code GlobalExceptionHandler} (production) or is
 * caught here directly (standalone test setup).
 *
 * <p>This controller is intentionally NOT folded into {@code ModelController}
 * (locked contract from the spec). NO model mutation happens here -- on
 * "Approve all" the frontend posts approved candidates back through the
 * existing model-save endpoint; "Discard all" is purely client-side state
 * clear.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 5.3
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
public class InfrastructureTerraformImportController {

    private final TerraformImportService terraformImportService;

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform
     */
    @PostMapping(
        value = "/projects/{projectId}/architectures/{architectureId}/infrastructure/import-terraform",
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> importTerraform(
        @PathVariable UUID projectId,
        @PathVariable UUID architectureId,
        @RequestPart(value = "files", required = false) MultipartFile[] files,
        @RequestParam(value = "environmentId", required = false) String environmentId,
        @RequestParam(value = "cloudAccountId", required = false) String cloudAccountId,
        @RequestParam(value = "locationId", required = false) String locationId,
        @RequestParam(value = "provider", required = false) String provider,
        @RequestParam(value = "repositoryUrl", required = false) String repositoryUrl,
        @RequestParam(value = "branch", required = false) String branch,
        @RequestParam(value = "commitSha", required = false) String commitSha,
        @RequestParam(value = "path", required = false) String path,
        @RequestParam(value = "workspace", required = false) String workspace
    ) {
        log.debug(
            "POST /api/model/projects/{}/architectures/{}/infrastructure/import-terraform"
                + " files={} environmentId={} provider={}",
            projectId, architectureId,
            files == null ? 0 : files.length,
            environmentId, provider);

        try {
            ImportOptions options = new ImportOptions(
                environmentId,
                cloudAccountId,
                locationId,
                provider,
                repositoryUrl,
                branch,
                commitSha,
                path,
                workspace
            );
            ImportReviewResult result = terraformImportService
                .runImport(projectId, architectureId, files, options);
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(result);
        } catch (IllegalArgumentException e) {
            log.warn("Bad request to terraform import: {}", e.getMessage());
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }
}
