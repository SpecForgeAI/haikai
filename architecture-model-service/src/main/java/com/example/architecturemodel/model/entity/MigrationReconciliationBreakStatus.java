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
 *   <li>{@link #EXPECTED_VOLATILE} -- a break whose divergence lands ENTIRELY on
 *       paths the volatility envelope recorded as legitimately non-deterministic
 *       (server timestamps, freshly-generated IDs, unordered collections). The
 *       gateway post-diff auto-disposition pass (sibling to the D6
 *       {@code expected_net_new} pass) recognises it when the break's value /
 *       ordering divergence is justified entirely by volatile paths with
 *       {@code volatility_source} in {@code {probed, probed_partial,
 *       endpoint_signal, declared}} (the higher-trust sources), then PATCHes the
 *       (already created, visible + auditable) break into this state with
 *       {@code needs_human=false} and a {@code detail_json} audit note listing
 *       the volatile paths + their source. It is NOT silent suppression: the
 *       break is created first and remains visible; a mixed volatile +
 *       non-volatile divergence stays {@code open} (the non-volatile part is a
 *       real break), and a divergence justified only by lower-trust
 *       {@code heuristic} paths is down-ranked to {@code info} (stays
 *       {@code open}), never auto-terminated.
 *       <p><b>Terminal + machine-set + human-overridable</b>, exactly like
 *       {@link #EXPECTED_NET_NEW}: it is TERMINAL (it lives in
 *       {@link #TERMINAL_HUMAN_DISPOSITIONS} so the loop does not re-bug / re-run
 *       it), MACHINE-SET (the gateway auto-disposition writes it), and
 *       HUMAN-OVERRIDABLE via the unchanged disposition PATCH path (a human can
 *       move an over-broadly-tolerated break back to {@code open} with one
 *       action, preserving the "oracle always breaks on a real divergence"
 *       invariant). Plain TEXT, NO DDL -- only {@link #ALL} (the validation set)
 *       and {@link #TERMINAL_HUMAN_DISPOSITIONS} (the no-auto-loop terminal set)
 *       gained the value.</p></li>
 * </ul>
 *
 * <p><b>Oracle invariant (CD-A):</b> the pinned current-state baseline is the
 * oracle ALWAYS; none of these dispositions mutate it. Intentional / deferred
 * deviations are handled here, by disposition, not by narrowing the oracle. The
 * D6 {@code expected_net_new} auto-disposition likewise only RECORDS the
 * additive endpoint -- it never narrows the pinned baseline. The
 * {@code expected_volatile} auto-disposition only ANNOTATES measured
 * non-determinism on the immutable baseline -- it never changes a captured
 * value, and a deliberately-changed NON-volatile value still breaks.</p>
 *
 * <p>Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) --
 * Task Group 1. Extended by Non-Reconciling Work at Reconcile Time
 * (2026-06-14, Spec 6 of 6 / D6) -- Task Group 1 (the {@code expected_net_new}
 * machine-set terminal value; NO new changeset -- the column is plain TEXT).
 * Extended by Reconcile-Time Determinism &amp; Volatile-Value Handling
 * (2026-06-16) -- Task Group 1 (the {@code expected_volatile} machine-set
 * terminal value; NO new changeset -- the column is plain TEXT).</p>
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

    // --- Machine-set terminal recognition (volatile-value handling) -------
    /**
     * The measured-volatility terminal state: a break whose value / ordering
     * divergence lands ENTIRELY on paths the volatility envelope recorded as
     * legitimately non-deterministic (higher-trust {@code volatility_source}:
     * {@code probed} / {@code probed_partial} / {@code endpoint_signal} /
     * {@code declared}). The gateway post-diff auto-disposition pass (sibling to
     * the {@link #EXPECTED_NET_NEW} pass) PATCHes the already-created, visible
     * break into this state with {@code needs_human=false} and a
     * {@code detail_json} audit note listing the volatile paths + source.
     * Terminal (no auto re-loop) + machine-set + human-overridable. It tolerates
     * VALUES + ORDERING only -- shape diffs on a volatile path STILL break, a
     * mixed volatile + non-volatile divergence stays {@code open}, and a
     * {@code heuristic}-only justification is down-ranked to {@code info} rather
     * than auto-terminated. NEVER silent suppression: the break is created and
     * visible first.
     */
    public static final String EXPECTED_VOLATILE = "expected_volatile";

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
        EXPECTED_NET_NEW,
        EXPECTED_VOLATILE
    );

    /**
     * The terminal dispositions that the idempotent callback / re-reconcile
     * short-circuit treats as a no-op: once set, the break is never sent and
     * never re-run (CD-A).
     *
     * <p>Holds the three human dispositions PLUS the machine-set
     * {@link #EXPECTED_NET_NEW} (an additive {@code net_new} endpoint recognised
     * at reconcile time) and {@link #EXPECTED_VOLATILE} (a divergence landing
     * entirely on measured-volatile paths). Both machine-set values are terminal
     * exactly like a human "accepted" -- the loop must not bug them or re-run
     * them. They are machine-set rather than human-chosen, but they share the
     * terminal no-auto-loop semantics, which is what this set gates. Both remain
     * human-overridable via the standard disposition PATCH path (see
     * {@link #EXPECTED_NET_NEW} / {@link #EXPECTED_VOLATILE}); membership here
     * never blocks an override.</p>
     */
    public static final Set<String> TERMINAL_HUMAN_DISPOSITIONS = Set.of(
        ACCEPTED, WONT_REPORT, INTENTIONAL_DEVIATION, EXPECTED_NET_NEW, EXPECTED_VOLATILE
    );

    private MigrationReconciliationBreakStatus() {
        // utility / constants holder
    }
}
