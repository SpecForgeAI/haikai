package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.SidecarEngine;
import java.sql.Connection;
import java.sql.SQLException;

/**
 * Abstraction over a Sybase JDBC driver flavour. Two implementations exist:
 * {@link JtdsDriverStrategy} (default, LGPL, on Maven Central) and
 * {@link JConnectDriverStrategy} (SAP-supplied, loaded via reflection so the
 * sidecar still compiles without the jar).
 *
 * <p>The strategy encapsulates two driver-specific concerns:</p>
 * <ul>
 *   <li>JDBC URL form -- jTDS uses {@code jdbc:jtds:sybase://host:port/db}
 *       while jConnect uses {@code jdbc:sybase:Tds:host:port} with the
 *       database name carried in a {@code SERVICENAME} property.</li>
 *   <li>Connection acquisition -- jTDS works through
 *       {@code DriverManager.getConnection(url, user, pw)}; jConnect's
 *       {@code acceptsURL()} doesn't co-operate with DriverManager so we
 *       call {@code driver.connect(url, props)} on a reflectively-loaded
 *       Driver instance.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-17 dual-driver support (post-mortem on Sybase ASE 15.7
 * login failure with jTDS).</p>
 */
public interface DriverStrategy {

    /**
     * Short identifier used in {@code [diag-sidecar]} log lines and surfaced
     * in {@code TestConnectionResponse.driverUsed}. Returns lower-case
     * (e.g. {@code "jtds"}, {@code "jconnect"}).
     */
    String name();

    /**
     * Whether this strategy can be used at runtime (i.e. its driver class is
     * on the classpath). When false, {@link #openConnection} will throw
     * immediately with a clear message so the auto path can skip it.
     */
    boolean isAvailable();

    /**
     * Build the JDBC URL form this driver accepts. Pure function; safe to
     * call without a JDBC connection.
     */
    String buildJdbcUrl(String host, int port, String database);

    /**
     * Open a JDBC connection using this driver's preferred mechanism. The
     * caller is responsible for closing the returned connection.
     *
     * @throws SQLException on any driver-level failure (network, login,
     *     unsupported feature). The caller's auto-mode loop catches this to
     *     decide whether to try the next strategy.
     */
    Connection openConnection(
            String host,
            int port,
            String database,
            String username,
            String password
    ) throws SQLException;

    /**
     * Charset-aware overload (2026-08-23): declares the DETECTED server
     * charset on the connection so single-byte data (e.g. Latin-1) decodes
     * correctly into Java strings — the one choke point for every consumer
     * (introspection, queries, S0 dumps, data migration). Default ignores
     * the charset for back-compat.
     */
    default Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String charset
    ) throws SQLException {
        return this.openConnection(host, port, database, username, password);
    }

    /**
     * Which source engines this strategy can serve (SPEC-1 §1.2). jTDS serves
     * BOTH ({@code jdbc:jtds:sybase://} and {@code jdbc:jtds:sqlserver://});
     * jConnect is Sybase-only and mssql-jdbc is SQL-Server-only. The default
     * is Sybase-only so a strategy that predates the multi-engine split (or a
     * test double) never gets handed an {@code mssql} request by mistake.
     */
    default boolean supports(final SidecarEngine engine) {
        return engine == SidecarEngine.SYBASE;
    }

    /**
     * Engine-aware URL build (SPEC-1 §1.2). The default keeps the pre-SPEC-1
     * behaviour for strategies that only know the Sybase form, so a test
     * double implementing the three-argument method stays valid.
     */
    default String buildJdbcUrl(final ConnectionOptions options) {
        return this.buildJdbcUrl(options.host(), options.port(), options.database());
    }

    /**
     * Engine-aware connection open (SPEC-1 §1.2) -- the ONE entry point
     * {@link ConnectionFactory} uses. The default delegates to the
     * charset-aware positional overload so existing strategies need no change.
     */
    default Connection openConnection(final ConnectionOptions options) throws SQLException {
        return this.openConnection(
                options.host(),
                options.port(),
                options.database(),
                options.username(),
                options.password(),
                options.charset());
    }
}
