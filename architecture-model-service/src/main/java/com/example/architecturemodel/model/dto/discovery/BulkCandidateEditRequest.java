package com.example.architecturemodel.model.dto.discovery;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Request body for {@code POST .../candidates/bulk-edit}.
 *
 * <p>The ATOMIC bulk-candidate-EDIT entry point added by the Skipped-candidate
 * visibility + grouped bulk-fill (C1) spec (2026-06-20, Task Group 3). It applies
 * PER-CANDIDATE field patches across an EXPLICIT, CURATED set of candidates in a
 * SINGLE transaction so the C1 remediation panel can bulk-fill the missing
 * field(s) that blocked or degraded a group of candidates and re-attempt the save
 * in one step. ANY single-candidate failure rolls back the WHOLE batch (the
 * all-or-nothing guarantee mirrors {@link BulkReviewCascadeRequest} /
 * {@code DiscoveryCascadeReviewService.bulkReviewCascade}).</p>
 *
 * <p>Unlike {@link BulkReviewCascadeRequest} (which applies ONE shared
 * {@code review_status} disposition across the whole id set), each {@link Patch}
 * here carries its OWN per-candidate field changes -- top-level candidate columns
 * AND a partial {@code data} JSONB overlay -- because the panel may set a shared
 * value for a group but ALSO accept a per-row override. The {@code patches} list
 * is the curated set; an empty list is a no-op.</p>
 *
 * <p>Patch semantics are PATCH-style, mirroring
 * {@code DiscoveryCandidateService.updateCandidate}: a {@code null} top-level
 * field leaves the persisted value alone (only non-null fields are written). The
 * {@code data} map is a PARTIAL OVERLAY -- supplied keys are merged onto the
 * existing candidate {@code data} (a key with a {@code null} value clears that
 * one key), and keys NOT present in {@code data} are preserved. This differs from
 * the wholesale {@code data} replace in the single-candidate
 * {@code updateCandidate} PUT, because the panel fills ONE missing field without
 * needing to round-trip the whole blob.</p>
 *
 * <p>Wire format is snake_case (global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}); no {@code @JsonNaming} / {@code @CamelCaseWire}
 * annotation needed (the frontend client is snake_case-typed). {@code patches}
 * stays {@code patches}; inside each {@link Patch}, {@code candidateId} -&gt;
 * {@code candidate_id}, {@code candidateType} -&gt; {@code candidate_type},
 * {@code reviewStatus} -&gt; {@code review_status}, {@code data} stays
 * {@code data}. NOTE: the {@code data} map keys themselves are a passthrough
 * JSONB blob Jackson serializes VERBATIM (it does NOT snake_case map keys), so a
 * camelCase {@code data} key like {@code controllerClassName} round-trips
 * unchanged -- matching the candidate {@code data} convention used throughout
 * (see {@code DiscoveryCandidateService.resolveConflict}).</p>
 *
 * <p>Spec: Skipped-candidate visibility + grouped bulk-fill (C1) for discovery
 * save-back (2026-06-20) -- Task Group 3; modelled on
 * {@link BulkReviewCascadeRequest}.</p>
 */
public record BulkCandidateEditRequest(
    List<Patch> patches
) {

    /**
     * A single curated candidate's field patch.
     *
     * <p>{@code candidateId} is the target candidate UUID (required). The
     * remaining top-level fields mirror the PATCH-style subset of
     * {@code DiscoveryCandidateService.updateCandidate}: a {@code null} field is
     * "omitted" and leaves the persisted value untouched. {@code data} is a
     * partial overlay merged onto the existing candidate {@code data} JSONB
     * (supplied keys win; absent keys are preserved; a key mapped to {@code null}
     * clears that one key) -- this is the missing-field bulk-fill primitive.</p>
     *
     * <p>{@code confidence} is a boxed {@code Double} so "omitted" (null) is
     * distinguishable from a deliberate {@code 0.0}, matching the boxed field on
     * {@code DiscoveryCandidateDto} / the {@code updateCandidate} hotfix.</p>
     */
    public record Patch(
        UUID candidateId,
        String name,
        String candidateType,
        String status,
        String reviewStatus,
        Double confidence,
        String operation,
        Map<String, Object> data
    ) {}
}
