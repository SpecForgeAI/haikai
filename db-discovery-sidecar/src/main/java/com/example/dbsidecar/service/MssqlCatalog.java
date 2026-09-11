package com.example.dbsidecar.service;

import static com.example.dbsidecar.service.EngineCatalog.addCapability;
import static com.example.dbsidecar.service.EngineCatalog.matchesSchemaFilter;
import static com.example.dbsidecar.service.EngineCatalog.matchesTableFilter;

import com.example.dbsidecar.model.IntrospectionResponse;
import com.example.dbsidecar.model.SidecarEngine;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * SQL Server catalog reads (SQL Server pair programme, SPEC-1 §1.3; wire
 * contract v2 §2).
 *
 * <p>The SQL Server sibling of {@link SybaseCatalog}. Where ASE decodes status
 * bitmasks out of {@code sysindexes} / {@code syscolumns} and reassembles
 * bodies from {@code syscomments} fragments, SQL Server's {@code sys.*} views
 * expose the same facts as NAMED columns -- so this catalog reads flags
 * directly ({@code is_primary_key}, {@code is_descending_key},
 * {@code delete_referential_action_desc}) and takes each routine body as ONE
 * {@code sys.sql_modules.definition} value with no reassembly and no 4KB
 * clip.</p>
 *
 * <h2>Design rules</h2>
 * <ul>
 *   <li><b>Every statement is a {@link PreparedStatement} over a CONSTANT SQL
 *       string.</b> Caller-supplied schema / table filters are applied in Java
 *       ({@link EngineCatalog#matchesSchemaFilter}), never spliced into SQL --
 *       there is no dynamic SQL on this path at all, so the filters cannot
 *       carry injection.</li>
 *   <li><b>Every optional read is fail-soft.</b> A permission failure on
 *       {@code msdb} (SQL Agent jobs), on a CDC view, or on Service Broker
 *       catalogs null-outs that section and simply does NOT advertise its
 *       capability, exactly as the ASE path treats a missing catalog. A missing
 *       section must never fail a whole introspection.</li>
 *   <li><b>Row mapping is pure.</b> Every {@code map*Row} / {@code decode*}
 *       method takes primitives and returns a record, so {@code MssqlCatalogTest}
 *       covers the mapping without a live SQL Server (there is none on the work
 *       machine -- shaping §7).</li>
 * </ul>
 */
public final class MssqlCatalog implements EngineCatalog {

    private static final Logger LOG = LoggerFactory.getLogger(MssqlCatalog.class);

    // ------------------------------------------------------------------
    // Capability keys. The first six are the SAME verbatim strings the ASE
    // catalog advertises (the discovery-side applicability resolver matches on
    // the STRING); the rest are the SQL-Server-only groups added by SPEC-1.
    // ------------------------------------------------------------------
    static final String CAP_COLLATION = "collation";
    static final String CAP_COMPUTED_COLUMNS = "computed_columns";
    static final String CAP_SEQUENCE_CURRENT_VALUE = "sequence_current_value";
    static final String CAP_FK_ACTIONS = "fk_actions";
    static final String CAP_INDEX_CLUSTERING = "index_clustering";
    static final String CAP_SCHEDULED_JOBS = "db_jobs";
    static final String CAP_FILTERED_INDEXES = "filtered_indexes";
    static final String CAP_INCLUDED_COLUMNS = "included_columns";
    static final String CAP_TRIGGER_EVENTS = "trigger_events";
    static final String CAP_EXTENDED_OBJECTS = "extended_objects";
    static final String CAP_COLUMN_DEFAULTS = "column_defaults";
    static final String CAP_CHECK_CONSTRAINTS = "check_constraints";
    static final String CAP_IDENTITY_SEED = "identity_seed";
    static final String CAP_COLUMN_PRECISION = "column_precision";
    static final String CAP_ROUTINE_PARAMETERS = "routine_parameters";

    /** {@code kind} value for a CHECK constraint row on {@code keys[]}. */
    static final String KIND_CHECK_CONSTRAINT = "check_constraint";
    /** {@code kind} value for a full-text index row on {@code keys[]}. */
    static final String KIND_FULLTEXT_INDEX = "fulltext_index";

    /** {@code scheduler} label for a SQL Server Agent job. */
    static final String SCHEDULER_SQL_AGENT = "sql_server_agent";

    @Override
    public SidecarEngine engine() {
        return SidecarEngine.MSSQL;
    }

    // ------------------------------------------------------------------
    // Identity
    // ------------------------------------------------------------------

    private static final String SQL_IDENTITY =
            "SELECT CONVERT(varchar(128), SERVERPROPERTY('ProductVersion')) AS product_version, "
                    + "CONVERT(varchar(128), SERVERPROPERTY('Edition')) AS edition, "
                    + "CONVERT(varchar(128), SERVERPROPERTY('ProductMajorVersion')) AS major_version";

    @Override
    public ServerIdentity probe(final Connection conn) throws SQLException {
        try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery(SQL_IDENTITY)) {
            if (rs.next()) {
                return new ServerIdentity(rs.getString("product_version"), rs.getString("edition"));
            }
        }
        return new ServerIdentity(null, null);
    }

    @Override
    public String readServerVersion(final Connection conn) {
        try {
            return this.probe(conn).version();
        } catch (final SQLException ignored) {
            // Version is evidence-only; null-out on any failure.
            return null;
        }
    }

    @Override
    public String readServerEdition(final Connection conn) {
        try {
            return this.probe(conn).edition();
        } catch (final SQLException ignored) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Introspection entry point
    // ------------------------------------------------------------------

    @Override
    public IntrospectionResponse introspect(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec
    ) throws SQLException {
        final List<String> capabilities = new ArrayList<>();
        String serverVersion = null;
        String serverEdition = null;
        try {
            final ServerIdentity identity = this.probe(conn);
            serverVersion = identity.version();
            serverEdition = identity.edition();
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_identity_read_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }

        final List<IntrospectionResponse.SchemaRow> schemas =
                this.readSchemas(conn, includeSchemas, timeoutSec);
        final List<IntrospectionResponse.TableRow> tables =
                this.readTables(conn, includeSchemas, includeTables, timeoutSec);
        final List<IntrospectionResponse.ColumnRow> columns =
                this.readColumns(conn, includeSchemas, includeTables, timeoutSec, capabilities);

        final List<IntrospectionResponse.KeyRow> keys = new ArrayList<>();
        keys.addAll(this.readIndexes(conn, includeSchemas, includeTables, timeoutSec, capabilities));
        keys.addAll(this.readForeignKeys(conn, includeSchemas, includeTables, timeoutSec,
                capabilities));
        keys.addAll(this.readCheckConstraints(conn, includeSchemas, includeTables, timeoutSec,
                capabilities));
        keys.addAll(this.readFulltextIndexes(conn, includeSchemas, includeTables, timeoutSec));

        final List<IntrospectionResponse.ViewRow> views =
                this.readViews(conn, includeSchemas, timeoutSec);
        final List<IntrospectionResponse.ProcedureRow> procedures =
                this.readRoutines(conn, includeSchemas, timeoutSec, capabilities);
        final List<IntrospectionResponse.TriggerRow> triggers =
                this.readTriggers(conn, includeSchemas, timeoutSec, capabilities);
        final List<IntrospectionResponse.SequenceRow> sequences =
                this.readSequences(conn, includeSchemas, includeTables, timeoutSec, capabilities);
        final List<IntrospectionResponse.ScheduledJobRow> jobs =
                this.readAgentJobs(conn, timeoutSec, capabilities);
        final List<IntrospectionResponse.ExtendedObjectRow> extended =
                this.readExtendedObjects(conn, includeSchemas, timeoutSec, capabilities);

        String databaseCollation = null;
        String serverCollation = null;
        try (PreparedStatement ps = conn.prepareStatement(
                "SELECT CONVERT(varchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) "
                        + "AS database_collation, "
                        + "CONVERT(varchar(128), SERVERPROPERTY('Collation')) AS server_collation")) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    databaseCollation = rs.getString("database_collation");
                    serverCollation = rs.getString("server_collation");
                    addCapability(capabilities, CAP_COLLATION);
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_collation_read_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }

        return new IntrospectionResponse(
                true, null, schemas, tables, columns, keys, views, procedures, triggers,
                sequences, jobs, capabilities, serverVersion, databaseCollation,
                SidecarEngine.MSSQL.wireValue(), serverEdition, serverCollation, extended);
    }

    // ------------------------------------------------------------------
    // Schemas
    // ------------------------------------------------------------------

    private static final String SQL_SCHEMAS =
            "SELECT s.name AS schema_name, p.name AS owner_name "
                    + "FROM sys.schemas s "
                    + "LEFT JOIN sys.database_principals p ON p.principal_id = s.principal_id "
                    + "ORDER BY s.name";

    private List<IntrospectionResponse.SchemaRow> readSchemas(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final List<IntrospectionResponse.SchemaRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_SCHEMAS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String name = rs.getString("schema_name");
                    if (isSystemSchema(name) || !matchesSchemaFilter(name, includeSchemas)) {
                        continue;
                    }
                    out.add(new IntrospectionResponse.SchemaRow(name, rs.getString("owner_name")));
                }
            }
        }
        return out;
    }

    /**
     * The schemas a migration never carries: the engine's own
     * ({@code sys}, {@code INFORMATION_SCHEMA}), the {@code guest} sandbox and
     * the fixed database-role schemas ({@code db_owner}, {@code db_datareader},
     * ...). Pure.
     */
    static boolean isSystemSchema(final String name) {
        if (name == null) {
            return true;
        }
        final String lower = name.trim().toLowerCase(Locale.ROOT);
        return "sys".equals(lower)
                || "information_schema".equals(lower)
                || "guest".equals(lower)
                || lower.startsWith("db_");
    }

    // ------------------------------------------------------------------
    // Tables
    // ------------------------------------------------------------------

    private static final String SQL_TABLES =
            "SELECT s.name AS schema_name, t.name AS table_name, "
                    + "t.temporal_type_desc AS temporal_type, "
                    + "t.is_memory_optimized, t.is_filetable, "
                    + "hs.name AS history_schema, h.name AS history_table, "
                    + "cs.name AS period_start_column, ce.name AS period_end_column "
                    + "FROM sys.tables t "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "LEFT JOIN sys.tables h ON h.object_id = t.history_table_id "
                    + "LEFT JOIN sys.schemas hs ON hs.schema_id = h.schema_id "
                    + "LEFT JOIN sys.periods p ON p.object_id = t.object_id "
                    + "LEFT JOIN sys.columns cs ON cs.object_id = p.object_id "
                    + "AND cs.column_id = p.start_column_id "
                    + "LEFT JOIN sys.columns ce ON ce.object_id = p.object_id "
                    + "AND ce.column_id = p.end_column_id "
                    + "WHERE t.is_ms_shipped = 0 "
                    + "ORDER BY s.name, t.name";

    /** Version-tolerant fallback for a build without temporal / FileTable columns. */
    private static final String SQL_TABLES_BARE =
            "SELECT s.name AS schema_name, t.name AS table_name "
                    + "FROM sys.tables t "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "WHERE t.is_ms_shipped = 0 "
                    + "ORDER BY s.name, t.name";

    private List<IntrospectionResponse.TableRow> readTables(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec
    ) throws SQLException {
        final List<IntrospectionResponse.TableRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_TABLES)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(mapTableRow(
                            schema,
                            table,
                            rs.getString("temporal_type"),
                            rs.getString("history_schema"),
                            rs.getString("history_table"),
                            rs.getString("period_start_column"),
                            rs.getString("period_end_column"),
                            (Boolean) rs.getObject("is_memory_optimized"),
                            (Boolean) rs.getObject("is_filetable")));
                }
            }
            return out;
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_tables_enriched_unavailable fallback=bare sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        out.clear();
        try (PreparedStatement ps = conn.prepareStatement(SQL_TABLES_BARE)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(new IntrospectionResponse.TableRow(schema, table));
                }
            }
        }
        return out;
    }

    /**
     * Map one {@code sys.tables} row. {@code temporalTypeDesc} is SQL Server's
     * own {@code NON_TEMPORAL_TABLE} / {@code HISTORY_TABLE} /
     * {@code SYSTEM_VERSIONED_TEMPORAL_TABLE}; the wire carries the contract's
     * {@code system_versioned} / {@code history} / null. Pure.
     */
    static IntrospectionResponse.TableRow mapTableRow(
            final String schemaName,
            final String tableName,
            final String temporalTypeDesc,
            final String historySchema,
            final String historyTable,
            final String periodStartColumn,
            final String periodEndColumn,
            final Boolean isMemoryOptimized,
            final Boolean isFiletable
    ) {
        final String history = historyTable == null
                ? null
                : (historySchema == null ? historyTable : historySchema + "." + historyTable);
        return new IntrospectionResponse.TableRow(
                schemaName,
                tableName,
                decodeTemporalType(temporalTypeDesc),
                history,
                periodStartColumn,
                periodEndColumn,
                isMemoryOptimized,
                isFiletable);
    }

    /** {@code SYSTEM_VERSIONED_TEMPORAL_TABLE} to {@code system_versioned}. Pure. */
    static String decodeTemporalType(final String temporalTypeDesc) {
        if (temporalTypeDesc == null) {
            return null;
        }
        final String upper = temporalTypeDesc.trim().toUpperCase(Locale.ROOT);
        if (upper.contains("SYSTEM_VERSIONED")) {
            return "system_versioned";
        }
        if (upper.startsWith("HISTORY")) {
            return "history";
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Columns
    // ------------------------------------------------------------------

    private static final String SQL_COLUMNS =
            "SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name, "
                    + "bt.name AS base_type_name, ut.name AS declared_type_name, "
                    + "ut.is_user_defined, ut.system_type_id AS declared_system_type_id, "
                    + "ut.user_type_id AS declared_user_type_id, "
                    + "c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, "
                    + "c.is_computed, c.collation_name, c.is_rowguidcol, c.is_sparse, "
                    + "c.is_filestream, c.generated_always_type_desc, c.is_hidden, c.column_id, "
                    + "cc.definition AS computed_definition, cc.is_persisted, "
                    + "dc.name AS default_name, dc.definition AS default_definition, "
                    + "CONVERT(varchar(64), ic.seed_value) AS identity_seed, "
                    + "CONVERT(varchar(64), ic.increment_value) AS identity_increment, "
                    + "xsc.name AS xml_schema_collection "
                    + "FROM sys.columns c "
                    + "JOIN sys.tables t ON t.object_id = c.object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "JOIN sys.types ut ON ut.user_type_id = c.user_type_id "
                    + "LEFT JOIN sys.types bt ON bt.user_type_id = ut.system_type_id "
                    + "AND bt.system_type_id = bt.user_type_id "
                    + "LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id "
                    + "AND cc.column_id = c.column_id "
                    + "LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id "
                    + "LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id "
                    + "AND ic.column_id = c.column_id "
                    + "LEFT JOIN sys.xml_schema_collections xsc "
                    + "ON xsc.xml_collection_id = c.xml_collection_id "
                    + "WHERE t.is_ms_shipped = 0 "
                    + "ORDER BY s.name, t.name, c.column_id";

    private List<IntrospectionResponse.ColumnRow> readColumns(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final List<IntrospectionResponse.ColumnRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_COLUMNS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final boolean aliasType = rs.getBoolean("is_user_defined")
                            || rs.getInt("declared_system_type_id")
                                    != rs.getInt("declared_user_type_id");
                    final String baseType = rs.getString("base_type_name") == null
                            ? rs.getString("declared_type_name")
                            : rs.getString("base_type_name");
                    out.add(mapColumnRow(
                            schema,
                            table,
                            rs.getString("column_name"),
                            baseType,
                            aliasType ? rs.getString("declared_type_name") : null,
                            rs.getInt("max_length"),
                            (Integer) rs.getObject("precision"),
                            (Integer) rs.getObject("scale"),
                            rs.getBoolean("is_nullable"),
                            rs.getInt("column_id"),
                            rs.getString("collation_name"),
                            rs.getBoolean("is_computed"),
                            rs.getString("computed_definition"),
                            (Boolean) rs.getObject("is_persisted"),
                            rs.getBoolean("is_identity"),
                            rs.getString("identity_seed"),
                            rs.getString("identity_increment"),
                            rs.getString("default_definition"),
                            rs.getString("default_name"),
                            (Boolean) rs.getObject("is_rowguidcol"),
                            (Boolean) rs.getObject("is_sparse"),
                            rs.getString("generated_always_type_desc"),
                            (Boolean) rs.getObject("is_hidden"),
                            (Boolean) rs.getObject("is_filestream"),
                            rs.getString("xml_schema_collection")));
                }
            }
        }
        addCapability(capabilities, CAP_COLLATION);
        addCapability(capabilities, CAP_COMPUTED_COLUMNS);
        addCapability(capabilities, CAP_COLUMN_DEFAULTS);
        addCapability(capabilities, CAP_COLUMN_PRECISION);
        addCapability(capabilities, CAP_IDENTITY_SEED);
        return out;
    }

    /**
     * Map one {@code sys.columns} row (wire contract v2 §2). Pure.
     *
     * <p>{@code maxLength} is normalised here: SQL Server reports the BYTE
     * length, so an {@code nvarchar(50)} arrives as 100, and {@code -1} means
     * {@code MAX}. The wire carries the DECLARED length (50) and keeps
     * {@code -1} for MAX, which is what a type mapper needs.</p>
     */
    static IntrospectionResponse.ColumnRow mapColumnRow(
            final String schemaName,
            final String tableName,
            final String columnName,
            final String baseTypeName,
            final String userTypeName,
            final int rawMaxLength,
            final Integer precision,
            final Integer scale,
            final boolean isNullable,
            final int ordinalPosition,
            final String collation,
            final boolean isComputed,
            final String computedDefinition,
            final Boolean isPersistedComputed,
            final boolean isIdentity,
            final String identitySeed,
            final String identityIncrement,
            final String defaultExpression,
            final String defaultConstraintName,
            final Boolean isRowGuidCol,
            final Boolean isSparse,
            final String generatedAlwaysTypeDesc,
            final Boolean isHidden,
            final Boolean isFilestream,
            final String xmlSchemaCollection
    ) {
        return new IntrospectionResponse.ColumnRow(
                schemaName,
                tableName,
                columnName,
                baseTypeName,
                normalizeMaxLength(baseTypeName, rawMaxLength),
                isNullable,
                ordinalPosition,
                collation,
                isComputed,
                isComputed ? computedDefinition : null,
                isIdentity,
                precision,
                scale,
                isIdentity ? identitySeed : null,
                isIdentity ? identityIncrement : null,
                defaultExpression,
                defaultConstraintName,
                isComputed ? isPersistedComputed : null,
                isRowGuidCol,
                isSparse,
                userTypeName,
                decodeGeneratedAlwaysType(generatedAlwaysTypeDesc),
                isHidden,
                isFilestream,
                xmlSchemaCollection);
    }

    /**
     * SQL Server's byte length to the DECLARED length. {@code -1} ({@code MAX})
     * passes through unchanged; the national / Unicode types halve. Pure.
     */
    static int normalizeMaxLength(final String baseTypeName, final int rawMaxLength) {
        if (rawMaxLength < 0) {
            return rawMaxLength;
        }
        final String type = baseTypeName == null ? "" : baseTypeName.trim().toLowerCase(Locale.ROOT);
        switch (type) {
            case "nchar":
            case "nvarchar":
            case "ntext":
            case "sysname":
                return rawMaxLength / 2;
            default:
                return rawMaxLength;
        }
    }

    /** {@code AS_ROW_START} to {@code as_row_start}; NOT_APPLICABLE to null. Pure. */
    static String decodeGeneratedAlwaysType(final String generatedAlwaysTypeDesc) {
        if (generatedAlwaysTypeDesc == null) {
            return null;
        }
        final String lower = generatedAlwaysTypeDesc.trim().toLowerCase(Locale.ROOT);
        if ("as_row_start".equals(lower) || "as_row_end".equals(lower)) {
            return lower;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Indexes
    // ------------------------------------------------------------------

    private static final String SQL_INDEXES =
            "SELECT s.name AS schema_name, t.name AS table_name, i.name AS index_name, "
                    + "i.type_desc, i.is_unique, i.is_primary_key, i.is_unique_constraint, "
                    + "i.is_disabled, i.filter_definition, i.object_id, i.index_id "
                    + "FROM sys.indexes i "
                    + "JOIN sys.tables t ON t.object_id = i.object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "WHERE t.is_ms_shipped = 0 AND i.index_id > 0 "
                    + "ORDER BY s.name, t.name, i.index_id";

    private static final String SQL_INDEX_COLUMNS =
            "SELECT ic.object_id, ic.index_id, ic.key_ordinal, ic.is_descending_key, "
                    + "ic.is_included_column, c.name AS column_name "
                    + "FROM sys.index_columns ic "
                    + "JOIN sys.columns c ON c.object_id = ic.object_id "
                    + "AND c.column_id = ic.column_id "
                    + "JOIN sys.tables t ON t.object_id = ic.object_id "
                    + "WHERE t.is_ms_shipped = 0 "
                    + "ORDER BY ic.object_id, ic.index_id, ic.is_included_column, ic.key_ordinal";

    /** Ordered key columns + their directions + the INCLUDE columns of one index. */
    record IndexColumnSet(
            List<String> keyColumns,
            List<String> directions,
            List<String> includeColumns
    ) {
        static IndexColumnSet empty() {
            return new IndexColumnSet(new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
        }
    }

    private Map<String, IndexColumnSet> readIndexColumns(final Connection conn, final int timeoutSec)
            throws SQLException {
        final Map<String, IndexColumnSet> byIndex = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_INDEX_COLUMNS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String key = rs.getLong("object_id") + ":" + rs.getInt("index_id");
                    final IndexColumnSet set =
                            byIndex.computeIfAbsent(key, k -> IndexColumnSet.empty());
                    final String column = rs.getString("column_name");
                    if (rs.getBoolean("is_included_column")) {
                        set.includeColumns().add(column);
                    } else {
                        set.keyColumns().add(column);
                        set.directions().add(rs.getBoolean("is_descending_key") ? "DESC" : "ASC");
                    }
                }
            }
        }
        return byIndex;
    }

    private List<IntrospectionResponse.KeyRow> readIndexes(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final Map<String, IndexColumnSet> columnsByIndex = this.readIndexColumns(conn, timeoutSec);
        final List<IntrospectionResponse.KeyRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_INDEXES)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final IndexColumnSet set = columnsByIndex.getOrDefault(
                            rs.getLong("object_id") + ":" + rs.getInt("index_id"),
                            IndexColumnSet.empty());
                    out.add(mapIndexRow(
                            schema,
                            table,
                            rs.getString("index_name"),
                            rs.getString("type_desc"),
                            rs.getBoolean("is_unique"),
                            rs.getBoolean("is_primary_key"),
                            rs.getBoolean("is_unique_constraint"),
                            (Boolean) rs.getObject("is_disabled"),
                            rs.getString("filter_definition"),
                            set.keyColumns(),
                            set.directions(),
                            set.includeColumns()));
                }
            }
        }
        addCapability(capabilities, CAP_INDEX_CLUSTERING);
        addCapability(capabilities, CAP_FILTERED_INDEXES);
        addCapability(capabilities, CAP_INCLUDED_COLUMNS);
        return out;
    }

    /**
     * Map one {@code sys.indexes} row. Pure.
     *
     * <p>{@code kind} follows the pre-existing vocabulary
     * ({@code primary_key} / {@code unique_constraint} / {@code index}) so the
     * discovery mapper is unchanged; {@code indexType} carries SQL Server's own
     * {@code type_desc} in the contract's lower-snake spelling, which is what
     * tells a columnstore from a rowstore index.</p>
     */
    static IntrospectionResponse.KeyRow mapIndexRow(
            final String schemaName,
            final String tableName,
            final String indexName,
            final String typeDesc,
            final boolean isUnique,
            final boolean isPrimaryKey,
            final boolean isUniqueConstraint,
            final Boolean isDisabled,
            final String filterDefinition,
            final List<String> keyColumns,
            final List<String> directions,
            final List<String> includeColumns
    ) {
        final String indexType = decodeIndexType(typeDesc);
        final String kind;
        if (isPrimaryKey) {
            kind = "primary_key";
        } else if (isUniqueConstraint) {
            kind = "unique_constraint";
        } else {
            kind = "index";
        }
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                kind,
                indexName,
                keyColumns,
                null,
                null,
                null,
                isUnique,
                null,
                null,
                null,
                indexType,
                indexType != null && indexType.startsWith("clustered"),
                filterDefinition,
                directions,
                filterDefinition,
                includeColumns,
                indexType,
                isDisabled,
                null,
                isUniqueConstraint,
                null,
                null);
    }

    /** {@code CLUSTERED COLUMNSTORE} to {@code clustered_columnstore}. Pure. */
    static String decodeIndexType(final String typeDesc) {
        if (typeDesc == null || typeDesc.trim().isEmpty()) {
            return null;
        }
        return typeDesc.trim().toLowerCase(Locale.ROOT).replace(' ', '_');
    }

    // ------------------------------------------------------------------
    // Foreign keys + check constraints
    // ------------------------------------------------------------------

    private static final String SQL_FOREIGN_KEYS =
            "SELECT fk.name AS fk_name, s.name AS schema_name, t.name AS table_name, "
                    + "rs.name AS referenced_schema, rt.name AS referenced_table, "
                    + "fk.delete_referential_action_desc, fk.update_referential_action_desc, "
                    + "fk.is_disabled, fk.is_not_trusted, "
                    + "pc.name AS column_name, rc.name AS referenced_column, "
                    + "fkc.constraint_column_id "
                    + "FROM sys.foreign_keys fk "
                    + "JOIN sys.tables t ON t.object_id = fk.parent_object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id "
                    + "JOIN sys.schemas rs ON rs.schema_id = rt.schema_id "
                    + "JOIN sys.foreign_key_columns fkc "
                    + "ON fkc.constraint_object_id = fk.object_id "
                    + "JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id "
                    + "AND pc.column_id = fkc.parent_column_id "
                    + "JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id "
                    + "AND rc.column_id = fkc.referenced_column_id "
                    + "ORDER BY s.name, t.name, fk.name, fkc.constraint_column_id";

    private List<IntrospectionResponse.KeyRow> readForeignKeys(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        // Accumulate per FK so the columns[] / referencedColumns[] pair is
        // POPULATED on both sides (wire contract v2 §2) -- the ASE path could
        // only ever report single-column FKs.
        final Map<String, IntrospectionResponse.KeyRow> byFk = new LinkedHashMap<>();
        final Map<String, List<String>> columnsByFk = new LinkedHashMap<>();
        final Map<String, List<String>> referencedByFk = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_FOREIGN_KEYS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final String fkName = rs.getString("fk_name");
                    final String key = schema + "." + table + "." + fkName;
                    final List<String> cols =
                            columnsByFk.computeIfAbsent(key, k -> new ArrayList<>());
                    final List<String> refCols =
                            referencedByFk.computeIfAbsent(key, k -> new ArrayList<>());
                    cols.add(rs.getString("column_name"));
                    refCols.add(rs.getString("referenced_column"));
                    byFk.put(key, mapFkRow(
                            schema,
                            table,
                            fkName,
                            cols,
                            rs.getString("referenced_schema"),
                            rs.getString("referenced_table"),
                            refCols,
                            rs.getString("update_referential_action_desc"),
                            rs.getString("delete_referential_action_desc"),
                            (Boolean) rs.getObject("is_disabled"),
                            (Boolean) rs.getObject("is_not_trusted")));
                }
            }
        }
        addCapability(capabilities, CAP_FK_ACTIONS);
        return new ArrayList<>(byFk.values());
    }

    /**
     * Map one foreign key (all of its columns already collected). The
     * referential actions carry SQL Server's own {@code NO_ACTION} /
     * {@code CASCADE} / {@code SET_NULL} / {@code SET_DEFAULT} verbatim in the
     * engine's spelling, normalised to spaces so a pack emitter can use them
     * directly in DDL. Pure.
     */
    static IntrospectionResponse.KeyRow mapFkRow(
            final String schemaName,
            final String tableName,
            final String fkName,
            final List<String> columns,
            final String referencedSchema,
            final String referencedTable,
            final List<String> referencedColumns,
            final String updateActionDesc,
            final String deleteActionDesc,
            final Boolean isDisabled,
            final Boolean isNotTrusted
    ) {
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                "foreign_key",
                fkName,
                new ArrayList<>(columns),
                referencedSchema,
                referencedTable,
                new ArrayList<>(referencedColumns),
                false,
                decodeReferentialAction(updateActionDesc),
                decodeReferentialAction(deleteActionDesc),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                isDisabled,
                isNotTrusted,
                null,
                null,
                null);
    }

    /** {@code SET_NULL} to {@code SET NULL}; null stays null. Pure. */
    static String decodeReferentialAction(final String actionDesc) {
        if (actionDesc == null || actionDesc.trim().isEmpty()) {
            return null;
        }
        return actionDesc.trim().toUpperCase(Locale.ROOT).replace('_', ' ');
    }

    private static final String SQL_CHECK_CONSTRAINTS =
            "SELECT s.name AS schema_name, t.name AS table_name, cc.name AS constraint_name, "
                    + "cc.definition, cc.is_disabled, cc.is_not_trusted "
                    + "FROM sys.check_constraints cc "
                    + "JOIN sys.tables t ON t.object_id = cc.parent_object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "ORDER BY s.name, t.name, cc.name";

    private List<IntrospectionResponse.KeyRow> readCheckConstraints(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final List<IntrospectionResponse.KeyRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_CHECK_CONSTRAINTS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(mapCheckConstraintRow(
                            schema,
                            table,
                            rs.getString("constraint_name"),
                            rs.getString("definition"),
                            (Boolean) rs.getObject("is_disabled"),
                            (Boolean) rs.getObject("is_not_trusted")));
                }
            }
        }
        addCapability(capabilities, CAP_CHECK_CONSTRAINTS);
        return out;
    }

    /** Map one {@code sys.check_constraints} row onto the NEW check kind. Pure. */
    static IntrospectionResponse.KeyRow mapCheckConstraintRow(
            final String schemaName,
            final String tableName,
            final String constraintName,
            final String definition,
            final Boolean isDisabled,
            final Boolean isNotTrusted
    ) {
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                KIND_CHECK_CONSTRAINT,
                constraintName,
                Collections.emptyList(),
                null,
                null,
                null,
                false,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                isDisabled,
                isNotTrusted,
                null,
                definition,
                null);
    }

    private static final String SQL_FULLTEXT_INDEXES =
            "SELECT s.name AS schema_name, t.name AS table_name, cat.name AS catalog_name, "
                    + "c.name AS column_name "
                    + "FROM sys.fulltext_indexes fi "
                    + "JOIN sys.tables t ON t.object_id = fi.object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "LEFT JOIN sys.fulltext_catalogs cat "
                    + "ON cat.fulltext_catalog_id = fi.fulltext_catalog_id "
                    + "LEFT JOIN sys.fulltext_index_columns fic ON fic.object_id = fi.object_id "
                    + "LEFT JOIN sys.columns c ON c.object_id = fic.object_id "
                    + "AND c.column_id = fic.column_id "
                    + "ORDER BY s.name, t.name, c.name";

    /**
     * Full-text indexes. Fail-soft: full-text search is an optional SQL Server
     * feature and its catalog views are absent when it is not installed.
     */
    private List<IntrospectionResponse.KeyRow> readFulltextIndexes(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec
    ) {
        final Map<String, List<String>> columnsByTable = new LinkedHashMap<>();
        final Map<String, String[]> identityByTable = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_FULLTEXT_INDEXES)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final String key = schema + "." + table;
                    identityByTable.put(key,
                            new String[] {schema, table, rs.getString("catalog_name")});
                    final String column = rs.getString("column_name");
                    if (column != null) {
                        columnsByTable.computeIfAbsent(key, k -> new ArrayList<>()).add(column);
                    }
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_fulltext_read_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            return Collections.emptyList();
        }
        final List<IntrospectionResponse.KeyRow> out = new ArrayList<>();
        for (final Map.Entry<String, String[]> entry : identityByTable.entrySet()) {
            final String[] identity = entry.getValue();
            out.add(mapFulltextIndexRow(
                    identity[0], identity[1], identity[2],
                    columnsByTable.getOrDefault(entry.getKey(), Collections.emptyList())));
        }
        return out;
    }

    /** Map one full-text index onto the NEW fulltext kind. Pure. */
    static IntrospectionResponse.KeyRow mapFulltextIndexRow(
            final String schemaName,
            final String tableName,
            final String catalogName,
            final List<String> columns
    ) {
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                KIND_FULLTEXT_INDEX,
                "fulltext_" + tableName,
                new ArrayList<>(columns),
                null,
                null,
                null,
                false,
                null,
                null,
                null,
                "fulltext",
                null,
                null,
                null,
                null,
                null,
                "fulltext",
                null,
                null,
                null,
                null,
                catalogName);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    private static final String SQL_VIEWS =
            "SELECT s.name AS schema_name, v.name AS view_name, m.definition, "
                    + "m.is_schema_bound, "
                    + "CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i "
                    + "WHERE i.object_id = v.object_id AND i.index_id > 0) "
                    + "THEN 1 ELSE 0 END AS is_indexed "
                    + "FROM sys.views v "
                    + "JOIN sys.schemas s ON s.schema_id = v.schema_id "
                    + "LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id "
                    + "WHERE v.is_ms_shipped = 0 "
                    + "ORDER BY s.name, v.name";

    private List<IntrospectionResponse.ViewRow> readViews(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final List<IntrospectionResponse.ViewRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_VIEWS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    if (isSystemSchema(schema) || !matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    out.add(mapViewRow(
                            schema,
                            rs.getString("view_name"),
                            rs.getString("definition"),
                            (Boolean) rs.getObject("is_schema_bound"),
                            rs.getInt("is_indexed") != 0));
                }
            }
        }
        return out;
    }

    /**
     * Map one {@code sys.views} row. An INDEXED view IS SQL Server's
     * materialized view, so {@code isMaterialized} and {@code isIndexedView}
     * carry the same fact under both vocabularies -- the pack layer reads
     * {@code isIndexedView} to raise the named {@code indexed_view}
     * untranslatable reason (OUT by shaping ruling 6). Pure.
     */
    static IntrospectionResponse.ViewRow mapViewRow(
            final String schemaName,
            final String viewName,
            final String definition,
            final Boolean isSchemaBound,
            final boolean isIndexed
    ) {
        return new IntrospectionResponse.ViewRow(
                schemaName, viewName, definition, isIndexed, isSchemaBound, isIndexed);
    }

    // ------------------------------------------------------------------
    // Routines (procedures + functions, T-SQL and CLR)
    // ------------------------------------------------------------------

    private static final String SQL_ROUTINES =
            "SELECT s.name AS schema_name, o.name AS routine_name, o.type AS object_type, "
                    + "m.definition, p.name AS execute_as_principal, a.name AS assembly_name, "
                    + "rt.name AS return_type "
                    + "FROM sys.objects o "
                    + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
                    + "LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id "
                    + "LEFT JOIN sys.assembly_modules am ON am.object_id = o.object_id "
                    + "LEFT JOIN sys.assemblies a ON a.assembly_id = am.assembly_id "
                    + "LEFT JOIN sys.database_principals p "
                    + "ON p.principal_id = m.execute_as_principal_id "
                    + "LEFT JOIN sys.parameters rp ON rp.object_id = o.object_id "
                    + "AND rp.parameter_id = 0 "
                    + "LEFT JOIN sys.types rt ON rt.user_type_id = rp.user_type_id "
                    + "WHERE o.is_ms_shipped = 0 "
                    + "AND o.type IN ('P', 'FN', 'IF', 'TF', 'AF', 'PC', 'FS', 'FT') "
                    + "ORDER BY s.name, o.name";

    private static final String SQL_ROUTINE_PARAMETERS =
            "SELECT s.name AS schema_name, o.name AS routine_name, pa.name AS parameter_name, "
                    + "bt.name AS base_type_name, ut.name AS declared_type_name, "
                    + "ut.is_user_defined, ut.system_type_id AS declared_system_type_id, "
                    + "ut.user_type_id AS declared_user_type_id, "
                    + "pa.max_length, pa.precision, pa.scale, pa.is_output, "
                    + "pa.has_default_value, pa.is_readonly, pa.parameter_id "
                    + "FROM sys.parameters pa "
                    + "JOIN sys.objects o ON o.object_id = pa.object_id "
                    + "JOIN sys.schemas s ON s.schema_id = o.schema_id "
                    + "JOIN sys.types ut ON ut.user_type_id = pa.user_type_id "
                    + "LEFT JOIN sys.types bt ON bt.user_type_id = ut.system_type_id "
                    + "AND bt.system_type_id = bt.user_type_id "
                    + "WHERE o.is_ms_shipped = 0 AND pa.parameter_id > 0 "
                    + "AND o.type IN ('P', 'FN', 'IF', 'TF', 'AF', 'PC', 'FS', 'FT') "
                    + "ORDER BY s.name, o.name, pa.parameter_id";

    private Map<String, List<IntrospectionResponse.ParameterRow>> readRoutineParameters(
            final Connection conn,
            final int timeoutSec
    ) throws SQLException {
        final Map<String, List<IntrospectionResponse.ParameterRow>> byRoutine =
                new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_ROUTINE_PARAMETERS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String key =
                            rs.getString("schema_name") + "." + rs.getString("routine_name");
                    final boolean aliasType = rs.getBoolean("is_user_defined")
                            || rs.getInt("declared_system_type_id")
                                    != rs.getInt("declared_user_type_id");
                    final String baseType = rs.getString("base_type_name") == null
                            ? rs.getString("declared_type_name")
                            : rs.getString("base_type_name");
                    byRoutine.computeIfAbsent(key, k -> new ArrayList<>()).add(
                            new IntrospectionResponse.ParameterRow(
                                    rs.getString("parameter_name"),
                                    baseType,
                                    normalizeMaxLength(baseType, rs.getInt("max_length")),
                                    (Integer) rs.getObject("precision"),
                                    (Integer) rs.getObject("scale"),
                                    rs.getBoolean("is_output"),
                                    rs.getBoolean("has_default_value"),
                                    rs.getBoolean("is_readonly"),
                                    rs.getInt("parameter_id"),
                                    aliasType ? rs.getString("declared_type_name") : null));
                }
            }
        }
        return byRoutine;
    }

    private List<IntrospectionResponse.ProcedureRow> readRoutines(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final Map<String, List<IntrospectionResponse.ParameterRow>> parameters =
                this.readRoutineParameters(conn, timeoutSec);
        final List<IntrospectionResponse.ProcedureRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_ROUTINES)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    if (isSystemSchema(schema) || !matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final String name = rs.getString("routine_name");
                    out.add(mapRoutineRow(
                            schema,
                            name,
                            rs.getString("object_type"),
                            rs.getString("definition"),
                            rs.getString("return_type"),
                            rs.getString("execute_as_principal"),
                            rs.getString("assembly_name"),
                            parameters.getOrDefault(schema + "." + name, Collections.emptyList())));
                }
            }
        }
        addCapability(capabilities, CAP_ROUTINE_PARAMETERS);
        return out;
    }

    /**
     * Map one routine. The body is the FULL {@code sys.sql_modules.definition}
     * -- SQL Server returns it as one value, so there is no 4 KB clip and no
     * {@code syscomments} reassembly (the ASE path needs both). A CLR routine
     * has no T-SQL body at all: it carries {@code language = "CLR"} and the
     * assembly name so the pack can raise the {@code clr_object} decision.
     * Pure.
     */
    static IntrospectionResponse.ProcedureRow mapRoutineRow(
            final String schemaName,
            final String routineName,
            final String objectType,
            final String definition,
            final String returnsType,
            final String executeAs,
            final String assemblyName,
            final List<IntrospectionResponse.ParameterRow> parameters
    ) {
        final boolean clr = isClrType(objectType);
        return new IntrospectionResponse.ProcedureRow(
                schemaName,
                routineName,
                decodeRoutineKind(objectType),
                definition,
                clr ? "CLR" : "TSQL",
                decodeFunctionKind(objectType),
                new ArrayList<>(parameters),
                returnsType,
                executeAs,
                assemblyName,
                null);
    }

    /** TRUE for the CLR object types {@code PC} / {@code FS} / {@code FT} / {@code AF}. Pure. */
    static boolean isClrType(final String objectType) {
        final String type = normalizeObjectType(objectType);
        return "PC".equals(type) || "FS".equals(type) || "FT".equals(type) || "AF".equals(type);
    }

    /** {@code procedure | function | clr_procedure | clr_function}. Pure. */
    static String decodeRoutineKind(final String objectType) {
        switch (normalizeObjectType(objectType)) {
            case "P":
                return "procedure";
            case "PC":
                return "clr_procedure";
            case "FN":
            case "IF":
            case "TF":
                return "function";
            case "FS":
            case "FT":
            case "AF":
                return "clr_function";
            default:
                return "procedure";
        }
    }

    /** {@code scalar | inline_table | multi_statement_table | aggregate | null}. Pure. */
    static String decodeFunctionKind(final String objectType) {
        switch (normalizeObjectType(objectType)) {
            case "FN":
            case "FS":
                return "scalar";
            case "IF":
                return "inline_table";
            case "TF":
            case "FT":
                return "multi_statement_table";
            case "AF":
                return "aggregate";
            default:
                return null;
        }
    }

    private static String normalizeObjectType(final String objectType) {
        return objectType == null ? "" : objectType.trim().toUpperCase(Locale.ROOT);
    }

    // ------------------------------------------------------------------
    // Triggers
    // ------------------------------------------------------------------

    private static final String SQL_TRIGGERS =
            "SELECT ps.name AS parent_schema, po.name AS parent_name, po.type AS parent_type, "
                    + "tr.name AS trigger_name, tr.is_instead_of_trigger, tr.is_disabled, "
                    + "tr.object_id, m.definition, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsFirstInsertTrigger')) "
                    + "AS first_insert, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsFirstUpdateTrigger')) "
                    + "AS first_update, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsFirstDeleteTrigger')) "
                    + "AS first_delete, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsLastInsertTrigger')) "
                    + "AS last_insert, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsLastUpdateTrigger')) "
                    + "AS last_update, "
                    + "CONVERT(int, OBJECTPROPERTYEX(tr.object_id, 'ExecIsLastDeleteTrigger')) "
                    + "AS last_delete "
                    + "FROM sys.triggers tr "
                    + "JOIN sys.objects po ON po.object_id = tr.parent_id "
                    + "JOIN sys.schemas ps ON ps.schema_id = po.schema_id "
                    + "LEFT JOIN sys.sql_modules m ON m.object_id = tr.object_id "
                    + "WHERE tr.parent_class = 1 AND tr.is_ms_shipped = 0 "
                    + "ORDER BY ps.name, po.name, tr.name";

    private static final String SQL_DATABASE_TRIGGERS =
            "SELECT tr.name AS trigger_name, tr.is_disabled, tr.object_id, m.definition "
                    + "FROM sys.triggers tr "
                    + "LEFT JOIN sys.sql_modules m ON m.object_id = tr.object_id "
                    + "WHERE tr.parent_class = 0 "
                    + "ORDER BY tr.name";

    private static final String SQL_TRIGGER_EVENTS =
            "SELECT te.object_id, te.type_desc "
                    + "FROM sys.trigger_events te "
                    + "ORDER BY te.object_id, te.type_desc";

    private Map<Long, List<String>> readTriggerEvents(final Connection conn, final int timeoutSec) {
        final Map<Long, List<String>> byTrigger = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_TRIGGER_EVENTS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    byTrigger.computeIfAbsent(rs.getLong("object_id"), k -> new ArrayList<>())
                            .add(decodeTriggerEvent(rs.getString("type_desc")));
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_trigger_events_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        return byTrigger;
    }

    /** {@code INSERT} to {@code insert}; a DDL event keeps its lower-snake name. Pure. */
    static String decodeTriggerEvent(final String typeDesc) {
        return typeDesc == null ? null : typeDesc.trim().toLowerCase(Locale.ROOT);
    }

    private List<IntrospectionResponse.TriggerRow> readTriggers(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final Map<Long, List<String>> eventsByTrigger = this.readTriggerEvents(conn, timeoutSec);
        final List<IntrospectionResponse.TriggerRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_TRIGGERS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("parent_schema");
                    if (isSystemSchema(schema) || !matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final long objectId = rs.getLong("object_id");
                    out.add(mapTriggerRow(
                            schema,
                            rs.getString("trigger_name"),
                            schema,
                            rs.getString("parent_name"),
                            rs.getString("parent_type"),
                            rs.getBoolean("is_instead_of_trigger"),
                            (Boolean) rs.getObject("is_disabled"),
                            eventsByTrigger.getOrDefault(objectId, Collections.emptyList()),
                            rs.getString("definition"),
                            orderedEvents(rs, "first_insert", "first_update", "first_delete"),
                            orderedEvents(rs, "last_insert", "last_update", "last_delete")));
                }
            }
        }
        // Database-scoped (DDL) triggers: listed separately per SPEC-1 §1.3.
        try (PreparedStatement ps = conn.prepareStatement(SQL_DATABASE_TRIGGERS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final long objectId = rs.getLong("object_id");
                    out.add(mapDatabaseTriggerRow(
                            rs.getString("trigger_name"),
                            (Boolean) rs.getObject("is_disabled"),
                            eventsByTrigger.getOrDefault(objectId, Collections.emptyList()),
                            rs.getString("definition")));
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_database_triggers_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        addCapability(capabilities, CAP_TRIGGER_EVENTS);
        return out;
    }

    /** The DML events this trigger is ordered first / last for. */
    private static List<String> orderedEvents(
            final ResultSet rs,
            final String insertColumn,
            final String updateColumn,
            final String deleteColumn
    ) throws SQLException {
        final List<String> events = new ArrayList<>(3);
        if (rs.getInt(insertColumn) == 1) {
            events.add("insert");
        }
        if (rs.getInt(updateColumn) == 1) {
            events.add("update");
        }
        if (rs.getInt(deleteColumn) == 1) {
            events.add("delete");
        }
        return events;
    }

    /**
     * Map one DML trigger. {@code timing} is REAL on SQL Server
     * ({@code after} / {@code instead_of} read off
     * {@code is_instead_of_trigger}), and {@code events} come from
     * {@code sys.trigger_events} rather than being guessed from the body the
     * way the ASE path must. Pure.
     */
    static IntrospectionResponse.TriggerRow mapTriggerRow(
            final String schemaName,
            final String triggerName,
            final String tableSchema,
            final String tableName,
            final String parentObjectType,
            final boolean isInsteadOf,
            final Boolean isDisabled,
            final List<String> events,
            final String definition,
            final List<String> orderFirstEvents,
            final List<String> orderLastEvents
    ) {
        return new IntrospectionResponse.TriggerRow(
                schemaName,
                triggerName,
                tableSchema,
                tableName,
                isInsteadOf ? "instead_of" : "after",
                new ArrayList<>(events),
                definition,
                isDisabled,
                "V".equals(normalizeObjectType(parentObjectType)) ? "view" : "table",
                orderFirstEvents,
                orderLastEvents,
                Boolean.FALSE);
    }

    /** Map one DATABASE-scoped (DDL) trigger. Pure. */
    static IntrospectionResponse.TriggerRow mapDatabaseTriggerRow(
            final String triggerName,
            final Boolean isDisabled,
            final List<String> events,
            final String definition
    ) {
        return new IntrospectionResponse.TriggerRow(
                null,
                triggerName,
                null,
                null,
                "after",
                new ArrayList<>(events),
                definition,
                isDisabled,
                null,
                Collections.emptyList(),
                Collections.emptyList(),
                Boolean.TRUE);
    }

    // ------------------------------------------------------------------
    // Sequences + identity
    // ------------------------------------------------------------------

    private static final String SQL_SEQUENCES =
            "SELECT s.name AS schema_name, sq.name AS sequence_name, t.name AS data_type, "
                    + "CONVERT(varchar(64), sq.start_value) AS start_value, "
                    + "CONVERT(varchar(64), sq.increment) AS increment_value, "
                    + "CONVERT(varchar(64), sq.minimum_value) AS min_value, "
                    + "CONVERT(varchar(64), sq.maximum_value) AS max_value, "
                    + "sq.is_cycling, "
                    + "CONVERT(varchar(64), sq.current_value) AS current_value, "
                    + "CONVERT(varchar(64), sq.cache_size) AS cache_size "
                    + "FROM sys.sequences sq "
                    + "JOIN sys.schemas s ON s.schema_id = sq.schema_id "
                    + "LEFT JOIN sys.types t ON t.user_type_id = sq.user_type_id "
                    + "ORDER BY s.name, sq.name";

    private static final String SQL_IDENTITY_COLUMNS =
            "SELECT s.name AS schema_name, t.name AS table_name, c.name AS column_name, "
                    + "ty.name AS data_type, "
                    + "CONVERT(varchar(64), ic.seed_value) AS seed_value, "
                    + "CONVERT(varchar(64), ic.increment_value) AS increment_value, "
                    + "CONVERT(varchar(64), ic.last_value) AS last_value "
                    + "FROM sys.identity_columns ic "
                    + "JOIN sys.tables t ON t.object_id = ic.object_id "
                    + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                    + "JOIN sys.columns c ON c.object_id = ic.object_id "
                    + "AND c.column_id = ic.column_id "
                    + "LEFT JOIN sys.types ty ON ty.user_type_id = c.user_type_id "
                    + "WHERE t.is_ms_shipped = 0 "
                    + "ORDER BY s.name, t.name, c.name";

    private List<IntrospectionResponse.SequenceRow> readSequences(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final List<IntrospectionResponse.SequenceRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_SEQUENCES)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    if (isSystemSchema(schema) || !matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    out.add(mapSequenceRow(
                            schema,
                            rs.getString("sequence_name"),
                            rs.getString("data_type"),
                            rs.getString("start_value"),
                            rs.getString("increment_value"),
                            rs.getString("min_value"),
                            rs.getString("max_value"),
                            (Boolean) rs.getObject("is_cycling"),
                            rs.getString("current_value"),
                            rs.getString("cache_size")));
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_sequences_read_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        // IDENTITY columns are synthesized into the SAME shape the ASE path
        // uses, so the discovery-side sequence_cutover_hazard finding fires
        // unchanged. sys.identity_columns.last_value IS the high-water mark --
        // no MAX(col) scan is needed on this engine.
        try (PreparedStatement ps = conn.prepareStatement(SQL_IDENTITY_COLUMNS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("schema_name");
                    final String table = rs.getString("table_name");
                    if (isSystemSchema(schema)
                            || !matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(synthesizeIdentitySequenceRow(
                            schema,
                            table,
                            rs.getString("column_name"),
                            rs.getString("data_type"),
                            rs.getString("seed_value"),
                            rs.getString("increment_value"),
                            rs.getString("last_value")));
                }
            }
            addCapability(capabilities, CAP_SEQUENCE_CURRENT_VALUE);
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_identity_columns_unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        return out;
    }

    /** Map one {@code sys.sequences} row -- full native detail. Pure. */
    static IntrospectionResponse.SequenceRow mapSequenceRow(
            final String schemaName,
            final String sequenceName,
            final String dataType,
            final String startValue,
            final String increment,
            final String minValue,
            final String maxValue,
            final Boolean isCycling,
            final String currentValue,
            final String cacheSize
    ) {
        return new IntrospectionResponse.SequenceRow(
                schemaName,
                sequenceName,
                dataType,
                startValue,
                increment,
                minValue,
                maxValue,
                isCycling,
                currentValue,
                null,
                null,
                null,
                cacheSize);
    }

    /**
     * Synthesize the {@code SequenceRow} shape for an IDENTITY column, using
     * the SAME {@code "<table>.<col> (identity)"} naming the ASE path uses so
     * the downstream finding is engine-independent. Pure.
     */
    static IntrospectionResponse.SequenceRow synthesizeIdentitySequenceRow(
            final String schemaName,
            final String tableName,
            final String columnName,
            final String dataType,
            final String seedValue,
            final String incrementValue,
            final String lastValue
    ) {
        return new IntrospectionResponse.SequenceRow(
                schemaName,
                tableName + "." + columnName + " (identity)",
                dataType,
                seedValue,
                incrementValue,
                null,
                null,
                Boolean.FALSE,
                lastValue,
                tableName,
                columnName,
                null,
                null);
    }

    // ------------------------------------------------------------------
    // SQL Server Agent jobs (msdb -- fail-soft on permission)
    // ------------------------------------------------------------------

    private static final String SQL_AGENT_JOBS =
            "SELECT j.name AS job_name, j.enabled AS job_enabled, "
                    + "js.step_id, js.subsystem, js.command, js.database_name, "
                    + "sch.name AS schedule_name, sch.freq_type, sch.freq_interval, "
                    + "sch.freq_subday_type, sch.freq_subday_interval, "
                    + "sch.freq_relative_interval, sch.freq_recurrence_factor, "
                    + "sch.active_start_time "
                    + "FROM msdb.dbo.sysjobs j "
                    + "LEFT JOIN msdb.dbo.sysjobsteps js ON js.job_id = j.job_id "
                    + "LEFT JOIN msdb.dbo.sysjobschedules sjs ON sjs.job_id = j.job_id "
                    + "LEFT JOIN msdb.dbo.sysschedules sch "
                    + "ON sch.schedule_id = sjs.schedule_id "
                    + "ORDER BY j.name, js.step_id";

    /**
     * SQL Server Agent jobs. FAIL-SOFT by design: the discovery login is
     * typically read-only on the SOURCE database and may have no rights in
     * {@code msdb} at all (shaping §7 asks for {@code SQLAgentReaderRole}
     * explicitly). On a permission failure the section is empty and the
     * {@code db_jobs} capability is NOT advertised, which discovery reads as
     * "unavailable" rather than "no jobs exist".
     */
    private List<IntrospectionResponse.ScheduledJobRow> readAgentJobs(
            final Connection conn,
            final int timeoutSec,
            final List<String> capabilities
    ) {
        final Map<String, List<IntrospectionResponse.JobStepRow>> stepsByJob =
                new LinkedHashMap<>();
        final Map<String, Boolean> enabledByJob = new LinkedHashMap<>();
        final Map<String, Map<String, Object>> frequencyByJob = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(SQL_AGENT_JOBS)) {
            applyTimeout(ps, timeoutSec);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String job = rs.getString("job_name");
                    enabledByJob.put(job, rs.getInt("job_enabled") != 0);
                    final List<IntrospectionResponse.JobStepRow> steps =
                            stepsByJob.computeIfAbsent(job, k -> new ArrayList<>());
                    final Integer stepId = (Integer) rs.getObject("step_id");
                    if (stepId != null && steps.stream()
                            .noneMatch(s -> stepId.equals(s.ordinal()))) {
                        steps.add(new IntrospectionResponse.JobStepRow(
                                stepId,
                                rs.getString("subsystem"),
                                rs.getString("command"),
                                rs.getString("database_name")));
                    }
                    if (!frequencyByJob.containsKey(job) && rs.getObject("freq_type") != null) {
                        final Map<String, Object> frequency = new LinkedHashMap<>();
                        frequency.put("schedule_name", rs.getString("schedule_name"));
                        frequency.put("freq_type", rs.getObject("freq_type"));
                        frequency.put("freq_interval", rs.getObject("freq_interval"));
                        frequency.put("freq_subday_type", rs.getObject("freq_subday_type"));
                        frequency.put("freq_subday_interval",
                                rs.getObject("freq_subday_interval"));
                        frequency.put("freq_relative_interval",
                                rs.getObject("freq_relative_interval"));
                        frequency.put("freq_recurrence_factor",
                                rs.getObject("freq_recurrence_factor"));
                        frequency.put("active_start_time", rs.getObject("active_start_time"));
                        frequencyByJob.put(job, frequency);
                    }
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] mssql_agent_jobs_unavailable reason=permission_or_absent "
                    + "sqlstate={}", e.getSQLState() == null ? "?" : e.getSQLState());
            return Collections.emptyList();
        }
        final List<IntrospectionResponse.ScheduledJobRow> out = new ArrayList<>();
        for (final Map.Entry<String, List<IntrospectionResponse.JobStepRow>> entry
                : stepsByJob.entrySet()) {
            out.add(mapAgentJobRow(
                    entry.getKey(),
                    enabledByJob.get(entry.getKey()),
                    entry.getValue(),
                    frequencyByJob.get(entry.getKey())));
        }
        addCapability(capabilities, CAP_SCHEDULED_JOBS);
        return out;
    }

    /**
     * Map one SQL Server Agent job. {@code command} carries the FIRST step's
     * command so the pre-existing single-command consumers keep working, while
     * {@code steps[]} carries every step in order. Pure.
     */
    static IntrospectionResponse.ScheduledJobRow mapAgentJobRow(
            final String jobName,
            final Boolean enabled,
            final List<IntrospectionResponse.JobStepRow> steps,
            final Map<String, Object> frequency
    ) {
        final String command = steps.isEmpty() ? null : steps.get(0).command();
        final String scheduleText = decodeScheduleText(frequency);
        return new IntrospectionResponse.ScheduledJobRow(
                null,
                jobName,
                SCHEDULER_SQL_AGENT,
                scheduleText,
                command,
                enabled,
                new ArrayList<>(steps),
                scheduleText,
                frequency);
    }

    /**
     * Decode the msdb frequency fields into a human sentence (wire contract
     * §2 {@code scheduleText}). The RAW fields also ride the wire in
     * {@code scheduleFrequency}, so nothing is lost to this summarisation.
     * Pure.
     */
    static String decodeScheduleText(final Map<String, Object> frequency) {
        if (frequency == null || frequency.isEmpty()) {
            return null;
        }
        final int freqType = intValue(frequency.get("freq_type"));
        final int interval = intValue(frequency.get("freq_interval"));
        final int subdayType = intValue(frequency.get("freq_subday_type"));
        final int subdayInterval = intValue(frequency.get("freq_subday_interval"));
        final int recurrence = intValue(frequency.get("freq_recurrence_factor"));
        final String at = formatAgentTime(intValue(frequency.get("active_start_time")));

        final String base;
        switch (freqType) {
            case 1:
                base = "once at " + at;
                break;
            case 4:
                base = interval <= 1 ? "daily at " + at
                        : "every " + interval + " days at " + at;
                break;
            case 8:
                base = "weekly (day mask " + interval + ")"
                        + (recurrence > 1 ? " every " + recurrence + " weeks" : "")
                        + " at " + at;
                break;
            case 16:
                base = "monthly on day " + interval
                        + (recurrence > 1 ? " every " + recurrence + " months" : "")
                        + " at " + at;
                break;
            case 32:
                base = "monthly relative (interval " + interval + ")"
                        + (recurrence > 1 ? " every " + recurrence + " months" : "")
                        + " at " + at;
                break;
            case 64:
                return "when SQL Server Agent starts";
            case 128:
                return "when the server is idle";
            default:
                base = "schedule freq_type=" + freqType;
                break;
        }
        if (subdayType == 2 && subdayInterval > 0) {
            return base + ", repeating every " + subdayInterval + " seconds";
        }
        if (subdayType == 4 && subdayInterval > 0) {
            return base + ", repeating every " + subdayInterval + " minutes";
        }
        if (subdayType == 8 && subdayInterval > 0) {
            return base + ", repeating every " + subdayInterval + " hours";
        }
        return base;
    }

    /** msdb stores a time as the integer {@code HHMMSS}. Pure. */
    static String formatAgentTime(final int hhmmss) {
        final int safe = Math.max(0, hhmmss);
        return String.format("%02d:%02d:%02d", safe / 10000, (safe / 100) % 100, safe % 100);
    }

    private static int intValue(final Object value) {
        return value instanceof Number ? ((Number) value).intValue() : 0;
    }

    // ------------------------------------------------------------------
    // Extended objects (no like-for-like target shape -- shaping §5 item 5)
    // ------------------------------------------------------------------

    /** One extended-object read: a kind, its SQL, and how to map a row. */
    private interface ExtendedRead {
        String kind();

        String sql();

        IntrospectionResponse.ExtendedObjectRow map(String kind, ResultSet rs) throws SQLException;
    }

    private List<IntrospectionResponse.ExtendedObjectRow> readExtendedObjects(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec,
            final List<String> capabilities
    ) {
        final List<IntrospectionResponse.ExtendedObjectRow> out = new ArrayList<>();
        for (final ExtendedRead read : extendedReads()) {
            try (PreparedStatement ps = conn.prepareStatement(read.sql())) {
                applyTimeout(ps, timeoutSec);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        final IntrospectionResponse.ExtendedObjectRow row =
                                read.map(read.kind(), rs);
                        if (row.schema() != null && isSystemSchema(row.schema())) {
                            continue;
                        }
                        if (row.schema() != null
                                && !matchesSchemaFilter(row.schema(), includeSchemas)) {
                            continue;
                        }
                        out.add(row);
                    }
                }
            } catch (final SQLException e) {
                // A feature that is not installed (Service Broker, CDC,
                // FILESTREAM, CLR) has no catalog view or no rights; that is
                // information, not a failure.
                LOG.info("[diag-sidecar] mssql_extended_read_unavailable kind={} sqlstate={}",
                        read.kind(), e.getSQLState() == null ? "?" : e.getSQLState());
            }
        }
        if (!out.isEmpty()) {
            addCapability(capabilities, CAP_EXTENDED_OBJECTS);
        }
        return out;
    }

    /** The extended-object reads, in wire order. */
    private static List<ExtendedRead> extendedReads() {
        final List<ExtendedRead> reads = new ArrayList<>();
        reads.add(simpleRead("service_broker_queue",
                "SELECT s.name AS schema_name, q.name AS object_name, "
                        + "q.is_activation_enabled, q.is_receive_enabled "
                        + "FROM sys.service_queues q "
                        + "JOIN sys.schemas s ON s.schema_id = q.schema_id "
                        + "WHERE q.is_ms_shipped = 0 ORDER BY s.name, q.name",
                "is_activation_enabled", "is_receive_enabled"));
        reads.add(simpleRead("service_broker_service",
                "SELECT NULL AS schema_name, sv.name AS object_name, "
                        + "q.name AS queue_name "
                        + "FROM sys.services sv "
                        + "LEFT JOIN sys.service_queues q ON q.object_id = sv.service_queue_id "
                        + "ORDER BY sv.name",
                "queue_name"));
        reads.add(simpleRead("service_broker_contract",
                "SELECT NULL AS schema_name, c.name AS object_name "
                        + "FROM sys.service_contracts c "
                        + "WHERE c.is_ms_shipped = 0 ORDER BY c.name"));
        reads.add(simpleRead("user_defined_table_type",
                "SELECT s.name AS schema_name, tt.name AS object_name, "
                        + "c.name AS column_name, ty.name AS column_type "
                        + "FROM sys.table_types tt "
                        + "JOIN sys.schemas s ON s.schema_id = tt.schema_id "
                        + "LEFT JOIN sys.columns c ON c.object_id = tt.type_table_object_id "
                        + "LEFT JOIN sys.types ty ON ty.user_type_id = c.user_type_id "
                        + "ORDER BY s.name, tt.name, c.column_id",
                "column_name", "column_type"));
        reads.add(simpleRead("synonym",
                "SELECT s.name AS schema_name, sy.name AS object_name, "
                        + "sy.base_object_name "
                        + "FROM sys.synonyms sy "
                        + "JOIN sys.schemas s ON s.schema_id = sy.schema_id "
                        + "ORDER BY s.name, sy.name",
                "base_object_name"));
        reads.add(simpleRead("fulltext_catalog",
                "SELECT NULL AS schema_name, c.name AS object_name, c.is_default "
                        + "FROM sys.fulltext_catalogs c ORDER BY c.name",
                "is_default"));
        reads.add(simpleRead("assembly",
                "SELECT NULL AS schema_name, a.name AS object_name, "
                        + "a.permission_set_desc, a.clr_name "
                        + "FROM sys.assemblies a WHERE a.is_user_defined = 1 ORDER BY a.name",
                "permission_set_desc", "clr_name"));
        reads.add(simpleRead("xml_schema_collection",
                "SELECT s.name AS schema_name, x.name AS object_name "
                        + "FROM sys.xml_schema_collections x "
                        + "JOIN sys.schemas s ON s.schema_id = x.schema_id "
                        + "WHERE x.name <> 'sys' ORDER BY s.name, x.name"));
        reads.add(simpleRead("partition_function",
                "SELECT NULL AS schema_name, pf.name AS object_name, pf.type_desc, "
                        + "pf.fanout, pf.boundary_value_on_right "
                        + "FROM sys.partition_functions pf ORDER BY pf.name",
                "type_desc", "fanout", "boundary_value_on_right"));
        reads.add(simpleRead("partition_scheme",
                "SELECT NULL AS schema_name, ps.name AS object_name, "
                        + "pf.name AS function_name "
                        + "FROM sys.partition_schemes ps "
                        + "LEFT JOIN sys.partition_functions pf "
                        + "ON pf.function_id = ps.function_id ORDER BY ps.name",
                "function_name"));
        reads.add(simpleRead("cdc_capture_instance",
                "SELECT s.name AS schema_name, ct.capture_instance AS object_name, "
                        + "t.name AS source_table, ct.supports_net_changes "
                        + "FROM cdc.change_tables ct "
                        + "JOIN sys.tables t ON t.object_id = ct.source_object_id "
                        + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                        + "ORDER BY s.name, ct.capture_instance",
                "source_table", "supports_net_changes"));
        reads.add(simpleRead("change_tracking",
                "SELECT s.name AS schema_name, t.name AS object_name, "
                        + "ctt.is_track_columns_updated_on "
                        + "FROM sys.change_tracking_tables ctt "
                        + "JOIN sys.tables t ON t.object_id = ctt.object_id "
                        + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                        + "ORDER BY s.name, t.name",
                "is_track_columns_updated_on"));
        reads.add(simpleRead("filestream_filegroup",
                "SELECT NULL AS schema_name, fg.name AS object_name, fg.type_desc "
                        + "FROM sys.filegroups fg WHERE fg.type = 'FD' ORDER BY fg.name",
                "type_desc"));
        reads.add(simpleRead("rowlevel_security_policy",
                "SELECT s.name AS schema_name, p.name AS object_name, p.is_enabled "
                        + "FROM sys.security_policies p "
                        + "JOIN sys.schemas s ON s.schema_id = p.schema_id "
                        + "ORDER BY s.name, p.name",
                "is_enabled"));
        reads.add(simpleRead("external_table",
                "SELECT s.name AS schema_name, t.name AS object_name "
                        + "FROM sys.external_tables t "
                        + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                        + "ORDER BY s.name, t.name"));
        reads.add(simpleRead("temporal_history_link",
                "SELECT s.name AS schema_name, t.name AS object_name, "
                        + "hs.name AS history_schema, h.name AS history_table "
                        + "FROM sys.tables t "
                        + "JOIN sys.schemas s ON s.schema_id = t.schema_id "
                        + "JOIN sys.tables h ON h.object_id = t.history_table_id "
                        + "JOIN sys.schemas hs ON hs.schema_id = h.schema_id "
                        + "ORDER BY s.name, t.name",
                "history_schema", "history_table"));
        return reads;
    }

    /**
     * An extended read whose rows carry {@code schema_name} + {@code object_name}
     * plus a fixed set of detail columns.
     */
    private static ExtendedRead simpleRead(
            final String kind,
            final String sql,
            final String... detailColumns
    ) {
        return new ExtendedRead() {
            @Override
            public String kind() {
                return kind;
            }

            @Override
            public String sql() {
                return sql;
            }

            @Override
            public IntrospectionResponse.ExtendedObjectRow map(
                    final String rowKind, final ResultSet rs) throws SQLException {
                final Map<String, Object> detail = new LinkedHashMap<>();
                for (final String column : detailColumns) {
                    detail.put(column, rs.getObject(column));
                }
                return new IntrospectionResponse.ExtendedObjectRow(
                        rowKind,
                        rs.getString("schema_name"),
                        rs.getString("object_name"),
                        null,
                        detail);
            }
        };
    }

    /** The capability keys an MSSQL introspection can advertise. Pure. */
    static Set<String> advertisableCapabilities() {
        final Set<String> keys = new LinkedHashSet<>();
        keys.add(CAP_COLLATION);
        keys.add(CAP_COMPUTED_COLUMNS);
        keys.add(CAP_SEQUENCE_CURRENT_VALUE);
        keys.add(CAP_FK_ACTIONS);
        keys.add(CAP_INDEX_CLUSTERING);
        keys.add(CAP_SCHEDULED_JOBS);
        keys.add(CAP_FILTERED_INDEXES);
        keys.add(CAP_INCLUDED_COLUMNS);
        keys.add(CAP_TRIGGER_EVENTS);
        keys.add(CAP_EXTENDED_OBJECTS);
        keys.add(CAP_COLUMN_DEFAULTS);
        keys.add(CAP_CHECK_CONSTRAINTS);
        keys.add(CAP_IDENTITY_SEED);
        keys.add(CAP_COLUMN_PRECISION);
        keys.add(CAP_ROUTINE_PARAMETERS);
        return keys;
    }

    private static void applyTimeout(final PreparedStatement ps, final int timeoutSec)
            throws SQLException {
        if (timeoutSec > 0) {
            ps.setQueryTimeout(timeoutSec);
        }
    }
}
