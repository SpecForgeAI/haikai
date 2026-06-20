package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;
import java.util.UUID;

/**
 * Response body for {@code PATCH .../api-behaviour/captures/batch}.
 *
 * <p>Best-effort, NON-atomic result: {@code updated} carries the DTOs for every
 * item whose {@code patch} applied; {@code failed} carries one entry per item
 * that did NOT, preserving the {@code id} and a human-readable {@code reason}
 * (e.g. capture not found, or a validation error from the field-merge). A
 * failing item never aborts the rest.</p>
 *
 * <p>Wire format is snake_case (the AMS default -- NO {@code @CamelCaseWire}).</p>
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
 */
public record BatchUpdateApiBehaviourCapturesResponse(
    List<ApiBehaviourCaptureDto> updated,
    List<FailedItem> failed
) {

    /**
     * One per-item failure entry. {@code id} is the capture id that failed to
     * patch; {@code reason} is the error message.
     */
    public record FailedItem(
        UUID id,
        String reason
    ) {}
}
