package com.example.architecturemodel.service.import_.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * User-supplied import options carried in the multipart form.
 *
 * <p>Mirrored on the controller as individual {@code @RequestParam}s and
 * assembled into this record by the controller before invoking the service.
 *
 * <p>JSON shape uses snake_case via {@link JsonProperty} for symmetry with
 * the rest of the package's payloads (the record itself is currently only
 * used internally; the snake_case annotations make it safe to surface in
 * future endpoints / responses without a shape change).
 *
 * <p>{@code environmentId} and {@code provider} are required (the controller
 * declares them as required {@code @RequestParam}s; the service defends with
 * a hard-fail boundary check). The five IaC-source metadata fields
 * ({@code repositoryUrl} / {@code branch} / {@code commitSha} / {@code path}
 * / {@code workspace}) are optional.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 5.2
 */
public record ImportOptions(

    @JsonProperty("environment_id")
    String environmentId,

    @JsonProperty("cloud_account_id")
    String cloudAccountId,

    @JsonProperty("location_id")
    String locationId,

    @JsonProperty("provider")
    String provider,

    @JsonProperty("repository_url")
    String repositoryUrl,

    @JsonProperty("branch")
    String branch,

    @JsonProperty("commit_sha")
    String commitSha,

    @JsonProperty("path")
    String path,

    @JsonProperty("workspace")
    String workspace

) {}
