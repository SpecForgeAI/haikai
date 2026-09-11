package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import com.example.dbsidecar.model.SidecarEngine;
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
    // Restore mode (Spec 2): compensation grammar + TRUNCATE TABLE
    // ------------------------------------------------------------------

    @Test
    void restoreModeAdmitsTruncateAndCompensationForms() {
        assertDoesNotThrow(() -> MutationSqlGuard.assertRestoreStatement(
                "TRUNCATE TABLE orders"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertRestoreStatement(
                "INSERT INTO orders (id, name) VALUES (1, 'a')"));
        assertDoesNotThrow(() -> MutationSqlGuard.assertRestoreBatch(List.of(
                "TRUNCATE TABLE orders",
                "SET IDENTITY_INSERT orders ON",
                "INSERT INTO orders (id, name) VALUES (1, 'a')",
                "SET IDENTITY_INSERT orders OFF")));
    }

    @Test
    void compensationModeStillRefusesTruncate() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement("TRUNCATE TABLE orders"));
    }

    @Test
    void restoreModeFullAnchorsTruncateAndRefusesDdl() {
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertRestoreStatement(
                        "TRUNCATE TABLE orders; DROP TABLE orders"));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertRestoreStatement("DROP TABLE orders"));
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
                DbMutationService.maskPassword(
                        "login failed for s3cret at s3cret", "s3cret"));
        assertNull(DbMutationService.maskPassword(null, "x"));
        assertEquals("unchanged", DbMutationService.maskPassword("unchanged", ""));
    }

    // ----------------------------------------------------------------------
    // SQL Server engine cases (SPEC-1 §1.5; wire contract v2 §4)
    // ----------------------------------------------------------------------

    /**
     * The SQL Server identity reseed is {@code DBCC CHECKIDENT} -- the ONLY
     * equivalent of the ASE {@code sp_chgattribute} form, and a construct that
     * appears nowhere else in this repo. Quoted and bracketed table forms both
     * admit, and {@code WITH NO_INFOMSGS} is optional.
     */
    @Test
    void mssqlAdmitsTheDbccCheckidentReseed() {
        assertEquals("DBCC CHECKIDENT ('dbo.orders', RESEED, 8421)",
                MutationSqlGuard.assertCompensationStatement(
                        "DBCC CHECKIDENT ('dbo.orders', RESEED, 8421)", SidecarEngine.MSSQL));
        assertEquals("DBCC CHECKIDENT ([dbo].[orders], RESEED, 0)",
                MutationSqlGuard.assertCompensationStatement(
                        "DBCC CHECKIDENT ([dbo].[orders], RESEED, 0)", SidecarEngine.MSSQL));
        assertEquals("DBCC CHECKIDENT ('orders', RESEED, 12) WITH NO_INFOMSGS",
                MutationSqlGuard.assertCompensationStatement(
                        "DBCC CHECKIDENT ('orders', RESEED, 12) WITH NO_INFOMSGS",
                        SidecarEngine.MSSQL));
        // Case and spacing are tolerated; the grammar is not.
        MutationSqlGuard.assertCompensationStatement(
                "dbcc checkident('orders',reseed,7)", SidecarEngine.MSSQL);
    }

    /** Only RESEED is admitted -- never RECHECK, NORESEED or a chained tail. */
    @Test
    void mssqlRefusesOtherDbccForms() {
        for (final String bad : java.util.List.of(
                "DBCC CHECKIDENT ('orders', NORESEED)",
                "DBCC CHECKIDENT ('orders', RESEED)",
                "DBCC CHECKDB",
                "DBCC SHRINKDATABASE (demo)",
                "DBCC CHECKIDENT ('orders', RESEED, 1); DROP TABLE orders",
                "DBCC CHECKIDENT ('orders', RESEED, abc)")) {
            assertThrows(SidecarSqlGuard.SqlGuardException.class,
                    () -> MutationSqlGuard.assertCompensationStatement(bad, SidecarEngine.MSSQL),
                    bad);
        }
    }

    /**
     * The two reseed grammars do NOT cross engines: the ASE form is refused on
     * a SQL Server connection and the DBCC form on an ASE one. Admitting the
     * wrong one would send a statement the server cannot parse -- or worse,
     * one it parses differently.
     */
    @Test
    void reseedFormsDoNotCrossEngines() {
        final String sybaseForm =
                "EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '8421'";
        final String mssqlForm = "DBCC CHECKIDENT ('orders', RESEED, 8421)";

        assertEquals(sybaseForm, MutationSqlGuard.assertCompensationStatement(sybaseForm));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        sybaseForm, SidecarEngine.MSSQL));

        assertEquals(mssqlForm, MutationSqlGuard.assertCompensationStatement(
                mssqlForm, SidecarEngine.MSSQL));
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(mssqlForm));

        assertTrue(MutationSqlGuard.isReseedForm(mssqlForm, SidecarEngine.MSSQL));
        assertFalse(MutationSqlGuard.isReseedForm(mssqlForm, SidecarEngine.SYBASE));
    }

    /**
     * RESTORE mode on SQL Server additionally admits a WHERE-less
     * {@code DELETE FROM <t>}: SQL Server refuses TRUNCATE on ANY FK-referenced
     * table -- even one whose children are empty -- so a parent table could
     * otherwise never be emptied before the bulk re-insert.
     */
    @Test
    void mssqlRestoreAdmitsTheBareDeleteFallback() {
        assertEquals("DELETE FROM orders",
                MutationSqlGuard.assertRestoreStatement("DELETE FROM orders",
                        SidecarEngine.MSSQL));
        assertEquals("DELETE FROM [dbo].[orders]",
                MutationSqlGuard.assertRestoreStatement("DELETE FROM [dbo].[orders]",
                        SidecarEngine.MSSQL));
        // TRUNCATE is still admitted in restore mode on both engines.
        assertEquals("TRUNCATE TABLE orders",
                MutationSqlGuard.assertRestoreStatement("TRUNCATE TABLE orders",
                        SidecarEngine.MSSQL));
        assertEquals("TRUNCATE TABLE orders",
                MutationSqlGuard.assertRestoreStatement("TRUNCATE TABLE orders"));
        // ...but TRUNCATE is NOT admitted in compensation mode on either.
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationStatement(
                        "TRUNCATE TABLE orders", SidecarEngine.MSSQL));
    }

    /** The restore DELETE is still one statement with no smuggled tail. */
    @Test
    void mssqlRestoreDeleteIsStillFullyAnchored() {
        for (final String bad : java.util.List.of(
                "DELETE FROM orders; DROP TABLE orders",
                "DELETE FROM orders -- and more",
                "DELETE FROM orders /* tail */")) {
            assertThrows(SidecarSqlGuard.SqlGuardException.class,
                    () -> MutationSqlGuard.assertRestoreStatement(bad, SidecarEngine.MSSQL),
                    bad);
        }
    }

    /** An engine-aware batch fails closed on the first offending statement. */
    @Test
    void mssqlBatchAdmissionIsEngineKeyed() {
        MutationSqlGuard.assertCompensationBatch(java.util.List.of(
                "SET IDENTITY_INSERT orders ON",
                "INSERT INTO orders (order_id, total) VALUES (1, 2)",
                "SET IDENTITY_INSERT orders OFF",
                "DBCC CHECKIDENT ('orders', RESEED, 1)"), SidecarEngine.MSSQL);
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> MutationSqlGuard.assertCompensationBatch(java.util.List.of(
                        "INSERT INTO orders (order_id) VALUES (1)",
                        "EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '1'"),
                        SidecarEngine.MSSQL));
    }
}
