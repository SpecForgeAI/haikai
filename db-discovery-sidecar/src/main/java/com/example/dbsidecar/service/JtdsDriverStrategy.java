package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.SidecarEngine;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * jTDS strategy. URL form: {@code jdbc:jtds:sybase://host:port/database} for
 * Sybase ASE and {@code jdbc:jtds:sqlserver://host:port/database} for SQL
 * Server (SPEC-1 §1.2 -- jTDS speaks TDS to both engines; only the URL scheme
 * differs). Opens connections through
 * {@code DriverManager.getConnection(url, user, pw)}.
 *
 * <p>jTDS is bundled as a regular Maven Central dependency so the class
 * loader resolves it at compile time. {@link #isAvailable()} therefore always
 * returns true after a successful class-load preflight.</p>
 */
public final class JtdsDriverStrategy implements DriverStrategy {

    private static final Logger LOG = LoggerFactory.getLogger(JtdsDriverStrategy.class);
    static final String DRIVER_CLASS = "net.sourceforge.jtds.jdbc.Driver";

    private final boolean available;

    public JtdsDriverStrategy() {
        boolean ok;
        try {
            Class.forName(DRIVER_CLASS);
            ok = true;
        } catch (final ClassNotFoundException e) {
            LOG.error("[diag-sidecar] driver=jtds preload=fail class_not_found");
            ok = false;
        }
        this.available = ok;
    }

    @Override
    public String name() {
        return "jtds";
    }

    @Override
    public boolean isAvailable() {
        return this.available;
    }

    @Override
    public boolean supports(final SidecarEngine engine) {
        // jTDS speaks TDS to BOTH engines; it is the mssql FALLBACK driver
        // (mssql-jdbc first) and the Sybase FIRST-attempt driver.
        return true;
    }

    @Override
    public String buildJdbcUrl(final String host, final int port, final String database) {
        return "jdbc:jtds:sybase://" + host + ":" + port + "/" + database;
    }

    /**
     * Engine-aware URL (SPEC-1 §1.2 / wire contract §1). SQL Server takes the
     * {@code sqlserver} sub-protocol plus the optional {@code instance} and
     * {@code domain} properties; Sybase keeps the original form byte-for-byte.
     * Property values are validated against a bare-identifier pattern before
     * they reach the URL -- a caller-supplied instance or domain can never
     * inject an extra {@code ;property=} pair.
     */
    @Override
    public String buildJdbcUrl(final ConnectionOptions options) {
        if (options.engine() != SidecarEngine.MSSQL) {
            return this.buildJdbcUrl(options.host(), options.port(), options.database());
        }
        final StringBuilder url = new StringBuilder("jdbc:jtds:sqlserver://")
                .append(options.host()).append(':').append(options.port())
                .append('/').append(options.database());
        if (isSafeUrlToken(options.instanceName())) {
            url.append(";instance=").append(options.instanceName().trim());
        }
        if (options.isNtlm() && isSafeUrlToken(options.domain())) {
            url.append(";domain=").append(options.domain().trim());
        }
        return url.toString();
    }

    /** A bare token safe to place in a JDBC URL property value. */
    static boolean isSafeUrlToken(final String value) {
        return value != null && value.trim().matches("[A-Za-z0-9_.-]+");
    }

    @Override
    public Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) throws SQLException {
        return this.openConnection(host, port, database, username, password, null);
    }

    @Override
    public Connection openConnection(final ConnectionOptions options) throws SQLException {
        if (!this.available) {
            throw new SQLException("jTDS driver not available on classpath");
        }
        if (options.engine() != SidecarEngine.MSSQL) {
            return this.openConnection(
                    options.host(), options.port(), options.database(),
                    options.username(), options.password(), options.charset());
        }
        // SQL Server: no charset property (the server's own collation drives
        // decoding and jTDS reads it off the login response).
        return DriverManager.getConnection(
                this.buildJdbcUrl(options), options.username(), options.password());
    }

    @Override
    public Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String charset
    ) throws SQLException {
        if (!this.available) {
            throw new SQLException("jTDS driver not available on classpath");
        }
        String url = this.buildJdbcUrl(host, port, database);
        if (charset != null && !charset.isEmpty()
                && charset.matches("[A-Za-z0-9_\\-]+")) {
            url = url + ";charset=" + charset;
        }
        return DriverManager.getConnection(url, username, password);
    }
}
