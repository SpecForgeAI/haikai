package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;
import java.util.UUID;

/**
 * Request body for {@code PATCH .../api-behaviour/captures/batch}.
 *
 * <p>A list of {@code {id, patch}} pairs so the reviewer's "Reject All" can
 * preserve EACH capture's own {@code reviewer_notes} masks (one distinct patch
 * per id); "Accept All" sends the same accept patch per id. Best-effort,
 * NON-atomic: each item's {@code patch} is applied via the existing
 * {@code ApiBehaviourCaptureService.update} field-merge independently; a failing
 * item is recorded in the response {@code failed[]} (with its id) and the loop
 * continues. The service enforces a per-call cap (see
 * {@code ApiBehaviourCaptureService.MAX_BATCH_ITEMS}); requests over the cap
 * are rejected with 400 rather than truncated.</p>
 *
 * <p>Wire format is snake_case (the AMS default -- NO {@code @CamelCaseWire}).</p>
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
 */
public record BatchUpdateApiBehaviourCapturesRequest(
    List<ItemPatch> items
) {

    /**
     * One {@code {id, patch}} pair. {@code id} is the target capture's id;
     * {@code patch} is a standard {@link UpdateApiBehaviourCaptureRequest}
     * applied via the existing per-row field-merge.
     */
    public record ItemPatch(
        UUID id,
        UpdateApiBehaviourCaptureRequest patch
    ) {}
}
