package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link MigrationExecutionRunItemEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java
 * {@code enum}) to match the established AMS pattern used by
 * {@link MigrationStorySpecGenerationStatus} and
 * {@link GeneratedMigrationBookOfWorkStatus}. There is NO DB enum / CHECK on
 * the {@code status} column; the service layer validates against {@link #ALL}.</p>
 *
 * <p>Per-spec lifecycle (one row per dispatched spec; advanced by the Driver
 * over durable run-state, event-driven on build-results callbacks):</p>
 * <ul>
 *   <li>{@code pending}     -- sequenced into the run, not yet started.</li>
 *   <li>{@code answering}   -- the headless shape-spec auto-answerer is driving the stream.</li>
 *   <li>{@code submitting}  -- the orchestration submit is in flight.</li>
 *   <li>{@code submitted}   -- the orchestration job was created; {@code job_id} correlated.</li>
 *   <li>{@code implemented} -- the build-results {@code implemented} callback arrived.</li>
 *   <li>{@code deployed}    -- the build-results {@code deployed} callback arrived (final spec).</li>
 *   <li>{@code failed}      -- the build-results {@code failed} callback arrived.</li>
 *   <li>{@code rejected}    -- the build-results {@code rejected} callback arrived.</li>
 * </ul>
 *
 * <p>{@code answering} / {@code submitting} with no {@code job_id} yet is the
 * "stuck mid-segment" signal the gateway boot-recovery sweep re-kicks (CD-2).</p>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
public final class MigrationExecutionRunItemStatus {

    public static final String PENDING = "pending";
    public static final String ANSWERING = "answering";
    public static final String SUBMITTING = "submitting";
    public static final String SUBMITTED = "submitted";
    public static final String IMPLEMENTED = "implemented";
    public static final String DEPLOYED = "deployed";
    public static final String FAILED = "failed";
    public static final String REJECTED = "rejected";

    /** The set of all allowed persisted run-item status values. */
    public static final Set<String> ALL = Set.of(
        PENDING, ANSWERING, SUBMITTING, SUBMITTED,
        IMPLEMENTED, DEPLOYED, FAILED, REJECTED
    );

    /**
     * Terminal outcome values that the build-results callback records on a
     * run-item's {@code outcome} column. A duplicate callback for an item that
     * already carries one of these is the idempotent no-op the Driver advance
     * recognises (CD-6).
     */
    public static final Set<String> TERMINAL_OUTCOMES = Set.of(
        IMPLEMENTED, DEPLOYED, FAILED, REJECTED
    );

    private MigrationExecutionRunItemStatus() {
        // utility / constants holder
    }
}
