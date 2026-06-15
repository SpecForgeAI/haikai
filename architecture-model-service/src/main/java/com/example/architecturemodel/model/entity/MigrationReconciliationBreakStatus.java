package com.example.architecturemodel.model.entity;

import java.util.Set;

/**
 * Disposition-lifecycle vocabulary for {@link MigrationReconciliationBreakEntity}.
 *
 * <p>Held as {@code public static final String} constants (not a Java
 * {@code enum}) to match the established AMS status-as-TEXT convention used by
 * {@link MigrationExecutionRunStatus} and
 * {@link MigrationStorySpecGenerationStatus}. There is NO DB enum / CHECK on the
 * {@code disposition_status} column; the service layer validates against
 * {@link #ALL}. Adding values requires no DDL change since the column is plain
 * TEXT.</p>
 *
 * <p>A "break" is a drifting {@code api_behaviour_diff_item}: the target
 * response diverged from the pinned current-state oracle for the same request.
 * The lifecycle splits into two arcs.</p>
 *
 * <h2>Machine states (the deploy -&gt; reconcile -&gt; bug -&gt; re-reconcile loop)</h2>
 * <ul>
 *   <li>{@link #OPEN} -- new break recorded by the full-baseline reconcile; not
 *       yet sent, not yet disposed.</li>
 *   <li>{@link #SENT_AS_BUG} -- the human selected this break and it was sent in
 *       a bug report ({@code bug_id} set, {@code attempt_count} N).</li>
 *   <li>{@link #FIXED_CONFIRMED} -- a {@code bug_id}+{@code deployed} callback
 *       re-reconciled JUST this break's source operation and it now matches the
 *       oracle (terminal-clean).</li>
 *   <li>{@link #STILL_BROKEN} -- the scoped re-reconcile still diverged; the
 *       break is reopened and the attempt counter advanced.</li>
 *   <li>{@link #CIRCUIT_BROKEN_ESCALATED} -- the bounded re-run round tripped the
 *       circuit breaker (max attempts) OR a {@code bug_id}+{@code failed}/{@code
 *       rejected} outcome arrived; escalated to a human, NO auto re-loop.</li>
 * </ul>
 *
 * <h2>Human dispositions (terminal; never re-run)</h2>
 * <ul>
 *   <li>{@link #ACCEPTED} -- accepted / won't-report: an intentional deviation
 *       (an edited spec that deliberately changes behaviour) or a deferred /
 *       un-implemented story's divergence. This is how those deviations are
 *       recorded WITHOUT changing the oracle (CD-A). Terminal: not sent, not
 *       re-run.</li>
 *   <li>{@link #WONT_REPORT} -- explicit "won't report" synonym for the accepted
 *       disposition (some callers prefer the verb form); same terminal semantics.</li>
 *   <li>{@link #INTENTIONAL_DEVIATION} -- explicit "intentional deviation"
 *       disposition; same terminal semantics. Kept distinct so the review UI can
 *       record WHY a break was not sent. A DEVIATION is a deliberate CHANGE to
 *       existing behaviour.</li>
 * </ul>
 *
 * <h2>Machine-set terminal recognition (D6, additive-endpoint auto-disposition)</h2>
 * <ul>
 *   <li>{@link #EXPECTED_NET_NEW} -- a {@code target_only} diff for a
 *       deliberately-added {@code net_new} API endpoint (present in the migrated
 *       target, absent from the pinned current-state baseline). The gateway
 *       post-diff auto-disposition pass (D6) recognises it by matching the
 *       break's normalised {@code <METHOD> <path>} key against a {@code net_new}
 *       work item's {@code net_new_operations} list, then PATCHes the (already
 *       created, visible + auditable) break into this state with
 *       {@code needs_human=false} and a {@code detail_json} audit note naming the
 *       matched work item. It is ADDITIVE (brand-new functionality), NOT a
 *       DEVIATION -- so it is a distinct value, deliberately NOT reused
 *       {@code intentional_deviation}.
 *       <p><b>Terminal + machine-set + human-overridable.</b> It is TERMINAL
 *       (it lives in {@link #TERMINAL_HUMAN_DISPOSITIONS} so the idempotent
 *       re-reconcile / callback short-circuit treats it like the human
 *       dispositions: never sent, never auto re-run). It is MACHINE-SET (the
 *       gateway auto-disposition writes it, not a human). It stays
 *       HUMAN-OVERRIDABLE: the standard disposition PATCH path
 *       ({@code validateDispositionStatus} accepts ANY value in {@link #ALL},
 *       including moving a break OUT of {@code expected_net_new} back to
 *       {@code open}) is unchanged, so a human can re-open / re-classify a
 *       wrongly-matched break (D7). Membership in
 *       {@link #TERMINAL_HUMAN_DISPOSITIONS} only governs the no-auto-loop
 *       short-circuit; it never blocks a human override.</p></li>
 * </ul>
 *
 * <p><b>Oracle invariant (CD-A):</b> the pinned current-state baseline is the
 * oracle ALWAYS; none of these dispositions mutate it. Intentional / deferred
 * deviations are handled here, by disposition, not by narrowing the oracle. The
 * D6 {@code expected_net_new} auto-disposition likewise only RECORDS the
 * additive endpoint -- it never narrows the pinned baseline.</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1. Extended by Non-Reconciling Work at Reconcile Time
 * (2026-06-14, Spec 6 of 6 / D6) -- Task Group 1 (the {@code expected_net_new}
 * machine-set terminal value; NO new changeset -- the column is plain TEXT).</p>
 */
public final class MigrationReconciliationBreakStatus {

    // --- Machine states ---------------------------------------------------
    public static final String OPEN = "open";
    public static final String SENT_AS_BUG = "sent_as_bug";
    public static final String FIXED_CONFIRMED = "fixed_confirmed";
    public static final String STILL_BROKEN = "still_broken";
    public static final String CIRCUIT_BROKEN_ESCALATED = "circuit_broken_escalated";

    // --- Human dispositions (terminal) ------------------------------------
    public static final String ACCEPTED = "accepted";
    public static final String WONT_REPORT = "wont_report";
    public static final String INTENTIONAL_DEVIATION = "intentional_deviation";

    // --- Machine-set terminal recognition (D6) ----------------------------
    /**
     * The additive-endpoint terminal state (D6): a {@code target_only} diff that
     * the gateway auto-disposition pass matched to a {@code net_new} work item.
     * Terminal (no auto re-loop) + machine-set + human-overridable. ADDITIVE,
     * NOT a deviation -- distinct from {@link #INTENTIONAL_DEVIATION}.
     */
    public static final String EXPECTED_NET_NEW = "expected_net_new";

    /** The set of all allowed persisted disposition-status values. */
    public static final Set<String> ALL = Set.of(
        OPEN,
        SENT_AS_BUG,
        FIXED_CONFIRMED,
        STILL_BROKEN,
        CIRCUIT_BROKEN_ESCALATED,
        ACCEPTED,
        WONT_REPORT,
        INTENTIONAL_DEVIATION,
        EXPECTED_NET_NEW
    );

    /**
     * The terminal dispositions that the idempotent callback / re-reconcile
     * short-circuit treats as a no-op: once set, the break is never sent and
     * never re-run (CD-A).
     *
     * <p>Holds the three human dispositions PLUS the D6 machine-set
     * {@link #EXPECTED_NET_NEW}: an additive {@code net_new} endpoint recognised
     * at reconcile time is terminal exactly like a human "accepted" -- the loop
     * must not bug it or re-run it. It is machine-set rather than human-chosen,
     * but it shares the terminal no-auto-loop semantics, which is what this set
     * gates. It remains human-overridable via the standard disposition PATCH
     * path (see {@link #EXPECTED_NET_NEW}); membership here never blocks an
     * override.</p>
     */
    public static final Set<String> TERMINAL_HUMAN_DISPOSITIONS = Set.of(
        ACCEPTED, WONT_REPORT, INTENTIONAL_DEVIATION, EXPECTED_NET_NEW
    );

    private MigrationReconciliationBreakStatus() {
        // utility / constants holder
    }
}
