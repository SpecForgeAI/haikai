package com.example.sybasesidecar.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Guard tests for the {@code /mutate} surface (Capture-State Discipline
 * Spec 1). The admitted grammar is EXACTLY what the AMVS compensation
 * generator emits; everything else is refused — including literals-only
 * trickery (chaining / comments outside quoted spans, unterminated strings,
 * any non-reseed system procedure).
 */
class MutationSqlGuardTest {

    // ------------------------------------------------------------------
    // Admitted forms
    // ------------------------------------------------------------------

    @Test
    void admitsDerivedDeleteUpdateInsert() {
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "DELETE FROM orders WHERE view_id = 42"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "UPDATE orders SET view_name = 'Quarterly', depth = 3 WHERE view_id = 42"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "INSERT INTO orders (view_id, view_name) VALUES (42, 'Quarterly')"));
    }

    @Test
    void admitsIdentityInsertToggleAndReseed() {
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "SET IDENTITY_INSERT orders ON"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "SET IDENTITY_INSERT orders OFF"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '41'"));
    }

    @Test
    void admitsLiteralsContainingChainingAndCommentFragments() {
        // Restored business data may contain ';' or '--' INSIDE a quoted
        // literal; the skeleton check must not refuse it.
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "UPDATE orders SET note = 'a; b -- c /* d */' WHERE view_id = 1"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertCompensationStatement(
                "INSERT INTO orders (view_id, note) VALUES (7, 'it''s; fine -- honest')"));
    }

    // ------------------------------------------------------------------
    // Refusals
    // ------------------------------------------------------------------

    @Test
    void refusesDdlAndTruncateAndSelect() {
        for (final String sql : List.of(
                "DROP TABLE orders",
                "TRUNCATE TABLE orders",
                "ALTER TABLE orders ADD c INT",
                "CREATE TABLE t (a INT)",
                "GRANT ALL ON orders TO PUBLIC",
                "SELECT * FROM orders",
                "MERGE INTO orders USING x ON 1=1")) {
            assertThrows(SidecarSqlGuard.SqlGuardException.class,
                    () -> MutationSqlGuard.assertCompensationStatement(sql), sql);
        }
    }

    @Test
    void refusesChainingAndCommentsOutsideLiterals() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "DELETE FROM orders WHERE view_id = 1; DROP TABLE orders"));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "DELETE FROM orders -- WHERE view_id = 1"));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "DELETE FROM orders /* all rows */ WHERE view_id = 1"));
    }

    @Test
    void refusesUnterminatedLiteral() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "UPDATE orders SET note = 'unterminated WHERE view_id = 1"));
    }

    @Test
    void refusesNonReseedProcedures() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "EXEC sp_chgattribute 'orders', 'other_attr', 0, '41'"));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement("EXEC sp_who"));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "EXEC xp_cmdshell 'dir'"));
    }

    @Test
    void refusesEmptyAndEmptyBatch() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement("   "));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationBatch(List.of()));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationBatch(null));
    }

    @Test
    void batchIsFailClosedOnFirstViolation() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationBatch(List.of(
                        "DELETE FROM orders WHERE view_id = 1",
                        "DROP TABLE orders")));
    }

    // ------------------------------------------------------------------
    // Literal stripping primitive
    // ------------------------------------------------------------------

    @Test
    void stripQuotedLiteralsBlanksSpansAndHandlesDoubling() {
        assertEquals("UPDATE t SET a = '' WHERE b = ''",
                MutationSqlGuard.stripQuotedLiterals(
                        "UPDATE t SET a = 'x; --' WHERE b = 'it''s'"));
        assertNull(MutationSqlGuard.stripQuotedLiterals("UPDATE t SET a = 'open"));
    }

    @Test
    void maskPasswordMasksEveryOccurrence() {
        assertEquals("login failed for *** at ***",
                SybaseMutationService.maskPassword(
                        "login failed for s3cret at s3cret", "s3cret"));
        assertNull(SybaseMutationService.maskPassword(null, "x"));
        assertEquals("unchanged", SybaseMutationService.maskPassword("unchanged", ""));
    }
}
