package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.dbsidecar.model.IntrospectionResponse;
import com.example.dbsidecar.model.SidecarEngine;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link MssqlCatalog} -- the pure row mappers, the
 * {@code sys.*} value decoders and the capability set.
 *
 * <p>No SQL Server is reachable from the build or the work machine (shaping
 * §7), so these tests drive the mapping seams with PRIMITIVE row inputs, the
 * same style the Sybase catalog tests use. That is deliberate: the mapping is
 * where a wire-contract mistake would actually land, and it is the part that
 * can be pinned without an engine.</p>
 */
class MssqlCatalogTest {

    // ----------------------------------------------------------------------
    // Columns
    // ----------------------------------------------------------------------

    /**
     * SQL Server reports {@code max_length} in BYTES, so an
     * {@code nvarchar(50)} arrives as 100 and would otherwise be emitted as a
     * 100-character column -- a silent doubling in every generated DDL.
     * {@code -1} (MAX) must pass through untouched.
     */
    @Test
    void maxLengthNormalisesNationalTypesAndKeepsMax() {
        assertEquals(50, MssqlCatalog.normalizeMaxLength("nvarchar", 100));
        assertEquals(10, MssqlCatalog.normalizeMaxLength("nchar", 20));
        assertEquals(8, MssqlCatalog.normalizeMaxLength("ntext", 16));
        assertEquals(128, MssqlCatalog.normalizeMaxLength("sysname", 256));
        // Single-byte types are already declared-length.
        assertEquals(50, MssqlCatalog.normalizeMaxLength("varchar", 50));
        assertEquals(8, MssqlCatalog.normalizeMaxLength("datetime2", 8));
        // MAX stays MAX on both widths.
        assertEquals(-1, MssqlCatalog.normalizeMaxLength("nvarchar", -1));
        assertEquals(-1, MssqlCatalog.normalizeMaxLength("varbinary", -1));
        // Unknown / null type: pass through rather than guess.
        assertEquals(42, MssqlCatalog.normalizeMaxLength(null, 42));
    }

    /**
     * A column row carries the full contract §2 field set: precision / scale,
     * the identity seed + increment, the DEFAULT constraint and its name, the
     * alias type name (with {@code dataType} resolved to the BASE type), and
     * the temporal period marker.
     */
    @Test
    void mapColumnRowCarriesTheFullContractFieldSet() {
        final IntrospectionResponse.ColumnRow row = MssqlCatalog.mapColumnRow(
                "sales", "invoice", "amount",
                "decimal", null,
                9, 18, 4,
                false, 3,
                "SQL_Latin1_General_CP1_CI_AS",
                false, null, null,
                false, null, null,
                "((0))", "DF_invoice_amount",
                Boolean.FALSE, Boolean.FALSE,
                "NOT_APPLICABLE", Boolean.FALSE, Boolean.FALSE,
                null);
        assertEquals("sales", row.schemaName());
        assertEquals("decimal", row.dataType());
        assertEquals(18, row.precision());
        assertEquals(4, row.scale());
        assertEquals("((0))", row.defaultExpression());
        assertEquals("DF_invoice_amount", row.defaultConstraintName());
        assertEquals("SQL_Latin1_General_CP1_CI_AS", row.collation());
        assertFalse(row.isNullable());
        // Not identity, not computed -> those fields stay null, never "0".
        assertNull(row.identitySeed());
        assertNull(row.identityIncrement());
        assertNull(row.computedExpression());
        assertNull(row.generatedAlwaysType());
    }

    /** An IDENTITY column carries its seed + increment; a plain one does not. */
    @Test
    void mapColumnRowCarriesIdentitySeedOnlyForIdentityColumns() {
        final IntrospectionResponse.ColumnRow identity = MssqlCatalog.mapColumnRow(
                "dbo", "orders", "order_id", "int", null, 4, 10, 0, false, 1,
                null, false, null, null,
                true, "1000", "5",
                null, null, null, null, null, null, null, null);
        assertEquals(Boolean.TRUE, identity.isIdentity());
        assertEquals("1000", identity.identitySeed());
        assertEquals("5", identity.identityIncrement());

        final IntrospectionResponse.ColumnRow plain = MssqlCatalog.mapColumnRow(
                "dbo", "orders", "note", "varchar", null, 40, null, null, true, 2,
                null, false, null, null,
                false, "1000", "5",
                null, null, null, null, null, null, null, null);
        assertNull(plain.identitySeed());
        assertNull(plain.identityIncrement());
    }

    /**
     * An alias (user-defined) type resolves to its BASE type in
     * {@code dataType}, with the declared name preserved in
     * {@code userTypeName} -- a type mapper needs the base type, a reviewer
     * needs the name the schema actually says.
     */
    @Test
    void mapColumnRowSeparatesAliasTypeFromBaseType() {
        final IntrospectionResponse.ColumnRow row = MssqlCatalog.mapColumnRow(
                "dbo", "customer", "phone", "varchar", "PhoneNumber",
                20, null, null, true, 4,
                null, false, null, null, false, null, null,
                null, null, null, null, null, null, null, null);
        assertEquals("varchar", row.dataType());
        assertEquals("PhoneNumber", row.userTypeName());
    }

    /** A PERSISTED computed column keeps its expression and the persisted flag. */
    @Test
    void mapColumnRowCarriesComputedExpressionAndPersistedFlag() {
        final IntrospectionResponse.ColumnRow row = MssqlCatalog.mapColumnRow(
                "dbo", "invoice", "total", "decimal", null, 9, 18, 2, true, 7,
                null, true, "([qty]*[price])", Boolean.TRUE,
                false, null, null, null, null, null, null, null, null, null, null);
        assertEquals(Boolean.TRUE, row.isComputed());
        assertEquals("([qty]*[price])", row.computedExpression());
        assertEquals(Boolean.TRUE, row.isPersistedComputed());
    }

    /** {@code generated_always_type_desc} decodes to the contract's vocabulary. */
    @Test
    void generatedAlwaysTypeDecode() {
        assertEquals("as_row_start", MssqlCatalog.decodeGeneratedAlwaysType("AS_ROW_START"));
        assertEquals("as_row_end", MssqlCatalog.decodeGeneratedAlwaysType("AS_ROW_END"));
        // The overwhelmingly common value means "this is an ordinary column".
        assertNull(MssqlCatalog.decodeGeneratedAlwaysType("NOT_APPLICABLE"));
        assertNull(MssqlCatalog.decodeGeneratedAlwaysType(null));
    }

    // ----------------------------------------------------------------------
    // Tables
    // ----------------------------------------------------------------------

    /** Temporal type decodes, and the history table is reported schema-qualified. */
    @Test
    void mapTableRowCarriesTemporalLink() {
        final IntrospectionResponse.TableRow row = MssqlCatalog.mapTableRow(
                "dbo", "employee",
                "SYSTEM_VERSIONED_TEMPORAL_TABLE",
                "history", "employee_history",
                "valid_from", "valid_to",
                Boolean.FALSE, Boolean.FALSE);
        assertEquals("system_versioned", row.temporalType());
        assertEquals("history.employee_history", row.historyTable());
        assertEquals("valid_from", row.periodStartColumn());
        assertEquals("valid_to", row.periodEndColumn());
    }

    /** A plain table reports NO temporal facts (null, never a false positive). */
    @Test
    void mapTableRowLeavesPlainTablesUnmarked() {
        final IntrospectionResponse.TableRow row = MssqlCatalog.mapTableRow(
                "dbo", "orders", "NON_TEMPORAL_TABLE", null, null, null, null,
                Boolean.FALSE, Boolean.FALSE);
        assertNull(row.temporalType());
        assertNull(row.historyTable());
    }

    /** The history side of a temporal pair is marked as such. */
    @Test
    void temporalTypeDecode() {
        assertEquals("history", MssqlCatalog.decodeTemporalType("HISTORY_TABLE"));
        assertNull(MssqlCatalog.decodeTemporalType("NON_TEMPORAL_TABLE"));
        assertNull(MssqlCatalog.decodeTemporalType(null));
    }

    // ----------------------------------------------------------------------
    // Indexes, FKs, checks
    // ----------------------------------------------------------------------

    /** {@code type_desc} becomes the contract's lower-snake index type. */
    @Test
    void indexTypeDecode() {
        assertEquals("clustered", MssqlCatalog.decodeIndexType("CLUSTERED"));
        assertEquals("nonclustered", MssqlCatalog.decodeIndexType("NONCLUSTERED"));
        assertEquals("clustered_columnstore",
                MssqlCatalog.decodeIndexType("CLUSTERED COLUMNSTORE"));
        assertEquals("nonclustered_columnstore",
                MssqlCatalog.decodeIndexType("NONCLUSTERED COLUMNSTORE"));
        assertEquals("xml", MssqlCatalog.decodeIndexType("XML"));
        assertEquals("spatial", MssqlCatalog.decodeIndexType("SPATIAL"));
        assertEquals("heap", MssqlCatalog.decodeIndexType("HEAP"));
        assertNull(MssqlCatalog.decodeIndexType(null));
        assertNull(MssqlCatalog.decodeIndexType("  "));
    }

    /**
     * A filtered covering index carries its predicate, its INCLUDE columns and
     * its per-column direction -- the three facts an equivalent Postgres index
     * cannot be generated without.
     */
    @Test
    void mapIndexRowCarriesFilterIncludeAndDirections() {
        final IntrospectionResponse.KeyRow row = MssqlCatalog.mapIndexRow(
                "dbo", "orders", "ix_orders_open", "NONCLUSTERED",
                false, false, false, Boolean.FALSE,
                "([status]='OPEN')",
                Arrays.asList("customer_id", "created_at"),
                Arrays.asList("ASC", "DESC"),
                Arrays.asList("total_amount"));
        assertEquals("index", row.kind());
        assertEquals("nonclustered", row.indexType());
        assertEquals("([status]='OPEN')", row.filterDefinition());
        // indexPredicate is the pre-existing field name for the same fact, so
        // the discovery mapper needs no branch per engine.
        assertEquals("([status]='OPEN')", row.indexPredicate());
        assertEquals(Arrays.asList("total_amount"), row.includeColumns());
        assertEquals(Arrays.asList("ASC", "DESC"), row.columnDirections());
        assertEquals(Boolean.FALSE, row.isClustered());
    }

    /** A clustered PK reports kind=primary_key and isClustered=true. */
    @Test
    void mapIndexRowClassifiesPrimaryKeyAndClustering() {
        final IntrospectionResponse.KeyRow pk = MssqlCatalog.mapIndexRow(
                "dbo", "orders", "PK_orders", "CLUSTERED",
                true, true, false, Boolean.FALSE, null,
                Collections.singletonList("order_id"),
                Collections.singletonList("ASC"),
                Collections.emptyList());
        assertEquals("primary_key", pk.kind());
        assertEquals(Boolean.TRUE, pk.isClustered());
        assertTrue(pk.isUnique());

        final IntrospectionResponse.KeyRow uq = MssqlCatalog.mapIndexRow(
                "dbo", "orders", "UQ_orders_ref", "NONCLUSTERED",
                true, false, true, Boolean.FALSE, null,
                Collections.singletonList("reference"),
                Collections.singletonList("ASC"),
                Collections.emptyList());
        assertEquals("unique_constraint", uq.kind());
        assertEquals(Boolean.TRUE, uq.isUniqueConstraint());

        final IntrospectionResponse.KeyRow columnstore = MssqlCatalog.mapIndexRow(
                "dbo", "fact_sales", "cci_fact", "CLUSTERED COLUMNSTORE",
                false, false, false, Boolean.FALSE, null,
                Collections.emptyList(), Collections.emptyList(), Collections.emptyList());
        assertEquals("clustered_columnstore", columnstore.indexType());
        assertEquals(Boolean.TRUE, columnstore.isClustered());
    }

    /**
     * FK rows populate BOTH column lists (the ASE path can only ever report a
     * single-column FK) and carry the referential actions in DDL spelling.
     */
    @Test
    void mapFkRowPopulatesBothColumnSidesAndActions() {
        final IntrospectionResponse.KeyRow row = MssqlCatalog.mapFkRow(
                "sales", "order_line", "FK_order_line_order",
                Arrays.asList("order_id", "tenant_id"),
                "sales", "orders",
                Arrays.asList("order_id", "tenant_id"),
                "NO_ACTION", "CASCADE",
                Boolean.FALSE, Boolean.TRUE);
        assertEquals("foreign_key", row.kind());
        assertEquals(Arrays.asList("order_id", "tenant_id"), row.columns());
        assertEquals(Arrays.asList("order_id", "tenant_id"), row.referencedColumns());
        assertEquals("sales", row.referencedSchema());
        assertEquals("orders", row.referencedTable());
        assertEquals("NO ACTION", row.updateRule());
        assertEquals("CASCADE", row.deleteRule());
        assertEquals(Boolean.TRUE, row.isNotTrusted());
    }

    /** {@code SET_NULL} / {@code SET_DEFAULT} become their DDL spellings. */
    @Test
    void referentialActionDecode() {
        assertEquals("SET NULL", MssqlCatalog.decodeReferentialAction("SET_NULL"));
        assertEquals("SET DEFAULT", MssqlCatalog.decodeReferentialAction("SET_DEFAULT"));
        assertEquals("CASCADE", MssqlCatalog.decodeReferentialAction("CASCADE"));
        assertNull(MssqlCatalog.decodeReferentialAction(null));
        assertNull(MssqlCatalog.decodeReferentialAction("   "));
    }

    /** A CHECK constraint lands on the NEW kind with its definition. */
    @Test
    void mapCheckConstraintRowUsesTheNewKind() {
        final IntrospectionResponse.KeyRow row = MssqlCatalog.mapCheckConstraintRow(
                "dbo", "orders", "CK_orders_total", "([total]>=(0))",
                Boolean.FALSE, Boolean.FALSE);
        assertEquals("check_constraint", row.kind());
        assertEquals("([total]>=(0))", row.checkDefinition());
        assertEquals("CK_orders_total", row.name());
    }

    /** A full-text index lands on its own kind with the catalog name. */
    @Test
    void mapFulltextIndexRowCarriesCatalogAndColumns() {
        final IntrospectionResponse.KeyRow row = MssqlCatalog.mapFulltextIndexRow(
                "dbo", "article", "ft_catalog", Arrays.asList("title", "body"));
        assertEquals("fulltext_index", row.kind());
        assertEquals("fulltext", row.indexType());
        assertEquals("ft_catalog", row.fulltextCatalog());
        assertEquals(Arrays.asList("title", "body"), row.columns());
    }

    // ----------------------------------------------------------------------
    // Views + routines
    // ----------------------------------------------------------------------

    /**
     * An INDEXED view is flagged BOTH ways: {@code isIndexedView} for the
     * named {@code indexed_view} untranslatable reason (OUT by ruling 6) and
     * {@code isMaterialized} for the engine-neutral consumer.
     */
    @Test
    void mapViewRowFlagsIndexedViews() {
        final IntrospectionResponse.ViewRow indexed = MssqlCatalog.mapViewRow(
                "dbo", "v_totals", "CREATE VIEW ...", Boolean.TRUE, true);
        assertEquals(Boolean.TRUE, indexed.isIndexedView());
        assertTrue(indexed.isMaterialized());
        assertEquals(Boolean.TRUE, indexed.isSchemaBound());

        final IntrospectionResponse.ViewRow plain = MssqlCatalog.mapViewRow(
                "dbo", "v_plain", "CREATE VIEW ...", Boolean.FALSE, false);
        assertEquals(Boolean.FALSE, plain.isIndexedView());
        assertFalse(plain.isMaterialized());
    }

    /** Routine kinds cover T-SQL procedures, all four function types and CLR. */
    @Test
    void routineKindAndFunctionKindDecode() {
        assertEquals("procedure", MssqlCatalog.decodeRoutineKind("P"));
        assertEquals("clr_procedure", MssqlCatalog.decodeRoutineKind("PC"));
        assertEquals("function", MssqlCatalog.decodeRoutineKind("FN"));
        assertEquals("function", MssqlCatalog.decodeRoutineKind("IF"));
        assertEquals("function", MssqlCatalog.decodeRoutineKind("TF"));
        assertEquals("clr_function", MssqlCatalog.decodeRoutineKind("AF"));
        assertEquals("clr_function", MssqlCatalog.decodeRoutineKind("FS"));
        assertEquals("clr_function", MssqlCatalog.decodeRoutineKind("FT"));

        assertEquals("scalar", MssqlCatalog.decodeFunctionKind("FN"));
        assertEquals("inline_table", MssqlCatalog.decodeFunctionKind("IF"));
        assertEquals("multi_statement_table", MssqlCatalog.decodeFunctionKind("TF"));
        assertEquals("aggregate", MssqlCatalog.decodeFunctionKind("AF"));
        assertNull(MssqlCatalog.decodeFunctionKind("P"));
    }

    /**
     * A routine carries its FULL body (no 4 KB clip -- SQL Server returns one
     * {@code sys.sql_modules.definition} value) plus its declared parameters.
     */
    @Test
    void mapRoutineRowCarriesFullBodyAndParameters() {
        final IntrospectionResponse.ParameterRow param =
                new IntrospectionResponse.ParameterRow(
                        "@order_id", "int", 4, 10, 0, false, false, false, 1, null);
        final String body = "CREATE PROCEDURE dbo.upd_order @order_id int AS BEGIN ... END";
        final IntrospectionResponse.ProcedureRow row = MssqlCatalog.mapRoutineRow(
                "dbo", "upd_order", "P", body, null, "dbo", null,
                Collections.singletonList(param));
        assertEquals("procedure", row.routineKind());
        assertEquals("TSQL", row.language());
        assertEquals(body, row.body());
        assertNull(row.truncated());
        assertEquals(1, row.parameters().size());
        assertEquals("@order_id", row.parameters().get(0).name());
        assertEquals("dbo", row.executeAs());
    }

    /** A CLR routine reports language=CLR and its assembly, with no T-SQL body. */
    @Test
    void mapRoutineRowMarksClrRoutines() {
        final IntrospectionResponse.ProcedureRow row = MssqlCatalog.mapRoutineRow(
                "dbo", "clr_hash", "FS", null, "varbinary", null, "CryptoLib",
                Collections.emptyList());
        assertEquals("clr_function", row.routineKind());
        assertEquals("CLR", row.language());
        assertEquals("CryptoLib", row.assemblyName());
        assertEquals("varbinary", row.returnsType());
        assertNull(row.body());
        assertTrue(MssqlCatalog.isClrType("FS"));
        assertFalse(MssqlCatalog.isClrType("FN"));
    }

    // ----------------------------------------------------------------------
    // Triggers
    // ----------------------------------------------------------------------

    /**
     * Trigger timing is REAL on SQL Server (read off
     * {@code is_instead_of_trigger}), the events come from
     * {@code sys.trigger_events} rather than a body scan, and the
     * first/last ordering rides along.
     */
    @Test
    void mapTriggerRowCarriesRealTimingEventsAndOrder() {
        final IntrospectionResponse.TriggerRow after = MssqlCatalog.mapTriggerRow(
                "dbo", "trg_orders_audit", "dbo", "orders", "U",
                false, Boolean.FALSE,
                Arrays.asList("insert", "update"),
                "CREATE TRIGGER ...",
                Collections.singletonList("insert"),
                Collections.emptyList());
        assertEquals("after", after.timing());
        assertEquals(Arrays.asList("insert", "update"), after.events());
        assertEquals("table", after.parentKind());
        assertEquals(Collections.singletonList("insert"), after.orderFirstEvents());
        assertEquals(Boolean.FALSE, after.isDatabaseTrigger());

        final IntrospectionResponse.TriggerRow insteadOf = MssqlCatalog.mapTriggerRow(
                "dbo", "trg_v_orders_ins", "dbo", "v_orders", "V",
                true, Boolean.TRUE,
                Collections.singletonList("insert"),
                "CREATE TRIGGER ...",
                Collections.emptyList(), Collections.emptyList());
        assertEquals("instead_of", insteadOf.timing());
        assertEquals("view", insteadOf.parentKind());
        assertEquals(Boolean.TRUE, insteadOf.isDisabled());
    }

    /** A database-scoped DDL trigger is listed separately and flagged. */
    @Test
    void mapDatabaseTriggerRowIsFlaggedAndParentless() {
        final IntrospectionResponse.TriggerRow row = MssqlCatalog.mapDatabaseTriggerRow(
                "trg_ddl_audit", Boolean.FALSE,
                Collections.singletonList("create_table"), "CREATE TRIGGER ...");
        assertEquals(Boolean.TRUE, row.isDatabaseTrigger());
        assertNull(row.tableName());
        assertEquals(Collections.singletonList("create_table"), row.events());
    }

    /** Trigger event descriptors lower-case, DDL events included. */
    @Test
    void triggerEventDecode() {
        assertEquals("insert", MssqlCatalog.decodeTriggerEvent("INSERT"));
        assertEquals("delete", MssqlCatalog.decodeTriggerEvent("DELETE"));
        assertEquals("create_table", MssqlCatalog.decodeTriggerEvent("CREATE_TABLE"));
        assertNull(MssqlCatalog.decodeTriggerEvent(null));
    }

    // ----------------------------------------------------------------------
    // Sequences + identity
    // ----------------------------------------------------------------------

    /** A native sequence carries every detail field, cache size included. */
    @Test
    void mapSequenceRowCarriesFullNativeDetail() {
        final IntrospectionResponse.SequenceRow row = MssqlCatalog.mapSequenceRow(
                "dbo", "seq_invoice", "bigint",
                "1000", "1", "1000", "9223372036854775807",
                Boolean.FALSE, "1042", "50");
        assertEquals("seq_invoice", row.sequenceName());
        assertEquals("bigint", row.dataType());
        assertEquals("1000", row.startValue());
        assertEquals("9223372036854775807", row.maxValue());
        assertEquals(Boolean.FALSE, row.cycle());
        assertEquals("1042", row.currentValue());
        assertEquals("50", row.cacheSize());
    }

    /**
     * An IDENTITY column is synthesized into the SAME sequence shape the ASE
     * path produces, so the downstream {@code sequence_cutover_hazard} finding
     * is engine-independent. {@code last_value} IS the high-water mark, so no
     * {@code MAX(col)} scan is ever needed on this engine.
     */
    @Test
    void identitySynthesisMatchesTheSharedShape() {
        final IntrospectionResponse.SequenceRow row =
                MssqlCatalog.synthesizeIdentitySequenceRow(
                        "dbo", "orders", "order_id", "int", "1", "1", "8421");
        assertEquals("orders.order_id (identity)", row.sequenceName());
        assertEquals("orders", row.ownedByTable());
        assertEquals("order_id", row.ownedByColumn());
        assertEquals("8421", row.currentValue());
        assertEquals("1", row.startValue());
    }

    // ----------------------------------------------------------------------
    // Agent jobs
    // ----------------------------------------------------------------------

    /** Job rows carry every step in order; {@code command} is the first step's. */
    @Test
    void mapAgentJobRowCarriesStepsAndScheduleText() {
        final List<IntrospectionResponse.JobStepRow> steps = Arrays.asList(
                new IntrospectionResponse.JobStepRow(1, "TSQL", "EXEC dbo.rebuild", "salesdb"),
                new IntrospectionResponse.JobStepRow(2, "CmdExec", "robocopy ...", null));
        final Map<String, Object> frequency = new LinkedHashMap<>();
        frequency.put("freq_type", 4);
        frequency.put("freq_interval", 1);
        frequency.put("freq_subday_type", 1);
        frequency.put("freq_subday_interval", 0);
        frequency.put("freq_recurrence_factor", 0);
        frequency.put("active_start_time", 23000);

        final IntrospectionResponse.ScheduledJobRow row =
                MssqlCatalog.mapAgentJobRow("nightly_rebuild", Boolean.TRUE, steps, frequency);
        assertEquals("sql_server_agent", row.scheduler());
        assertEquals("EXEC dbo.rebuild", row.command());
        assertEquals(2, row.steps().size());
        assertEquals("CmdExec", row.steps().get(1).subsystem());
        assertEquals("daily at 02:30:00", row.scheduleText());
        assertEquals("daily at 02:30:00", row.schedule());
        assertEquals(frequency, row.scheduleFrequency());
    }

    /** The msdb frequency fields decode into a readable sentence. */
    @Test
    void scheduleTextDecode() {
        assertEquals("daily at 02:30:00", MssqlCatalog.decodeScheduleText(
                frequency(4, 1, 1, 0, 0, 23000)));
        assertEquals("every 3 days at 00:00:00", MssqlCatalog.decodeScheduleText(
                frequency(4, 3, 1, 0, 0, 0)));
        assertEquals("weekly (day mask 62) every 2 weeks at 06:00:00",
                MssqlCatalog.decodeScheduleText(frequency(8, 62, 1, 0, 2, 60000)));
        assertEquals("monthly on day 1 at 01:00:00", MssqlCatalog.decodeScheduleText(
                frequency(16, 1, 1, 0, 1, 10000)));
        assertEquals("daily at 08:00:00, repeating every 15 minutes",
                MssqlCatalog.decodeScheduleText(frequency(4, 1, 4, 15, 0, 80000)));
        assertEquals("when SQL Server Agent starts",
                MssqlCatalog.decodeScheduleText(frequency(64, 0, 0, 0, 0, 0)));
        // No schedule attached is null, not an invented one.
        assertNull(MssqlCatalog.decodeScheduleText(null));
        assertNull(MssqlCatalog.decodeScheduleText(Collections.emptyMap()));
    }

    /** msdb encodes a time as the integer HHMMSS. */
    @Test
    void agentTimeFormat() {
        assertEquals("02:30:00", MssqlCatalog.formatAgentTime(23000));
        assertEquals("00:00:00", MssqlCatalog.formatAgentTime(0));
        assertEquals("23:59:59", MssqlCatalog.formatAgentTime(235959));
        assertEquals("00:00:00", MssqlCatalog.formatAgentTime(-1));
    }

    private static Map<String, Object> frequency(
            final int freqType,
            final int interval,
            final int subdayType,
            final int subdayInterval,
            final int recurrence,
            final int startTime
    ) {
        final Map<String, Object> frequency = new LinkedHashMap<>();
        frequency.put("freq_type", freqType);
        frequency.put("freq_interval", interval);
        frequency.put("freq_subday_type", subdayType);
        frequency.put("freq_subday_interval", subdayInterval);
        frequency.put("freq_recurrence_factor", recurrence);
        frequency.put("active_start_time", startTime);
        return frequency;
    }

    // ----------------------------------------------------------------------
    // Schema filtering + capabilities
    // ----------------------------------------------------------------------

    /** The engine's own schemas and the fixed role schemas are never carried. */
    @Test
    void systemSchemasAreExcluded() {
        assertTrue(MssqlCatalog.isSystemSchema("sys"));
        assertTrue(MssqlCatalog.isSystemSchema("SYS"));
        assertTrue(MssqlCatalog.isSystemSchema("INFORMATION_SCHEMA"));
        assertTrue(MssqlCatalog.isSystemSchema("guest"));
        assertTrue(MssqlCatalog.isSystemSchema("db_owner"));
        assertTrue(MssqlCatalog.isSystemSchema("db_datareader"));
        assertTrue(MssqlCatalog.isSystemSchema(null));
        // A user schema is carried, including one that merely starts with "d".
        assertFalse(MssqlCatalog.isSystemSchema("dbo"));
        assertFalse(MssqlCatalog.isSystemSchema("sales"));
        assertFalse(MssqlCatalog.isSystemSchema("data_warehouse"));
    }

    /**
     * The capability set is the cross-service contract discovery matches on.
     * The first six keys are the SAME strings the ASE catalog advertises so
     * the applicability resolver needs no engine branch.
     */
    @Test
    void capabilitySetMatchesTheContract() {
        assertEquals(
                java.util.Set.of(
                        "collation",
                        "computed_columns",
                        "sequence_current_value",
                        "fk_actions",
                        "index_clustering",
                        "db_jobs",
                        "filtered_indexes",
                        "included_columns",
                        "trigger_events",
                        "extended_objects",
                        "column_defaults",
                        "check_constraints",
                        "identity_seed",
                        "column_precision",
                        "routine_parameters"),
                MssqlCatalog.advertisableCapabilities());
        // Shared keys really are shared, character for character.
        assertEquals(SybaseCatalog.CAP_COLLATION, MssqlCatalog.CAP_COLLATION);
        assertEquals(SybaseCatalog.CAP_SCHEDULED_JOBS, MssqlCatalog.CAP_SCHEDULED_JOBS);
        assertEquals(SybaseCatalog.CAP_FK_ACTIONS, MssqlCatalog.CAP_FK_ACTIONS);
    }

    /** The catalog names its own engine. */
    @Test
    void catalogReportsItsEngine() {
        assertEquals(SidecarEngine.MSSQL, new MssqlCatalog().engine());
        assertEquals(SidecarEngine.SYBASE, new SybaseCatalog().engine());
    }
}
