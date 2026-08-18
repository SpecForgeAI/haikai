package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link SclScanEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java
 * {@code enum}) to match the established AMS pattern used by
 * {@link MigrationExecutionRunStatus} and its siblings. There is NO DB enum /
 * CHECK on the {@code status} column (matching the AMS status-as-TEXT
 * convention for run-state discriminators); the service layer validates
 * against {@link #ALL}. Adding values requires no DDL change since the column
 * is plain TEXT.</p>
 *
 * <p>Lifecycle (a single SCL mining scan over one (project, architecture)):</p>
 * <ul>
 *   <li>{@code in_progress} -- the scan was created and the miner is streaming
 *       contract batches into the corpus (the DB DEFAULT, changeset 224).</li>
 *   <li>{@code completed}   -- the miner finished; the corpus for this scan is
 *       complete and readable as a whole.</li>
 *   <li>{@code failed}      -- the miner aborted; partial corpus rows remain
 *       for diagnosis but the scan is terminal.</li>
 * </ul>
 *
 * <p>Spec: SCL corpus persistence (Structural Contract Language) (2026-08-18).</p>
 */
public final class SclScanStatus {

    public static final String IN_PROGRESS = "in_progress";
    public static final String COMPLETED = "completed";
    public static final String FAILED = "failed";

    /** The set of all allowed persisted scan-status values. */
    public static final Set<String> ALL = Set.of(IN_PROGRESS, COMPLETED, FAILED);

    private SclScanStatus() {
        // utility / constants holder
    }
}
