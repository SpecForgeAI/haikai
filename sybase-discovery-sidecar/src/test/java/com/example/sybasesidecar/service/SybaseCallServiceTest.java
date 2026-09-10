package com.example.sybasesidecar.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.sybasesidecar.model.CallParam;
import com.example.sybasesidecar.model.CallRequest;
import com.example.sybasesidecar.model.CallResponse;
import java.sql.SQLException;
import java.sql.Types;
import java.time.DateTimeException;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link SybaseCallService} -- the pure helpers behind the
 * {@code /call} invocation surface (Stored-Proc Behaviour Program, Spec 2).
 * The JDBC-touching path (bind, execute, result walk, OUT read) is exercised
 * by the integration suite against a live Sybase, exactly as the query and
 * mutation services are; everything testable without a connection is
 * extracted into package-visible statics and driven here.
 *
 * <p>Routine vocabulary is invented ({@code upd_ledger_roll},
 * {@code fn_roll_total}).</p>
 */
class SybaseCallServiceTest {

    // ------------------------------------------------------------------
    // Call-string composition
    // ------------------------------------------------------------------

    @Test
    void composesProcedureCallWithReturnStatus() {
        assertEquals("{?= call dbo.upd_ledger_roll(?, ?, ?)}",
                SybaseCallService.composeCallString("dbo.upd_ledger_roll", false, true, 3));
    }

    @Test
    void composesProcedureCallWithoutReturnStatus() {
        assertEquals("{call dbo.upd_ledger_roll(?, ?)}",
                SybaseCallService.composeCallString("dbo.upd_ledger_roll", false, false, 2));
    }

    @Test
    void composesFunctionCallWithResultPlaceholder() {
        assertEquals("{? = call dbo.fn_roll_total(?)}",
                SybaseCallService.composeCallString("dbo.fn_roll_total", true, false, 1));
        // returnStatus is meaningless for a function and never changes the shape.
        assertEquals("{? = call dbo.fn_roll_total(?)}",
                SybaseCallService.composeCallString("dbo.fn_roll_total", true, true, 1));
    }

    @Test
    void composesZeroParameterCalls() {
        assertEquals("{?= call dbo.upd_ledger_roll()}",
                SybaseCallService.composeCallString("dbo.upd_ledger_roll", false, true, 0));
        assertEquals("{call dbo.upd_ledger_roll()}",
                SybaseCallService.composeCallString("dbo.upd_ledger_roll", false, false, 0));
        assertEquals("{? = call ledger_db.dbo.fn_roll_total()}",
                SybaseCallService.composeCallString("ledger_db.dbo.fn_roll_total", true, false, 0));
    }

    // ------------------------------------------------------------------
    // Parameter ordering
    // ------------------------------------------------------------------

    @Test
    void ordersParamsByOrdinalAndReservesOrdinalZeroForTheFunctionResult() {
        final CallParam second = param("@amount", 2, "money", "in", "10.50");
        final CallParam first = param("@roll_id", 1, "int", "in", "7");
        final CallParam unnumbered = param("@note", null, "varchar(40)", "in", "x");
        final CallParam result = param("@total", 0, "numeric(10,2)", "output", null);

        final List<CallParam> ordered =
                SybaseCallService.orderParams(List.of(second, first, unnumbered, result));
        assertEquals(3, ordered.size());
        assertEquals("@roll_id", ordered.get(0).getName());
        assertEquals("@amount", ordered.get(1).getName());
        // Absent ordinals sort last, in their original order.
        assertEquals("@note", ordered.get(2).getName());

        assertEquals("@total",
                SybaseCallService.returnDescriptor(List.of(second, result, first)).getName());
        assertNull(SybaseCallService.returnDescriptor(List.of(second, first)));
        assertNull(SybaseCallService.returnDescriptor(null));
        assertTrue(SybaseCallService.orderParams(null).isEmpty());
    }

    @Test
    void directionDefaultsToInputAndRecognisesOutputForms() {
        assertTrue(param("@a", 1, "int", null, "1").isInput());
        assertFalse(param("@a", 1, "int", null, "1").isOutput());
        assertTrue(param("@a", 1, "int", "output", null).isOutput());
        assertFalse(param("@a", 1, "int", "output", null).isInput());
        assertTrue(param("@a", 1, "int", "OUT", null).isOutput());
        assertTrue(param("@a", 1, "int", "inout", "1").isOutput());
        assertTrue(param("@a", 1, "int", "inout", "1").isInput());
    }

    // ------------------------------------------------------------------
    // Bind-type classifier
    // ------------------------------------------------------------------

    @Test
    void classifiesEachSybaseTypeFamilyToItsJdbcType() {
        assertEquals(Types.INTEGER, SybaseCallService.jdbcTypeFor("int"));
        assertEquals(Types.INTEGER, SybaseCallService.jdbcTypeFor("INTEGER"));
        assertEquals(Types.SMALLINT, SybaseCallService.jdbcTypeFor("smallint"));
        assertEquals(Types.TINYINT, SybaseCallService.jdbcTypeFor("tinyint"));
        assertEquals(Types.BIGINT, SybaseCallService.jdbcTypeFor("bigint"));
        assertEquals(Types.BIT, SybaseCallService.jdbcTypeFor("bit"));
        assertEquals(Types.NUMERIC, SybaseCallService.jdbcTypeFor("numeric(10,2)"));
        assertEquals(Types.NUMERIC, SybaseCallService.jdbcTypeFor("decimal(18, 4)"));
        assertEquals(Types.DECIMAL, SybaseCallService.jdbcTypeFor("money"));
        assertEquals(Types.DECIMAL, SybaseCallService.jdbcTypeFor("smallmoney"));
        assertEquals(Types.DOUBLE, SybaseCallService.jdbcTypeFor("float"));
        assertEquals(Types.DOUBLE, SybaseCallService.jdbcTypeFor("double precision"));
        assertEquals(Types.REAL, SybaseCallService.jdbcTypeFor("real"));
        assertEquals(Types.TIMESTAMP, SybaseCallService.jdbcTypeFor("datetime"));
        assertEquals(Types.TIMESTAMP, SybaseCallService.jdbcTypeFor("smalldatetime"));
        assertEquals(Types.TIMESTAMP, SybaseCallService.jdbcTypeFor("bigdatetime"));
        assertEquals(Types.DATE, SybaseCallService.jdbcTypeFor("date"));
        assertEquals(Types.TIME, SybaseCallService.jdbcTypeFor("time"));
        assertEquals(Types.CHAR, SybaseCallService.jdbcTypeFor("char(3)"));
        assertEquals(Types.VARCHAR, SybaseCallService.jdbcTypeFor("varchar(40)"));
        assertEquals(Types.VARCHAR, SybaseCallService.jdbcTypeFor("univarchar(40)"));
        assertEquals(Types.LONGVARCHAR, SybaseCallService.jdbcTypeFor("text"));
        assertEquals(Types.BINARY, SybaseCallService.jdbcTypeFor("binary(8)"));
        assertEquals(Types.VARBINARY, SybaseCallService.jdbcTypeFor("varbinary(255)"));
        assertEquals(Types.LONGVARBINARY, SybaseCallService.jdbcTypeFor("image"));
        // Unknown / absent types fall back to the most forgiving bind.
        assertEquals(Types.VARCHAR, SybaseCallService.jdbcTypeFor("some_udt"));
        assertEquals(Types.VARCHAR, SybaseCallService.jdbcTypeFor(null));
    }

    @Test
    void classifiesEachSybaseTypeToItsSetterFamily() {
        assertEquals(SybaseCallService.BindFamily.INTEGRAL, SybaseCallService.familyFor("int"));
        assertEquals(SybaseCallService.BindFamily.INTEGRAL, SybaseCallService.familyFor("tinyint"));
        assertEquals(SybaseCallService.BindFamily.BIGINT, SybaseCallService.familyFor("bigint"));
        assertEquals(SybaseCallService.BindFamily.BOOLEAN, SybaseCallService.familyFor("bit"));
        assertEquals(SybaseCallService.BindFamily.DECIMAL,
                SybaseCallService.familyFor("numeric(10,2)"));
        assertEquals(SybaseCallService.BindFamily.DECIMAL, SybaseCallService.familyFor("money"));
        assertEquals(SybaseCallService.BindFamily.DOUBLE, SybaseCallService.familyFor("real"));
        assertEquals(SybaseCallService.BindFamily.TIMESTAMP,
                SybaseCallService.familyFor("datetime"));
        assertEquals(SybaseCallService.BindFamily.DATE, SybaseCallService.familyFor("date"));
        assertEquals(SybaseCallService.BindFamily.TIME, SybaseCallService.familyFor("time"));
        assertEquals(SybaseCallService.BindFamily.BYTES, SybaseCallService.familyFor("image"));
        // ASE's "timestamp" is a rowversion, NOT a datetime.
        assertEquals(SybaseCallService.BindFamily.BYTES, SybaseCallService.familyFor("timestamp"));
        assertEquals(SybaseCallService.BindFamily.STRING,
                SybaseCallService.familyFor("varchar(40)"));
        assertEquals(SybaseCallService.BindFamily.STRING, SybaseCallService.familyFor("text"));
        assertEquals(SybaseCallService.BindFamily.STRING, SybaseCallService.familyFor(null));
    }

    @Test
    void reducesADeclaredTypeToItsBaseToken() {
        assertEquals("numeric", SybaseCallService.baseTypeToken("NUMERIC(10, 2)"));
        assertEquals("varchar", SybaseCallService.baseTypeToken(" VarChar (40) "));
        assertEquals("double precision", SybaseCallService.baseTypeToken("DOUBLE  PRECISION"));
        assertEquals("bigint", SybaseCallService.baseTypeToken("unsigned bigint"));
        assertEquals("", SybaseCallService.baseTypeToken(null));
    }

    // ------------------------------------------------------------------
    // Wire-value coercion
    // ------------------------------------------------------------------

    @Test
    void decodesTheHexBinaryWireForm() {
        assertArrayEquals(new byte[] {0x00, (byte) 0xff, 0x10},
                SybaseCallService.decodeHexBytes("\\x00ff10"));
        // 0x prefix and upper-case hex are tolerated, as is whitespace.
        assertArrayEquals(new byte[] {(byte) 0xde, (byte) 0xad},
                SybaseCallService.decodeHexBytes("0xDEAD"));
        assertArrayEquals(new byte[] {(byte) 0xde, (byte) 0xad},
                SybaseCallService.decodeHexBytes(" \\xde ad "));
        // Bare hex without a prefix still decodes.
        assertArrayEquals(new byte[] {0x01}, SybaseCallService.decodeHexBytes("01"));
        assertArrayEquals(new byte[0], SybaseCallService.decodeHexBytes("\\x"));
        assertNull(SybaseCallService.decodeHexBytes(null));

        assertThrows(IllegalArgumentException.class,
                () -> SybaseCallService.decodeHexBytes("\\x0"));
        assertThrows(IllegalArgumentException.class,
                () -> SybaseCallService.decodeHexBytes("\\xzz"));
    }

    @Test
    void parsesTheWireDatetimeLeniently() {
        final java.sql.Timestamp canonical = java.sql.Timestamp.valueOf("2026-09-09 13:45:12.123");
        assertEquals(canonical, SybaseCallService.parseWireTimestamp("2026-09-09 13:45:12.123"));
        assertEquals(canonical, SybaseCallService.parseWireTimestamp("2026-09-09T13:45:12.123"));
        assertEquals(canonical, SybaseCallService.parseWireTimestamp("  2026-09-09 13:45:12.123Z "));
        assertEquals(canonical,
                SybaseCallService.parseWireTimestamp("2026-09-09 13:45:12.123000000"));

        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 13:45:12.000"),
                SybaseCallService.parseWireTimestamp("2026-09-09 13:45:12"));
        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 13:45:00.000"),
                SybaseCallService.parseWireTimestamp("2026-09-09 13:45"));
        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 00:00:00.000"),
                SybaseCallService.parseWireTimestamp("2026-09-09"));

        assertThrows(DateTimeException.class,
                () -> SybaseCallService.parseWireTimestamp("09/09/2026"));
    }

    @Test
    void parsesTheWireDateAndTimeForms() {
        assertEquals(java.sql.Date.valueOf("2026-09-09"),
                SybaseCallService.parseWireDate("2026-09-09"));
        // A full datetime is truncated to its date part.
        assertEquals(java.sql.Date.valueOf("2026-09-09"),
                SybaseCallService.parseWireDate("2026-09-09 13:45:12.123"));

        assertEquals(java.sql.Time.valueOf("13:45:12"),
                SybaseCallService.parseWireTime("13:45:12.123"));
        assertEquals(java.sql.Time.valueOf("13:45:12"),
                SybaseCallService.parseWireTime("13:45:12"));
        assertEquals(java.sql.Time.valueOf("13:45:00"),
                SybaseCallService.parseWireTime("13:45"));
        // A full datetime yields its time part.
        assertEquals(java.sql.Time.valueOf("13:45:12"),
                SybaseCallService.parseWireTime("2026-09-09 13:45:12.123"));
    }

    @Test
    void parsesIntegralAndBitWireValues() {
        assertEquals(42L, SybaseCallService.parseWireLong("42"));
        assertEquals(42L, SybaseCallService.parseWireLong(" +42 "));
        assertEquals(-7L, SybaseCallService.parseWireLong("-7"));
        assertEquals(42L, SybaseCallService.parseWireLong("42.000"));
        assertThrows(IllegalArgumentException.class, () -> SybaseCallService.parseWireLong("x"));

        assertTrue(SybaseCallService.parseWireBoolean("1"));
        assertTrue(SybaseCallService.parseWireBoolean("TRUE"));
        assertTrue(SybaseCallService.parseWireBoolean("yes"));
        assertFalse(SybaseCallService.parseWireBoolean("0"));
        assertFalse(SybaseCallService.parseWireBoolean("off"));
        assertThrows(IllegalArgumentException.class,
                () -> SybaseCallService.parseWireBoolean("maybe"));
    }

    // ------------------------------------------------------------------
    // Error + message projection
    // ------------------------------------------------------------------

    @Test
    void projectsASqlExceptionOntoTheErrorDetail() {
        final SQLException e = new SQLException(
                "Attempt to insert duplicate key row for login s3cr3t", "23000", 2601);
        final CallResponse.ErrorDetail detail = SybaseCallService.projectError(e, "s3cr3t");

        assertEquals(2601, detail.number());
        assertEquals("23000", detail.sqlstate());
        // Plain java.sql.SQLException exposes neither; only jConnect's EedInfo does.
        assertNull(detail.severity());
        assertNull(detail.state());
        // The password never leaves the JVM in clear.
        assertEquals("Attempt to insert duplicate key row for login ***", detail.message());
        assertNull(SybaseCallService.projectError(null, "s3cr3t"));
    }

    @Test
    void readsDriverSeverityReflectivelyWhenTheExceptionExposesIt() {
        final SQLException withSeverity = new SeverityBearingSqlException("boom", "ZZZZZ", 20001);
        final CallResponse.ErrorDetail detail =
                SybaseCallService.projectError(withSeverity, null);
        assertEquals(16, detail.severity());
        assertEquals(3, detail.state());
        assertEquals(20001, detail.number());
        // Absent methods / null targets stay null rather than blowing up.
        assertNull(SybaseCallService.reflectInt(new Object(), "getSeverity"));
        assertNull(SybaseCallService.reflectInt(null, "getSeverity"));
    }

    /** Stands in for a jConnect {@code EedInfo}-bearing driver exception. */
    private static final class SeverityBearingSqlException extends SQLException {

        private static final long serialVersionUID = 1L;

        SeverityBearingSqlException(final String reason, final String state, final int code) {
            super(reason, state, code);
        }

        public int getSeverity() {
            return 16;
        }

        public int getState() {
            return 3;
        }
    }

    @Test
    void classifiesDrainedServerMessages() {
        // A bare PRINT arrives with error number 0.
        assertEquals("print", SybaseCallService.classifyMessageKind(0, null));
        assertEquals("print", SybaseCallService.classifyMessageKind(0, 10));
        // Numbered informational messages (severity <= 10).
        assertEquals("info", SybaseCallService.classifyMessageKind(3621, null));
        assertEquals("info", SybaseCallService.classifyMessageKind(3621, 10));
        // Severity 11+ that arrived as a warning rather than an exception.
        assertEquals("raiserror", SybaseCallService.classifyMessageKind(20001, 11));
        assertEquals("raiserror", SybaseCallService.classifyMessageKind(20001, 16));
    }

    @Test
    void namesOutputParamsByDeclaredNameElseByPosition() {
        assertEquals("@total", SybaseCallService.outputKey(
                param("@total", 2, "int", "output", null), 2));
        assertEquals("p2", SybaseCallService.outputKey(
                param(null, 2, "int", "output", null), 2));
        assertEquals("p3", SybaseCallService.outputKey(
                param("  ", 3, "int", "output", null), 3));
    }

    // ------------------------------------------------------------------
    // Envelope + limit contract
    // ------------------------------------------------------------------

    @Test
    void transportFailureEnvelopeIsFullyPopulated() {
        final CallResponse body = CallResponse.failure("Call guard rejected: nope", "jtds");
        assertFalse(body.ok());
        assertEquals(CallResponse.OUTCOME_ERROR, body.outcome());
        assertEquals("jtds", body.driverUsed());
        assertNull(body.returnStatus());
        assertNull(body.errorDetail());
        // Collections are empty, never null: the Node consumer never null-checks.
        assertTrue(body.resultSets().isEmpty());
        assertTrue(body.updateCounts().isEmpty());
        assertTrue(body.messages().isEmpty());
        assertTrue(body.outputParams().isEmpty());
        assertTrue(body.session().setOptions().isEmpty());
    }

    @Test
    void clampsLimitsToTheCallCeilings() {
        final CallRequest defaults = new CallRequest();
        assertEquals(1000, defaults.resolveMaxRowsPerResultSet());
        assertEquals(10, defaults.resolveMaxResultSets());
        assertEquals(30, defaults.resolveQueryTimeoutSeconds());

        final CallRequest overshoot = new CallRequest();
        overshoot.setMaxRowsPerResultSet(1_000_000);
        overshoot.setMaxResultSets(999);
        overshoot.setQueryTimeoutSeconds(999_999);
        assertEquals(10_000, overshoot.resolveMaxRowsPerResultSet());
        assertEquals(50, overshoot.resolveMaxResultSets());
        // The LONG ceiling -- a batch routine is not a 300s /query.
        assertEquals(86_400, overshoot.resolveQueryTimeoutSeconds());
        assertEquals(86_400, SybaseCallService.MAX_CALL_TIMEOUT_SECONDS);

        final CallRequest undershoot = new CallRequest();
        undershoot.setMaxRowsPerResultSet(0);
        undershoot.setMaxResultSets(-3);
        undershoot.setQueryTimeoutSeconds(0);
        assertEquals(1, undershoot.resolveMaxRowsPerResultSet());
        assertEquals(1, undershoot.resolveMaxResultSets());
        assertEquals(1, undershoot.resolveQueryTimeoutSeconds());

        // The nested limits object wins over the flat fields.
        final CallRequest nested = new CallRequest();
        nested.setMaxRowsPerResultSet(5);
        final CallRequest.CallLimits limits = new CallRequest.CallLimits();
        limits.setMaxRowsPerResultSet(77);
        limits.setQueryTimeoutSeconds(600);
        nested.setLimits(limits);
        assertEquals(77, nested.resolveMaxRowsPerResultSet());
        assertEquals(600, nested.resolveQueryTimeoutSeconds());
        assertEquals(10, nested.resolveMaxResultSets());
    }

    @Test
    void returnStatusDefaultsTrueForProceduresAndFalseForFunctions() {
        final CallRequest proc = new CallRequest();
        proc.setRoutineName("upd_ledger_roll");
        assertTrue(proc.resolveReturnStatus());
        assertEquals("dbo", proc.resolveSchemaName());

        proc.setReturnStatus(false);
        assertFalse(proc.resolveReturnStatus());

        final CallRequest fn = new CallRequest();
        fn.setRoutineName("fn_roll_total");
        fn.setRoutineKind("FUNCTION");
        assertTrue(fn.isFunction());
        assertFalse(fn.resolveReturnStatus());
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static CallParam param(
            final String name,
            final Integer ordinal,
            final String sybaseType,
            final String direction,
            final String value
    ) {
        final CallParam p = new CallParam();
        p.setName(name);
        p.setOrdinal(ordinal);
        p.setSybaseType(sybaseType);
        p.setDirection(direction);
        p.setValue(value);
        return p;
    }
}
