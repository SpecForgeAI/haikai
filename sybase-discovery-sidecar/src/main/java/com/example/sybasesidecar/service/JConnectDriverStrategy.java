package com.example.sybasesidecar.service;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.SQLException;
import java.util.Properties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * jConnect strategy. URL form: {@code jdbc:sybase:Tds:host:port/database}.
 * The target database is embedded in the URL path.
 *
 * <p>An earlier revision passed the database via a {@code SERVICENAME}
 * property on a path-less URL ({@code jdbc:sybase:Tds:host:port}). That
 * broke against real Sybase ASE servers: jConnect silently ignored the
 * property and the client landed on the server's default database
 * ({@code tempdb}), producing 0-table introspection results. Putting the
 * database in the URL path is the form jConnect actually honours.</p>
 *
 * <p>jConnect's {@code acceptsURL()} doesn't play nicely with
 * {@code DriverManager} (it has reported false-positive / false-negative
 * cases against TDS URLs), so we open the connection by calling
 * {@code driver.connect(url, props)} on a Driver instance we instantiate
 * directly via reflection.</p>
 *
 * <p>The driver class ({@code com.sybase.jdbc4.jdbc.SybDriver}) is NOT
 * referenced by name in source -- it is loaded reflectively so the sidecar
 * compiles cleanly without the SAP jConnect jar on the classpath. When the
 * jar is missing at runtime {@link #isAvailable()} returns false and the
 * auto-mode loop in {@link SybaseQueryService} skips this strategy.</p>
 */
public final class JConnectDriverStrategy implements DriverStrategy {

    private static final Logger LOG = LoggerFactory.getLogger(JConnectDriverStrategy.class);
    static final String DRIVER_CLASS = "com.sybase.jdbc4.jdbc.SybDriver";

    private final Driver driverInstance;
    private final boolean available;

    public JConnectDriverStrategy() {
        Driver d = null;
        boolean ok = false;
        try {
            final Class<?> cls = Class.forName(DRIVER_CLASS);
            d = (Driver) cls.getDeclaredConstructor().newInstance();
            ok = true;
            LOG.info("[diag-sidecar] driver=jconnect preload=ok class={}", DRIVER_CLASS);
        } catch (final ClassNotFoundException e) {
            // Expected when the jconn4.jar isn't on the classpath. Don't log
            // at error level -- this is a known optional-dep situation.
            LOG.info("[diag-sidecar] driver=jconnect preload=unavailable reason=class_not_found");
        } catch (final ReflectiveOperationException | LinkageError e) {
            LOG.warn(
                    "[diag-sidecar] driver=jconnect preload=fail reason={}",
                    e.getClass().getSimpleName()
            );
        }
        this.driverInstance = d;
        this.available = ok;
    }

    @Override
    public String name() {
        return "jconnect";
    }

    @Override
    public boolean isAvailable() {
        return this.available;
    }

    @Override
    public String buildJdbcUrl(final String host, final int port, final String database) {
        // The database MUST be in the URL path. jConnect ignores SERVICENAME
        // when it's only on the props bag and silently lands on tempdb.
        final String base = "jdbc:sybase:Tds:" + host + ":" + port;
        return (database == null || database.isEmpty()) ? base : (base + "/" + database);
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
    public Connection openConnection(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String charset
    ) throws SQLException {
        if (!this.available || this.driverInstance == null) {
            throw new SQLException("jConnect driver not available on classpath");
        }
        final String url = this.buildJdbcUrl(host, port, database);
        final Properties props = new Properties();
        props.setProperty("user", username);
        props.setProperty("password", password);
        if (charset != null && !charset.isEmpty()) {
            // jConnect: CHARSET names the server charset the client asks the
            // server to converse in; declaring the DETECTED one guarantees
            // byte-correct decoding of single-byte data.
            props.setProperty("CHARSET", charset);
        }
        final Connection conn = this.driverInstance.connect(url, props);
        if (conn == null) {
            // Driver.connect returns null when acceptsURL() rejects -- treat
            // as a SQLException so the auto loop can fall through.
            throw new SQLException("jConnect driver did not accept URL: " + url);
        }
        return conn;
    }
}
