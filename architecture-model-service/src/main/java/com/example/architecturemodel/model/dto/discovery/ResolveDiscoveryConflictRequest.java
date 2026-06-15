package com.example.architecturemodel.model.dto.discovery;

/**
 * Request body for {@code PATCH .../candidates/{candidateId}/resolve-conflict}.
 *
 * <p>The durable, single-attribute conflict-resolution write added by the
 * Conversational Discovery-Review "Architect" Persona spec (Spec 3, 2026-06-02)
 * Task Group 1. Today single-conflict resolution is CLIENT-SIDE-ONLY (the grid's
 * {@code handleResolveConflicts} mutates candidate {@code data} in React state and
 * persists only on save-back; no server write exists). This request drives a THIN
 * DETERMINISTIC server-side write so a conversational resolution is DURABLE
 * IMMEDIATELY: it sets the canonical attribute slot ({@code data[attr]}), stamps
 * {@code data._conflictResolutions[attr]}, and clears {@code data._conflicts[attr]}
 * -- a JSONB passthrough on the existing candidate {@code data} column, NO schema /
 * Liquibase change.</p>
 *
 * <p>The endpoint stays SINGLE-attribute: resolve-by-pattern (Spec 3 Decision 5) is
 * driven by the gateway issuing ONE call per similarity-class member, never by a
 * multi-attribute body.</p>
 *
 * <p><b>Wire format is snake_case</b> (global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}); no {@code @JsonNaming} / {@code @CamelCaseWire}
 * annotation needed. {@code attr} -&gt; {@code attr}, {@code chosenValue} -&gt;
 * {@code chosen_value}, {@code chosenSource} -&gt; {@code chosen_source},
 * {@code resolvedBy} -&gt; {@code resolved_by}, {@code resolvedAt} -&gt;
 * {@code resolved_at}.</p>
 *
 * <p><b>CRITICAL -- the snake_case wire stops at the request boundary.</b> The
 * service MAPS these request fields into <b>camelCase</b> keys
 * ({@code chosenValue} / {@code chosenSource} / {@code resolvedBy} /
 * {@code resolvedAt}) when it stamps {@code data._conflictResolutions[attr]}. The
 * candidate {@code data} JSONB is a passthrough MAP whose keys Jackson serializes
 * VERBATIM (the global SNAKE_CASE strategy does NOT rewrite map keys), and the
 * frontend reader ({@code DiscoveryCandidateTable.tsx} {@code handleResolveConflicts}
 * + the conflicts fixtures + {@code ConflictResolutionModal}) reads camelCase. So
 * snake_case keys INSIDE {@code data} would silently break the grid + the
 * conversation conflict reader -- the conflict would stay "live" forever despite
 * being resolved in the DB. The write shape therefore matches the grid's
 * {@code handleResolveConflicts} payload exactly, so a future grid refactor can
 * reuse this endpoint.</p>
 *
 * <p>{@code resolvedAt} is OPTIONAL on the wire: the gateway/orchestrator may stamp
 * a client timestamp, but the service falls back to {@code Instant.now()} when it is
 * null/blank so the resolution always carries a server-authoritative time (mirroring
 * how {@code reviewCandidate} stamps {@code reviewedAt}).</p>
 *
 * @param attr the conflicting attribute name (the key in {@code data._conflicts})
 * @param chosenValue the value the reviewer chose for {@code attr} (written to the
 *                    canonical slot {@code data[attr]} and recorded in the resolution)
 * @param chosenSource the source the chosen value came from (recorded in the resolution)
 * @param resolvedBy freeform label identifying who resolved the conflict (recorded in
 *                   the resolution; defaults to "anonymous" when null/blank)
 * @param resolvedAt optional ISO-8601 timestamp of the resolution; the server falls
 *                   back to {@code Instant.now()} when null/blank
 */
public record ResolveDiscoveryConflictRequest(
    String attr,
    Object chosenValue,
    String chosenSource,
    String resolvedBy,
    String resolvedAt
) {}
