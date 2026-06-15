package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Status vocabulary for {@link MigrationStorySpecGenerationEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java
 * {@code enum}) to match the established AMS pattern used by
 * {@link GeneratedMigrationBookOfWorkStatus} (Spec 1) and
 * {@code DiscoveryRunEntity}'s status / discoveryKind / mode columns.
 * The DB CHECK constraint {@code chk_msg_status} (Liquibase changeset 140)
 * is the source of truth; renaming or adding values requires a NEW changeset
 * per {@code feedback_liquibase_immutable_changesets.md}.</p>
 *
 * <p>Status vocabulary (per spec.md "Status + confidence sentinels"):</p>
 * <ul>
 *   <li>{@code generated}             -- LLM produced a valid spec; gateway validator passed.</li>
 *   <li>{@code generated_with_warnings} -- LLM produced a spec but gateway attached warnings
 *       (e.g. confidence downgrade per R-7).</li>
 *   <li>{@code insufficient_context}  -- LLM (or gateway-pre-LLM token-cascade) reported the
 *       focused-context payload was insufficient; {@code missingInputs[]} populated.</li>
 *   <li>{@code failed}                -- LLM call, validator, or persistence failed.</li>
 *   <li>{@code skipped_blocked}       -- user explicitly toggled "Skip blocked stories" ON
 *       and this story was blocked (R-6, default OFF).</li>
 * </ul>
 *
 * <p>{@code not_attempted} is intentionally NOT a persisted status (A-6 / R-12) --
 * "not attempted" is computed in-memory by the summary endpoint as
 * {@code book_of_work_json.stories - rows-in-this-table}; no row is ever written
 * carrying that value.</p>
 *
 * <p>Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1.</p>
 */
public final class MigrationStorySpecGenerationStatus {

    public static final String GENERATED = "generated";
    public static final String GENERATED_WITH_WARNINGS = "generated_with_warnings";
    public static final String INSUFFICIENT_CONTEXT = "insufficient_context";
    public static final String FAILED = "failed";
    public static final String SKIPPED_BLOCKED = "skipped_blocked";

    /**
     * The set of all allowed persisted status values. Mirrors the DB CHECK
     * constraint {@code chk_msg_status} on changeset 140. Useful for
     * service-layer pre-validation before issuing the JDBC write.
     *
     * <p>Note: {@code not_attempted} is intentionally absent -- it is computed
     * lazily by the summary endpoint, never persisted (A-6).</p>
     */
    public static final Set<String> ALL = Set.of(
        GENERATED, GENERATED_WITH_WARNINGS, INSUFFICIENT_CONTEXT, FAILED, SKIPPED_BLOCKED
    );

    /**
     * Statuses considered "successfully generated" (either clean or with
     * gateway-attached warnings). Used by re-run idempotency: by default,
     * re-runs SKIP rows already at one of these statuses unless the
     * {@code regenerateAll=true} flag is passed (R-8).
     */
    public static final Set<String> SUCCESSFULLY_GENERATED = Set.of(
        GENERATED, GENERATED_WITH_WARNINGS
    );

    /**
     * Statuses considered "re-attemptable by default" on a re-run (R-8).
     * Excludes {@code skipped_blocked} -- that one only comes back via
     * explicit toggle on the next batch run (R-6).
     */
    public static final Set<String> REATTEMPTABLE_BY_DEFAULT = Set.of(
        FAILED, INSUFFICIENT_CONTEXT, GENERATED_WITH_WARNINGS
    );

    private MigrationStorySpecGenerationStatus() {
        // utility / constants holder
    }
}
