package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.dbsidecar.model.CallParam;
import com.example.dbsidecar.model.CallRequest;
import com.example.dbsidecar.model.SidecarEngine;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Guard tests for the {@code /call} surface (Stored-Proc Behaviour Program,
 * Spec 2). The endpoint carries NO SQL text, so what is policed here is the
 * small set of caller tokens that reach the composed call string or the
 * session preamble: the routine identifier, the system-procedure block, the
 * parameter cap, and the session SET allowlist.
 *
 * <p>Routine vocabulary in these tests is invented ({@code upd_ledger_roll},
 * {@code fn_roll_total}) -- never a real routine name from any codebase.</p>
 */
class CallSqlGuardTest {

    // ------------------------------------------------------------------
    // Routine identifiers
    // ------------------------------------------------------------------

    @Test
    void acceptsBareSchemaQualifiedAndDatabaseQualifiedNames() {
        // Bare name + default schema.
        assertEquals("dbo.upd_ledger_roll",
                CallSqlGuard.assertRoutineName("dbo", "upd_ledger_roll"));
        // Bare name, no schema supplied at all.
        assertEquals("upd_ledger_roll",
                CallSqlGuard.assertRoutineName(null, "upd_ledger_roll"));
        // Caller supplied the qualified form; the schema field is ignored.
        assertEquals("dbo.upd_ledger_roll",
                CallSqlGuard.assertRoutineName("ignored", "dbo.upd_ledger_roll"));
        // Three parts: database.schema.routine.
        assertEquals("ledger_db.dbo.upd_ledger_roll",
                CallSqlGuard.assertRoutineName(null, "ledger_db.dbo.upd_ledger_roll"));
        // A dotted SCHEMA composes with a bare routine to the same 3 parts.
        assertEquals("ledger_db.dbo.upd_ledger_roll",
                CallSqlGuard.assertRoutineName("ledger_db.dbo", "upd_ledger_roll"));
        // Leading underscore is a legal identifier start.
        assertEquals("_staging._roll_1",
                CallSqlGuard.assertRoutineName("_staging", "_roll_1"));
    }

    @Test
    void rejectsNonIdentifierCharacters() {
        final List<String> bad = List.of(
                "upd_ledger_roll; drop table t",
                "upd ledger roll",
                "upd-ledger-roll",
                "[upd_ledger_roll]",
                "\"upd_ledger_roll\"",
                "upd_ledger_roll()",
                "upd_ledger_roll--",
                "1_roll",
                "roll/*x*/",
                "roll'",
                "");
        for (final String name : bad) {
            final SidecarSqlGuard.SqlGuardException e = assertThrows(
                    SidecarSqlGuard.SqlGuardException.class,
                    () -> CallSqlGuard.assertRoutineName("dbo", name),
                    "expected rejection for: " + name);
            assertEquals(CallSqlGuard.REASON_BAD_ROUTINE_NAME, e.getReason());
        }
    }

    @Test
    void rejectsEmptyPartsAndOverQualifiedNames() {
        // Empty part between dots.
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> CallSqlGuard.assertRoutineName(null, "ledger_db..upd_ledger_roll"));
        // Sybase's own 4-part form (server.db.owner.object) is over-qualified.
        final SidecarSqlGuard.SqlGuardException e = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> CallSqlGuard.assertRoutineName(null, "srv.ledger_db.dbo.upd_ledger_roll"));
        assertEquals(CallSqlGuard.REASON_BAD_ROUTINE_NAME, e.getReason());
    }

    @Test
    void blocksSystemProceduresUnlessAllowlisted() {
        for (final String name : List.of("sp_configure", "sp_who", "xp_cmdshell", "SP_Configure")) {
            final SidecarSqlGuard.SqlGuardException e = assertThrows(
                    SidecarSqlGuard.SqlGuardException.class,
                    () -> CallSqlGuard.assertRoutineName(null, name),
                    "expected block for: " + name);
            assertEquals(CallSqlGuard.REASON_SYSTEM_PROC_BLOCKED, e.getReason());
        }
        // Blocked no matter how it is qualified.
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> CallSqlGuard.assertRoutineName(null, "master.dbo.sp_configure"));
    }

    @Test
    void allowsTheReadOnlyIntrospectionProcs() {
        assertTrue(SidecarSqlGuard.isAllowlistedIntrospectionProc("sp_sjoblist"));
        assertEquals("sp_sjoblist", CallSqlGuard.assertRoutineName(null, "sp_sjoblist"));
        assertEquals("sp_sjobhistory", CallSqlGuard.assertRoutineName(null, "sp_sjobhistory"));
        // Case-insensitive membership, as the allowlist itself is.
        assertEquals("dbo.SP_SJobList", CallSqlGuard.assertRoutineName("dbo", "SP_SJobList"));
    }

    // ------------------------------------------------------------------
    // Parameter cap
    // ------------------------------------------------------------------

    @Test
    void admitsUpToTheParamCapAndRefusesBeyondIt() {
        assertDoesNotThrow(() -> CallSqlGuard.assertParamCount(params(CallSqlGuard.MAX_PARAMS)));
        assertDoesNotThrow(() -> CallSqlGuard.assertParamCount(null));
        final SidecarSqlGuard.SqlGuardException e = assertThrows(
                SidecarSqlGuard.SqlGuardException.class,
                () -> CallSqlGuard.assertParamCount(params(CallSqlGuard.MAX_PARAMS + 1)));
        assertEquals(CallSqlGuard.REASON_TOO_MANY_PARAMS, e.getReason());
    }

    private static List<CallParam> params(final int count) {
        final List<CallParam> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            final CallParam p = new CallParam();
            p.setOrdinal(i + 1);
            p.setSybaseType("int");
            list.add(p);
        }
        return list;
    }

    // ------------------------------------------------------------------
    // Session SET allowlist
    // ------------------------------------------------------------------

    @Test
    void admitsEveryAllowlistedSetForm() {
        final List<String> lines = List.of(
                "set nocount off",
                "set nocount on",
                "set ansinull on",
                "set arithabort off",
                "set chained off",
                "set quoted_identifier on",
                "set string_rtruncation on",
                "set ansi_permissions off",
                "set rowcount 0",
                "set rowcount 500",
                "set textsize 2147483647",
                "set dateformat mdy",
                "set dateformat ydm",
                "set transaction isolation level 0",
                "set transaction isolation level 3");
        for (final String line : lines) {
            assertEquals(line, CallSqlGuard.assertSessionSetLine(line),
                    "expected admission for: " + line);
        }
    }

    @Test
    void normalisesCaseAndWhitespaceBeforeMatching() {
        assertEquals("SET NOCOUNT ON", CallSqlGuard.assertSessionSetLine("  SET   NOCOUNT  ON  "));
        assertEquals("Set RowCount 10", CallSqlGuard.assertSessionSetLine("Set\tRowCount\n10"));
    }

    @Test
    void refusesAnySetFormOutsideTheAllowlist() {
        final List<String> bad = List.of(
                "set nocount maybe",
                "set rowcount -1",
                "set rowcount",
                "set dateformat xyz",
                "set transaction isolation level 4",
                "set role sa_role on",
                "set nocount on; drop table t",
                "select 1",
                "exec sp_configure 'x', 1",
                "set textsize 10 -- comment",
                "   ");
        for (final String line : bad) {
            final SidecarSqlGuard.SqlGuardException e = assertThrows(
                    SidecarSqlGuard.SqlGuardException.class,
                    () -> CallSqlGuard.assertSessionSetLine(line),
                    "expected refusal for: " + line);
            assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET, e.getReason());
        }
        assertThrows(SidecarSqlGuard.SqlGuardException.class,
                () -> CallSqlGuard.assertSessionSetLine(null));
    }

    // ------------------------------------------------------------------
    // Whole-request pre-flight
    // ------------------------------------------------------------------

    @Test
    void assertCallReturnsTheQualifiedNameForAValidRequest() {
        final CallRequest req = new CallRequest();
        req.setRoutineName("upd_ledger_roll");
        req.setSchemaName("dbo");
        req.setSessionSet(List.of("set nocount off"));
        req.setParams(params(3));
        assertEquals("dbo.upd_ledger_roll", CallSqlGuard.assertCall(req));
    }

    @Test
    void assertCallSurfacesTheFirstViolationWithItsReasonToken() {
        final CallRequest procBlocked = new CallRequest();
        procBlocked.setRoutineName("xp_cmdshell");
        assertEquals(CallSqlGuard.REASON_SYSTEM_PROC_BLOCKED,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(procBlocked)).getReason());

        final CallRequest badSet = new CallRequest();
        badSet.setRoutineName("upd_ledger_roll");
        badSet.setSessionSet(List.of("set nocount off", "shutdown"));
        assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(badSet)).getReason());

        final CallRequest tooMany = new CallRequest();
        tooMany.setRoutineName("upd_ledger_roll");
        tooMany.setParams(params(CallSqlGuard.MAX_PARAMS + 1));
        assertEquals(CallSqlGuard.REASON_TOO_MANY_PARAMS,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(tooMany)).getReason());

        assertEquals(CallSqlGuard.REASON_BAD_ROUTINE_NAME,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(null)).getReason());
    }

    // ----------------------------------------------------------------------
    // SQL Server engine cases (SPEC-1 §1.5; wire contract v2 §5)
    // ----------------------------------------------------------------------

    /**
     * The SQL Server SET allowlist. Each option below CHANGES what a capture
     * observes -- {@code xact_abort} decides whether an error aborts the whole
     * transaction, {@code ansi_nulls} and {@code quoted_identifier} are baked
     * into a routine's compiled plan, {@code implicit_transactions} flips the
     * transaction model -- which is exactly why the profile has to be pinnable
     * rather than assumed.
     */
    @Test
    void mssqlSessionSetAllowlistAdmitsTheDocumentedForms() {
        for (final String line : java.util.List.of(
                "set ansi_nulls on",
                "set ansi_padding off",
                "set ansi_warnings on",
                "set arithabort on",
                "set quoted_identifier on",
                "set nocount off",
                "set xact_abort on",
                "set concat_null_yields_null on",
                "set implicit_transactions off",
                "set numeric_roundabort off",
                "set ansi_null_dflt_on on",
                "set rowcount 0",
                "set textsize 2147483647",
                "set dateformat ymd",
                "set datefirst 7",
                "set language us_english",
                "set transaction isolation level read committed",
                "set transaction isolation level snapshot",
                "set transaction isolation level serializable",
                "set lock_timeout -1",
                "set lock_timeout 5000")) {
            assertEquals(line,
                    CallSqlGuard.assertSessionSetLine(line, SidecarEngine.MSSQL), line);
        }
        // Whitespace runs are collapsed and the line is trimmed; the CASE the
        // caller used is preserved verbatim, because the normalised line is the
        // exact text executed and a capture records what actually ran.
        assertEquals("SET XACT_ABORT ON",
                CallSqlGuard.assertSessionSetLine("  SET   XACT_ABORT   ON  ",
                        SidecarEngine.MSSQL));
    }

    /** Anything outside the allowlist is refused with the named reason. */
    @Test
    void mssqlSessionSetAllowlistRefusesEverythingElse() {
        for (final String line : java.util.List.of(
                "set identity_insert orders on",
                "set context_info 0x01",
                "set showplan_all on",
                "set datefirst 8",
                "set transaction isolation level 1",
                "set nocount on; drop table orders",
                "select 1")) {
            assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET,
                    assertThrows(SidecarSqlGuard.SqlGuardException.class,
                            () -> CallSqlGuard.assertSessionSetLine(line, SidecarEngine.MSSQL))
                            .getReason(), line);
        }
    }

    /**
     * The allowlists do NOT cross engines: ASE's numeric isolation level and
     * {@code chained} are meaningless on SQL Server, and SQL Server's
     * {@code xact_abort} and named isolation levels are meaningless on ASE.
     */
    @Test
    void sessionSetAllowlistsDoNotCrossEngines() {
        assertEquals("set chained on", CallSqlGuard.assertSessionSetLine("set chained on"));
        assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertSessionSetLine("set chained on",
                                SidecarEngine.MSSQL)).getReason());

        assertEquals("set transaction isolation level 1",
                CallSqlGuard.assertSessionSetLine("set transaction isolation level 1"));
        assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertSessionSetLine("set xact_abort on"))
                        .getReason());
    }

    /** The parameter ceiling is the ENGINE's own: 255 on ASE, 2100 on SQL Server. */
    @Test
    void parameterCeilingIsPerEngine() {
        assertEquals(255, CallSqlGuard.maxParams(SidecarEngine.SYBASE));
        assertEquals(2100, CallSqlGuard.maxParams(SidecarEngine.MSSQL));

        // 256 params: refused on ASE, admitted on SQL Server.
        assertEquals(CallSqlGuard.REASON_TOO_MANY_PARAMS,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertParamCount(params(256), SidecarEngine.SYBASE))
                        .getReason());
        CallSqlGuard.assertParamCount(params(256), SidecarEngine.MSSQL);
        CallSqlGuard.assertParamCount(params(2100), SidecarEngine.MSSQL);

        // 2101 is over SQL Server's own ceiling.
        assertEquals(CallSqlGuard.REASON_TOO_MANY_PARAMS,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertParamCount(params(2101), SidecarEngine.MSSQL))
                        .getReason());
    }

    /** A full {@code /call} request is validated against ITS OWN engine. */
    @Test
    void assertCallUsesTheRequestEngine() {
        final CallRequest mssql = new CallRequest();
        mssql.setRoutineName("upd_ledger_roll");
        mssql.getEngineOptions().setEngine(SidecarEngine.MSSQL);
        mssql.setSessionSet(java.util.List.of("set xact_abort on", "set nocount off"));
        mssql.setParams(params(1000));
        // No schema was supplied, so the bare routine name is authoritative.
        assertEquals("upd_ledger_roll", CallSqlGuard.assertCall(mssql));

        // The same request on the default (sybase) engine fails on BOTH counts.
        final CallRequest sybase = new CallRequest();
        sybase.setRoutineName("upd_ledger_roll");
        sybase.setSessionSet(java.util.List.of("set xact_abort on"));
        assertEquals(CallSqlGuard.REASON_BAD_SESSION_SET,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(sybase)).getReason());

        final CallRequest tooMany = new CallRequest();
        tooMany.setRoutineName("upd_ledger_roll");
        tooMany.setParams(params(1000));
        assertEquals(CallSqlGuard.REASON_TOO_MANY_PARAMS,
                assertThrows(SidecarSqlGuard.SqlGuardException.class,
                        () -> CallSqlGuard.assertCall(tooMany)).getReason());
    }
}
