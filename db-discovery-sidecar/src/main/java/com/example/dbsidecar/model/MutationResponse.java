package com.example.dbsidecar.model;

import java.util.List;

/**
 * Response body for {@code POST /mutate} (Capture-State Discipline Spec 1).
 * {@code rowCounts} carries the per-statement affected-row counts,
 * positionally aligned with the request's {@code statements}. On failure the
 * batch was rolled back (when transactional) and {@code error} carries a
 * password-masked message.
 */
public record MutationResponse(
        boolean ok,
        String error,
        List<Integer> rowCounts
) {
}
