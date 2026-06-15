package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link DbMigrationPackEntity}.
 *
 * <p>Two values only (the DB CHECK constraint {@code chk_dmp_status},
 * Liquibase changeset 172, is the source of truth):</p>
 * <ul>
 *   <li>{@link #GENERATED} -- the pack files reflect the last explicit
 *       generation run over the recorded {@code input_snapshot_hash}.</li>
 *   <li>{@link #STALE} -- the generation inputs have drifted (snapshot-hash
 *       mismatch) OR a pack decision was resolved since generation. A stale
 *       pack is NEVER auto-regenerated -- Regenerate is always an explicit
 *       user action; staleness only ever shows a banner.</li>
 * </ul>
 *
 * <p>Modeled on {@link GeneratedMigrationBookOfWorkStatus} (plain string
 * constants, no Java enum, so the wire/DB representation stays a free
 * string validated at the service layer).</p>
 *
 * <p>Spec: Source-Grade DB Schema + Data Migration Pack (2026-06-11) --
 * Task Group 1.</p>
 */
public final class DbMigrationPackStatus {

    public static final String GENERATED = "generated";
    public static final String STALE = "stale";

    /** All allowed status values, mirroring chk_dmp_status. */
    public static final Set<String> ALL = Set.of(GENERATED, STALE);

    private DbMigrationPackStatus() {
        // Constants holder - prevent instantiation
    }
}
