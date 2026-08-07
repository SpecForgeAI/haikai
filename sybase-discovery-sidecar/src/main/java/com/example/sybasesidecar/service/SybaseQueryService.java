package com.example.sybasesidecar.service;

import com.example.sybasesidecar.model.IntrospectionResponse;
import com.example.sybasesidecar.model.QueryResponse;
import com.example.sybasesidecar.model.SybaseDriverChoice;
import com.example.sybasesidecar.model.TestConnectionResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Sybase JDBC service - opens a per-request connection, runs the requested
 * operation, and closes the connection.
 *
 * <p>Spec: 2026-05-16 Database Discovery Packs - Task Group 4 (sidecar).
 * Revised 2026-05-17 to support two driver flavours (jTDS, jConnect) with a
 * caller-supplied preference and an auto-fallback mode.</p>
 *
 * <h2>Driver selection</h2>
 * <p>Every public entry point accepts a {@link SybaseDriverChoice}. The
 * service holds a {@link JtdsDriverStrategy} and a {@link JConnectDriverStrategy}
 * instance (the latter loaded reflectively; gracefully absent when its jar
 * is missing). The resolution rules:</p>
 * <ul>
 *   <li>{@code JTDS} or {@code JCONNECT}: use that strategy directly.</li>
 *   <li>{@code AUTO}: try jTDS first; on SQLException try jConnect; if
 *       jConnect is unavailable the auto path is jTDS-only and the original
 *       error surfaces unchanged.</li>
 * </ul>
 * <p>The successful driver name (or the last attempted driver on failure) is
 * surfaced in {@link TestConnectionResponse#driverUsed()} and the
 * {@code [diag-sidecar]} log lines so the runbook can correlate.</p>
 *
 * <h2>Operational characteristics</h2>
 * <ul>
 *   <li>NO connection pooling. Every request opens its own JDBC connection
 *       and closes it in a {@code finally} block. This is intentional in v1
 *       because pooling would force the sidecar to retain credentials
 *       beyond the request lifetime.</li>
 *   <li>SELECT-only enforcement via {@link SidecarSqlGuard}. The TS-side
 *       {@code sqlGuard} is the first line; this is the second.</li>
 *   <li>Query timeout enforced via {@link Statement#setQueryTimeout(int)}
 *       (best-effort - some JDBC drivers ignore it for certain operations).
 *   </li>
 *   <li>Row limit enforced server-side by stopping the result-set walk after
 *       {@code maxRows} - we DO NOT rely on the client-supplied LIMIT.</li>
 *   <li>Password masking on every error message returned to the client.</li>
 * </ul>
 *
 * <h2>Per-row mapper seams (metadata-enrichment spec 2026-05-31)</h2>
 * <p>The catalog row -&gt; {@link IntrospectionResponse} record mapping for each
 * group is factored into PURE, package-visible methods ({@code map*Row} /
 * {@code mapKeyIndexKind} / {@code synthesizeIdentitySequenceRow}) taking
 * primitive row inputs (NOT a live JDBC {@link ResultSet}). The JDBC
 * {@code while (rs.next())} loops are thin "read row -&gt; call mapper" shells.
 * This lets {@code SybaseQueryServiceTest} unit-test the SQL-&gt;object mapping +
 * the identity synthesis + the version-branch null-out without a live DB.</p>
 *
 * <h2>Metadata-enrichment catalog reads (Task Groups 2-4, spec 2026-05-31)</h2>
 * <p>Groups 2-4 widen the existing {@code /introspect} catalog reads to project
 * the six metadata groups (collation; computed columns; sequence/identity
 * current value; FK referential actions; index clustering/ordering;
 * DB-resident jobs). Each enriched read is VERSION-TOLERANT: where a newer ASE
 * catalog column/object may be absent on an older engine, the enriched query is
 * attempted and a {@link SQLException} falls back to the prior (bare) query or
 * null-outs the field -- it never hard-errors the whole introspection. When a
 * group's read path runs, its key is appended to {@code capabilities[]} on the
 * response so discovery can resolve {@code present} vs {@code unavailable}.</p>
 */
@Service
public class SybaseQueryService {

    private static final Logger LOG = LoggerFactory.getLogger(SybaseQueryService.class);

    /**
     * Cap on snippet body lengths (procedure/view/trigger). Per spec, ~4KB.
     * The TS-side {@code snippetRedaction.redactSnippet} will further reduce
     * the snippet before it reaches a Finding payload.
     */
    private static final int MAX_SNIPPET_CHARS = 4096;

    // ------------------------------------------------------------------
    // Capability keys (spec 2026-05-31). Each metadata group advertises its
    // key in IntrospectionResponse.capabilities[] when its read path runs, so
    // the discovery side distinguishes "this build does not surface group X"
    // (key absent -> unavailable) from "group X surfaced but genuinely null".
    // These verbatim strings are the contract the discovery applicability
    // resolver matches on; keep them stable.
    // ------------------------------------------------------------------
    /** Group 1 -- per-column collation + DB-level sort order. */
    static final String CAP_COLLATION = "collation";
    /** Group 2 -- computed-column flag + expression. */
    static final String CAP_COMPUTED_COLUMNS = "computed_columns";
    /** Group 3 -- sequence / identity current value (high-water mark). */
    static final String CAP_SEQUENCE_CURRENT_VALUE = "sequence_current_value";
    /** Group 4 -- FK referential ON UPDATE / ON DELETE actions. */
    static final String CAP_FK_ACTIONS = "fk_actions";
    /** Group 5 -- index clustering / ordering / method. */
    static final String CAP_INDEX_CLUSTERING = "index_clustering";
    /**
     * Group 6 -- DB-resident scheduled jobs (Job Scheduler). The wire value is
     * {@code "db_jobs"} to MATCH the discovery-side applicability resolver key
     * (`SYBASE_METADATA_CAPABILITY.dbJobs` in `sybaseIntrospection.ts`); the
     * constant name is internal, the STRING is the cross-service contract.
     */
    static final String CAP_SCHEDULED_JOBS = "db_jobs";

    private final DriverStrategy jtds;
    private final DriverStrategy jconnect;

    /**
     * Default constructor used by Spring. Instantiates both strategies; the
     * jConnect strategy gracefully reports unavailable when its jar is
     * missing from the classpath.
     */
    public SybaseQueryService() {
        this(new JtdsDriverStrategy(), new JConnectDriverStrategy());
    }

    /**
     * Constructor used by tests to inject fake / stub strategies.
     */
    SybaseQueryService(final DriverStrategy jtds, final DriverStrategy jconnect) {
        this.jtds = jtds;
        this.jconnect = jconnect;
    }

    /**
     * Build the JDBC URL for the given driver choice. Pure helper retained
     * for back-compat with the existing test cases.
     */
    public String buildJdbcUrl(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database
    ) {
        return this.strategyFor(choice == SybaseDriverChoice.AUTO ? SybaseDriverChoice.JTDS : choice)
                .buildJdbcUrl(host, port, database);
    }

    /**
     * Back-compat overload: defaults to the jTDS URL form.
     */
    public String buildJdbcUrl(final String host, final int port, final String database) {
        return this.buildJdbcUrl(SybaseDriverChoice.JTDS, host, port, database);
    }

    /**
     * Open a per-request JDBC connection using the strategy implied by
     * {@code choice}. In {@link SybaseDriverChoice#AUTO} mode, attempts jTDS
     * first and falls through to jConnect on SQLException.
     *
     * @return a 2-element record carrying the open connection plus the
     *         strategy name that succeeded.
     */
    private OpenConnectionResult openConnection(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) throws SQLException {
        if (choice == SybaseDriverChoice.AUTO) {
            return this.openConnectionAuto(host, port, database, username, password);
        }
        final DriverStrategy strat = this.strategyFor(choice);
        final Connection conn = strat.openConnection(host, port, database, username, password);
        this.applyReadOnly(conn);
        LOG.info("[diag-sidecar] driver_attempt driver={} result=ok forced=true", strat.name());
        return new OpenConnectionResult(conn, strat.name());
    }

    private OpenConnectionResult openConnectionAuto(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) throws SQLException {
        SQLException jtdsErr = null;
        try {
            final Connection conn = this.jtds.openConnection(host, port, database, username, password);
            this.applyReadOnly(conn);
            LOG.info("[diag-sidecar] driver_attempt driver=jtds result=ok auto=true");
            return new OpenConnectionResult(conn, this.jtds.name());
        } catch (final SQLException e) {
            jtdsErr = e;
            LOG.info("[diag-sidecar] driver_attempt driver=jtds result=fail auto=true sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        if (!this.jconnect.isAvailable()) {
            LOG.info("[diag-sidecar] driver_attempt driver=jconnect skipped=unavailable");
            throw jtdsErr;
        }
        try {
            final Connection conn = this.jconnect.openConnection(host, port, database, username, password);
            this.applyReadOnly(conn);
            LOG.info("[diag-sidecar] driver_attempt driver=jconnect result=ok auto=true");
            return new OpenConnectionResult(conn, this.jconnect.name());
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] driver_attempt driver=jconnect result=fail auto=true sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            // Surface the jConnect error (the second / final attempt) since
            // it is typically the more accurate signal for ASE 15.7+ servers.
            throw e;
        }
    }

    private DriverStrategy strategyFor(final SybaseDriverChoice choice) {
        return choice == SybaseDriverChoice.JCONNECT ? this.jconnect : this.jtds;
    }

    /**
     * Best-effort: set the connection read-only + auto-commit. Some Sybase
     * drivers reject {@code setReadOnly} silently and that's not fatal --
     * the GRANT layer is the real enforcement.
     */
    private void applyReadOnly(final Connection conn) {
        try {
            conn.setReadOnly(true);
            conn.setAutoCommit(true);
        } catch (final SQLException ignored) {
            // intentionally swallow -- driver-specific quirk
        }
    }

    /**
     * Test the connection by opening a JDBC connection, reading the server
     * version via {@code @@version}, and closing the connection.
     */
    public TestConnectionResponse testConnection(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) {
        LOG.info("Sidecar query category=test_connection host={} db={} driver_choice={}",
                host, database, choice);
        Connection conn = null;
        OpenConnectionResult opened = null;
        try {
            opened = this.openConnection(choice, host, port, database, username, password);
            conn = opened.connection();
            String serverVersion = null;
            try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery("SELECT @@version")) {
                if (rs.next()) {
                    serverVersion = rs.getString(1);
                }
            }
            return new TestConnectionResponse(true, null, serverVersion, opened.driverName());
        } catch (final SQLException e) {
            return new TestConnectionResponse(
                    false,
                    this.maskPassword(e.getMessage(), password),
                    null,
                    opened == null ? this.lastAttemptedDriverName(choice) : opened.driverName()
            );
        } finally {
            this.closeQuietly(conn);
        }
    }

    /**
     * Back-compat overload: defaults to AUTO.
     */
    public TestConnectionResponse testConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) {
        return this.testConnection(SybaseDriverChoice.AUTO, host, port, database, username, password);
    }

    /**
     * Run the full introspection batch (schemas, tables, columns, keys,
     * indexes, views, procedures, triggers) inside a single connection.
     */
    public IntrospectionResponse introspect(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int queryTimeoutSeconds
    ) {
        LOG.info("Sidecar query category=introspect host={} db={} driver_choice={}",
                host, database, choice);
        Connection conn = null;
        try {
            conn = this.openConnection(choice, host, port, database, username, password).connection();

            // The engine version is read first so the version-branched reads
            // (e.g. the ASE16 native SEQUENCE catalog) can consult it.
            final String serverVersion = this.readServerVersion(conn);

            // capabilities[] is appended to by each enriched read path as it
            // successfully runs (spec 2026-05-31, decision 3).
            final List<String> capabilities = new ArrayList<>();

            final List<IntrospectionResponse.SchemaRow> schemas = this.introspectSchemas(
                    conn, includeSchemas, queryTimeoutSeconds);
            final List<IntrospectionResponse.TableRow> tables = this.introspectTables(
                    conn, includeSchemas, includeTables, queryTimeoutSeconds);
            final List<IntrospectionResponse.ColumnRow> columns = this.introspectColumns(
                    conn, includeSchemas, includeTables, queryTimeoutSeconds, capabilities);
            final List<IntrospectionResponse.KeyRow> keys = this.introspectKeysAndIndexes(
                    conn, includeSchemas, includeTables, queryTimeoutSeconds, capabilities);
            final List<IntrospectionResponse.ViewRow> views = this.introspectViews(
                    conn, includeSchemas, queryTimeoutSeconds);
            final List<IntrospectionResponse.ProcedureRow> procedures = this.introspectProcedures(
                    conn, includeSchemas, queryTimeoutSeconds);
            final List<IntrospectionResponse.TriggerRow> triggers = this.introspectTriggers(
                    conn, includeSchemas, queryTimeoutSeconds);

            // Group 3 (sequence/identity current value): synthesize the
            // identity sequences + read native ASE16 sequences (version-branched).
            final List<IntrospectionResponse.SequenceRow> sequences = this.introspectSequences(
                    conn, includeSchemas, includeTables, queryTimeoutSeconds, serverVersion, capabilities);

            // Group 6 (DB-resident jobs): read the Job Scheduler via the narrow
            // read-only allowlist (best-effort; null-outs to empty if absent).
            final List<IntrospectionResponse.ScheduledJobRow> scheduledJobs = this.introspectScheduledJobs(
                    conn, queryTimeoutSeconds, capabilities);

            // Group 1 (DB-level sort order): a single base-catalog read; NO
            // sp_helpsort. Null-outs on any failure (the per-column collation
            // is the primary signal; this is the DB-wide default).
            final String databaseCollation = this.readDatabaseCollation(conn, queryTimeoutSeconds, capabilities);

            return new IntrospectionResponse(
                    true, null, schemas, tables, columns, keys, views, procedures, triggers,
                    sequences, scheduledJobs, capabilities, serverVersion, databaseCollation);
        } catch (final SQLException e) {
            return new IntrospectionResponse(
                    false,
                    this.maskPassword(e.getMessage(), password),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    Collections.emptyList(),
                    null,
                    null
            );
        } finally {
            this.closeQuietly(conn);
        }
    }

    /**
     * Back-compat overload: defaults to AUTO.
     */
    public IntrospectionResponse introspect(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int queryTimeoutSeconds
    ) {
        return this.introspect(
                SybaseDriverChoice.AUTO, host, port, database, username, password,
                includeSchemas, includeTables, queryTimeoutSeconds);
    }

    /**
     * Execute a single guarded SELECT.
     */
    public QueryResponse query(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String sql,
            final int queryTimeoutSeconds,
            final int maxRows
    ) {
        // Re-enforce the SELECT-only contract at the JVM layer.
        SidecarSqlGuard.assertReadonlySelect(sql);
        LOG.info("Sidecar query category=query_select host={} db={} timeoutSec={} maxRows={} driver_choice={}",
                host, database, queryTimeoutSeconds, maxRows, choice);

        Connection conn = null;
        try {
            conn = this.openConnection(choice, host, port, database, username, password).connection();
            try (Statement st = conn.createStatement()) {
                if (queryTimeoutSeconds > 0) {
                    st.setQueryTimeout(queryTimeoutSeconds);
                }
                if (maxRows > 0) {
                    // maxRows + 1 (2026-08-07): with setMaxRows(maxRows) the
                    // driver never yields row maxRows+1, so the walk below could
                    // NEVER observe a clipped result and `truncated` was always
                    // false — a capped page was indistinguishable from a final
                    // page. Fetch ONE sentinel row beyond the cap; the walk
                    // keeps maxRows rows and flags `truncated` on the sentinel.
                    st.setMaxRows(maxRows + 1);
                }
                final List<Map<String, Object>> rows = new ArrayList<>();
                boolean truncated = false;
                try (ResultSet rs = st.executeQuery(sql)) {
                    final ResultSetMetaData md = rs.getMetaData();
                    final int cols = md.getColumnCount();
                    while (rs.next()) {
                        if (maxRows > 0 && rows.size() >= maxRows) {
                            truncated = true;
                            break;
                        }
                        final Map<String, Object> row = new LinkedHashMap<>();
                        for (int i = 1; i <= cols; i++) {
                            final String name = md.getColumnLabel(i);
                            final Object value = rs.getObject(i);
                            row.put(name, normalizeWireValue(value));
                        }
                        rows.add(row);
                    }
                }
                return new QueryResponse(true, null, rows, rows.size(), truncated);
            }
        } catch (final SQLException e) {
            return new QueryResponse(
                    false,
                    this.maskPassword(e.getMessage(), password),
                    Collections.emptyList(),
                    0,
                    false
            );
        } finally {
            this.closeQuietly(conn);
        }
    }

    /**
     * Back-compat overload: defaults to AUTO.
     */
    public QueryResponse query(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String sql,
            final int queryTimeoutSeconds,
            final int maxRows
    ) {
        return this.query(
                SybaseDriverChoice.AUTO, host, port, database, username, password,
                sql, queryTimeoutSeconds, maxRows);
    }

    /** Wire datetime shape: naive local timestamp, no zone offset, millis. */
    static final java.time.format.DateTimeFormatter WIRE_DATETIME =
            java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");
    /** Wire time-of-day shape. */
    static final java.time.format.DateTimeFormatter WIRE_TIME =
            java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
    private static final char[] HEX_DIGITS = "0123456789abcdef".toCharArray();

    /**
     * Typed wire normalisation for {@code /query} row values (gold standard
     * 2026-08-07). Raw JDBC objects previously went straight to Jackson, whose
     * defaults silently corrupt migration data at the Node consumer:
     * <ul>
     *   <li>{@code BigDecimal} / {@code long} serialised as JSON numbers lose
     *       precision at {@code JSON.parse} (IEEE double, 2^53) — exactly the
     *       values a data migration must carry exactly. Now decimal / bigint
     *       render as STRINGS ({@code toPlainString}), matching node-pg's own
     *       string parsing of {@code numeric} / {@code int8}, so the two sides
     *       of a parity comparison align.</li>
     *   <li>{@code java.sql.Timestamp} serialised as epoch millis re-interprets
     *       a zoneless ASE datetime through the JVM default zone. Now datetimes
     *       render as the naive wall-clock string the engine stored
     *       ({@code yyyy-MM-dd HH:mm:ss.SSS}; the Dockerfile pins
     *       {@code -Duser.timezone=UTC} so DST gaps cannot corrupt the
     *       round-trip). Dates / times render as {@code yyyy-MM-dd} /
     *       {@code HH:mm:ss}.</li>
     *   <li>{@code byte[]} serialised as base64 while Postgres renders bytea as
     *       {@code \x}-prefixed hex — the same bytes compared as unequal
     *       strings. Now binary renders as {@code \x} + lowercase hex.</li>
     *   <li>{@code Clob} serialised as an object graph. Now the full character
     *       content (a Clob read failure propagates as {@link SQLException} —
     *       a LOUD query failure, never a garbled cell).</li>
     * </ul>
     * Integers/booleans/strings/floats pass through untouched (both engines
     * agree on their JSON shapes). Package-visible + pure for unit tests.
     */
    static Object normalizeWireValue(final Object value) throws SQLException {
        if (value == null) {
            return null;
        }
        if (value instanceof java.math.BigDecimal) {
            return ((java.math.BigDecimal) value).toPlainString();
        }
        if (value instanceof java.math.BigInteger || value instanceof Long) {
            return value.toString();
        }
        if (value instanceof java.sql.Timestamp) {
            return ((java.sql.Timestamp) value).toLocalDateTime().format(WIRE_DATETIME);
        }
        if (value instanceof java.sql.Date) {
            return ((java.sql.Date) value).toLocalDate().toString();
        }
        if (value instanceof java.sql.Time) {
            return ((java.sql.Time) value).toLocalTime().format(WIRE_TIME);
        }
        if (value instanceof java.util.Date) {
            // Defensive: an exotic driver returning a plain java.util.Date.
            return new java.sql.Timestamp(((java.util.Date) value).getTime())
                    .toLocalDateTime().format(WIRE_DATETIME);
        }
        if (value instanceof byte[]) {
            final byte[] bytes = (byte[]) value;
            final StringBuilder sb = new StringBuilder(2 + bytes.length * 2).append("\\x");
            for (final byte b : bytes) {
                sb.append(HEX_DIGITS[(b >> 4) & 0xF]).append(HEX_DIGITS[b & 0xF]);
            }
            return sb.toString();
        }
        if (value instanceof java.sql.Clob) {
            final java.sql.Clob clob = (java.sql.Clob) value;
            final long length = clob.length();
            return length == 0 ? "" : clob.getSubString(1, (int) Math.min(length, Integer.MAX_VALUE));
        }
        return value;
    }

    /**
     * Used by error-path responses: report the driver we would have tried
     * (in auto mode the first attempt is jTDS) so the caller has a non-null
     * driver name to log/diagnose with.
     */
    private String lastAttemptedDriverName(final SybaseDriverChoice choice) {
        if (choice == SybaseDriverChoice.JCONNECT) {
            return this.jconnect.name();
        }
        if (choice == SybaseDriverChoice.JTDS) {
            return this.jtds.name();
        }
        // AUTO: jTDS tried first, then jConnect (if available). On a thrown
        // exception we don't know which one threw without instrumentation;
        // return jConnect when available since it was the last attempt.
        return this.jconnect.isAvailable() ? this.jconnect.name() : this.jtds.name();
    }

    /**
     * Best-effort read of the engine version string (ASE {@code @@version}) on
     * an already-open introspection connection. Version-tolerant: any failure
     * null-outs rather than aborting the introspection (the version is evidence,
     * not a hard dependency). Mirrors the {@code @@version} read in
     * {@link #testConnection}.
     */
    private String readServerVersion(final Connection conn) {
        try (Statement st = conn.createStatement(); ResultSet rs = st.executeQuery("SELECT @@version")) {
            if (rs.next()) {
                return rs.getString(1);
            }
        } catch (final SQLException ignored) {
            // version is evidence-only; null-out on any failure
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Introspection sub-queries (Sybase ASE system tables)
    // ------------------------------------------------------------------

    /**
     * Schemas/owners - Sybase ASE exposes owners via {@code sysusers}.
     */
    private List<IntrospectionResponse.SchemaRow> introspectSchemas(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name FROM sysusers u "
                        + "WHERE u.uid > 0 AND u.uid < 16383 ORDER BY u.name";
        final List<IntrospectionResponse.SchemaRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String name = rs.getString("owner_name");
                    if (matchesSchemaFilter(name, includeSchemas)) {
                        out.add(new IntrospectionResponse.SchemaRow(name, name));
                    }
                }
            }
        }
        return out;
    }

    /**
     * User tables - {@code sysobjects.type = 'U'}.
     */
    private List<IntrospectionResponse.TableRow> introspectTables(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS table_name "
                        + "FROM sysobjects o JOIN sysusers u ON u.uid = o.uid "
                        + "WHERE o.type = 'U' ORDER BY u.name, o.name";
        final List<IntrospectionResponse.TableRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (matchesSchemaFilter(schema, includeSchemas)
                            && matchesTableFilter(table, includeTables)) {
                        out.add(new IntrospectionResponse.TableRow(schema, table));
                    }
                }
            }
        }
        return out;
    }

    /**
     * Columns - {@code syscolumns} joined to {@code sysobjects} +
     * {@code systypes}.
     *
     * <p>Group 1 (collation) + Group 2 (computed columns) widen this read
     * (spec 2026-05-31). The enriched query additionally projects:</p>
     * <ul>
     *   <li>{@code collation_name} -- the column's character-set / sort-order
     *       name from {@code syscharsets} via {@code syscolumns.collationid}
     *       (group 1). Verbatim; a Sybase case-insensitive sort order must
     *       reach discovery byte-for-byte for the CI-&gt;CS hazard finding.</li>
     *   <li>{@code col_status2} -- {@code syscolumns.status2}; the computed bit
     *       ({@code 0x10}) is decoded by {@link #isComputedColumnStatus} (group
     *       2).</li>
     *   <li>{@code computed_text} -- the verbatim computed-column expression via
     *       a {@code syscomments} join (group 2).</li>
     * </ul>
     *
     * <p>VERSION-TOLERANT: {@code status2} / {@code collationid} are absent on
     * pre-ASE15 catalogs. The enriched query is attempted; a {@link SQLException}
     * (e.g. unknown column) falls back to the prior bare query so older engines
     * still introspect (the new fields then null-out). Each group's key is added
     * to {@code capabilities} only when the enriched read succeeds.</p>
     *
     * <p>The per-row mapping is delegated to the pure {@link #mapColumnRow}
     * seam; the loop only reads primitives off the {@link ResultSet}.</p>
     */
    private List<IntrospectionResponse.ColumnRow> introspectColumns(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        // Enriched read: collation (group 1) + computed status/text (group 2).
        // cs.name is the sort-order/charset name; syscomments.text is the
        // verbatim computed expression. LEFT JOINs so a non-computed / default-
        // collation column still returns its structural row.
        final String enrichedSql =
                "SELECT u.name AS owner_name, o.name AS table_name, c.name AS column_name, "
                        + "t.name AS data_type, c.length AS max_length, "
                        + "(c.status & 8) AS allow_null, c.colid AS ordinal_pos, "
                        + "cs.name AS collation_name, c.status2 AS col_status2, "
                        + "cmt.text AS computed_text "
                        + "FROM syscolumns c "
                        + "JOIN sysobjects o ON o.id = c.id "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "JOIN systypes t ON t.usertype = c.usertype "
                        + "LEFT JOIN syscharsets cs ON cs.id = c.collationid "
                        + "LEFT JOIN syscomments cmt ON cmt.id = c.id AND cmt.colid2 = c.colid "
                        + "WHERE o.type = 'U' ORDER BY u.name, o.name, c.colid";
        final List<IntrospectionResponse.ColumnRow> enriched = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(enrichedSql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final String collation = rs.getString("collation_name");
                    final Integer status2 = (Integer) rs.getObject("col_status2");
                    final Boolean isComputed = isComputedColumnStatus(status2);
                    // Only surface the expression when the column is computed.
                    final String computedText =
                            Boolean.TRUE.equals(isComputed) ? rs.getString("computed_text") : null;
                    enriched.add(mapColumnRow(
                            schema,
                            table,
                            rs.getString("column_name"),
                            rs.getString("data_type"),
                            rs.getInt("max_length"),
                            rs.getInt("allow_null") != 0,
                            rs.getInt("ordinal_pos"),
                            collation,
                            isComputed,
                            computedText,
                            null   // isIdentity is resolved on the sequence path (group 3)
                    ));
                }
            }
            // Enriched read succeeded -> groups 1 + 2 are surfaced.
            addCapability(capabilities, CAP_COLLATION);
            addCapability(capabilities, CAP_COMPUTED_COLUMNS);
            return enriched;
        } catch (final SQLException e) {
            // Version-tolerant fallback: a pre-ASE15 catalog lacks status2 /
            // collationid. Re-run the prior bare query (collation + computed
            // null-out); do NOT advertise groups 1/2 in capabilities.
            LOG.info("[diag-sidecar] introspect_columns enriched_read_unavailable fallback=bare sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            return this.introspectColumnsBare(conn, includeSchemas, includeTables, timeoutSec);
        }
    }

    /**
     * Bare column read (the pre-enrichment query) used as the version-tolerant
     * fallback when the enriched collation/computed read fails on an older
     * catalog. The enrichment fields null-out; the structural shape is
     * unchanged.
     */
    private List<IntrospectionResponse.ColumnRow> introspectColumnsBare(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS table_name, c.name AS column_name, "
                        + "t.name AS data_type, c.length AS max_length, "
                        + "(c.status & 8) AS allow_null, c.colid AS ordinal_pos "
                        + "FROM syscolumns c "
                        + "JOIN sysobjects o ON o.id = c.id "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "JOIN systypes t ON t.usertype = c.usertype "
                        + "WHERE o.type = 'U' ORDER BY u.name, o.name, c.colid";
        final List<IntrospectionResponse.ColumnRow> out = new ArrayList<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(mapColumnRow(
                            schema,
                            table,
                            rs.getString("column_name"),
                            rs.getString("data_type"),
                            rs.getInt("max_length"),
                            rs.getInt("allow_null") != 0,
                            rs.getInt("ordinal_pos"),
                            null,   // collation        (enriched read unavailable)
                            null,   // isComputed       (enriched read unavailable)
                            null,   // computedExpr     (enriched read unavailable)
                            null    // isIdentity       (group 3, sequence path)
                    ));
                }
            }
        }
        return out;
    }

    /**
     * Keys + indexes - Sybase ASE: {@code sysindexes} for indexes (status
     * bits tell us PK/unique), {@code sysreferences} for FKs.
     *
     * <p>Group 5 (index ordering / clustering) widens the index read and Group
     * 4 (FK referential actions) widens the FK walk (spec 2026-05-31).</p>
     *
     * <p>Index read (group 5): the clustered flag is decoded from the
     * {@code sysindexes.status} bit ({@link #decodeClustered}); the key columns
     * + their ASC/DESC ordering are resolved via {@link #readIndexColumns}
     * ({@code index_col} / {@code index_colorder} builtins), and a verbatim-ish
     * {@code indexDefinition} + {@code indexMethod} are assembled by
     * {@link #buildIndexDefinition}. {@code indexPredicate} is always null (ASE
     * has no filtered / partial indexes).</p>
     *
     * <p>FK walk (group 4): the {@code sysreferences} action codes are decoded
     * to verbatim engine strings via {@link #decodeFkAction}. Classic ASE FKs
     * carry no action (the codes are 0/absent) -- the values null-out
     * version-tolerantly and discovery resolves them to unavailable.</p>
     *
     * <p>Each per-row mapping is delegated to the pure seams {@link #mapIndexRow}
     * / {@link #mapFkRow}; the loops only read primitives off the
     * {@link ResultSet}.</p>
     */
    private List<IntrospectionResponse.KeyRow> introspectKeysAndIndexes(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<String> capabilities
    ) throws SQLException {
        final List<IntrospectionResponse.KeyRow> out = new ArrayList<>();

        final String indexSql =
                "SELECT u.name AS owner_name, o.name AS table_name, "
                        + "i.name AS index_name, i.status AS index_status, "
                        + "i.id AS object_id, i.indid AS index_id "
                        + "FROM sysindexes i "
                        + "JOIN sysobjects o ON o.id = i.id "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "WHERE o.type = 'U' AND i.indid > 0 AND i.indid < 255 "
                        + "ORDER BY u.name, o.name, i.indid";
        boolean indexOrderingSurfaced = false;
        try (PreparedStatement ps = conn.prepareStatement(indexSql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final String indexName = rs.getString("index_name");
                    final int indexStatus = rs.getInt("index_status");
                    final int objectId = rs.getInt("object_id");
                    final int indexId = rs.getInt("index_id");

                    // Group 5: resolve the ordered key columns + ASC/DESC. This
                    // is a best-effort enrichment: if the index-column builtins
                    // are unavailable on the engine the read null-outs and the
                    // index still returns with empty ordering metadata.
                    final IndexColumns ic = this.readIndexColumns(
                            conn, objectId, indexId, indexName, timeoutSec);
                    final boolean clustered = decodeClustered(indexStatus);
                    final boolean unique = (indexStatus & 2) != 0 || (indexStatus & 2048) != 0;
                    final String indexDefinition = ic.columns().isEmpty()
                            ? null
                            : buildIndexDefinition(
                                    indexName, table, clustered, unique, ic.columns(), ic.directions());
                    final String indexMethod = clustered ? "clustered" : "nonclustered";
                    if (!ic.columns().isEmpty()) {
                        indexOrderingSurfaced = true;
                    }

                    out.add(mapIndexRow(
                            schema,
                            table,
                            indexName,
                            indexStatus,
                            ic.columns(),
                            indexDefinition,
                            indexMethod,
                            ic.directions().isEmpty() ? null : ic.directions(),
                            null   // isClusteredOverride: use the status-bit decode
                    ));
                }
            }
        }
        // Group 5 is surfaced when at least the clustered/method decode ran for
        // the index set (the method is always derivable from the status bit).
        addCapability(capabilities, CAP_INDEX_CLUSTERING);

        // FK walk (group 4). The action codes live on sysreferences in ASE15.7+
        // (often 0/absent on classic ASE). Attempt the enriched read; fall back
        // to the bare FK walk (actions null-out) on any SQLException.
        final boolean fkActionsSurfaced =
                this.introspectForeignKeys(conn, includeSchemas, includeTables, timeoutSec, out);
        if (fkActionsSurfaced) {
            addCapability(capabilities, CAP_FK_ACTIONS);
        }
        return out;
    }

    /**
     * FK walk (group 4). Appends foreign-key {@link IntrospectionResponse.KeyRow}
     * rows to {@code out}. Returns {@code true} when the enriched action-code
     * read succeeded (so the caller advertises {@code fk_actions}); returns
     * {@code false} when it fell back to the bare FK walk (actions null-out).
     */
    private boolean introspectForeignKeys(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<IntrospectionResponse.KeyRow> out
    ) throws SQLException {
        // Enriched: project the referential action codes. ASE15.7+ exposes them
        // on sysreferences; column naming varies, so a SQLException here is the
        // version-tolerance trigger to fall back to the bare walk.
        final String enrichedFkSql =
                "SELECT ut.name AS owner_name, ot.name AS table_name, "
                        + "ur.name AS ref_owner, orf.name AS ref_table, "
                        + "r.constrid AS constr_id, "
                        + "r.deleteaction AS delete_action, r.updateaction AS update_action "
                        + "FROM sysreferences r "
                        + "JOIN sysobjects ot ON ot.id = r.tableid "
                        + "JOIN sysusers ut ON ut.uid = ot.uid "
                        + "JOIN sysobjects orf ON orf.id = r.reftabid "
                        + "JOIN sysusers ur ON ur.uid = orf.uid "
                        + "ORDER BY ut.name, ot.name";
        try (PreparedStatement ps = conn.prepareStatement(enrichedFkSql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final Integer deleteCode = (Integer) rs.getObject("delete_action");
                    final Integer updateCode = (Integer) rs.getObject("update_action");
                    out.add(mapFkRow(
                            schema,
                            table,
                            "fk_" + rs.getInt("constr_id"),
                            Collections.emptyList(),   // columns (FK column walk is a later enrichment)
                            rs.getString("ref_owner"),
                            rs.getString("ref_table"),
                            Collections.emptyList(),   // referencedColumns
                            decodeFkAction(updateCode),
                            decodeFkAction(deleteCode)
                    ));
                }
            }
            return true;
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] introspect_fk enriched_read_unavailable fallback=bare sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            this.introspectForeignKeysBare(conn, includeSchemas, includeTables, timeoutSec, out);
            return false;
        }
    }

    /**
     * Bare FK walk (the pre-enrichment query) -- the version-tolerant fallback
     * when the action-code columns are absent on an older catalog. The
     * referential actions null-out.
     */
    private void introspectForeignKeysBare(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final List<IntrospectionResponse.KeyRow> out
    ) throws SQLException {
        final String fkSql =
                "SELECT ut.name AS owner_name, ot.name AS table_name, "
                        + "ur.name AS ref_owner, orf.name AS ref_table, "
                        + "r.constrid AS constr_id "
                        + "FROM sysreferences r "
                        + "JOIN sysobjects ot ON ot.id = r.tableid "
                        + "JOIN sysusers ut ON ut.uid = ot.uid "
                        + "JOIN sysobjects orf ON orf.id = r.reftabid "
                        + "JOIN sysusers ur ON ur.uid = orf.uid "
                        + "ORDER BY ut.name, ot.name";
        try (PreparedStatement ps = conn.prepareStatement(fkSql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    out.add(mapFkRow(
                            schema,
                            table,
                            "fk_" + rs.getInt("constr_id"),
                            Collections.emptyList(),
                            rs.getString("ref_owner"),
                            rs.getString("ref_table"),
                            Collections.emptyList(),
                            null,   // updateRule (action codes unavailable)
                            null    // deleteRule (action codes unavailable)
                    ));
                }
            }
        }
    }

    /**
     * Group 5: resolve an index's ordered key columns + their ASC/DESC
     * directions using the ASE {@code index_col} / {@code index_colorder}
     * builtins (1-based key position). Best-effort + version-tolerant: any
     * {@link SQLException} (builtin unavailable / unexpected) returns an empty
     * {@link IndexColumns} so the index row still surfaces with no ordering
     * metadata rather than failing the whole introspection.
     *
     * <p>{@code index_col(object_name, indid, key#)} returns the key column
     * name; {@code index_colorder(...)} returns {@code 'ASC'} / {@code 'DESC'}.
     * We walk key positions until {@code index_col} returns null.</p>
     */
    private IndexColumns readIndexColumns(
            final Connection conn,
            final int objectId,
            final int indexId,
            final String indexName,
            final int timeoutSec
    ) {
        final List<String> columns = new ArrayList<>();
        final List<String> directions = new ArrayList<>();
        // object_name(id) resolves the (owner-qualified-by-context) table name
        // index_col expects; we pass the object id through object_name so the
        // builtin keys on the same object the catalog row referenced.
        final String sql =
                "SELECT index_col(object_name(?), ?, ?) AS col_name, "
                        + "index_colorder(object_name(?), ?, ?) AS col_order";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            // ASE indexes carry up to 31 key columns; cap the walk defensively.
            for (int key = 1; key <= 31; key++) {
                ps.setInt(1, objectId);
                ps.setInt(2, indexId);
                ps.setInt(3, key);
                ps.setInt(4, objectId);
                ps.setInt(5, indexId);
                ps.setInt(6, key);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        break;
                    }
                    final String colName = rs.getString("col_name");
                    if (colName == null || colName.isEmpty()) {
                        break;
                    }
                    columns.add(colName);
                    final String order = rs.getString("col_order");
                    // Normalise to ASC/DESC; default ASC when the builtin is
                    // silent (ASE indexes default to ascending key order).
                    directions.add(order != null && order.toUpperCase().startsWith("DESC")
                            ? "DESC" : "ASC");
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] index_col_walk unavailable index={} sqlstate={}",
                    indexName, e.getSQLState() == null ? "?" : e.getSQLState());
            return new IndexColumns(Collections.emptyList(), Collections.emptyList());
        }
        return new IndexColumns(columns, directions);
    }

    /**
     * Group 3: sequences + identity generators (spec 2026-05-31).
     *
     * <p>Two sources feed the {@code sequences[]} array:</p>
     * <ol>
     *   <li>IDENTITY columns ({@code syscolumns.status & 0x80}) are synthesized
     *       into the {@code sequences[]} shape per {@link #synthesizeIdentitySequenceRow}
     *       (decision 7). The current value is resolved cheap-path-first via
     *       {@link #resolveCurrentValue}: {@code ident_current()} (catalog
     *       high-water) and, ONLY when that is null, a {@code MAX(<col>)} SCAN
     *       fallback (a DATA read -- see {@link #readMaxIdentityValue}).</li>
     *   <li>Native ASE16 {@code SEQUENCE} objects are read from the SEQUENCE
     *       catalog, VERSION-BRANCHED on {@link #supportsNativeSequenceCatalog}
     *       so a pre-ASE16 / absent catalog null-outs rather than hard-errors.</li>
     * </ol>
     */
    private List<IntrospectionResponse.SequenceRow> introspectSequences(
            final Connection conn,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int timeoutSec,
            final String serverVersion,
            final List<String> capabilities
    ) throws SQLException {
        final List<IntrospectionResponse.SequenceRow> out = new ArrayList<>();

        // (1) IDENTITY columns -> synthesized sequences. status & 0x80 = identity.
        final String identitySql =
                "SELECT u.name AS owner_name, o.name AS table_name, c.name AS column_name, "
                        + "t.name AS data_type "
                        + "FROM syscolumns c "
                        + "JOIN sysobjects o ON o.id = c.id "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "JOIN systypes t ON t.usertype = c.usertype "
                        + "WHERE o.type = 'U' AND (c.status & 128) <> 0 "
                        + "ORDER BY u.name, o.name, c.colid";
        boolean surfacedAny = false;
        try (PreparedStatement ps = conn.prepareStatement(identitySql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    final String table = rs.getString("table_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)
                            || !matchesTableFilter(table, includeTables)) {
                        continue;
                    }
                    final String column = rs.getString("column_name");
                    final String dataType = rs.getString("data_type");
                    // Cheap path first: ident_current() catalog high-water.
                    final String cheap = this.readIdentCurrent(conn, schema, table, timeoutSec);
                    // MAX(col) SCAN FALLBACK only when the cheap value is null.
                    // NB this is a DATA read whose cost is PROPORTIONAL TO TABLE
                    // SIZE; it is strictly conditional on a null cheap value.
                    final String scan = shouldScanForCurrentValue(cheap)
                            ? this.readMaxIdentityValue(conn, schema, table, column, timeoutSec)
                            : null;
                    final String currentValue = resolveCurrentValue(cheap, scan);
                    out.add(synthesizeIdentitySequenceRow(schema, table, column, dataType, currentValue));
                    surfacedAny = true;
                }
            }
        }

        // (2) Native ASE16 SEQUENCE objects -- version-branched (decision 4).
        if (supportsNativeSequenceCatalog(serverVersion)) {
            try {
                this.introspectNativeSequences(conn, includeSchemas, timeoutSec, out);
                surfacedAny = true;
            } catch (final SQLException e) {
                // Defensive: even when the version string says ASE16, a missing
                // SEQUENCE catalog null-outs rather than aborting introspection.
                LOG.info("[diag-sidecar] native_sequence_read unavailable sqlstate={}",
                        e.getSQLState() == null ? "?" : e.getSQLState());
            }
        }

        if (surfacedAny) {
            addCapability(capabilities, CAP_SEQUENCE_CURRENT_VALUE);
        }
        return out;
    }

    /**
     * Read native ASE16 {@code SEQUENCE} objects. ASE exposes user sequences as
     * {@code sysobjects.type = 'SO'}; the current value is read via the
     * sequence's {@code current value} accessor where available. Best-effort:
     * the caller version-branches the invocation and swallows a missing-catalog
     * {@link SQLException}.
     */
    private void introspectNativeSequences(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec,
            final List<IntrospectionResponse.SequenceRow> out
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS sequence_name "
                        + "FROM sysobjects o "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "WHERE o.type = 'SO' "
                        + "ORDER BY u.name, o.name";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final String name = rs.getString("sequence_name");
                    // A real SEQUENCE is not owned by a single table/column.
                    out.add(new IntrospectionResponse.SequenceRow(
                            schema, name, null, null, null, null, null, null,
                            null,   // currentValue: detailed read is a later enrichment
                            null,   // ownedByTable
                            null,   // ownedByColumn
                            null    // definition
                    ));
                }
            }
        }
    }

    /**
     * Group 3 cheap path: read the IDENTITY allocation high-water via the ASE
     * {@code ident_current('<table>')} builtin (a CATALOG read -- no table
     * scan). Best-effort; any {@link SQLException} returns null so the caller
     * falls back to the {@code MAX(col)} scan.
     */
    private String readIdentCurrent(
            final Connection conn,
            final String schema,
            final String table,
            final int timeoutSec
    ) {
        final String sql = "SELECT convert(varchar(64), ident_current(?)) AS cur";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            ps.setString(1, schema + "." + table);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return rs.getString("cur");
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] ident_current unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        return null;
    }

    /**
     * Group 3 SCAN FALLBACK: {@code SELECT MAX(<identity_col>) FROM <table>}.
     *
     * <p>WARNING: this is a DATA read, NOT a catalog read. Its cost is
     * PROPORTIONAL TO TABLE SIZE (a full scan / index max). It runs on the
     * {@code /introspect} path under the per-request read-only connection +
     * per-query timeout, and is invoked ONLY when the cheap
     * {@code ident_current()} path returned null (see
     * {@link #shouldScanForCurrentValue}). Best-effort: a {@link SQLException}
     * returns null (the cutover finding is then marked value-unavailable).</p>
     *
     * <p>The identifiers are quoted; they originate from the ASE catalog
     * ({@code syscolumns} / {@code sysobjects}) and are not caller-supplied, so
     * this is a controlled internal read on the already-guarded introspection
     * connection.</p>
     */
    private String readMaxIdentityValue(
            final Connection conn,
            final String schema,
            final String table,
            final String column,
            final int timeoutSec
    ) {
        final String sql = "SELECT convert(varchar(64), MAX(" + quoteIdent(column) + ")) AS hi "
                + "FROM " + quoteIdent(schema) + "." + quoteIdent(table);
        try (Statement st = conn.createStatement()) {
            if (timeoutSec > 0) {
                st.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = st.executeQuery(sql)) {
                if (rs.next()) {
                    return rs.getString("hi");
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] max_identity_scan unavailable table={} sqlstate={}",
                    table, e.getSQLState() == null ? "?" : e.getSQLState());
        }
        return null;
    }

    /**
     * Group 6: DB-resident scheduled jobs (spec 2026-05-31, decision 8). Reads
     * the Sybase Job Scheduler via the read-only base tables in
     * {@code sybmgmtdb} ({@code js_jobs} / {@code js_scheduledjobs} +
     * {@code js_schedules}). These are SELECT-only base-table reads issued as
     * {@link PreparedStatement}s on the introspection connection; the
     * companion read-only proc allowlist is documented in {@link SidecarSqlGuard}.
     *
     * <p>Best-effort + version-tolerant: the Job Scheduler is optional on ASE
     * (the {@code sybmgmtdb} catalog may be absent / the user may lack access),
     * so any {@link SQLException} returns an empty list and the group is NOT
     * advertised in {@code capabilities} -- discovery then resolves it to
     * unavailable rather than fabricating an empty "no jobs" result.</p>
     */
    private List<IntrospectionResponse.ScheduledJobRow> introspectScheduledJobs(
            final Connection conn,
            final int timeoutSec,
            final List<String> capabilities
    ) {
        final List<IntrospectionResponse.ScheduledJobRow> out = new ArrayList<>();
        // js_jobs: the job definition (name + command). js_scheduledjobs joins
        // a job to its schedule; js_schedules carries the schedule expression.
        // LEFT JOINs so an unscheduled (manual) job still surfaces.
        final String sql =
                "SELECT j.name AS job_name, j.command AS job_command, "
                        + "s.name AS schedule_name, j.enabled AS job_enabled "
                        + "FROM sybmgmtdb..js_jobs j "
                        + "LEFT JOIN sybmgmtdb..js_scheduledjobs sj ON sj.jobid = j.id "
                        + "LEFT JOIN sybmgmtdb..js_schedules s ON s.id = sj.schedid "
                        + "ORDER BY j.name";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final Object enabledObj = rs.getObject("job_enabled");
                    final Boolean enabled = enabledObj == null
                            ? null
                            : ((Number) enabledObj).intValue() != 0;
                    out.add(mapScheduledJobRow(
                            null,   // schemaName: Job Scheduler jobs are server-scoped
                            rs.getString("job_name"),
                            "sybase_job_scheduler",
                            rs.getString("schedule_name"),
                            rs.getString("job_command"),
                            enabled
                    ));
                }
            }
            addCapability(capabilities, CAP_SCHEDULED_JOBS);
        } catch (final SQLException e) {
            // Job Scheduler absent / inaccessible -> not surfaced (unavailable).
            LOG.info("[diag-sidecar] job_scheduler_read unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            return Collections.emptyList();
        }
        return out;
    }

    /**
     * Group 1: the DB-level default collation / sort order (spec 2026-05-31).
     * A single BASE-CATALOG read; NO {@code sp_helpsort}. ASE stores the
     * server's default sort-order id in {@code master.dbo.sysconfigures}; the
     * name resolves via {@code master.dbo.syscharsets}. Best-effort: any
     * {@link SQLException} (config row absent / no access) null-outs and the
     * group is not advertised by this read (the per-column collation on the
     * column rows is the primary signal and advertises {@code collation}).
     */
    private String readDatabaseCollation(
            final Connection conn,
            final int timeoutSec,
            final List<String> capabilities
    ) {
        // 'default sortorder id' is config 123 historically; match by name to be
        // version-tolerant rather than depending on the numeric config id.
        final String sql =
                "SELECT cs.name AS sort_order "
                        + "FROM master.dbo.syscharsets cs "
                        + "JOIN master.dbo.sysconfigures cf ON cf.value = cs.id "
                        + "WHERE cf.name = 'default sortorder id'";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    final String name = rs.getString("sort_order");
                    if (name != null && !name.isBlank()) {
                        addCapability(capabilities, CAP_COLLATION);
                        return name;
                    }
                }
            }
        } catch (final SQLException e) {
            LOG.info("[diag-sidecar] database_collation_read unavailable sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
        }
        return null;
    }

    /**
     * Views - {@code sysobjects.type = 'V'}. Body extracted from
     * {@code syscomments}. Trimmed to {@link #MAX_SNIPPET_CHARS}.
     */
    private List<IntrospectionResponse.ViewRow> introspectViews(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS view_name, "
                        + "c.text AS definition_text, c.colid AS frag_id "
                        + "FROM sysobjects o "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "JOIN syscomments c ON c.id = o.id "
                        + "WHERE o.type = 'V' "
                        + "ORDER BY u.name, o.name, c.colid";
        final Map<String, StringBuilder> assembledBodies = new LinkedHashMap<>();
        final Map<String, IntrospectionResponse.ViewRow> rowByKey = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final String name = rs.getString("view_name");
                    final String key = schema + "." + name;
                    final String text = rs.getString("definition_text");
                    final StringBuilder buf = assembledBodies.computeIfAbsent(key, k -> new StringBuilder());
                    if (buf.length() < MAX_SNIPPET_CHARS && text != null) {
                        buf.append(text);
                    }
                    rowByKey.computeIfAbsent(key, k -> new IntrospectionResponse.ViewRow(schema, name, "", false));
                }
            }
        }
        final List<IntrospectionResponse.ViewRow> out = new ArrayList<>();
        for (final Map.Entry<String, IntrospectionResponse.ViewRow> e : rowByKey.entrySet()) {
            final StringBuilder buf = assembledBodies.get(e.getKey());
            final String body = buf == null ? "" : trimSnippet(buf.toString());
            final IntrospectionResponse.ViewRow row = e.getValue();
            out.add(new IntrospectionResponse.ViewRow(row.schemaName(), row.viewName(), body, false));
        }
        return out;
    }

    /**
     * Procedures - {@code sysobjects.type = 'P'}.
     */
    private List<IntrospectionResponse.ProcedureRow> introspectProcedures(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS proc_name, "
                        + "c.text AS definition_text, c.colid AS frag_id "
                        + "FROM sysobjects o "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "JOIN syscomments c ON c.id = o.id "
                        + "WHERE o.type = 'P' "
                        + "ORDER BY u.name, o.name, c.colid";
        final Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        final Map<String, IntrospectionResponse.ProcedureRow> rowByKey = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final String name = rs.getString("proc_name");
                    final String key = schema + "." + name;
                    final StringBuilder buf = bodies.computeIfAbsent(key, k -> new StringBuilder());
                    final String text = rs.getString("definition_text");
                    if (buf.length() < MAX_SNIPPET_CHARS && text != null) {
                        buf.append(text);
                    }
                    rowByKey.computeIfAbsent(key, k -> new IntrospectionResponse.ProcedureRow(
                            schema, name, "procedure", "", "TSQL"
                    ));
                }
            }
        }
        final List<IntrospectionResponse.ProcedureRow> out = new ArrayList<>();
        for (final Map.Entry<String, IntrospectionResponse.ProcedureRow> e : rowByKey.entrySet()) {
            final StringBuilder buf = bodies.get(e.getKey());
            final String body = buf == null ? "" : trimSnippet(buf.toString());
            final IntrospectionResponse.ProcedureRow row = e.getValue();
            out.add(new IntrospectionResponse.ProcedureRow(
                    row.schemaName(),
                    row.procedureName(),
                    row.routineKind(),
                    body,
                    row.language()
            ));
        }
        return out;
    }

    /**
     * Triggers - {@code sysobjects.type = 'TR'}. Body via syscomments.
     */
    private List<IntrospectionResponse.TriggerRow> introspectTriggers(
            final Connection conn,
            final List<String> includeSchemas,
            final int timeoutSec
    ) throws SQLException {
        final String sql =
                "SELECT u.name AS owner_name, o.name AS trigger_name, "
                        + "c.text AS definition_text, c.colid AS frag_id "
                        + "FROM sysobjects o "
                        + "JOIN sysusers u ON u.uid = o.uid "
                        + "LEFT JOIN syscomments c ON c.id = o.id "
                        + "WHERE o.type = 'TR' "
                        + "ORDER BY u.name, o.name, c.colid";
        final Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        final Map<String, IntrospectionResponse.TriggerRow> rowByKey = new LinkedHashMap<>();
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            if (timeoutSec > 0) {
                ps.setQueryTimeout(timeoutSec);
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    final String schema = rs.getString("owner_name");
                    if (!matchesSchemaFilter(schema, includeSchemas)) {
                        continue;
                    }
                    final String name = rs.getString("trigger_name");
                    final String key = schema + "." + name;
                    final StringBuilder buf = bodies.computeIfAbsent(key, k -> new StringBuilder());
                    final String text = rs.getString("definition_text");
                    if (buf.length() < MAX_SNIPPET_CHARS && text != null) {
                        buf.append(text);
                    }
                    rowByKey.computeIfAbsent(key, k -> new IntrospectionResponse.TriggerRow(
                            schema, name, schema, "", "after", Collections.emptyList(), ""
                    ));
                }
            }
        }
        final List<IntrospectionResponse.TriggerRow> out = new ArrayList<>();
        for (final Map.Entry<String, IntrospectionResponse.TriggerRow> e : rowByKey.entrySet()) {
            final StringBuilder buf = bodies.get(e.getKey());
            final String body = buf == null ? "" : trimSnippet(buf.toString());
            final IntrospectionResponse.TriggerRow row = e.getValue();
            out.add(new IntrospectionResponse.TriggerRow(
                    row.schemaName(),
                    row.triggerName(),
                    row.tableSchema(),
                    row.tableName(),
                    "after",
                    mapTriggerEvents(body),
                    body
            ));
        }
        return out;
    }

    // ------------------------------------------------------------------
    // Pure per-row mappers (unit-test surface -- primitives in, record out)
    //
    // Spec 2026-05-31 (Sybase metadata enrichment). These take primitive row
    // inputs (NOT a live JDBC ResultSet) so SybaseQueryServiceTest can cover
    // the catalog-row -> IntrospectionResponse record mapping + the identity
    // synthesis + the version-branch null-out behaviour without a live DB.
    // The JDBC loops above are thin "read row -> call mapper" shells. These
    // methods change NO query behaviour -- they only relocate the mapping seam.
    // ------------------------------------------------------------------

    /**
     * Map a single {@code syscolumns} row to a {@link IntrospectionResponse.ColumnRow}.
     * The enrichment fields ({@code collation}, {@code isComputed},
     * {@code computedExpression}, {@code isIdentity}) are passed through
     * verbatim; pass null when the (Group 1) query does not yet project them.
     */
    static IntrospectionResponse.ColumnRow mapColumnRow(
            final String schemaName,
            final String tableName,
            final String columnName,
            final String dataType,
            final int maxLength,
            final boolean isNullable,
            final int ordinalPosition,
            final String collation,
            final Boolean isComputed,
            final String computedExpression,
            final Boolean isIdentity
    ) {
        return new IntrospectionResponse.ColumnRow(
                schemaName,
                tableName,
                columnName,
                dataType,
                maxLength,
                isNullable,
                ordinalPosition,
                collation,
                isComputed,
                computedExpression,
                isIdentity
        );
    }

    /**
     * Decode the ASE {@code syscolumns.status2} computed-column bit
     * ({@code 0x10}) into a nullable {@link Boolean} (group 2). Version-tolerant:
     * a {@code null} status2 (older catalog that does not surface the column)
     * decodes to {@code null} (UNKNOWN) -- distinct from an explicit
     * {@code false} -- so discovery never misreads "couldn't tell" as
     * "definitely not computed".
     */
    static Boolean isComputedColumnStatus(final Integer status2) {
        if (status2 == null) {
            return null;
        }
        return (status2 & 16) != 0;
    }

    /**
     * Decode an ASE {@code sysreferences} referential-action code into a
     * verbatim engine string (group 4). Version-tolerant: a {@code null} or
     * {@code 0} code (classic ASE FKs carry no action -- CASCADE is ASE15.7+)
     * and any unknown / out-of-range code null-out rather than guessing, so
     * discovery resolves the absent action to {@code unavailable}.
     *
     * <ul>
     *   <li>{@code 1} -&gt; {@code CASCADE}</li>
     *   <li>{@code 2} -&gt; {@code SET NULL}</li>
     *   <li>{@code 3} -&gt; {@code SET DEFAULT}</li>
     *   <li>{@code 4} -&gt; {@code NO ACTION} (a.k.a. RESTRICT)</li>
     * </ul>
     */
    static String decodeFkAction(final Integer code) {
        if (code == null) {
            return null;
        }
        switch (code) {
            case 1:
                return "CASCADE";
            case 2:
                return "SET NULL";
            case 3:
                return "SET DEFAULT";
            case 4:
                return "NO ACTION";
            default:
                // 0 = "no action recorded" + any unknown code -> null-out.
                return null;
        }
    }

    /**
     * Decode a Sybase {@code sysindexes.status} bitmask into the normalised
     * key/index {@code kind}. Pure: this is the status-bit decode lifted out of
     * the index loop so it is unit-testable on raw {@code int} inputs.
     *
     * <ul>
     *   <li>{@code status & 2}    -&gt; unique</li>
     *   <li>{@code status & 2048} -&gt; primary key</li>
     * </ul>
     */
    static String mapKeyIndexKind(final int indexStatus) {
        final boolean isUnique = (indexStatus & 2) != 0;
        final boolean isPk = (indexStatus & 2048) != 0;
        if (isPk) {
            return "primary_key";
        }
        return isUnique ? "unique_constraint" : "index";
    }

    /**
     * TRUE when a Sybase {@code sysindexes.status} bitmask denotes a CLUSTERED
     * index. Pure decode (bit {@code 16} is the clustered marker in ASE
     * {@code sysindexes.status}). Group 5 uses this to populate
     * {@link IntrospectionResponse.KeyRow#isClustered()}.
     */
    static boolean decodeClustered(final int indexStatus) {
        return (indexStatus & 16) != 0;
    }

    /**
     * Group 5: assemble a verbatim-ish index definition from the decoded parts
     * (name + table + clustered/unique flags + ordered columns with ASC/DESC).
     * Pure: lets {@code SybaseQueryServiceTest} assert the ordering text without
     * a live catalog. ASE renders e.g.
     * {@code CREATE UNIQUE CLUSTERED INDEX ix ON t (a ASC, b DESC)}.
     *
     * @param directions per-column ASC/DESC aligned to {@code columns}; when
     *        shorter than {@code columns}, the missing entries default to ASC.
     */
    static String buildIndexDefinition(
            final String indexName,
            final String tableName,
            final boolean clustered,
            final boolean unique,
            final List<String> columns,
            final List<String> directions
    ) {
        final StringBuilder sb = new StringBuilder("CREATE ");
        if (unique) {
            sb.append("UNIQUE ");
        }
        sb.append(clustered ? "CLUSTERED " : "NONCLUSTERED ");
        sb.append("INDEX ").append(indexName).append(" ON ").append(tableName).append(" (");
        final List<String> cols = columns == null ? Collections.emptyList() : columns;
        final List<String> dirs = directions == null ? Collections.emptyList() : directions;
        for (int i = 0; i < cols.size(); i++) {
            if (i > 0) {
                sb.append(", ");
            }
            final String dir = i < dirs.size() && dirs.get(i) != null ? dirs.get(i) : "ASC";
            sb.append(cols.get(i)).append(' ').append(dir);
        }
        sb.append(')');
        return sb.toString();
    }

    /**
     * Map a single {@code sysindexes} row to a {@link IntrospectionResponse.KeyRow}.
     * The {@code kind}, {@code isUnique}, and (by default) {@code isClustered}
     * are derived from the status bitmask via {@link #mapKeyIndexKind} /
     * {@link #decodeClustered}; the group-5 ordering fields
     * ({@code indexDefinition}, {@code indexMethod}, {@code columnDirections})
     * are passed through verbatim (null until Group 5 projects them).
     * {@code indexPredicate} is ALWAYS null for ASE (no filtered / partial
     * indexes -- discovery resolves it to {@code not_applicable_for_engine}).
     *
     * @param isClusteredOverride when non-null, overrides the status-bit
     *        clustered decode (lets a future query pass an explicit value);
     *        when null the {@link #decodeClustered} bit decode is used.
     */
    static IntrospectionResponse.KeyRow mapIndexRow(
            final String schemaName,
            final String tableName,
            final String indexName,
            final int indexStatus,
            final List<String> columns,
            final String indexDefinition,
            final String indexMethod,
            final List<String> columnDirections,
            final Boolean isClusteredOverride
    ) {
        final String kind = mapKeyIndexKind(indexStatus);
        final boolean isUnique = (indexStatus & 2) != 0;
        final boolean isPk = (indexStatus & 2048) != 0;
        final Boolean isClustered =
                isClusteredOverride != null ? isClusteredOverride : decodeClustered(indexStatus);
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                kind,
                indexName,
                columns,
                null,
                null,
                null,
                isUnique || isPk,
                null,               // updateRule  (FK-only; null for index rows)
                null,               // deleteRule  (FK-only; null for index rows)
                indexDefinition,
                indexMethod,
                isClustered,
                null,               // indexPredicate (ASE has no partial indexes)
                columnDirections
        );
    }

    /**
     * Map a single {@code sysreferences} FK-walk row to a foreign-key
     * {@link IntrospectionResponse.KeyRow}. Pure: lifted out of the
     * {@code sysreferences} loop. The group-4 referential actions
     * ({@code updateRule} / {@code deleteRule}) are passed through verbatim
     * (null until Group 2 projects them -- classic ASE FKs are often
     * RESTRICT / NO ACTION, and CASCADE is ASE15.7+, so the value is
     * version-tolerant and may legitimately be null).
     */
    static IntrospectionResponse.KeyRow mapFkRow(
            final String schemaName,
            final String tableName,
            final String name,
            final List<String> columns,
            final String referencedSchema,
            final String referencedTable,
            final List<String> referencedColumns,
            final String updateRule,
            final String deleteRule
    ) {
        return new IntrospectionResponse.KeyRow(
                schemaName,
                tableName,
                "foreign_key",
                name,
                columns,
                referencedSchema,
                referencedTable,
                referencedColumns,
                false,
                updateRule,
                deleteRule,
                null,   // indexDefinition  (FK rows carry no index-ordering metadata)
                null,   // indexMethod
                null,   // isClustered
                null,   // indexPredicate
                null    // columnDirections
        );
    }

    /**
     * Synthesize a {@link IntrospectionResponse.SequenceRow} for a Sybase
     * IDENTITY column (decision 7). The synthesized {@code sequenceName} is
     * {@code "<table>.<col> (identity)"} with {@code ownedByTable} /
     * {@code ownedByColumn} set, so the discovery-side
     * {@code sequence_cutover_hazard} Finding fires unchanged. {@code currentValue}
     * is the allocation high-water mark already resolved by the caller (cheap
     * path, then a {@code MAX(col)} scan fallback -- Group 3); pass null when it
     * could not be read. Pure: no DB access here.
     */
    static IntrospectionResponse.SequenceRow synthesizeIdentitySequenceRow(
            final String schemaName,
            final String tableName,
            final String columnName,
            final String dataType,
            final String currentValue
    ) {
        final String sequenceName = tableName + "." + columnName + " (identity)";
        return new IntrospectionResponse.SequenceRow(
                schemaName,
                sequenceName,
                dataType,
                null,           // startValue
                null,           // increment
                null,           // minValue
                null,           // maxValue
                null,           // cycle
                currentValue,
                tableName,      // ownedByTable
                columnName,     // ownedByColumn
                null            // definition
        );
    }

    /**
     * Group 3 selection: resolve the IDENTITY/sequence current value
     * cheap-path-first. Returns the cheap-path value when it is present
     * (non-blank); otherwise returns the {@code MAX(col)} scan value (which may
     * itself be null when the table is empty). Pure: the selection logic is
     * unit-tested without a live scan.
     */
    static String resolveCurrentValue(final String cheapValue, final String scanValue) {
        if (cheapValue != null && !cheapValue.isBlank()) {
            return cheapValue;
        }
        return scanValue;
    }

    /**
     * Group 3 gate: TRUE when the cheap-path current value is absent (null /
     * blank) and the caller MUST therefore fall back to the {@code MAX(col)}
     * scan. Pure: this is the predicate the JDBC fallback consults so the
     * (table-size-proportional) scan runs ONLY when strictly necessary.
     */
    static boolean shouldScanForCurrentValue(final String cheapValue) {
        return cheapValue == null || cheapValue.isBlank();
    }

    /**
     * Group 3 / decision 4: TRUE when the engine version string denotes ASE16
     * or newer, where the native {@code SEQUENCE} catalog exists. Pre-ASE16 /
     * absent / unparseable version strings return false so the native-sequence
     * read is SKIPPED (null-out) rather than hard-erroring against a catalog
     * object that does not exist on the older engine. Pure: parses the major
     * version out of the ASE {@code @@version} string
     * (e.g. {@code "Adaptive Server Enterprise/16.0 SP03"}).
     */
    static boolean supportsNativeSequenceCatalog(final String serverVersion) {
        if (serverVersion == null) {
            return false;
        }
        // Match the first "/<major>" or bare leading major in the version text.
        final Matcher m = Pattern.compile("(\\d+)(?:\\.\\d+)?").matcher(serverVersion);
        if (m.find()) {
            try {
                return Integer.parseInt(m.group(1)) >= 16;
            } catch (final NumberFormatException ignored) {
                return false;
            }
        }
        return false;
    }

    /**
     * Map a single Job-Scheduler row to a
     * {@link IntrospectionResponse.ScheduledJobRow} (group 6). Pure: primitives
     * in, record out. The scheduler label / schedule / command are verbatim.
     */
    static IntrospectionResponse.ScheduledJobRow mapScheduledJobRow(
            final String schemaName,
            final String jobName,
            final String scheduler,
            final String schedule,
            final String command,
            final Boolean enabled
    ) {
        return new IntrospectionResponse.ScheduledJobRow(
                schemaName,
                jobName,
                scheduler,
                schedule,
                command,
                enabled
        );
    }

    /**
     * Infer the trigger DML events ({@code insert} / {@code update} /
     * {@code delete}) from a trigger body. Pure: lifted out of the trigger loop
     * so it is unit-testable on a raw body string.
     */
    static List<String> mapTriggerEvents(final String body) {
        final List<String> events = new ArrayList<>();
        final String text = body == null ? "" : body;
        if (Pattern.compile("\\bINSERT\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) {
            events.add("insert");
        }
        if (Pattern.compile("\\bUPDATE\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) {
            events.add("update");
        }
        if (Pattern.compile("\\bDELETE\\b", Pattern.CASE_INSENSITIVE).matcher(text).find()) {
            events.add("delete");
        }
        return events;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Append a capability key to the list if not already present (the same
     * group key can be advertised from more than one read path -- e.g.
     * {@code collation} from both the per-column read and the DB-level read).
     */
    private static void addCapability(final List<String> capabilities, final String key) {
        if (capabilities != null && !capabilities.contains(key)) {
            capabilities.add(key);
        }
    }

    /**
     * Quote a Sybase identifier with brackets, escaping any embedded closing
     * bracket. Used only for the internal {@code MAX(col)} scan whose
     * identifiers come from the ASE catalog (not caller input).
     */
    private static String quoteIdent(final String ident) {
        if (ident == null) {
            return "[]";
        }
        return "[" + ident.replace("]", "]]") + "]";
    }

    /**
     * Returns true if the given name passes the include filter (or the
     * filter is empty / null, which means "no filter").
     */
    static boolean matchesSchemaFilter(final String name, final List<String> include) {
        if (include == null || include.isEmpty()) {
            return true;
        }
        for (final String s : include) {
            if (s != null && s.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Like {@link #matchesSchemaFilter} but for table names. Empty filter
     * means "no filter".
     */
    static boolean matchesTableFilter(final String name, final List<String> include) {
        if (include == null || include.isEmpty()) {
            return true;
        }
        for (final String t : include) {
            if (t != null && t.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Trim a snippet to {@link #MAX_SNIPPET_CHARS}.
     */
    private static String trimSnippet(final String body) {
        if (body == null) {
            return "";
        }
        if (body.length() <= MAX_SNIPPET_CHARS) {
            return body;
        }
        return body.substring(0, MAX_SNIPPET_CHARS) + "...[truncated]";
    }

    /**
     * Mask the password substring out of an error message before returning
     * it to the client.
     */
    public String maskPassword(final String message, final String password) {
        if (message == null) {
            return "";
        }
        if (password == null || password.isEmpty()) {
            return message;
        }
        return message.replace(password, "***");
    }

    /**
     * Close a JDBC connection swallowing any exception.
     */
    private void closeQuietly(final Connection conn) {
        if (conn == null) {
            return;
        }
        try {
            conn.close();
        } catch (final SQLException ignored) {
            // not fatal - the connection will be reaped by GC + driver
        }
    }

    /**
     * Internal carrier for a successful connection-open plus the strategy
     * name that produced it.
     */
    private record OpenConnectionResult(Connection connection, String driverName) {
    }

    /**
     * Internal carrier for an index's ordered key columns + their aligned
     * ASC/DESC directions (group 5). The two lists are index-aligned.
     */
    private record IndexColumns(List<String> columns, List<String> directions) {
    }
}
