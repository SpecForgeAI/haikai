package com.example.sybasesidecar.service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * jTDS strategy. URL form: {@code jdbc:jtds:sybase://host:port/database}.
 * Opens connections through {@code DriverManager.getConnection(url, user, pw)}.
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
    public String buildJdbcUrl(final String host, final int port, final String database) {
        return "jdbc:jtds:sybase://" + host + ":" + port + "/" + database;
    }

    @Override
    public Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password
    ) throws SQLException {
        if (!this.available) {
            throw new SQLException("jTDS driver not available on classpath");
        }
        final String url = this.buildJdbcUrl(host, port, database);
        return DriverManager.getConnection(url, username, password);
    }
}
