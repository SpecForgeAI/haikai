package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.SidecarEngine;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Microsoft {@code mssql-jdbc} strategy -- the FIRST-attempt driver for the
 * {@code mssql} engine (SPEC-1 §1.2; wire contract v2 §1).
 *
 * <p>URL form:</p>
 * <pre>
 * jdbc:sqlserver://host[\instance]:port;databaseName=db;encrypt=…;
 *     trustServerCertificate=…[;authenticationScheme=NTLM;domain=…]
 * </pre>
 *
 * <p>Two deliberate choices, both from shaping ruling 4:</p>
 * <ul>
 *   <li><b>Encryption is ON by default</b> (mssql-jdbc 12.x already defaults
 *       that way) with an explicit {@code trustServerCertificate} opt-in for a
 *       self-signed corporate certificate. The toggle is never implied.</li>
 *   <li><b>NTLM, not Kerberos.</b> {@code authenticationScheme=NTLM} is
 *       PURE JAVA in mssql-jdbc -- no {@code sqljdbc_auth.dll}, so a Windows
 *       domain login works from the container as well as from the bare
 *       work-machine deployment. Kerberos SSO (native DLL) is out of scope.</li>
 * </ul>
 *
 * <p>The instance and domain tokens are validated against a bare-token pattern
 * before they reach the URL, so a caller can never inject an extra
 * {@code ;property=value} pair into the connection string. The database name
 * rides {@code databaseName=} and is likewise validated; a name outside the
 * pattern is passed through {@code DriverManager} properties instead of the
 * URL so exotic-but-legal database names still connect.</p>
 */
public final class MssqlJdbcDriverStrategy implements DriverStrategy {

    private static final Logger LOG = LoggerFactory.getLogger(MssqlJdbcDriverStrategy.class);
    static final String DRIVER_CLASS = "com.microsoft.sqlserver.jdbc.SQLServerDriver";

    private final boolean available;

    public MssqlJdbcDriverStrategy() {
        boolean ok;
        try {
            Class.forName(DRIVER_CLASS);
            ok = true;
        } catch (final ClassNotFoundException e) {
            LOG.error("[diag-sidecar] driver=mssql_jdbc preload=fail class_not_found");
            ok = false;
        }
        this.available = ok;
    }

    @Override
    public String name() {
        return "mssql-jdbc";
    }

    @Override
    public boolean isAvailable() {
        return this.available;
    }

    @Override
    public boolean supports(final SidecarEngine engine) {
        return engine == SidecarEngine.MSSQL;
    }

    /**
     * Positional form kept for the {@link DriverStrategy} contract: a default
     * instance, encryption on, certificate trust off, SQL authentication.
     */
    @Override
    public String buildJdbcUrl(final String host, final int port, final String database) {
        return this.buildJdbcUrl(new ConnectionOptions(
                SidecarEngine.MSSQL, host, port, database, null, null, null, null,
                "sql", null, true, false, null));
    }

    @Override
    public String buildJdbcUrl(final ConnectionOptions options) {
        final StringBuilder url = new StringBuilder("jdbc:sqlserver://").append(options.host());
        if (JtdsDriverStrategy.isSafeUrlToken(options.instanceName())) {
            url.append('\\').append(options.instanceName().trim());
        }
        if (options.port() > 0) {
            url.append(':').append(options.port());
        }
        if (JtdsDriverStrategy.isSafeUrlToken(options.database())) {
            url.append(";databaseName=").append(options.database().trim());
        }
        url.append(";encrypt=").append(options.encrypt());
        url.append(";trustServerCertificate=").append(options.trustServerCertificate());
        if (options.isNtlm()) {
            url.append(";authenticationScheme=NTLM");
            if (JtdsDriverStrategy.isSafeUrlToken(options.domain())) {
                url.append(";domain=").append(options.domain().trim());
            }
        }
        return url.toString();
    }

    @Override
    public Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) throws SQLException {
        return this.openConnection(new ConnectionOptions(
                SidecarEngine.MSSQL, host, port, database, username, password, null, null,
                "sql", null, true, false, null));
    }

    @Override
    public Connection openConnection(final ConnectionOptions options) throws SQLException {
        if (!this.available) {
            throw new SQLException("mssql-jdbc driver not available on classpath");
        }
        final java.util.Properties props = new java.util.Properties();
        if (options.username() != null) {
            props.setProperty("user", options.username());
        }
        if (options.password() != null) {
            props.setProperty("password", options.password());
        }
        if (!JtdsDriverStrategy.isSafeUrlToken(options.database()) && options.database() != null) {
            // A database name with characters the URL grammar would swallow
            // travels as a property instead (mssql-jdbc honours both).
            props.setProperty("databaseName", options.database());
        }
        if (options.isNtlm() && options.domain() != null
                && !JtdsDriverStrategy.isSafeUrlToken(options.domain())) {
            props.setProperty("domain", options.domain());
        }
        return DriverManager.getConnection(this.buildJdbcUrl(options), props);
    }
}
