package com.example.architecturemodel.model.dto.security;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The Security Overview rollup (Security health dashboard, 2026-07-19;
 * entity_id generalization second wave): severity counts per resolved model
 * entity over one report (latest by default), plus the Not-matched bucket.
 * Computed at READ time -- circle counts are never persisted into diagram
 * content.
 *
 * <p><b>Level-generic contract (changeset 213):</b> {@link #entities} carries
 * one entry per attributed entity AT THE REPORT'S ASSOCIATION LEVEL, with the
 * resolved live name and the ancestor chain ids
 * ({@code applicationId} / {@code applicationComponentId} -- null where not
 * applicable). The FRONTEND aggregates these to whatever hierarchy levels the
 * Security Summary displays (nearest-displayed-ancestor rule) using the
 * metaModel ancestry it already holds -- changing display nesting never needs
 * a server round-trip.</p>
 *
 * <p>{@link #applications} is the pre-213 wire shape, still populated for
 * {@code association_level=application} reports so older readers keep working;
 * new readers should consume {@link #entities}.</p>
 *
 * <p>Snake_case wire (AMS global default); severity count keys are the
 * normalized ladder values ({@code info|low|medium|high|critical}).</p>
 */
public record SecurityRollupDto(
    UUID reportId,
    Instant uploadedAt,
    String associationLevel,
    List<EntityEntry> entities,
    List<Entry> applications,
    Map<String, Long> unmatched,
    Map<String, Long> totals
) {

    /**
     * Severity counts for one resolved entity at the report's association
     * level, with its resolved ancestor ids for client-side aggregation.
     */
    public record EntityEntry(
        String level,
        String entityId,
        String entityName,
        String applicationId,
        String applicationComponentId,
        Map<String, Long> counts
    ) {
    }

    /** Pre-213 shape: severity counts for one resolved application. */
    public record Entry(
        String applicationId,
        String applicationName,
        Map<String, Long> counts
    ) {
    }
}
