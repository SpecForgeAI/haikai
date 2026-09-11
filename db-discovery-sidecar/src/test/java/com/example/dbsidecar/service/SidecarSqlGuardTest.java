package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Tests for {@link SidecarSqlGuard}. Spec: 2026-05-16 Database Discovery
 * Packs - Task Group 4 (sidecar).
 *
 * <p>These tests cover the JVM-layer SELECT-only contract: forbidden
 * keywords, multi-statement blocks, sp_/xp_ system procedure rejection, and the empty and
 * not-select edge cases. They run as part of the standard sidecar build
 * and do NOT require a real Sybase server.</p>
 *
 * <p>Revised 2026-05-31 (metadata-enrichment spec, Task Group 4) to cover the
 * narrow read-only Job Scheduler proc allowlist: the allowlisted procs
 * ({@code sp_sjobhistory}, {@code sp_sjoblist}) PASS on the introspection job
 * path ({@link SidecarSqlGuard#assertAllowlistedIntrospectionProc}) while the
 * SAME procs and all other {@code sp_*} / {@code xp_*} stay REJECTED on the
 * {@code /query} path ({@link SidecarSqlGuard#assertReadonlySelect}).</p>
 */
class SidecarSqlGuardTest {

    /**
     * The guard accepts plain SELECT statements and returns the trimmed SQL.
     */
    @Test
    void allowsSimpleSelect() {
        final String sql = "SELECT name FROM sysobjects WHERE type = 'U'";
        assertEquals(sql, SidecarSqlGuard.assertReadonlySelect(sql));
    }

    /**
     * The guard accepts WITH ... SELECT (CTE) statements - the SQL must
     * begin with SELECT or WITH.
     */
    @Test
    void allowsCteSelect() {
        final String sql = "WITH x AS (SELECT 1) SELECT * FROM x";
        assertDoesNotThrow(() -> SidecarSqlGuard.assertReadonlySelect(sql));
    }

    /**
     * The guard tolerates a trailing semicolon - some clients append it
     * habitually. Only a semicolon followed by MORE SQL is a violation.
     */
    @Test
    void allowsTrailingSemicolon() {
        assertDoesNotThrow(() -> SidecarSqlGuard.assertReadonlySelect("SELECT 1;"));
        assertDoesNotThrow(() -> SidecarSqlGuard.assertReadonlySelect("SELECT 1;   "));
    }

    /**
     * Forbidden DML / DDL keywords are rejected. Parameterised so the
     * test name surfaces which keyword failed at CI time.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET x = 1",
            "DELETE FROM t",
            "MERGE INTO t USING s",
            "DROP TABLE t",
            "ALTER TABLE t ADD COLUMN c INT",
            "TRUNCATE TABLE t",
            "CREATE TABLE t (id INT)",
            "GRANT SELECT ON t TO u",
            "REVOKE SELECT ON t FROM u"
    })
    void rejectsForbiddenKeywords(final String sql) {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("forbidden_keyword", ex.getReason());
    }

    /**
     * {@code EXEC} and {@code CALL} are blocked even when used as the
     * leading verb.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "EXEC sp_help",
            "CALL my_proc()",
            "exec my_proc"
    })
    void rejectsExecAndCall(final String sql) {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("forbidden_keyword", ex.getReason());
    }

    /**
     * Sybase system stored procedures ({@code sp_*}, {@code xp_*}) are
     * blocked even when invoked indirectly inside a SELECT.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT * FROM sp_help",
            "SELECT name FROM sysobjects WHERE name = 'sp_who'",
            "SELECT xp_cmdshell('whoami')"
    })
    void rejectsSpAndXpCalls(final String sql) {
        assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
    }

    /**
     * Multi-statement payloads are rejected.
     */
    @Test
    void rejectsMultiStatement() {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect("SELECT 1; SELECT 2")
        );
        assertEquals("multi_statement", ex.getReason());
    }

    /**
     * Comment smuggling is defeated by stripping comments before the
     * keyword scan.
     */
    @Test
    void rejectsCommentSmuggledDml() {
        // INSERT inside a block comment becomes invisible after stripping,
        // BUT we still ensure a sneaky INSERT outside comments is caught.
        final String sql = "SELECT 1 /* comment */ INSERT INTO t VALUES (1)";
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("forbidden_keyword", ex.getReason());
    }

    /**
     * Empty / blank input is rejected explicitly.
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "\n\n"})
    void rejectsEmpty(final String sql) {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("empty", ex.getReason());
    }

    /**
     * Non-SELECT leading verbs are rejected even when they aren't in the
     * forbidden list (e.g. {@code SHOW}, {@code DESCRIBE}). The contract
     * is positive: the SQL MUST begin with SELECT or WITH.
     */
    @ParameterizedTest
    @ValueSource(strings = {"SHOW TABLES", "DESCRIBE foo", "BEGIN TRAN"})
    void rejectsNonSelectVerbs(final String sql) {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("not_select", ex.getReason());
    }

    /**
     * Null input throws with the empty reason rather than NPE.
     */
    @Test
    void rejectsNull() {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(null)
        );
        assertEquals("empty", ex.getReason());
    }

    // ----------------------------------------------------------------------
    // Group 6 (DB-resident jobs) read-only Job Scheduler proc allowlist.
    // spec 2026-05-31, Task Group 4 / decision 8. The allowlist is reachable
    // ONLY via assertAllowlistedIntrospectionProc (the introspection job path);
    // the /query guard (assertReadonlySelect) is UNCHANGED and still blanket-
    // blocks ALL sp_*/xp_*.
    // ----------------------------------------------------------------------

    /**
     * The EXACT allowlisted read-only Job Scheduler procs PASS on the
     * introspection job path. These are the only two procs the introspection
     * read may invoke: {@code sp_sjobhistory} (run history) and
     * {@code sp_sjoblist} (job list). Membership is case-insensitive and
     * whitespace-trimmed.
     */
    @ParameterizedTest
    @ValueSource(strings = {"sp_sjobhistory", "sp_sjoblist", "SP_SJOBHISTORY", "  sp_sjoblist  "})
    void allowlistedJobProcsPassOnIntrospectionPath(final String proc) {
        assertTrue(SidecarSqlGuard.isAllowlistedIntrospectionProc(proc));
        assertDoesNotThrow(() -> SidecarSqlGuard.assertAllowlistedIntrospectionProc(proc));
        assertEquals(proc.trim(), SidecarSqlGuard.assertAllowlistedIntrospectionProc(proc));
    }

    /**
     * A mutating Job Scheduler proc and any other {@code sp_*} / {@code xp_*}
     * is REJECTED even on the introspection path -- the allowlist is narrow:
     * exactly the two read-only reporting procs and nothing else.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "sp_sjobcreate",
            "sp_sjobmodify",
            "sp_sjobdrop",
            "sp_sjobcontrol",
            "sp_who",
            "xp_cmdshell",
            "sp_helptext"
    })
    void nonAllowlistedProcsRejectedOnIntrospectionPath(final String proc) {
        assertFalse(SidecarSqlGuard.isAllowlistedIntrospectionProc(proc));
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertAllowlistedIntrospectionProc(proc)
        );
        assertEquals("forbidden_keyword", ex.getReason());
    }

    /**
     * Critically: the allowlist does NOT leak into the {@code /query} guard.
     * The SAME allowlisted procs are still REJECTED when they appear in a
     * {@code /query} SELECT, because {@link SidecarSqlGuard#assertReadonlySelect}
     * keeps blanket-blocking ALL {@code sp_*} / {@code xp_*} and does not
     * consult the introspection allowlist.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT * FROM sp_sjobhistory",
            "SELECT * FROM sp_sjoblist",
            "EXEC sp_sjobhistory"
    })
    void allowlistedProcsStillBlockedOnQueryPath(final String sql) {
        final SidecarSqlGuard.SqlGuardException ex = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertReadonlySelect(sql)
        );
        assertEquals("forbidden_keyword", ex.getReason());
    }

    /**
     * An empty / null proc name on the introspection path is rejected with the
     * {@code empty} reason rather than an NPE.
     */
    @Test
    void introspectionProcRejectsEmpty() {
        assertEquals("empty", assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertAllowlistedIntrospectionProc(null)
        ).getReason());
        assertEquals("empty", assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> SidecarSqlGuard.assertAllowlistedIntrospectionProc("   ")
        ).getReason());
    }
}
