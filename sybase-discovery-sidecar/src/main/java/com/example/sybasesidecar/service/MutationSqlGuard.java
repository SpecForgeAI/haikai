package com.example.sybasesidecar.service;

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
 *   <li>{@code EXEC sp_chgattribute '<table>', 'identity_burn_max', 0, '<n>'}
 *       — the ONLY admitted procedure, pinning the next minted identity back
 *       to the before-image maximum. Every other {@code sp_*} / {@code xp_*}
 *       stays blocked.</li>
 * </ul>
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

    private static final List<Pattern> ALLOWED_FORMS = List.of(
            Pattern.compile("^DELETE\\s+FROM\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^UPDATE\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^INSERT\\s+INTO\\s+.+$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL),
            Pattern.compile("^SET\\s+IDENTITY_INSERT\\s+\\S+\\s+(?:ON|OFF)$", Pattern.CASE_INSENSITIVE),
            Pattern.compile(
                    "^EXEC\\s+sp_chgattribute\\s+'[^']+',\\s*'identity_burn_max',\\s*0,\\s*'\\d+'$",
                    Pattern.CASE_INSENSITIVE)
    );

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

    private static final Pattern RESEED_FORM = Pattern.compile(
            "^EXEC\\s+sp_chgattribute\\s+'[^']+',\\s*'identity_burn_max',\\s*0,\\s*'\\d+'$",
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
        if (rawStatement == null) {
            throw new SidecarSqlGuard.SqlGuardException("Statement is null.", "empty");
        }
        final String statement = rawStatement.trim();
        if (statement.isEmpty()) {
            throw new SidecarSqlGuard.SqlGuardException("Statement is empty.", "empty");
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
        final boolean isReseed = RESEED_FORM.matcher(statement).matches();
        if (!isReseed && SP_CALL_PATTERN.matcher(skeleton).find()) {
            throw new SidecarSqlGuard.SqlGuardException(
                    "Only the identity_burn_max reseed procedure is permitted on /mutate.",
                    "forbidden_keyword");
        }
        if (ALLOWED_FORMS.stream().noneMatch(p -> p.matcher(statement).matches())) {
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
        if (statements == null || statements.isEmpty()) {
            throw new SidecarSqlGuard.SqlGuardException("Statement batch is empty.", "empty");
        }
        for (final String statement : statements) {
            assertCompensationStatement(statement);
        }
    }
}
