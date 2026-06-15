package com.example.architecturemodel.model.dto.migration;

/**
 * Fixed enum-like set of gap codes surfaced by
 * {@code MigrationDiscoveryContextService} on the
 * {@link ReadinessAssessmentDto#gaps()} list.
 *
 * <p>String constants (rather than a Java enum) match the existing AMS
 * convention for stringly-typed status / category vocabularies (see
 * {@code DiscoveryFindingService.ALLOWED_STATUSES}) so consumers across
 * services (gateway resolver, frontend) can pattern-match on stable wire
 * values without redeploying for new codes.</p>
 *
 * <p>Spec: Migration Discovery Context Integration (2026-05-16) -- Task Group 1.</p>
 */
public final class MigrationGapCodes {

    private MigrationGapCodes() {}

    public static final String NO_API_BEHAVIOUR_BASELINE = "no_api_behaviour_baseline";
    public static final String UNRESOLVED_DISCOVERY_DECISIONS = "unresolved_discovery_decisions";
    public static final String MISSING_CURRENT_TO_TARGET_MAPPINGS = "missing_current_to_target_mappings";
    public static final String NO_DATABASE_DISCOVERY_FINDINGS = "no_database_discovery_findings";
    public static final String HIGH_SEVERITY_UNREVIEWED_FINDINGS = "high_severity_unreviewed_findings";
    public static final String MISSING_OAS_FOR_IN_SCOPE_INTERFACE = "missing_oas_for_in_scope_interface";
    public static final String INSUFFICIENT_RUNTIME_EVIDENCE = "insufficient_runtime_evidence";
    public static final String NO_SAMPLE_DATA_HINTS = "no_sample_data_hints";

    // -----------------------------------------------------------------------
    // Coverage-gate gap codes (Spec: Capture Coverage Gates, 2026-05-30).
    //
    // Three advisory coverage dimensions computed-on-read inside
    // MigrationDiscoveryContextService.assessReadiness(...): each downgrades the
    // relevant readiness stream to partial/insufficient and rides the existing
    // ReadinessAssessmentDto.gaps() list -- NEVER blocking. snake_case String
    // VALUES, matching the eight codes above (NOT a Java enum).
    // -----------------------------------------------------------------------

    /**
     * (A) CAPTURE coverage gap. Emitted on baselineReadiness / apiReadiness
     * when a baseline session's {@code included = true} operations were not all
     * captured (joined {@code api_behaviour_operations} vs
     * {@code api_behaviour_captures}). The absence of a diff for a current-only
     * baseline never replayed against a target is the unexecuted-coverage
     * signal, NOT an error, and does NOT itself emit this code.
     */
    public static final String INCOMPLETE_CAPTURE_COVERAGE = "incomplete_capture_coverage";

    /**
     * (B) SPECIFICATION coverage gap. Emitted on discoveryReadiness when one or
     * more discovered endpoints are not "fully specified" per the per-protocol
     * bar (REST = resolved {@code endpoint_data_effects} edge; SOAP = parent
     * interface has bound request/response message entities;
     * {@code business_logics.behavior} is a BONUS signal only, never required).
     */
    public static final String UNDER_SPECIFIED_ENDPOINTS = "under_specified_endpoints";

    /**
     * (C) INVENTORY reconciliation gap. Emitted on apiReadiness /
     * baselineReadiness when the model-file endpoint inventory and the harness
     * {@code api_behaviour_operations} set diverge in EITHER direction
     * (discovered-but-not-captured OR captured-but-not-discovered), compared
     * with a protocol-aware key (SOAP = {@code soap_action} /
     * {@code request_root_element}; REST = {@code {method, path}}).
     */
    public static final String DISCOVERY_HARNESS_INVENTORY_MISMATCH =
        "discovery_harness_inventory_mismatch";

    /** Per-stream status string: stream is fully ready. */
    public static final String STATUS_SUFFICIENT = "sufficient";

    /** Per-stream status string: stream has gaps that prerequisite work can close. */
    public static final String STATUS_PARTIAL = "partial";

    /** Per-stream status string: stream is missing critical inputs. */
    public static final String STATUS_INSUFFICIENT = "insufficient";
}
