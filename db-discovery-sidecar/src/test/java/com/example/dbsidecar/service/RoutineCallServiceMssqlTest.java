package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.dbsidecar.model.CallParam;
import com.example.dbsidecar.model.SidecarEngine;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Types;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * SQL Server twins of the {@code /call} binder tables (SPEC-1 §1.5; wire
 * contract v2 §5).
 *
 * <p>The two engines' type vocabularies overlap without coinciding, and the
 * overlaps are where a silent mis-bind would live: {@code timestamp} is a
 * ROWVERSION on both (never a datetime), {@code datetime2} /
 * {@code datetimeoffset} / {@code uniqueidentifier} / {@code sql_variant}
 * exist only on SQL Server, and an {@code nvarchar} bound through a narrowing
 * {@code setString} loses characters outside the server collation. Each pair
 * below pins the SQL Server answer NEXT TO the Sybase one, so a future edit
 * cannot quietly collapse the two tables back into one.</p>
 */
class RoutineCallServiceMssqlTest {

    // ----------------------------------------------------------------------
    // Bind families
    // ----------------------------------------------------------------------

    /** The SQL Server national text family binds through {@code setNString}. */
    @Test
    void nationalTextTypesBindAsNString() {
        assertEquals(RoutineCallService.BindFamily.NSTRING,
                RoutineCallService.familyFor("nvarchar(40)", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.NSTRING,
                RoutineCallService.familyFor("nchar(3)", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.NSTRING,
                RoutineCallService.familyFor("ntext", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.NSTRING,
                RoutineCallService.familyFor("xml", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.NSTRING,
                RoutineCallService.familyFor("sysname", SidecarEngine.MSSQL));
        // Sybase has no national-text family: unichar/univarchar bind as STRING.
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("univarchar(40)", SidecarEngine.SYBASE));
    }

    /** {@code datetime2} is a timestamp; {@code datetimeoffset} is its own family. */
    @Test
    void temporalFamiliesSplitByEngine() {
        assertEquals(RoutineCallService.BindFamily.TIMESTAMP,
                RoutineCallService.familyFor("datetime2(7)", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.TIMESTAMP,
                RoutineCallService.familyFor("datetime", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.DATETIMEOFFSET,
                RoutineCallService.familyFor("datetimeoffset(7)", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.DATE,
                RoutineCallService.familyFor("date", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.TIME,
                RoutineCallService.familyFor("time(7)", SidecarEngine.MSSQL));
        // ASE's bigdatetime/bigtime have no SQL Server spelling and vice versa.
        assertEquals(RoutineCallService.BindFamily.TIMESTAMP,
                RoutineCallService.familyFor("bigdatetime", SidecarEngine.SYBASE));
    }

    /** {@code timestamp} is a ROWVERSION on BOTH engines -- binary, not a date. */
    @Test
    void timestampIsARowversionOnBothEngines() {
        assertEquals(RoutineCallService.BindFamily.BYTES,
                RoutineCallService.familyFor("timestamp", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.BYTES,
                RoutineCallService.familyFor("rowversion", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.BYTES,
                RoutineCallService.familyFor("timestamp", SidecarEngine.SYBASE));
        assertEquals(RoutineCallService.BindFamily.BYTES,
                RoutineCallService.familyFor("varbinary(max)", SidecarEngine.MSSQL));
    }

    /** Numeric + bit + money families agree across the two engines. */
    @Test
    void numericFamiliesAgreeAcrossEngines() {
        for (final SidecarEngine engine : SidecarEngine.values()) {
            assertEquals(RoutineCallService.BindFamily.INTEGRAL,
                    RoutineCallService.familyFor("int", engine));
            assertEquals(RoutineCallService.BindFamily.BIGINT,
                    RoutineCallService.familyFor("bigint", engine));
            assertEquals(RoutineCallService.BindFamily.BOOLEAN,
                    RoutineCallService.familyFor("bit", engine));
            assertEquals(RoutineCallService.BindFamily.DECIMAL,
                    RoutineCallService.familyFor("money", engine));
            assertEquals(RoutineCallService.BindFamily.DECIMAL,
                    RoutineCallService.familyFor("numeric(10,2)", engine));
            assertEquals(RoutineCallService.BindFamily.DOUBLE,
                    RoutineCallService.familyFor("float", engine));
        }
    }

    /**
     * {@code uniqueidentifier}, {@code sql_variant} and the CLR-backed types
     * bind as strings -- their canonical / {@code ToString()} / WKT forms.
     */
    @Test
    void guidVariantAndClrTypesBindAsStrings() {
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("uniqueidentifier", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("sql_variant", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("hierarchyid", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("geography", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.BindFamily.STRING,
                RoutineCallService.familyFor("geometry", SidecarEngine.MSSQL));
    }

    // ----------------------------------------------------------------------
    // JDBC type constants (typed NULLs + OUT registration)
    // ----------------------------------------------------------------------

    /** The national-text types register as their N-flavoured JDBC constants. */
    @Test
    void nationalTextRegistersAsNTypes() {
        assertEquals(Types.NVARCHAR,
                RoutineCallService.jdbcTypeFor("nvarchar(40)", SidecarEngine.MSSQL));
        assertEquals(Types.NCHAR,
                RoutineCallService.jdbcTypeFor("nchar(3)", SidecarEngine.MSSQL));
        assertEquals(Types.LONGNVARCHAR,
                RoutineCallService.jdbcTypeFor("ntext", SidecarEngine.MSSQL));
        assertEquals(Types.LONGNVARCHAR,
                RoutineCallService.jdbcTypeFor("xml", SidecarEngine.MSSQL));
        // The SAME token on Sybase is the plain CHAR family (no N types).
        assertEquals(Types.CHAR, RoutineCallService.jdbcTypeFor("nchar(3)"));
    }

    /** {@code datetimeoffset} registers as the driver's own type constant. */
    @Test
    void dateTimeOffsetRegistersAsTheDriverType() {
        assertEquals(microsoft.sql.Types.DATETIMEOFFSET,
                RoutineCallService.jdbcTypeFor("datetimeoffset", SidecarEngine.MSSQL));
        assertEquals(RoutineCallService.MSSQL_DATETIMEOFFSET,
                RoutineCallService.jdbcTypeFor("datetimeoffset(7)", SidecarEngine.MSSQL));
    }

    /** A GUID registers as CHAR(36)'s constant, sql_variant as OTHER. */
    @Test
    void guidAndVariantRegistrations() {
        assertEquals(Types.CHAR,
                RoutineCallService.jdbcTypeFor("uniqueidentifier", SidecarEngine.MSSQL));
        assertEquals(Types.OTHER,
                RoutineCallService.jdbcTypeFor("sql_variant", SidecarEngine.MSSQL));
        assertEquals(Types.VARBINARY,
                RoutineCallService.jdbcTypeFor("rowversion", SidecarEngine.MSSQL));
        assertEquals(Types.TIMESTAMP,
                RoutineCallService.jdbcTypeFor("datetime2(3)", SidecarEngine.MSSQL));
    }

    /** An unknown type stays VARCHAR -- the most forgiving choice on both. */
    @Test
    void unknownTypesFallBackToVarchar() {
        assertEquals(Types.VARCHAR,
                RoutineCallService.jdbcTypeFor("some_alias_type", SidecarEngine.MSSQL));
        assertEquals(Types.VARCHAR, RoutineCallService.jdbcTypeFor(null, SidecarEngine.MSSQL));
    }

    /** The default (engine-less) overloads stay on the Sybase table. */
    @Test
    void defaultOverloadsRemainSybase() {
        assertEquals(RoutineCallService.familyFor("nvarchar(40)", SidecarEngine.SYBASE),
                RoutineCallService.familyFor("nvarchar(40)"));
        assertEquals(RoutineCallService.jdbcTypeFor("timestamp", SidecarEngine.SYBASE),
                RoutineCallService.jdbcTypeFor("timestamp"));
    }

    // ----------------------------------------------------------------------
    // sourceType / sybaseType aliasing
    // ----------------------------------------------------------------------

    /** {@code sourceType} is the field name; {@code sybaseType} is an alias. */
    @Test
    void sourceTypeAcceptsTheLegacySpellingOnTheWire() throws Exception {
        final ObjectMapper mapper = new ObjectMapper();
        final CallParam modern = mapper.readValue(
                "{\"name\":\"@id\",\"sourceType\":\"nvarchar(40)\",\"value\":\"x\"}",
                CallParam.class);
        assertEquals("nvarchar(40)", modern.getSourceType());
        assertEquals("nvarchar(40)", modern.getSybaseType());

        for (final String legacy : List.of("sybaseType", "sybase_type", "source_type")) {
            final CallParam param = mapper.readValue(
                    "{\"name\":\"@id\",\"" + legacy + "\":\"int\",\"value\":\"1\"}",
                    CallParam.class);
            assertEquals("int", param.getSourceType(), "alias " + legacy);
        }
    }

    /** Either accessor writes the same field. */
    @Test
    void bothAccessorsShareOneField() {
        final CallParam param = new CallParam();
        param.setSybaseType("datetime2(7)");
        assertEquals("datetime2(7)", param.getSourceType());
        param.setSourceType("nvarchar(10)");
        assertEquals("nvarchar(10)", param.getSybaseType());
    }

    // ----------------------------------------------------------------------
    // Table-valued parameters
    // ----------------------------------------------------------------------

    /**
     * A table-valued parameter is REFUSED by name rather than bound as
     * something else -- capturing a routine's behaviour with the wrong input
     * would produce evidence that never happened.
     */
    @Test
    void tableValuedParametersAreRefusedByName() {
        final CallParam declared = new CallParam();
        declared.setName("@lines");
        declared.setTableValued(Boolean.TRUE);
        assertTrue(declared.isTableValued());
        final IllegalArgumentException thrown = assertThrows(IllegalArgumentException.class,
                () -> RoutineCallService.assertNoTableValuedParams(
                        Collections.singletonList(declared)));
        assertTrue(thrown.getMessage().contains(RoutineCallService.REASON_TVP_UNSUPPORTED));
        assertTrue(thrown.getMessage().contains("@lines"));

        // Inferred from the type token, for a caller that did not set the flag.
        final CallParam inferred = new CallParam();
        inferred.setSourceType("table");
        assertTrue(inferred.isTableValued());
        final CallParam readonly = new CallParam();
        readonly.setSourceType("dbo.OrderLineType READONLY");
        assertTrue(readonly.isTableValued());
    }

    /** An ordinary parameter is never mistaken for a TVP. */
    @Test
    void scalarParametersAreNotTableValued() {
        final CallParam param = new CallParam();
        param.setSourceType("nvarchar(40)");
        assertFalse(param.isTableValued());
        RoutineCallService.assertNoTableValuedParams(Collections.singletonList(param));
        RoutineCallService.assertNoTableValuedParams(null);
    }

    // ----------------------------------------------------------------------
    // Message classification
    // ----------------------------------------------------------------------

    /**
     * {@code THROW} raises a USER error (number >= 50000). When the driver
     * delivers it as a warning the severity can be absent, so the number alone
     * must classify it as a {@code raiserror} -- otherwise a deliberate
     * business error would be captured as an informational message.
     */
    @Test
    void throwIsClassifiedAsRaiserror() {
        assertEquals("raiserror",
                RoutineCallService.classifyMessageKind(50001, null, SidecarEngine.MSSQL));
        assertEquals("raiserror",
                RoutineCallService.classifyMessageKind(50001, 16, SidecarEngine.MSSQL));
        // Below the user range with no severity is still informational.
        assertEquals("info",
                RoutineCallService.classifyMessageKind(3609, null, SidecarEngine.MSSQL));
        // A bare PRINT is a print on both engines.
        assertEquals("print",
                RoutineCallService.classifyMessageKind(0, null, SidecarEngine.MSSQL));
        assertEquals("print",
                RoutineCallService.classifyMessageKind(0, null, SidecarEngine.SYBASE));
        // Severity 11+ is a raiserror on both.
        assertEquals("raiserror",
                RoutineCallService.classifyMessageKind(20001, 16, SidecarEngine.SYBASE));
        // The Sybase path is UNCHANGED: a high user number alone is info there.
        assertEquals("info",
                RoutineCallService.classifyMessageKind(50001, null, SidecarEngine.SYBASE));
        assertEquals("info", RoutineCallService.classifyMessageKind(50001, null));
    }

    /** Severity / state read null on a driver that exposes neither. */
    @Test
    void severityAndStateDegradeToNullOnAPlainException() {
        final java.sql.SQLException plain = new java.sql.SQLException("boom", "42000", 1105);
        assertEquals(null, RoutineCallService.severityOf(plain));
        assertEquals(null, RoutineCallService.stateOf(plain));
        assertEquals(null, RoutineCallService.severityOf(null));

        final com.example.dbsidecar.model.CallResponse.ErrorDetail detail =
                RoutineCallService.projectError(plain, null);
        assertEquals(1105, detail.number());
        assertEquals("42000", detail.sqlstate());
        assertEquals("boom", detail.message());
    }
}
