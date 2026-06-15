package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/api-behaviour/capture-sessions/{sessionId}/inventory-reconciliation}.
 *
 * <p>Snake_case wire via the AMS global Jackson strategy (NO
 * {@code @CamelCaseWire} -- consumers are the validation service's
 * snake_case-typed {@code archModelClient} and the frontend):
 * {@code scope_interface_ids}, {@code persist_scope},
 * {@code refresh_findings}.</p>
 *
 * <p>All fields boxed/reference (per
 * {@code project_primitive_double_dto_overwrite.md}) so omitted JSON keys
 * stay {@code null} and the service applies the documented defaults:</p>
 *
 * <ul>
 *   <li>{@code scopeInterfaceIds} {@code null} &rarr; fall back to the
 *       session row's persisted {@code scope_interface_ids_json}; when that
 *       is ALSO null, the WHOLE architecture's endpoint set is in scope --
 *       nothing silently absent.</li>
 *   <li>{@code persistScope} {@code null} &rarr; {@code false}.</li>
 *   <li>{@code refreshFindings} {@code null} &rarr; {@code true} (the
 *       default; display-only callers pass {@code false}).</li>
 * </ul>
 *
 * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1.</p>
 */
public record InventoryReconciliationRequest(
    List<String> scopeInterfaceIds,
    Boolean persistScope,
    Boolean refreshFindings
) {}
