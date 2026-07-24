package com.example.architecturemodel.model.dto.apibehaviour;

import java.util.List;
import java.util.UUID;

/**
 * Response shape for the capture-session inventory reconciliation endpoint.
 *
 * <p>THE wire contract for the whole Model-Seeded Capture Inventory feature
 * (2026-06-11): the validation service's {@code reconcile-inventory} action
 * returns this payload VERBATIM, the {@code /start} hard-block gate reads
 * it, and every frontend surface (wizard Step 4, override dialog, baseline
 * coverage figure) renders it without reshaping. Snake_case wire via the
 * AMS global Jackson strategy -- NO {@code @CamelCaseWire}.</p>
 *
 * <p>All numerics boxed ({@link Integer} / {@link Double}) per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <h2>Semantics</h2>
 * <ul>
 *   <li><b>Accounted</b> = the endpoint's reconciliation key matches at
 *       least one of the session's operation rows REGARDLESS of the row's
 *       {@code included} value -- an excluded-with-reason row counts as
 *       accounted (persistence IS the accounting record).</li>
 *   <li>{@code inScopeUnaccountedEndpoints} -- in-scope committed endpoints
 *       with NO matching operation row (the Start-gate blocker list).</li>
 *   <li>{@code operationsWithoutModelEndpoint} -- harness operations the
 *       committed model does not know (each also emitted as a
 *       session-linked reconciliation finding when
 *       {@code refresh_findings=true}).</li>
 *   <li>{@code excludedByScopeEndpoints} -- endpoints whose
 *       {@code interface_id} is outside the scope set; displayed in bulk,
 *       never silently absent (D7).</li>
 *   <li>Coverage: {@code in_scope_coverage_pct} = accounted in-scope /
 *       total in-scope x 100; {@code architecture_coverage_pct} = accounted
 *       across ALL architecture endpoints / total x 100
 *       (excluded-by-scope endpoints lower the whole-architecture figure by
 *       design, D7). Empty denominators return 100.</li>
 * </ul>
 *
 * <p>Spec: Model-Seeded Capture Inventory (2026-06-11) -- Task Group 1.</p>
 */
public record InventoryReconciliationResponse(
    List<UnaccountedEndpointRef> inScopeUnaccountedEndpoints,
    List<OperationWithoutModelEndpointRef> operationsWithoutModelEndpoint,
    List<ExcludedByScopeEndpointRef> excludedByScopeEndpoints,
    /**
     * Internal (non-HTTP) entry points (Spec 2026-07-24): endpoints whose
     * owning interface is typed Internal Processing. They can NEVER be
     * exercised over HTTP, so they are auto-classified OUT of capture scope —
     * visible here (never silent), never in the unaccounted list, never in
     * any coverage denominator, never blocking /start.
     */
    List<ExcludedByScopeEndpointRef> internalExcludedEndpoints,
    Double inScopeCoveragePct,
    Integer inScopeAccountedCount,
    Integer inScopeTotalCount,
    Double architectureCoveragePct,
    Integer architectureAccountedCount,
    Integer architectureTotalCount
) {

    /**
     * Full ref for an in-scope committed endpoint with no matching operation
     * row. {@code key} is the calculator's reconciliation key; SOAP fields
     * are null for REST endpoints (and vice versa for method/path-less SOAP
     * ops).
     */
    public record UnaccountedEndpointRef(
        String endpointId,
        String interfaceId,
        String key,
        String name,
        String method,
        String path,
        String protocol,
        String soapAction,
        String requestRootElement
    ) {}

    /** Full ref for a harness operation the committed model does not know. */
    public record OperationWithoutModelEndpointRef(
        UUID operationRowId,
        String operationId,
        String method,
        String path,
        String key
    ) {}

    /** Compact ref for an endpoint excluded by interface scope (bulk display). */
    public record ExcludedByScopeEndpointRef(
        String endpointId,
        String interfaceId,
        String key,
        String name
    ) {}
}
