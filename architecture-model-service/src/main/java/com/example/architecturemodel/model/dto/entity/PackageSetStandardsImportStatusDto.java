package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;

/**
 * PackageSetStandardsImportStatus DTO - tracks import history and counts for audit and display.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
public record PackageSetStandardsImportStatusDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("imported_at")
    OffsetDateTime importedAt,

    @JsonProperty("company_file_path")
    String companyFilePath,

    @JsonProperty("project_file_path")
    String projectFilePath,

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
    Integer updatedRules
) {}
