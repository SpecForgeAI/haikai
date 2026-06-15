package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Per-reference-kind roll-up of evidence coverage across the book's story items.
 *
 * <p>Coverage is taken strictly from the per-item metadata on
 * {@code book_of_work_json.items[]}: {@code evidenceReferences},
 * {@code discoveryFindingReferences}, {@code apiBaselineReferences},
 * {@code mappingReferences}, and {@code architectureReferences}. The service
 * never derives coverage from anywhere else.</p>
 *
 * <p>{@link #anyCoverageCount()} is the count of stories that have at least
 * one populated reference across all five categories (i.e. "story has
 * evidence of some kind").</p>
 *
 * <p>All counts are boxed {@link Long} so any future PATCH/merge code path
 * cannot silently wipe a count to {@code 0}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 3. Task Group 2.</p>
 *
 * @param evidenceReferenceCount         Stories with at least one {@code evidenceReferences} entry.
 * @param discoveryFindingReferenceCount Stories with at least one {@code discoveryFindingReferences} entry.
 * @param apiBaselineReferenceCount      Stories with at least one {@code apiBaselineReferences} entry.
 * @param mappingReferenceCount          Stories with at least one {@code mappingReferences} entry.
 * @param architectureReferenceCount     Stories with at least one {@code architectureReferences} entry.
 * @param anyCoverageCount               Stories with at least one entry across any of the five categories.
 */
public record MigrationDeliveryEvidenceSummaryDto(
    @JsonProperty("evidence_reference_count")
    Long evidenceReferenceCount,

    @JsonProperty("discovery_finding_reference_count")
    Long discoveryFindingReferenceCount,

    @JsonProperty("api_baseline_reference_count")
    Long apiBaselineReferenceCount,

    @JsonProperty("mapping_reference_count")
    Long mappingReferenceCount,

    @JsonProperty("architecture_reference_count")
    Long architectureReferenceCount,

    @JsonProperty("any_coverage_count")
    Long anyCoverageCount
) {}
