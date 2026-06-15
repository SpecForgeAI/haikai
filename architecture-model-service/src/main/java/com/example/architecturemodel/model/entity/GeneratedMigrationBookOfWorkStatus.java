package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link GeneratedMigrationBookOfWorkEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java {@code enum})
 * to match the existing AMS pattern used by {@code DiscoveryRunEntity}'s status
 * / discoveryKind / mode columns. The DB CHECK constraint {@code chk_gmbw_status}
 * (Liquibase changeset 139) is the source of truth; renaming or adding values
 * requires a NEW changeset per {@code feedback_liquibase_immutable_changesets.md}.</p>
 *
 * <p>Status lifecycle (per spec.md AMS section + Q-6):</p>
 * <ul>
 *   <li>{@code draft}            -- newly generated; under review.</li>
 *   <li>{@code reviewed}         -- reviewer has signed off but not yet saved to backlog.</li>
 *   <li>{@code partially_saved}  -- save-to-backlog ran; some items succeeded, some failed.</li>
 *   <li>{@code saved}            -- save-to-backlog ran; all admitted items succeeded.</li>
 *   <li>{@code archived}         -- superseded by a newer draft for the same tuple (Q-6 regenerate).</li>
 *   <li>{@code failed}           -- generation or persistence failed; see {@code error_message}.</li>
 * </ul>
 *
 * <p>Spec: Product Manager Migration Delivery Plan (2026-05-17) -- Task Group 1.</p>
 */
public final class GeneratedMigrationBookOfWorkStatus {

    public static final String DRAFT = "draft";
    public static final String REVIEWED = "reviewed";
    public static final String PARTIALLY_SAVED = "partially_saved";
    public static final String SAVED = "saved";
    public static final String ARCHIVED = "archived";
    public static final String FAILED = "failed";

    /**
     * The set of all allowed status values. Mirrors the DB CHECK constraint
     * {@code chk_gmbw_status} on changeset 139. Useful for service-layer
     * pre-validation before issuing the JDBC write.
     */
    public static final Set<String> ALL = Set.of(
        DRAFT, REVIEWED, PARTIALLY_SAVED, SAVED, ARCHIVED, FAILED
    );

    /**
     * The set of statuses considered "active" (i.e. NOT archived). Used by the
     * default list endpoint and the Q-6 regenerate-on-same-tuple archive lookup.
     */
    public static final Set<String> ACTIVE = Set.of(
        DRAFT, REVIEWED, PARTIALLY_SAVED, SAVED, FAILED
    );

    private GeneratedMigrationBookOfWorkStatus() {
        // utility / constants holder
    }
}
