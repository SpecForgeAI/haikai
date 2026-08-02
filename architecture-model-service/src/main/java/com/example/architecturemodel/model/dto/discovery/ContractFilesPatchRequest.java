package com.example.architecturemodel.model.dto.discovery;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * Request body for the PATCH contract-files endpoint (2026-08-02).
 *
 * <p>Carries operator-uploaded API contract files (WADL/WSDL/XSD content) that
 * the architecture-model-service merges into the discovery run's
 * {@code config_snapshot.contractFiles[]} JSONB array. Unlike log files
 * (metadata-only, content on disk), a contract file's CONTENT is inline here:
 * WADL/XSD are small text documents and the discovery pipeline reads the
 * content directly from the config as an authoritative Interface/Endpoint
 * source (the service-discovery analogue of API Baseline Capture's contract
 * upload).</p>
 *
 * <p>Merge is idempotent on {@code fileName}: re-PATCHing with the same name
 * REPLACES that entry, never appends a duplicate.</p>
 *
 * @param contractFiles non-empty list of {@link ContractFileDto} entries.
 */
public record ContractFilesPatchRequest(
    @JsonProperty("contractFiles")
    @NotNull(message = "contractFiles is required")
    @NotEmpty(message = "contractFiles must not be empty")
    @Valid
    List<ContractFileDto> contractFiles
) {
    /**
     * One uploaded contract file: a display {@code fileName} (extension drives
     * pass selection downstream — `.wadl`/`.xsd`) and its verbatim text
     * {@code content}.
     */
    public record ContractFileDto(
        @JsonProperty("fileName")
        @NotNull(message = "fileName is required")
        @NotEmpty(message = "fileName must not be empty")
        String fileName,

        @JsonProperty("content")
        @NotNull(message = "content is required")
        @NotEmpty(message = "content must not be empty")
        String content
    ) {}
}
