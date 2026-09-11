package com.example.dbsidecar.service;

import com.example.dbsidecar.model.SidecarEngine;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * JVM-layer guard for the {@code /mutate} endpoint (Capture-State Discipline
 * Spec 1 — the compensation engine's Sybase write surface).
 *
 * <p>The read path's {@link SidecarSqlGuard} stays untouched and
 * blanket-blocks all DML on {@code /query}. THIS guard is the mirror image
 * for the ONE write surface: it admits EXACTLY the statement grammar the
 * AMVS compensation generator emits and nothing else:</p>
 *
 * <ul>
 *   <li>{@code DELETE FROM ...} / {@code UPDATE ...} / {@code INSERT INTO ...}
 *       — plain single-statement DML (the derived inverse of an observed
 *       write);</li>
 *   <li>{@code SET IDENTITY_INSERT <table> ON|OFF} — wraps identity-row
 *       re-inserts;</li>
 *   <li>the engine's identity reseed — Sybase
 *       {@code EXEC sp_chgattribute '<table>', 'identity_burn_max', 0, '<n>'},
 *       SQL Server {@code DBCC CHECKIDENT ('<t>', RESEED, <n>)} — the ONLY
 *       admitted procedure form, pinning the next minted identity back to the
 *       before-image maximum. Every other {@code sp_*} / {@code xp_*} stays
 *       blocked.</li>
 * </ul>
 *
 * <p>RESTORE mode additionally admits {@code TRUNCATE TABLE <t>} on both
 * engines and, on SQL Server ONLY, a WHERE-less {@code DELETE FROM <t>}:
 * SQL Server refuses TRUNCATE on any FK-referenced table, so the S0 restore
 * would otherwise have no way to empty a parent table (SPEC-1 §1.5).</p>
 *
 * <p>DDL, TRUNCATE, SELECT, statement chaining ({@code ;}) and comment
 * markers are rejected. Chaining/comment fragments are checked OUTSIDE
 * single-quoted literal spans (quote-doubling aware): restored business data
 * may legitimately contain {@code ;} or {@code --} inside a string literal,
 * and refusing it would turn a valid undo into a false residue halt.</p>
 */
public final class MutationSqlGuard {

    private MutationSqlGuard() {
        // utility class
    }

    /** The DML + IDENTITY_INSERT grammar both engines share. */
    private static final List<Pattern> SHARED_FORMS = List.of(
            Pattern.compile("^DELETE\\s+FROM\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^UPDATE\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^INSERT\\s+INTO\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^SET\\s+IDENTITY_INSERT\\s+\\S+\\s+(?:ON|OFF)$", Pattern.CASE_INSENSITIVE)
    );

    /**
     * Sybase ASE identity reseed: {@code sp_chgattribute} pins the next minted
     * identity back to the before-image maximum.
     */
    private static final Pattern SYBASE_RESEED_FORM = Pattern.compile(
            "^EXEC\\s+sp_chgattribute\\s+'[^']+',\\s*'identity_burn_max',\\s*0,\\s*'\\d+'$",
            Pattern.CASE_INSENSITIVE);

    /**
     * SQL Server identity reseed: {@code DBCC CHECKIDENT} is the ONLY
     * equivalent, and it appears nowhere else in this repo. The table may be
     * quoted ({@code 'dbo.orders'}) or bracketed ({@code [dbo].[orders]}), and
     * {@code WITH NO_INFOMSGS} is optional (SPEC-1 §1.5, wire contract §4).
     */
    private static final Pattern MSSQL_RESEED_FORM = Pattern.compile(
            "^DBCC\\s+CHECKIDENT\\s*\\(\\s*(?:'[^']+'|\\[[^\\]]+\\](?:\\.\\[[^\\]]+\\])*)\\s*,"
                    + "\\s*RESEED\\s*,\\s*-?\\d+\\s*\\)(?:\\s+WITH\\s+NO_INFOMSGS)?$",
            Pattern.CASE_INSENSITIVE);

    /**
     * RESTORE-mode-only, SQL Server only: an unfiltered
     * {@code DELETE FROM <t>}. SQL Server refuses {@code TRUNCATE} on ANY
     * FK-referenced table -- even one whose children are empty -- so the S0
     * restore path needs a DELETE fallback for parent tables. Full-anchored
     * and WHERE-less by construction.
     */
    private static final Pattern MSSQL_RESTORE_DELETE_FORM = Pattern.compile(
            "^DELETE\\s+FROM\\s+\\S+$",
            Pattern.CASE_INSENSITIVE);

    /** The statement forms admitted for one engine, reseed included. */
    static List<Pattern> allowedForms(final SidecarEngine engine) {
        final List<Pattern> forms = new ArrayList<>(SHARED_FORMS);
        forms.add(engine == SidecarEngine.MSSQL ? MSSQL_RESEED_FORM : SYBASE_RESEED_FORM);
        return forms;
    }

    /**
     * Forbidden anywhere in the statement SKELETON (literals blanked):
     * chaining, comments, and the destructive / definitional keywords the
     * generator never emits.
     */
    private static final Pattern FORBIDDEN_SKELETON_PATTERN = Pattern.compile(
            "(;|--|/\\*|\\*/|\\b(?:DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|SELECT)\\b)",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * System-procedure references are blocked in the skeleton EXCEPT the one
     * admitted {@code sp_chgattribute} reseed form (which is matched in full
     * by its ALLOWED_FORMS entry before this pattern is consulted).
     */
    private static final Pattern SP_CALL_PATTERN = Pattern.compile(
            "\\b(?:sp|xp)_[A-Za-z_]+\\b",
            Pattern.CASE_INSENSITIVE
    );

    /** TRUE when the statement is THIS engine's identity reseed. Pure. */
    static boolean isReseedForm(final String statement, final SidecarEngine engine) {
        final Pattern form =
                engine == SidecarEngine.MSSQL ? MSSQL_RESEED_FORM : SYBASE_RESEED_FORM;
        return form.matcher(statement).matches();
    }

    /**
     * RESTORE-mode-only form (Spec 2): the S0 restore path truncates each
     * dumped table before bulk re-insert. Full-anchored — a chained
     * {@code TRUNCATE TABLE t; DROP ...} does not match and falls through to
     * refusal.
     */
    private static final Pattern RESTORE_TRUNCATE_FORM = Pattern.compile(
            "^TRUNCATE\\s+TABLE\\s+\\S+$",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Blank single-quoted literal spans (quote-doubling aware) so fragment
     * checks only see the SQL skeleton. Returns {@code null} for an
     * unterminated literal — itself a violation.
     */
    static String stripQuotedLiterals(final String statement) {
        final StringBuilder skeleton = new StringBuilder();
        int i = 0;
        while (i < statement.length()) {
            final char ch = statement.charAt(i);
            if (ch != '\'') {
                skeleton.append(ch);
                i++;
                continue;
            }
            int j = i + 1;
            while (true) {
                final int at = statement.indexOf('\'', j);
                if (at == -1) {
                    return null;
                }
                if (at + 1 < statement.length() && statement.charAt(at + 1) == '\'') {
                    j = at + 2;
                    continue;
                }
                j = at + 1;
                break;
            }
            skeleton.append("''");
            i = j;
        }
        return skeleton.toString();
    }

    /**
     * Assert ONE statement satisfies the compensation grammar. Throws
     * {@link SidecarSqlGuard.SqlGuardException} (reused for its structured
     * reason codes) on any violation; returns the trimmed statement on
     * success.
     */
    public static String assertCompensationStatement(final String rawStatement) {
        return assertStatement(rawStatement, false, SidecarEngine.SYBASE);
    }

    /** Engine-aware compensation admission (SPEC-1 §1.5). */
    public static String assertCompensationStatement(
            final String rawStatement, final SidecarEngine engine) {
        return assertStatement(rawStatement, false, engine);
    }

    /**
     * RESTORE-mode admission (Spec 2): the compensation grammar PLUS
     * {@code TRUNCATE TABLE <t>}. Everything else behaves identically.
     */
    public static String assertRestoreStatement(final String rawStatement) {
        return assertStatement(rawStatement, true, SidecarEngine.SYBASE);
    }

    /** Engine-aware restore admission (SPEC-1 §1.5). */
    public static String assertRestoreStatement(
            final String rawStatement, final SidecarEngine engine) {
        return assertStatement(rawStatement, true, engine);
    }

    private static String assertStatement(
            final String rawStatement,
            final boolean restoreMode,
            final SidecarEngine engine) {
        if (rawStatement == null) {
            throw new SidecarSqlGuard.SqlGuardException("Statement is null.", "empty");
        }
        final String statement = rawStatement.trim();
        if (statement.isEmpty()) {
            throw new SidecarSqlGuard.SqlGuardException("Statement is empty.", "empty");
        }
        if (restoreMode && RESTORE_TRUNCATE_FORM.matcher(statement).matches()) {
            return statement;
        }
        if (restoreMode && engine == SidecarEngine.MSSQL
                && MSSQL_RESTORE_DELETE_FORM.matcher(statement).matches()) {
            // The FK-referenced-parent fallback: SQL Server will not TRUNCATE
            // such a table at all, so an unfiltered DELETE is the only way to
            // empty it before the bulk re-insert.
            return statement;
        }
        final String skeleton = stripQuotedLiterals(statement);
        if (skeleton == null) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Statement has an unterminated string literal.", "malformed");
        }
        if (FORBIDDEN_SKELETON_PATTERN.matcher(skeleton).find()) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Statement contains a forbidden keyword or fragment for the /mutate surface.",
                    "forbidden_keyword");
        }
        final boolean isReseed = isReseedForm(statement, engine);
        if (!isReseed && SP_CALL_PATTERN.matcher(skeleton).find()) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Only the identity reseed procedure is permitted on /mutate.",
                    "forbidden_keyword");
        }
        if (allowedForms(engine).stream().noneMatch(p -> p.matcher(statement).matches())) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Statement does not match the compensation grammar "
                            + "(INSERT/UPDATE/DELETE, SET IDENTITY_INSERT, or the identity reseed).",
                    "not_compensation");
        }
        return statement;
    }

    /**
     * Assert a whole batch; fail-closed on the first violation.
     */
    public static void assertCompensationBatch(final List<String> statements) {
        assertBatch(statements, false, SidecarEngine.SYBASE);
    }

    /** Engine-aware compensation batch admission (SPEC-1 §1.5). */
    public static void assertCompensationBatch(
            final List<String> statements, final SidecarEngine engine) {
        assertBatch(statements, false, engine);
    }

    /** Restore-mode batch admission (Spec 2). */
    public static void assertRestoreBatch(final List<String> statements) {
        assertBatch(statements, true, SidecarEngine.SYBASE);
    }

    /** Engine-aware restore batch admission (SPEC-1 §1.5). */
    public static void assertRestoreBatch(
            final List<String> statements, final SidecarEngine engine) {
        assertBatch(statements, true, engine);
    }

    private static void assertBatch(
            final List<String> statements,
            final boolean restoreMode,
            final SidecarEngine engine) {
        if (statements == null || statements.isEmpty()) {
            throw new SidecarSqlGuard.SqlGuardException("Statement batch is empty.", "empty");
        }
        for (final String statement : statements) {
            assertStatement(statement, restoreMode, engine);
        }
    }
}
