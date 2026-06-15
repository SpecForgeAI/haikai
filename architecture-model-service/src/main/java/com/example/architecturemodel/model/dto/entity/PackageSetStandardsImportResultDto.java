package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * PackageSetStandardsImportResult DTO - response for the import operation.
 *
 * Contains the import status and optionally any warnings or errors encountered.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
public record PackageSetStandardsImportResultDto(
    @JsonProperty("success")
    boolean success,

    @JsonProperty("message")
    String message,

    @JsonProperty("imported_at")
    OffsetDateTime importedAt,

    @JsonProperty("company_file_found")
    boolean companyFileFound,

    @JsonProperty("project_file_found")
    boolean projectFileFound,

    @JsonProperty("company_revision")
    String companyRevision,

    @JsonProperty("project_revision")
    String projectRevision,

    @JsonProperty("inserted_sets")
    Integer insertedSets,

    @JsonProperty("updated_sets")
    Integer updatedSets,

    @JsonProperty("inserted_packages")
    Integer insertedPackages,

    @JsonProperty("updated_packages")
    Integer updatedPackages,

    @JsonProperty("inserted_rules")
    Integer insertedRules,

    @JsonProperty("updated_rules")
    Integer updatedRules,

    @JsonProperty("warnings")
    List<String> warnings
) {}
