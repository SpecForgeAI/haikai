package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.dbsidecar.model.CallParam;
import com.example.dbsidecar.model.CallRequest;
import com.example.dbsidecar.model.CallResponse;
import java.sql.SQLException;
import java.sql.Types;
import java.time.DateTimeException;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link RoutineCallService} -- the pure helpers behind the
 * {@code /call} invocation surface (Stored-Proc Behaviour Program, Spec 2).
 * The JDBC-touching path (bind, execute, result walk, OUT read) is exercised
 * by the integration suite against a live Sybase, exactly as the query and
 * mutation services are; everything testable without a connection is
 * extracted into package-visible statics and driven here.
 *
 * <p>Routine vocabulary is invented ({@code upd_ledger_roll},
 * {@code fn_roll_total}).</p>
 */
class RoutineCallServiceTest {

    // ------------------------------------------------------------------
    // Call-string composition
    // ------------------------------------------------------------------

    @Test
    void composesProcedureCallWithReturnStatus() {
        assertEquals("{?= call dbo.upd_ledger_roll(?, ?, ?)}",
                RoutineCallService.composeCallString("dbo.upd_ledger_roll", false, true, 3));
    }

    @Test
    void composesProcedureCallWithoutReturnStatus() {
        assertEquals("{call dbo.upd_ledger_roll(?, ?)}",
                RoutineCallService.composeCallString("dbo.upd_ledger_roll", false, false, 2));
    }

    @Test
    void composesFunctionCallWithResultPlaceholder() {
        assertEquals("{? = call dbo.fn_roll_total(?)}",
                RoutineCallService.composeCallString("dbo.fn_roll_total", true, false, 1));
        // returnStatus is meaningless for a function and never changes the shape.
        assertEquals("{? = call dbo.fn_roll_total(?)}",
                RoutineCallService.composeCallString("dbo.fn_roll_total", true, true, 1));
    }

    @Test
    void composesZeroParameterCalls() {
        assertEquals("{?= call dbo.upd_ledger_roll()}",
                RoutineCallService.composeCallString("dbo.upd_ledger_roll", false, true, 0));
        assertEquals("{call dbo.upd_ledger_roll()}",
                RoutineCallService.composeCallString("dbo.upd_ledger_roll", false, false, 0));
        assertEquals("{? = call ledger_db.dbo.fn_roll_total()}",
                RoutineCallService.composeCallString("ledger_db.dbo.fn_roll_total", true, false, 0));
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
                RoutineCallService.orderParams(List.of(second, first, unnumbered, result));
        assertEquals(3, ordered.size());
        assertEquals("@roll_id", ordered.get(0).getName());
        assertEquals("@amount", ordered.get(1).getName());
        // Absent ordinals sort last, in their original order.
        assertEquals("@note", ordered.get(2).getName());

        assertEquals("@total",
                RoutineCallService.returnDescriptor(List.of(second, result, first)).getName());
        assertNull(RoutineCallService.returnDescriptor(List.of(second, first)));
        assertNull(RoutineCallService.returnDescriptor(null));
        assertTrue(RoutineCallService.orderParams(null).isEmpty());
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
        assertEquals(Types.INTEGER, RoutineCallService.jdbcTypeFor("int"));
        assertEquals(Types.INTEGER, RoutineCallService.jdbcTypeFor("INTEGER"));
        assertEquals(Types.SMALLINT, RoutineCallService.jdbcTypeFor("smallint"));
        assertEquals(Types.TINYINT, RoutineCallService.jdbcTypeFor("tinyint"));
        assertEquals(Types.BIGINT, RoutineCallService.jdbcTypeFor("bigint"));
        assertEquals(Types.BIT, RoutineCallService.jdbcTypeFor("bit"));
        assertEquals(Types.NUMERIC, RoutineCallService.jdbcTypeFor("numeric(10,2)"));
        assertEquals(Types.NUMERIC, RoutineCallService.jdbcTypeFor("decimal(18, 4)"));
        assertEquals(Types.DECIMAL, RoutineCallService.jdbcTypeFor("money"));
        assertEquals(Types.DECIMAL, RoutineCallService.jdbcTypeFor("smallmoney"));
        assertEquals(Types.DOUBLE, RoutineCallService.jdbcTypeFor("float"));
        assertEquals(Types.DOUBLE, RoutineCallService.jdbcTypeFor("double precision"));
        assertEquals(Types.REAL, RoutineCallService.jdbcTypeFor("real"));
        assertEquals(Types.TIMESTAMP, RoutineCallService.jdbcTypeFor("datetime"));
        assertEquals(Types.TIMESTAMP, RoutineCallService.jdbcTypeFor("smalldatetime"));
        assertEquals(Types.TIMESTAMP, RoutineCallService.jdbcTypeFor("bigdatetime"));
        assertEquals(Types.DATE, RoutineCallService.jdbcTypeFor("date"));
        assertEquals(Types.TIME, RoutineCallService.jdbcTypeFor("time"));
        assertEquals(Types.CHAR, RoutineCallService.jdbcTypeFor("char(3)"));
        assertEquals(Types.VARCHAR, RoutineCallService.jdbcTypeFor("varchar(40)"));
        assertEquals(Types.VARCHAR, RoutineCallService.jdbcTypeFor("univarchar(40)"));
        assertEquals(Types.LONGVARCHAR, RoutineCallService.jdbcTypeFor("text"));
        assertEquals(Types.BINARY, RoutineCallService.jdbcTypeFor("binary(8)"));
        assertEquals(Types.VARBINARY, RoutineCallService.jdbcTypeFor("varbinary(255)"));
        assertEquals(Types.LONGVARBINARY, RoutineCallService.jdbcTypeFor("image"));
        // Unknown / absent types fall back to the most forgiving bind.
        assertEquals(Types.VARCHAR, RoutineCallService.jdbcTypeFor("some_udt"));
        assertEquals(Types.VARCHAR, RoutineCallService.jdbcTypeFor(null));
    }

    @Test
    void classifiesEachSybaseTypeToItsSetterFamily() {
        assertEquals(RoutineCallService.BindFamily.INTEGRAL, RoutineCallService.familyFor("int"));
        assertEquals(RoutineCallService.BindFamily.INTEGRAL, RoutineCallService.familyFor("tinyint"));
        assertEquals(RoutineCallService.BindFamily.BIGINT, RoutineCallService.familyFor("bigint"));
        assertEquals(RoutineCallService.BindFamily.BOOLEAN, RoutineCallService.familyFor("bit"));
        assertEquals(RoutineCallService.BindFamily.DECIMAL,
                RoutineCallService.familyFor("numeric(10,2)"));
        assertEquals(RoutineCallService.BindFamily.DECIMAL, RoutineCallService.familyFor("money"));
        assertEquals(RoutineCallService.BindFamily.DOUBLE, RoutineCallService.familyFor("real"));
        assertEquals(RoutineCallService.BindFamily.TIMESTAMP,
                RoutineCallService.familyFor("datetime"));
        assertEquals(RoutineCallService.BindFamily.DATE, RoutineCallService.familyFor("date"));
        assertEquals(RoutineCallService.BindFamily.TIME, RoutineCallService.familyFor("time"));
        assertEquals(RoutineCallService.BindFamily.BYTES, RoutineCallService.familyFor("image"));
        // ASE's "timestamp" is a rowversion, NOT a datetime.
        assertEquals(RoutineCallService.BindFamily.BYTES, RoutineCallService.familyFor("timestamp"));
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("varchar(40)"));
        assertEquals(RoutineCallService.BindFamily.STRING, RoutineCallService.familyFor("text"));
        assertEquals(RoutineCallService.BindFamily.STRING, RoutineCallService.familyFor(null));
    }

    @Test
    void reducesADeclaredTypeToItsBaseToken() {
        assertEquals("numeric", RoutineCallService.baseTypeToken("NUMERIC(10, 2)"));
        assertEquals("varchar", RoutineCallService.baseTypeToken(" VarChar (40) "));
        assertEquals("double precision", RoutineCallService.baseTypeToken("DOUBLE  PRECISION"));
        assertEquals("bigint", RoutineCallService.baseTypeToken("unsigned bigint"));
        assertEquals("", RoutineCallService.baseTypeToken(null));
    }

    // ------------------------------------------------------------------
    // Wire-value coercion
    // ------------------------------------------------------------------

    @Test
    void decodesTheHexBinaryWireForm() {
        assertArrayEquals(new byte[] {0x00, (byte) 0xff, 0x10},
                RoutineCallService.decodeHexBytes("\\x00ff10"));
        // 0x prefix and upper-case hex are tolerated, as is whitespace.
        assertArrayEquals(new byte[] {(byte) 0xde, (byte) 0xad},
                RoutineCallService.decodeHexBytes("0xDEAD"));
        assertArrayEquals(new byte[] {(byte) 0xde, (byte) 0xad},
                RoutineCallService.decodeHexBytes(" \\xde ad "));
        // Bare hex without a prefix still decodes.
        assertArrayEquals(new byte[] {0x01}, RoutineCallService.decodeHexBytes("01"));
        assertArrayEquals(new byte[0], RoutineCallService.decodeHexBytes("\\x"));
        assertNull(RoutineCallService.decodeHexBytes(null));

        assertThrows(IllegalArgumentException.class,
                () -> RoutineCallService.decodeHexBytes("\\x0"));
        assertThrows(IllegalArgumentException.class,
                () -> RoutineCallService.decodeHexBytes("\\xzz"));
    }

    @Test
    void parsesTheWireDatetimeLeniently() {
        final java.sql.Timestamp canonical = java.sql.Timestamp.valueOf("2026-09-09 13:45:12.123");
        assertEquals(canonical, RoutineCallService.parseWireTimestamp("2026-09-09 13:45:12.123"));
        assertEquals(canonical, RoutineCallService.parseWireTimestamp("2026-09-09T13:45:12.123"));
        assertEquals(canonical, RoutineCallService.parseWireTimestamp("  2026-09-09 13:45:12.123Z "));
        assertEquals(canonical,
                RoutineCallService.parseWireTimestamp("2026-09-09 13:45:12.123000000"));

        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 13:45:12.000"),
                RoutineCallService.parseWireTimestamp("2026-09-09 13:45:12"));
        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 13:45:00.000"),
                RoutineCallService.parseWireTimestamp("2026-09-09 13:45"));
        assertEquals(java.sql.Timestamp.valueOf("2026-09-09 00:00:00.000"),
                RoutineCallService.parseWireTimestamp("2026-09-09"));

        assertThrows(DateTimeException.class,
                () -> RoutineCallService.parseWireTimestamp("09/09/2026"));
    }

    @Test
    void parsesTheWireDateAndTimeForms() {
        assertEquals(java.sql.Date.valueOf("2026-09-09"),
                RoutineCallService.parseWireDate("2026-09-09"));
        // A full datetime is truncated to its date part.
        assertEquals(java.sql.Date.valueOf("2026-09-09"),
                RoutineCallService.parseWireDate("2026-09-09 13:45:12.123"));

        assertEquals(java.sql.Time.valueOf("13:45:12"),
                RoutineCallService.parseWireTime("13:45:12.123"));
        assertEquals(java.sql.Time.valueOf("13:45:12"),
                RoutineCallService.parseWireTime("13:45:12"));
        assertEquals(java.sql.Time.valueOf("13:45:00"),
                RoutineCallService.parseWireTime("13:45"));
        // A full datetime yields its time part.
        assertEquals(java.sql.Time.valueOf("13:45:12"),
                RoutineCallService.parseWireTime("2026-09-09 13:45:12.123"));
    }

    @Test
    void parsesIntegralAndBitWireValues() {
        assertEquals(42L, RoutineCallService.parseWireLong("42"));
        assertEquals(42L, RoutineCallService.parseWireLong(" +42 "));
        assertEquals(-7L, RoutineCallService.parseWireLong("-7"));
        assertEquals(42L, RoutineCallService.parseWireLong("42.000"));
        assertThrows(IllegalArgumentException.class, () -> RoutineCallService.parseWireLong("x"));

        assertTrue(RoutineCallService.parseWireBoolean("1"));
        assertTrue(RoutineCallService.parseWireBoolean("TRUE"));
        assertTrue(RoutineCallService.parseWireBoolean("yes"));
        assertFalse(RoutineCallService.parseWireBoolean("0"));
        assertFalse(RoutineCallService.parseWireBoolean("off"));
        assertThrows(IllegalArgumentException.class,
                () -> RoutineCallService.parseWireBoolean("maybe"));
    }

    // ------------------------------------------------------------------
    // Error + message projection
    // ------------------------------------------------------------------

    @Test
    void projectsASqlExceptionOntoTheErrorDetail() {
        final SQLException e = new SQLException(
                "Attempt to insert duplicate key row for login s3cr3t", "23000", 2601);
        final CallResponse.ErrorDetail detail = RoutineCallService.projectError(e, "s3cr3t");

        assertEquals(2601, detail.number());
        assertEquals("23000", detail.sqlstate());
        // Plain java.sql.SQLException exposes neither; only jConnect's EedInfo does.
        assertNull(detail.severity());
        assertNull(detail.state());
        // The password never leaves the JVM in clear.
        assertEquals("Attempt to insert duplicate key row for login ***", detail.message());
        assertNull(RoutineCallService.projectError(null, "s3cr3t"));
    }

    @Test
    void readsDriverSeverityReflectivelyWhenTheExceptionExposesIt() {
        final SQLException withSeverity = new SeverityBearingSqlException("boom", "ZZZZZ", 20001);
        final CallResponse.ErrorDetail detail =
                RoutineCallService.projectError(withSeverity, null);
        assertEquals(16, detail.severity());
        assertEquals(3, detail.state());
        assertEquals(20001, detail.number());
        // Absent methods / null targets stay null rather than blowing up.
        assertNull(RoutineCallService.reflectInt(new Object(), "getSeverity"));
        assertNull(RoutineCallService.reflectInt(null, "getSeverity"));
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
        assertEquals("print", RoutineCallService.classifyMessageKind(0, null));
        assertEquals("print", RoutineCallService.classifyMessageKind(0, 10));
        // Numbered informational messages (severity <= 10).
        assertEquals("info", RoutineCallService.classifyMessageKind(3621, null));
        assertEquals("info", RoutineCallService.classifyMessageKind(3621, 10));
        // Severity 11+ that arrived as a warning rather than an exception.
        assertEquals("raiserror", RoutineCallService.classifyMessageKind(20001, 11));
        assertEquals("raiserror", RoutineCallService.classifyMessageKind(20001, 16));
    }

    @Test
    void namesOutputParamsByDeclaredNameElseByPosition() {
        assertEquals("@total", RoutineCallService.outputKey(
                param("@total", 2, "int", "output", null), 2));
        assertEquals("p2", RoutineCallService.outputKey(
                param(null, 2, "int", "output", null), 2));
        assertEquals("p3", RoutineCallService.outputKey(
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
        assertEquals(86_400, RoutineCallService.MAX_CALL_TIMEOUT_SECONDS);

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
