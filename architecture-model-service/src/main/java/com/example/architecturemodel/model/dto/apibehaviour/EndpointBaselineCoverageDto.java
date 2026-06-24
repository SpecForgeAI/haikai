package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.UUID;

/**
 * One architecture API endpoint element that is covered by an ACTIVE API
 * Behaviour Baseline.
 *
 * <p>Spec: Migration Delivery Plan expansion — endpoint↔baseline coverage
 * (2026-06-24 fix). Produced by
 * {@code ApiBehaviourEndpointBaselineCoverageService}, which joins the
 * architecture's endpoint elements to active-baseline items via the SAME
 * protocol-aware reconciliation key the readiness gate uses
 * ({@code InventoryReconciliationCalculator}). This is the canonical
 * endpoint→baseline link the gateway's phase-2 expansion consumes instead of
 * the old (broken) baseline-NAME substring match.</p>
 *
 * <p>Wire format is the AMS global snake_case default, so
 * {@code endpointId}/{@code baselineId} serialise to {@code endpoint_id}/
 * {@code baseline_id}.</p>
 *
 * @param endpointId the architecture model endpoint element id (matches the
 *        {@code elements-inventory} instance id the gateway batches on)
 * @param baselineId the resolved ACTIVE baseline id covering this endpoint
 * @param method     the endpoint's HTTP method (REST) — informational
 * @param path       the endpoint's path/address (REST) — informational
 */
public record EndpointBaselineCoverageDto(
    String endpointId,
    UUID baselineId,
    String method,
    String path
) {
}
