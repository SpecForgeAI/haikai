package com.example.architecturemodel.service.import_.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Top-level transient candidate review payload returned by the importer.
 *
 * <p>Contains the proposed {@code IaCSource} (one per import upload --
 * Q4: whole-ZIP-is-one-IaCSource), three lists of {@link ImportedCandidate}
 * partitioned by triage outcome ({@code willCreate} / {@code willUpdate} /
 * {@code unsupported}), a flat {@code warnings} list aggregating top-level
 * import warnings (unresolved variable references, partial composite
 * groupings, malformed HCL fragments, etc.), and a {@link Summary} block
 * carrying counts per category.
 *
 * <p>JSON shape uses snake_case via {@link JsonProperty}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 1.4
 */
public record ImportReviewResult(

    @JsonProperty("iac_source")
    ProposedIaCSource iacSource,

    @JsonProperty("will_create")
    List<ImportedCandidate> willCreate,

    @JsonProperty("will_update")
    List<ImportedCandidate> willUpdate,

    @JsonProperty("unsupported")
    List<ImportedCandidate> unsupported,

    @JsonProperty("warnings")
    List<String> warnings,

    @JsonProperty("summary")
    Summary summary

) {

    public ImportReviewResult {
        willCreate = willCreate == null ? List.of() : List.copyOf(willCreate);
        willUpdate = willUpdate == null ? List.of() : List.copyOf(willUpdate);
        unsupported = unsupported == null ? List.of() : List.copyOf(unsupported);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }

    /**
     * Build an {@link ImportReviewResult} with the {@link Summary} counts
     * derived from the three candidate lists + the warnings list.
     */
    public static ImportReviewResult build(
        ProposedIaCSource iacSource,
        List<ImportedCandidate> willCreate,
        List<ImportedCandidate> willUpdate,
        List<ImportedCandidate> unsupported,
        List<String> warnings
    ) {
        int creates = willCreate == null ? 0 : willCreate.size();
        int updates = willUpdate == null ? 0 : willUpdate.size();
        int unsupp = unsupported == null ? 0 : unsupported.size();
        int totalWarn = (warnings == null ? 0 : warnings.size())
            + countCandidateWarnings(willCreate)
            + countCandidateWarnings(willUpdate)
            + countCandidateWarnings(unsupported);
        return new ImportReviewResult(
            iacSource,
            willCreate,
            willUpdate,
            unsupported,
            warnings,
            new Summary(creates, updates, unsupp, totalWarn)
        );
    }

    private static int countCandidateWarnings(List<ImportedCandidate> candidates) {
        if (candidates == null) return 0;
        int total = 0;
        for (ImportedCandidate c : candidates) {
            if (c == null || c.perCandidateWarnings() == null) continue;
            total += c.perCandidateWarnings().size();
        }
        return total;
    }

    /**
     * Proposed {@code IaCSource} fields for the upload. One {@link ProposedIaCSource}
     * per import (Q4: whole-ZIP-is-one-IaCSource). Mirrors the persisted shape
     * minus server-managed fields (id) which are filled on approval.
     */
    public record ProposedIaCSource(
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

    /** Counts surfaced to the candidate review UI summary panel. */
    public record Summary(
        @JsonProperty("will_create_count")
        int willCreateCount,

        @JsonProperty("will_update_count")
        int willUpdateCount,

        @JsonProperty("unsupported_count")
        int unsupportedCount,

        @JsonProperty("total_warnings_count")
        int totalWarningsCount
    ) {}
}
