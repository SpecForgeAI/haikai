package com.example.sybasesidecar.service;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * JVM-layer SQL guard for the Sybase sidecar.
 *
 * <p>Spec: 2026-05-16 Database Discovery Packs - Task Group 4 (sidecar).</p>
 *
 * <p>This is the third layer of defense. The discovery-service applies its
 * own {@code sqlGuard.ts} before the HTTP egress; this class re-enforces the
 * SELECT-only contract at the JVM layer so that even a sidecar invoked
 * directly (e.g. by mistake from another caller) cannot mutate data.</p>
 *
 * <p>Rejected on sight:</p>
 * <ul>
 *   <li>Forbidden keywords (case-insensitive, word-boundary):
 *       {@code INSERT, UPDATE, DELETE, MERGE, DROP, ALTER, TRUNCATE, EXEC,
 *       CALL, GRANT, REVOKE, CREATE, SP_*}.</li>
 *   <li>Multi-statement input (a {@code ;} followed by more SQL).</li>
 *   <li>SQL that does not begin with {@code SELECT} or {@code WITH} (CTE).</li>
 *   <li>Empty / whitespace-only SQL.</li>
 * </ul>
 *
 * <p>SQL comments (line and block forms) are stripped before keyword
 * keyword analysis so that a malicious caller cannot smuggle DML inside a
 * comment that is later un-commented by the engine.</p>
 *
 * <h2>Introspection job-proc allowlist (metadata-enrichment spec 2026-05-31,
 * Task Group 4 / decision 8)</h2>
 * <p>Group 6 (DB-resident jobs) reads the Sybase Job Scheduler. The
 * {@code /introspect} catalog reads are hardcoded {@link java.sql.PreparedStatement}s
 * that already BYPASS this guard (the guard is only pre-flighted on the
 * {@code /query} endpoint, in {@code SidecarController#query}). The allowlist
 * below does NOT relax {@code /query}: {@link #assertReadonlySelect} still
 * blanket-blocks ALL {@code sp_*} / {@code xp_*}. Instead, the allowlist exists
 * to make the EXACT set of read-only Job Scheduler procedures the introspection
 * job path is permitted to invoke explicit and auditable, and is reachable ONLY
 * via {@link #assertAllowlistedIntrospectionProc} (never from the {@code /query}
 * path).</p>
 *
 * <p>Allowlisted read-only Job Scheduler procedures (EXACTLY these two; both are
 * reporting-only and perform no writes / configuration changes):</p>
 * <ul>
 *   <li>{@code sp_sjobhistory} -- reports Job Scheduler run history (read-only).</li>
 *   <li>{@code sp_sjoblist} -- lists the defined Job Scheduler jobs (read-only).</li>
 * </ul>
 * <p>Every mutating Job Scheduler proc ({@code sp_sjobcreate},
 * {@code sp_sjobmodify}, {@code sp_sjobdrop}, {@code sp_sjobcontrol}, ...) is
 * deliberately EXCLUDED and stays blocked everywhere.</p>
 */
public final class SidecarSqlGuard {

    private SidecarSqlGuard() {
        // utility class
    }

    /**
     * Forbidden keyword list. Anything matching these word-boundary patterns
     * fails the guard. {@code sp_*} is included so the caller cannot invoke
     * system stored procedures that may have side effects on Sybase.
     */
    private static final List<String> FORBIDDEN_KEYWORDS = List.of(
            "INSERT",
            "UPDATE",
            "DELETE",
            "MERGE",
            "DROP",
            "ALTER",
            "TRUNCATE",
            "EXEC",
            "CALL",
            "GRANT",
            "REVOKE",
            "CREATE"
    );

    /**
     * Pattern that catches the forbidden DDL/DML keywords above. Built once
     * at class-load time.
     */
    private static final Pattern FORBIDDEN_KEYWORD_PATTERN = Pattern.compile(
            "\\b(?:" + String.join("|", FORBIDDEN_KEYWORDS) + ")\\b",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Pattern for Sybase system stored procedures (sp_*, xp_*). These can
     * perform writes / configuration changes and must be blocked at the
     * sidecar layer.
     */
    private static final Pattern SP_CALL_PATTERN = Pattern.compile(
            "\\b(?:sp|xp)_[A-Za-z_]+\\b",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * The NARROW, explicit allowlist of read-only Job Scheduler procedures the
     * introspection job path (group 6) is permitted to invoke. EXACTLY these
     * two reporting-only procs; every other {@code sp_*} / {@code xp_*} (incl.
     * mutating Job Scheduler procs) stays blocked. Lower-cased for a
     * case-insensitive membership test. Spec 2026-05-31, decision 8.
     *
     * <ul>
     *   <li>{@code sp_sjobhistory} -- Job Scheduler run history (read-only).</li>
     *   <li>{@code sp_sjoblist} -- list of defined Job Scheduler jobs (read-only).</li>
     * </ul>
     *
     * <p>NB: this allowlist is consulted ONLY by
     * {@link #assertAllowlistedIntrospectionProc}; the {@code /query} guard
     * ({@link #assertReadonlySelect}) does NOT consult it and continues to
     * blanket-block all {@code sp_*} / {@code xp_*}.</p>
     */
    private static final Set<String> ALLOWLISTED_INTROSPECTION_PROCS = Set.of(
            "sp_sjobhistory",
            "sp_sjoblist"
    );

    /**
     * Strip SQL comments so the keyword scan sees the real query text.
     * Block comments first (so they can wrap a {@code --}), then line comments.
     */
    private static String stripComments(final String sql) {
        String stripped = sql.replaceAll("/\\*[\\s\\S]*?\\*/", " ");
        stripped = stripped.replaceAll("--[^\\n\\r]*", " ");
        return stripped;
    }

    /**
     * Assert the given SQL is a safe read-only SELECT. Throws
     * {@link SqlGuardException} on any violation. Returns the trimmed SQL on
     * success so callers can pass it straight through to the JDBC layer.
     *
     * <p>This is the {@code /query}-endpoint guard. It is UNCHANGED by the
     * metadata-enrichment spec: it still blanket-blocks ALL {@code sp_*} /
     * {@code xp_*} (the introspection job-proc allowlist is NOT consulted
     * here).</p>
     *
     * @param rawSql the SQL text to validate
     * @return the trimmed SQL on success
     * @throws SqlGuardException if the SQL violates the read-only contract
     */
    public static String assertReadonlySelect(final String rawSql) {
        if (rawSql == null) {
            throw new SqlGuardException("SQL is null.", "empty");
        }
        final String sql = rawSql.trim();
        if (sql.isEmpty()) {
            throw new SqlGuardException("SQL is empty.", "empty");
        }

        final String stripped = stripComments(sql).trim();

        // Multi-statement check: trailing single ';' is OK, anything after
        // the first ';' that contains non-whitespace text is a violation.
        final int semiIdx = stripped.indexOf(';');
        if (semiIdx >= 0 && !stripped.substring(semiIdx + 1).trim().isEmpty()) {
            throw new SqlGuardException(
                    "Multiple SQL statements are not permitted. Provide a single SELECT.",
                    "multi_statement"
            );
        }

        if (FORBIDDEN_KEYWORD_PATTERN.matcher(stripped).find()) {
            throw new SqlGuardException(
                    "SQL contains a forbidden keyword. Only SELECT statements are permitted.",
                    "forbidden_keyword"
            );
        }
        if (SP_CALL_PATTERN.matcher(stripped).find()) {
            throw new SqlGuardException(
                    "SQL references a system stored procedure (sp_*/xp_*). Not permitted via the sidecar /query endpoint.",
                    "forbidden_keyword"
            );
        }

        // First word must be SELECT or WITH.
        final String firstWord = stripped.split("\\s+", 2)[0].toUpperCase();
        if (!"SELECT".equals(firstWord) && !"WITH".equals(firstWord)) {
            throw new SqlGuardException(
                    "SQL must begin with SELECT (or WITH ... SELECT). Found: " + firstWord + ".",
                    "not_select"
            );
        }
        return sql;
    }

    /**
     * TRUE when {@code procName} is one of the EXACT read-only Job Scheduler
     * procedures the introspection job path is allowed to invoke (group 6,
     * decision 8). Case-insensitive; trims surrounding whitespace. Pure: this
     * is the membership test {@link #assertAllowlistedIntrospectionProc} and
     * the unit tests share. The {@code /query} guard does NOT call this.
     */
    public static boolean isAllowlistedIntrospectionProc(final String procName) {
        if (procName == null) {
            return false;
        }
        return ALLOWLISTED_INTROSPECTION_PROCS.contains(procName.trim().toLowerCase(Locale.ROOT));
    }

    /**
     * Assert that {@code procName} is an allowlisted read-only Job Scheduler
     * procedure usable by the introspection job path (group 6). Throws
     * {@link SqlGuardException} with reason {@code forbidden_keyword} for any
     * proc NOT on the narrow allowlist (incl. every mutating Job Scheduler proc
     * and all other {@code sp_*} / {@code xp_*}).
     *
     * <p>This entry point is reachable ONLY from the introspection job read; it
     * is intentionally separate from {@link #assertReadonlySelect} so the
     * {@code /query} endpoint remains blanket-blocking for all procs.</p>
     *
     * @param procName the bare procedure name (e.g. {@code sp_sjobhistory})
     * @return the trimmed proc name on success
     * @throws SqlGuardException if the proc is not on the introspection allowlist
     */
    public static String assertAllowlistedIntrospectionProc(final String procName) {
        if (procName == null || procName.trim().isEmpty()) {
            throw new SqlGuardException("Procedure name is empty.", "empty");
        }
        if (!isAllowlistedIntrospectionProc(procName)) {
            throw new SqlGuardException(
                    "Procedure '" + procName.trim() + "' is not on the read-only introspection "
                            + "job-proc allowlist.",
                    "forbidden_keyword"
            );
        }
        return procName.trim();
    }

    /**
     * Exception thrown by the guard. Carries a machine-readable reason code
     * the HTTP layer turns into a structured error payload.
     */
    public static class SqlGuardException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        private final String reason;

        public SqlGuardException(final String message, final String reason) {
            super(message);
            this.reason = reason;
        }

        public String getReason() {
            return this.reason;
        }
    }
}
