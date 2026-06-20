package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;

/**
 * Response body for {@code POST .../api-behaviour/baseline-items/batch}.
 *
 * <p>Best-effort, NON-atomic result: {@code created} carries the DTOs for every
 * item that validated + persisted; {@code failed} carries one entry per item
 * that did NOT, preserving the request {@code index} (position in the submitted
 * {@code items} list), the originating {@code captureId} (for the warning the
 * frontend renders -- may be {@code null} if the bad item omitted it), and a
 * human-readable {@code reason}. A bad item never aborts the rest.</p>
 *
 * <p>Wire format is snake_case (the AMS default -- NO {@code @CamelCaseWire});
 * {@code captureId} serialises as {@code capture_id} on the wire.</p>
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
 */
public record BatchCreateApiBehaviourBaselineItemsResponse(
    List<ApiBehaviourBaselineItemDto> created,
    List<FailedItem> failed
) {

    /**
     * One per-item failure entry. {@code index} is the item's position in the
     * submitted {@code items} list; {@code captureId} is its
     * {@code capture_id} (nullable -- the offending item may have omitted it);
     * {@code reason} is the validation/persist error message.
     */
    public record FailedItem(
        int index,
        java.util.UUID captureId,
        String reason
    ) {}
}
