package com.example.dbsidecar.service;

import com.example.dbsidecar.model.CallParam;
import com.example.dbsidecar.model.CallRequest;
import com.example.dbsidecar.model.SidecarEngine;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * JVM-layer guard for the {@code /call} endpoint (Stored-Proc Behaviour
 * Program, Spec 2 -- the sidecar's routine-invocation surface).
 *
 * <p>The other two guards police SQL TEXT: {@link SidecarSqlGuard} keeps
 * {@code /query} SELECT-only and {@link MutationSqlGuard} admits exactly the
 * compensation grammar on {@code /mutate}. This guard has no SQL text to
 * police -- {@code /call} carries none. What it polices instead is the small
 * set of caller-supplied tokens that reach the composed call string or the
 * session preamble:</p>
 *
 * <ul>
 *   <li><b>Routine identifier</b> -- 1 to 3 dot-separated parts, each a bare
 *       identifier {@code ^[A-Za-z_][A-Za-z0-9_]*$}. No quoting, no brackets,
 *       no whitespace, no semicolons: the composed
 *       {@code &#123;?= call db.dbo.name(?, ?)&#125;} therefore cannot carry
 *       injected SQL.</li>
 *   <li><b>System procedures</b> -- anything named {@code sp_*} / {@code xp_*}
 *       is refused unless it is on
 *       {@link SidecarSqlGuard#isAllowlistedIntrospectionProc} (the narrow
 *       read-only Job Scheduler allowlist). A caller must not reach
 *       {@code sp_configure} and friends through the invocation surface.</li>
 *   <li><b>Parameter count</b> -- at most 255 on Sybase ASE and 2100 on SQL
 *       Server, each the engine's own ceiling; it also bounds the bind
 *       loop.</li>
 *   <li><b>Session SET lines</b> -- these ARE executed as statements, so they
 *       are matched WHOLE against a fixed PER-ENGINE allowlist of harmless
 *       session options. Nothing else is executable through this endpoint.</li>
 * </ul>
 *
 * <p>Every violation throws {@link SidecarSqlGuard.SqlGuardException} with a
 * machine-readable reason token: {@code bad_routine_name},
 * {@code system_proc_blocked}, {@code too_many_params},
 * {@code bad_session_set}.</p>
 */
public final class CallSqlGuard {

    private CallSqlGuard() {
        // utility class
    }

    /** Reason token: the routine identifier is missing / malformed / over-qualified. */
    public static final String REASON_BAD_ROUTINE_NAME = "bad_routine_name";
    /** Reason token: a non-allowlisted {@code sp_*} / {@code xp_*} procedure. */
    public static final String REASON_SYSTEM_PROC_BLOCKED = "system_proc_blocked";
    /** Reason token: more than {@link #MAX_PARAMS} parameters. */
    public static final String REASON_TOO_MANY_PARAMS = "too_many_params";
    /** Reason token: a session SET line outside the allowlist. */
    public static final String REASON_BAD_SESSION_SET = "bad_session_set";

    /** ASE's own ceiling on procedure parameters; also bounds the bind loop. */
    public static final int MAX_PARAMS = 255;

    /** SQL Server's own ceiling on procedure parameters (wire contract §5). */
    public static final int MAX_PARAMS_MSSQL = 2100;

    /** The parameter ceiling for one engine. Pure. */
    public static int maxParams(final SidecarEngine engine) {
        return engine == SidecarEngine.MSSQL ? MAX_PARAMS_MSSQL : MAX_PARAMS;
    }

    /** Maximum dot-separated parts in a qualified routine name (db.schema.name). */
    public static final int MAX_NAME_PARTS = 3;

    /** A bare SQL identifier -- the ONLY shape any name part may take. */
    static final Pattern IDENTIFIER = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");

    /** System-procedure prefixes blocked unless explicitly allowlisted. */
    private static final Pattern SYSTEM_PROC_PREFIX = Pattern.compile("^(?:sp|xp)_.*$");

    /**
     * The complete allowlist of executable session SET forms. Each pattern
     * matches a WHOLE line (anchored, case-insensitive) after trimming and
     * whitespace-run collapsing. These options change how the routine's own
     * body behaves ({@code nocount} suppresses the DONE_IN_PROC counts,
     * {@code chained} flips implicit-transaction semantics, {@code rowcount}
     * caps affected rows, ...) which is exactly the session profile a
     * behaviour capture needs to pin. Nothing that writes data, changes
     * configuration, or names an object is admitted.
     */
    private static final List<Pattern> SESSION_SET_FORMS = List.of(
            Pattern.compile(
                    "^set (?:ansinull|arithabort|chained|quoted_identifier|nocount"
                            + "|string_rtruncation|ansi_permissions) (?:on|off)$",
                    Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set rowcount \\d+$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set textsize \\d+$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set dateformat (?:mdy|dmy|ymd|ydm|myd|dym)$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set transaction isolation level [0-3]$", Pattern.CASE_INSENSITIVE)
    );

    /**
     * The SQL Server SET allowlist (SPEC-1 §1.5). The set is deliberately
     * WIDER than ASE's because SQL Server routine behaviour genuinely depends
     * on more session options -- {@code xact_abort} decides whether an error
     * aborts the whole transaction, {@code ansi_nulls} /
     * {@code quoted_identifier} are baked into a routine's compiled plan, and
     * {@code implicit_transactions} flips the transaction model the way ASE's
     * {@code chained} does. Every one of them CHANGES what the capture
     * observes, which is exactly why the profile must be pinnable. Nothing
     * that writes data, changes server configuration or names an object is
     * admitted, and the isolation levels are spelled out by NAME (SQL Server
     * has no numeric form).
     */
    private static final List<Pattern> MSSQL_SESSION_SET_FORMS = List.of(
            Pattern.compile(
                    "^set (?:ansi_nulls|ansi_padding|ansi_warnings|arithabort"
                            + "|quoted_identifier|nocount|xact_abort|concat_null_yields_null"
                            + "|implicit_transactions|numeric_roundabort|ansi_null_dflt_on) "
                            + "(?:on|off)$",
                    Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set rowcount \\d+$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set textsize \\d+$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set dateformat (?:mdy|dmy|ymd|ydm|myd|dym)$",
                    Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set datefirst [1-7]$", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set language \\w+$", Pattern.CASE_INSENSITIVE),
            Pattern.compile(
                    "^set transaction isolation level (?:read uncommitted|read committed"
                            + "|repeatable read|snapshot|serializable)$",
                    Pattern.CASE_INSENSITIVE),
            Pattern.compile("^set lock_timeout -?\\d+$", Pattern.CASE_INSENSITIVE)
    );

    /** The SET allowlist for one engine. Pure. */
    static List<Pattern> sessionSetForms(final SidecarEngine engine) {
        return engine == SidecarEngine.MSSQL ? MSSQL_SESSION_SET_FORMS : SESSION_SET_FORMS;
    }

    /**
     * Full pre-flight for one {@code /call} request. Called by the controller
     * BEFORE any JDBC work (a rejection is HTTP 400, a contract violation, not
     * a retryable runtime failure) and re-asserted by
     * {@link RoutineCallService} -- no caller is trusted, matching the
     * two-layer posture of the read and write paths.
     *
     * @return the resolved, guard-proven qualified routine name
     *     (e.g. {@code dbo.upd_ledger_roll}) ready for the call composer
     * @throws SidecarSqlGuard.SqlGuardException on any violation
     */
    public static String assertCall(final CallRequest req) {
        if (req == null) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Call request is null.", REASON_BAD_ROUTINE_NAME);
        }
        final SidecarEngine engine = req.resolveEngine();
        final String qualified = assertRoutineName(req.getSchemaName(), req.getRoutineName());
        assertParamCount(req.resolveParams(), engine);
        assertSessionSet(req.resolveSessionSet(), engine);
        return qualified;
    }

    /**
     * Validate the routine identifier and return its qualified form.
     *
     * <p>Resolution: a DOTTED {@code routineName} is authoritative and the
     * {@code schemaName} field is ignored (the caller fully qualified it);
     * otherwise the schema (itself possibly dotted, e.g. {@code db.dbo}, and
     * defaulting to {@code dbo} when blank) is prefixed. The result is split
     * on {@code .} and every part must be a bare identifier, with at most
     * {@link #MAX_NAME_PARTS} parts.</p>
     */
    public static String assertRoutineName(final String schemaName, final String routineName) {
        final String routine = routineName == null ? "" : routineName.trim();
        if (routine.isEmpty()) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Routine name is empty.", REASON_BAD_ROUTINE_NAME);
        }
        final String schema = schemaName == null ? "" : schemaName.trim();
        final String qualified;
        if (routine.indexOf('.') >= 0 || schema.isEmpty()) {
            qualified = routine;
        } else {
            qualified = schema + "." + routine;
        }

        final String[] parts = qualified.split("\\.", -1);
        if (parts.length > MAX_NAME_PARTS) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Routine name '" + qualified + "' has " + parts.length
                            + " parts; at most " + MAX_NAME_PARTS
                            + " (database.schema.routine) are permitted.",
                    REASON_BAD_ROUTINE_NAME);
        }
        for (final String part : parts) {
            if (!IDENTIFIER.matcher(part).matches()) {
                throw new SidecarSqlGuard.SqlGuardException(
                        "Routine name part '" + part
                                + "' is not a bare identifier ([A-Za-z_][A-Za-z0-9_]*).",
                        REASON_BAD_ROUTINE_NAME);
            }
        }

        final String bare = parts[parts.length - 1];
        if (SYSTEM_PROC_PREFIX.matcher(bare.toLowerCase(Locale.ROOT)).matches()
                && !SidecarSqlGuard.isAllowlistedIntrospectionProc(bare)) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "System procedure '" + bare + "' (sp_*/xp_*) is not invocable via /call.",
                    REASON_SYSTEM_PROC_BLOCKED);
        }
        return qualified;
    }

    /** Refuse a parameter list longer than {@link #MAX_PARAMS} (Sybase). */
    public static void assertParamCount(final List<CallParam> params) {
        assertParamCount(params, SidecarEngine.SYBASE);
    }

    /** Refuse a parameter list longer than the engine's own ceiling. */
    public static void assertParamCount(
            final List<CallParam> params, final SidecarEngine engine) {
        final int size = params == null ? 0 : params.size();
        final int ceiling = maxParams(engine);
        if (size > ceiling) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Too many parameters (" + size + "); at most " + ceiling + " are permitted.",
                    REASON_TOO_MANY_PARAMS);
        }
    }

    /**
     * Validate every session SET line and return the NORMALISED forms (trimmed,
     * whitespace-runs collapsed) that the service is permitted to execute.
     */
    public static List<String> assertSessionSet(final List<String> lines) {
        return assertSessionSet(lines, SidecarEngine.SYBASE);
    }

    /** Engine-aware session-SET admission (SPEC-1 §1.5). */
    public static List<String> assertSessionSet(
            final List<String> lines, final SidecarEngine engine) {
        final List<String> normalised = new ArrayList<>();
        if (lines == null) {
            return normalised;
        }
        for (final String line : lines) {
            normalised.add(assertSessionSetLine(line, engine));
        }
        return normalised;
    }

    /**
     * Validate ONE session SET line. Returns its normalised form (trimmed,
     * internal whitespace runs collapsed to single spaces) -- the exact string
     * the service executes, so no unvalidated character can reach the server.
     */
    public static String assertSessionSetLine(final String line) {
        return assertSessionSetLine(line, SidecarEngine.SYBASE);
    }

    /** Engine-aware single-line session-SET admission (SPEC-1 §1.5). */
    public static String assertSessionSetLine(final String line, final SidecarEngine engine) {
        final String normalised = normalizeSessionSetLine(line);
        if (normalised == null) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Session SET line is empty.", REASON_BAD_SESSION_SET);
        }
        if (!isAllowedSessionSet(normalised, engine)) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Session SET line '" + normalised + "' is not on the /call SET allowlist for "
                            + engine.wireValue() + ".",
                    REASON_BAD_SESSION_SET);
        }
        return normalised;
    }

    /** Trim + collapse whitespace runs; null for a null / blank line. Pure. */
    static String normalizeSessionSetLine(final String line) {
        if (line == null) {
            return null;
        }
        final String collapsed = line.trim().replaceAll("\\s+", " ");
        return collapsed.isEmpty() ? null : collapsed;
    }

    /**
     * TRUE when the (already normalised) line matches one of the allowlisted
     * SET forms. Pure; shared by the assertion and the unit tests.
     */
    static boolean isAllowedSessionSet(final String normalisedLine) {
        return isAllowedSessionSet(normalisedLine, SidecarEngine.SYBASE);
    }

    /** Engine-aware allowlist membership. Pure. */
    static boolean isAllowedSessionSet(
            final String normalisedLine, final SidecarEngine engine) {
        if (normalisedLine == null) {
            return false;
        }
        for (final Pattern form : sessionSetForms(engine)) {
            if (form.matcher(normalisedLine).matches()) {
                return true;
            }
        }
        return false;
    }
}
