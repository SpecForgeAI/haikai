package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link MigrationExecutionRunEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java
 * {@code enum}) to match the established AMS pattern used by
 * {@link MigrationStorySpecGenerationStatus} and
 * {@link GeneratedMigrationBookOfWorkStatus}. There is NO DB enum / CHECK on
 * the {@code status} column (matching the AMS status-as-TEXT convention for
 * run-state discriminators); the service layer validates against {@link #ALL}.
 * Adding values requires no DDL change since the column is plain TEXT.</p>
 *
 * <p>Lifecycle (a single run over one book of work):</p>
 * <ul>
 *   <li>{@code started}     -- the run was created and the first spec dispatched.</li>
 *   <li>{@code dispatching} -- a spec is mid-flight (shape-spec-answer / orchestration submit).</li>
 *   <li>{@code awaiting_approval} -- a plane completed (build / verify / reconcile); the run is
 *       PAUSED for a human "approve &amp; continue" before the next plane dispatches (Spec W).</li>
 *   <li>{@code halted}      -- a spec failed / was rejected; the run stopped and is recorded.</li>
 *   <li>{@code deployed}    -- the final spec's deployed build-results callback arrived;
 *       {@code target_base_url} recorded; reconciliation hand-off (Spec 4) is the next step.</li>
 *   <li>{@code failed}      -- a terminal failure of the run itself.</li>
 * </ul>
 *
 * <p>Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
 * Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1.</p>
 */
public final class MigrationExecutionRunStatus {

    public static final String STARTED = "started";
    public static final String DISPATCHING = "dispatching";
    /**
     * Phased execution (Spec W, 2026-07-17): a plane finished its
     * build / verify / reconcile and the run is PAUSED awaiting a human
     * "approve &amp; continue" before the next plane dispatches. No DDL change
     * is needed (the {@code status} column is plain TEXT; validation is here).
     */
    public static final String AWAITING_APPROVAL = "awaiting_approval";
    public static final String HALTED = "halted";
    public static final String DEPLOYED = "deployed";
    public static final String FAILED = "failed";

    /** The set of all allowed persisted run-status values. */
    public static final Set<String> ALL = Set.of(
        STARTED, DISPATCHING, AWAITING_APPROVAL, HALTED, DEPLOYED, FAILED
    );

    private MigrationExecutionRunStatus() {
        // utility / constants holder
    }
}
