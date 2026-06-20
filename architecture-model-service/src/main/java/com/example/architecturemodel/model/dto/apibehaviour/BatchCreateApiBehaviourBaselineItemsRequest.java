package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;

/**
 * Request body for {@code POST .../api-behaviour/baseline-items/batch}.
 *
 * <p>Best-effort, NON-atomic bulk create: each {@code items[i]} is validated +
 * persisted independently. A bad item is recorded in the response
 * {@code failed[]} (with its index + capture_id) and the loop continues -- it
 * does NOT abort the rest or roll back the successes. The service enforces a
 * per-call cap (see {@code ApiBehaviourBaselineItemService.MAX_BATCH_ITEMS});
 * requests over the cap are rejected with 400 rather than truncated.</p>
 *
 * <p>Mirrors the STRUCTURE of {@code BulkCreateDiscoveryFindingsRequest}
 * (cap + {@code items} list) but the persist loop is best-effort/non-atomic
 * (per-item {@code failed[]}, no throw-on-first-bad-item).</p>
 *
 * <p>Wire format is snake_case (the AMS default -- NO {@code @CamelCaseWire});
 * {@code items} serialises as {@code items} on the wire.</p>
 *
 * <p>Spec: Baseline Save &amp; Review -- Batch + Activate + Table Detail +
 * Postman Export (2026-06-20) -- Task Group 1 (R1).</p>
 */
public record BatchCreateApiBehaviourBaselineItemsRequest(
    List<CreateApiBehaviourBaselineItemRequest> items
) {}
