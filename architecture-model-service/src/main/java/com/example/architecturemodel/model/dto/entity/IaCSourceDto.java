package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for an IaC Source.
 *
 * Records IaC source-of-record metadata (Terraform repo / path / workspace /
 * commit SHA / provider). Standard entity envelope plus 13 source-specific
 * fields.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 * model_file_id is server-side only and not exposed.
 */
public record IaCSourceDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("source_type")
    String sourceType,

    @JsonProperty("repository_url")
    String repositoryUrl,

    @JsonProperty("repository_provider")
    String repositoryProvider,

    @JsonProperty("branch")
    String branch,

    @JsonProperty("commit_sha")
    String commitSha,

    @JsonProperty("path")
    String path,

    @JsonProperty("workspace")
    String workspace,

    @JsonProperty("module_name")
    String moduleName,

    @JsonProperty("module_path")
    String modulePath,

    @JsonProperty("provider")
    String provider,

    @JsonProperty("owner")
    String owner,

    @JsonProperty("last_scanned_at")
    String lastScannedAt,

    @JsonProperty("last_imported_at")
    String lastImportedAt
) {}
