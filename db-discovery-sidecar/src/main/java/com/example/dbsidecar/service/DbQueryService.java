package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.IntrospectionResponse;
import com.example.dbsidecar.model.QueryResponse;
import com.example.dbsidecar.model.SidecarEngine;
import com.example.dbsidecar.model.SybaseDriverChoice;
import com.example.dbsidecar.model.TestConnectionResponse;
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
 * This lets {@code DbQueryServiceTest} unit-test the SQL-&gt;object mapping +
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
public class DbQueryService {

    private static final Logger LOG = LoggerFactory.getLogger(DbQueryService.class);

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
    private final ConnectionFactory connections;

    /**
     * Per-engine catalog layer (SPEC-1 §1.3). Stateless: one instance each,
     * resolved by the request's {@code engine}.
     */
    private final EngineCatalog sybaseCatalog = new SybaseCatalog();
    private final EngineCatalog mssqlCatalog = new MssqlCatalog();

    /**
     * Default constructor used by Spring. Instantiates every driver strategy;
     * the jConnect strategy gracefully reports unavailable when its jar is
     * missing from the classpath.
     */
    public DbQueryService() {
        this(new JtdsDriverStrategy(), new JConnectDriverStrategy());
    }

    /**
     * Constructor used by tests to inject fake / stub Sybase strategies. The
     * SQL Server strategy is the production one (its driver is a regular
     * Maven dependency, so it is always present).
     */
    DbQueryService(final DriverStrategy jtds, final DriverStrategy jconnect) {
        this.jtds = jtds;
        this.jconnect = jconnect;
        this.connections = new ConnectionFactory(jtds, jconnect);
    }

    /** Constructor used by tests that need all three strategies stubbed. */
    DbQueryService(
            final DriverStrategy jtds,
            final DriverStrategy jconnect,
            final DriverStrategy mssql
    ) {
        this.jtds = jtds;
        this.jconnect = jconnect;
        this.connections = new ConnectionFactory(jtds, jconnect, mssql);
    }

    /** The catalog that reads this engine's system tables (SPEC-1 §1.3). */
    EngineCatalog catalogFor(final SidecarEngine engine) {
        return engine == SidecarEngine.MSSQL ? this.mssqlCatalog : this.sybaseCatalog;
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
    /**
     * Open a READ-ONLY per-request connection. The driver resolution (Sybase
     * jTDS/jConnect auto-fallback, SQL Server mssql-jdbc-then-jTDS) lives in
     * the ONE {@link ConnectionFactory} (SPEC-1 §1.2); this service only asks
     * for the read-only posture its two endpoints need.
     */
    private OpenConnectionResult openConnection(final ConnectionOptions options)
            throws SQLException {
        final ConnectionFactory.Opened opened = this.connections.open(options, true);
        return new OpenConnectionResult(opened.connection(), opened.driverName());
    }

    private DriverStrategy strategyFor(final SybaseDriverChoice choice) {
        return choice == SybaseDriverChoice.JCONNECT ? this.jconnect : this.jtds;
    }

    /**
     * Test the connection by opening a JDBC connection, reading the server
     * version via {@code @@version}, and closing the connection.
     */
    public TestConnectionResponse testConnection(final ConnectionOptions options) {
        LOG.info("Sidecar query category=test_connection host={} db={} engine={} driver_choice={}",
                options.host(), options.database(), options.engine().wireValue(), options.driver());
        Connection conn = null;
        OpenConnectionResult opened = null;
        try {
            opened = this.openConnection(options);
            conn = opened.connection();
            // The version probe is the engine's own -- ASE {@code @@version},
            // SQL Server SERVERPROPERTY -- and it PROPAGATES its failure: a
            // login that cannot read the version is not a usable connection.
            final EngineCatalog.ServerIdentity identity =
                    this.catalogFor(options.engine()).probe(conn);
            return new TestConnectionResponse(
                    true, null, identity.version(), opened.driverName(),
                    options.engine().wireValue(), identity.edition());
        } catch (final SQLException e) {
            return new TestConnectionResponse(
                    false,
                    this.maskPassword(e.getMessage(), options.password()),
                    null,
                    opened == null ? this.lastAttemptedDriverName(options) : opened.driverName(),
                    options.engine().wireValue(),
                    null
            );
        } finally {
            this.closeQuietly(conn);
        }
    }

    /**
     * Back-compat overload: a Sybase connection with the given driver choice.
     */
    public TestConnectionResponse testConnection(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) {
        return this.testConnection(ConnectionOptions.sybase(
                host, port, database, username, password, null, choice));
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
        return this.introspect(choice, host, port, database, username, password,
                includeSchemas, includeTables, queryTimeoutSeconds, null);
    }

    /**
     * Engine-aware introspection (SPEC-1 §1.3): the per-request connection is
     * opened here, the catalog reads belong to the engine's
     * {@link EngineCatalog}, and the error envelope (password-masked) stays
     * here so both engines fail identically on the wire.
     */
    public IntrospectionResponse introspect(
            final ConnectionOptions options,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int queryTimeoutSeconds
    ) {
        LOG.info("Sidecar query category=introspect host={} db={} engine={} driver_choice={}",
                options.host(), options.database(), options.engine().wireValue(), options.driver());
        Connection conn = null;
        try {
            conn = this.openConnection(options).connection();
            return this.catalogFor(options.engine())
                    .introspect(conn, includeSchemas, includeTables, queryTimeoutSeconds);
        } catch (final SQLException e) {
            return IntrospectionResponse.failure(
                    this.maskPassword(e.getMessage(), options.password()));
        } finally {
            this.closeQuietly(conn);
        }
    }

    /** Charset-aware variant (2026-08-23): declares the detected server
     *  charset on the connection so string data decodes byte-correctly. */
    public IntrospectionResponse introspect(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final List<String> includeSchemas,
            final List<String> includeTables,
            final int queryTimeoutSeconds,
            final String charset
    ) {
        return this.introspect(
                ConnectionOptions.sybase(host, port, database, username, password, charset, choice),
                includeSchemas, includeTables, queryTimeoutSeconds);
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
        return this.query(choice, host, port, database, username, password, sql,
                queryTimeoutSeconds, maxRows, null);
    }

    /** Charset-aware variant (2026-08-23). */
    public QueryResponse query(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String sql,
            final int queryTimeoutSeconds,
            final int maxRows,
            final String charset
    ) {
        return this.query(
                ConnectionOptions.sybase(host, port, database, username, password, charset, choice),
                sql, queryTimeoutSeconds, maxRows);
    }

    /**
     * Execute a single guarded SELECT on any engine (SPEC-1 §1.2 / §1.4). The
     * SELECT-only contract is re-enforced here at the JVM layer, and every row
     * value goes through {@link #normalizeWireValue} so the wire shape is
     * identical across engines.
     */
    public QueryResponse query(
            final ConnectionOptions options,
            final String sql,
            final int queryTimeoutSeconds,
            final int maxRows
    ) {
        // Re-enforce the SELECT-only contract at the JVM layer.
        SidecarSqlGuard.assertReadonlySelect(sql);
        LOG.info("Sidecar query category=query_select host={} db={} engine={} timeoutSec={} "
                        + "maxRows={} driver_choice={}",
                options.host(), options.database(), options.engine().wireValue(),
                queryTimeoutSeconds, maxRows, options.driver());

        final String password = options.password();
        Connection conn = null;
        try {
            conn = this.openConnection(options).connection();
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
                            row.put(name, readWireValue(rs, i, md, options.engine()));
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

    /**
     * Wire datetime shape to SECONDS; the fraction is appended separately by
     * {@link #renderFraction} so sub-millisecond precision survives
     * ({@code datetime2(7)} / {@code time(7)} carry 100 ns ticks and a fixed
     * {@code .SSS} pattern silently truncated them).
     */
    static final java.time.format.DateTimeFormatter WIRE_DATETIME_SECONDS =
            java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    /** Wire time-of-day shape (seconds; fraction appended when non-zero). */
    static final java.time.format.DateTimeFormatter WIRE_TIME =
            java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
    /** ISO shape for {@code datetimeoffset} (fraction + offset appended). */
    static final java.time.format.DateTimeFormatter WIRE_ISO_SECONDS =
            java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");
    private static final char[] HEX_DIGITS = "0123456789abcdef".toCharArray();

    /** Column type name that carries a GUID on SQL Server. */
    private static final String TYPE_UNIQUEIDENTIFIER = "uniqueidentifier";

    /**
     * Render a sub-second fraction from a nanosecond-of-second value (wire
     * contract v2 §3): trailing zeros trimmed, never fewer than
     * {@code minDigits} digits, and the empty string when the value is zero
     * and {@code minDigits} is 0.
     *
     * <p>With {@code minDigits = 3} this reproduces the pre-SPEC-1
     * {@code .SSS} rendering EXACTLY for every millisecond-resolution value --
     * which is every Sybase ASE {@code datetime} (1/300 s) -- so the Sybase
     * wire is byte-for-byte unchanged, while a SQL Server {@code datetime2(7)}
     * keeps all seven of its digits.</p>
     */
    static String renderFraction(final int nanos, final int minDigits) {
        final int safe = Math.max(0, nanos);
        final String digits = String.format("%09d", safe);
        int end = digits.length();
        while (end > minDigits && digits.charAt(end - 1) == '0') {
            end--;
        }
        return end == 0 ? "" : "." + digits.substring(0, end);
    }

    /** {@code HH:mm:ss[.fff...]} -- fraction only when non-zero, min 3 digits. */
    static String renderWireTime(final java.time.LocalTime time) {
        return time.format(WIRE_TIME)
                + (time.getNano() == 0 ? "" : renderFraction(time.getNano(), 3));
    }

    /** {@code yyyy-MM-dd HH:mm:ss.fff...} -- fraction always, min 3 digits. */
    static String renderWireDateTime(final java.time.LocalDateTime value) {
        return value.format(WIRE_DATETIME_SECONDS) + renderFraction(value.getNano(), 3);
    }

    /**
     * {@code yyyy-MM-ddTHH:mm:ss.fffffff+HH:MM} -- the wire contract's
     * {@code datetimeoffset} shape: a FIXED seven-digit fraction (SQL Server's
     * own 100 ns resolution) and an explicit numeric offset, never {@code Z}.
     */
    static String renderWireOffsetDateTime(final java.time.OffsetDateTime value) {
        final String fraction = String.format("%09d", Math.max(0, value.getNano())).substring(0, 7);
        final String offset = value.getOffset().getId();
        return value.format(WIRE_ISO_SECONDS) + "." + fraction
                + ("Z".equals(offset) ? "+00:00" : offset);
    }

    /** {@code \x} + lowercase hex -- the shape Postgres renders bytea in. */
    static String renderHex(final byte[] bytes) {
        final StringBuilder sb = new StringBuilder(2 + bytes.length * 2).append("\\x");
        for (final byte b : bytes) {
            sb.append(HEX_DIGITS[(b >> 4) & 0xF]).append(HEX_DIGITS[b & 0xF]);
        }
        return sb.toString();
    }

    /**
     * Read ONE result-set cell into its wire form (SPEC-1 §1.4).
     *
     * <p>SQL Server {@code time(p)} is the one type the default JDBC mapping
     * cannot carry: mssql-jdbc hands back a {@link java.sql.Time}, which holds
     * MILLISECONDS, so a {@code time(7)} column would silently lose its last
     * four digits. For that column type only, and only on SQL Server, the
     * value is read as a {@link java.time.LocalTime} (JDBC 4.1
     * {@code getObject(int, Class)}) which carries nanoseconds. Every other
     * type -- {@code datetime2}, {@code datetimeoffset} included -- already
     * arrives with full precision and goes through the shared switch.</p>
     *
     * <p>The Sybase path never takes the {@code LocalTime} branch, so its wire
     * is untouched.</p>
     */
    static Object readWireValue(
            final ResultSet rs,
            final int index,
            final ResultSetMetaData md,
            final SidecarEngine engine
    ) throws SQLException {
        final String typeName = safeColumnTypeName(md, index);
        if (engine == SidecarEngine.MSSQL && "time".equalsIgnoreCase(typeName)) {
            try {
                final java.time.LocalTime local = rs.getObject(index, java.time.LocalTime.class);
                return local == null ? null : renderWireTime(local);
            } catch (final SQLException | AbstractMethodError | UnsupportedOperationException e) {
                // Driver without the JDBC 4.1 accessor: fall through to the
                // shared switch (millisecond resolution, never a failure).
                LOG.debug("[diag-sidecar] time_localtime_read_unavailable column_index={}", index);
            }
        }
        return normalizeWireValue(rs.getObject(index), typeName);
    }

    /** Column type name, or null when the driver refuses to report one. */
    static String safeColumnTypeName(final ResultSetMetaData md, final int index) {
        try {
            return md.getColumnTypeName(index);
        } catch (final SQLException e) {
            return null;
        }
    }

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
        return normalizeWireValue(value, null);
    }

    /**
     * Type-name-aware variant (SPEC-1 §1.4). {@code columnTypeName} is the
     * driver's own type label for the column the value came from; it is used
     * ONLY to recognise SQL Server's {@code uniqueidentifier}, which
     * mssql-jdbc hands back as an UPPER-case String while Postgres renders
     * {@code uuid} in lower case -- the two would compare unequal in a parity
     * run for no reason but letter case. Every other decision is made from the
     * Java type alone, so a null type name changes nothing.
     */
    static Object normalizeWireValue(final Object value, final String columnTypeName)
            throws SQLException {
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
            final java.sql.Timestamp ts = (java.sql.Timestamp) value;
            return ts.toLocalDateTime().format(WIRE_DATETIME_SECONDS)
                    + renderFraction(ts.getNanos(), 3);
        }
        if (value instanceof java.sql.Date) {
            return ((java.sql.Date) value).toLocalDate().toString();
        }
        if (value instanceof java.sql.Time) {
            final java.sql.Time time = (java.sql.Time) value;
            // java.sql.Time carries milliseconds only; a non-zero remainder
            // still renders (SQL Server time(3) and below round-trip exactly).
            final int millis = (int) Math.floorMod(time.getTime(), 1000L);
            return time.toLocalTime().format(WIRE_TIME)
                    + (millis == 0 ? "" : renderFraction(millis * 1_000_000, 3));
        }
        if (value instanceof microsoft.sql.DateTimeOffset) {
            return renderWireOffsetDateTime(
                    ((microsoft.sql.DateTimeOffset) value).getOffsetDateTime());
        }
        if (value instanceof java.time.OffsetDateTime) {
            return renderWireOffsetDateTime((java.time.OffsetDateTime) value);
        }
        if (value instanceof java.time.LocalDateTime) {
            return renderWireDateTime((java.time.LocalDateTime) value);
        }
        if (value instanceof java.time.LocalTime) {
            return renderWireTime((java.time.LocalTime) value);
        }
        if (value instanceof java.time.LocalDate) {
            return value.toString();
        }
        if (value instanceof java.util.Date) {
            // Defensive: an exotic driver returning a plain java.util.Date.
            final java.sql.Timestamp ts =
                    new java.sql.Timestamp(((java.util.Date) value).getTime());
            return ts.toLocalDateTime().format(WIRE_DATETIME_SECONDS)
                    + renderFraction(ts.getNanos(), 3);
        }
        if (value instanceof java.util.UUID) {
            return value.toString().toLowerCase(java.util.Locale.ROOT);
        }
        if (value instanceof byte[]) {
            return renderHex((byte[]) value);
        }
        if (value instanceof java.sql.Blob) {
            final java.sql.Blob blob = (java.sql.Blob) value;
            final long length = blob.length();
            return length == 0
                    ? "\\x"
                    : renderHex(blob.getBytes(1, (int) Math.min(length, Integer.MAX_VALUE)));
        }
        if (value instanceof java.sql.Clob) {
            final java.sql.Clob clob = (java.sql.Clob) value;
            final long length = clob.length();
            return length == 0 ? "" : clob.getSubString(1, (int) Math.min(length, Integer.MAX_VALUE));
        }
        if (value instanceof java.sql.SQLXML) {
            return ((java.sql.SQLXML) value).getString();
        }
        if (value instanceof String && TYPE_UNIQUEIDENTIFIER.equalsIgnoreCase(columnTypeName)) {
            return ((String) value).toLowerCase(java.util.Locale.ROOT);
        }
        return value;
    }

    /**
     * Used by error-path responses: report the driver we would have tried
     * (in auto mode the first attempt is jTDS) so the caller has a non-null
     * driver name to log/diagnose with.
     */
    private String lastAttemptedDriverName(final ConnectionOptions options) {
        return this.connections.lastAttemptedDriverName(options);
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
}
