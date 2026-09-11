package com.example.dbsidecar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.EngineOptions;
import com.example.dbsidecar.model.SidecarEngine;
import com.example.dbsidecar.model.SybaseDriverChoice;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * URL forms + driver-resolution order for the ONE {@link ConnectionFactory}
 * (SPEC-1 §1.2; wire contract v2 §1).
 *
 * <p>No connection is ever opened here: the URL builders are pure and the
 * resolution order is a pure list, which is exactly the part that decides
 * whether a SQL Server request reaches mssql-jdbc or accidentally falls into
 * the Sybase path.</p>
 */
class ConnectionFactoryTest {

    // ----------------------------------------------------------------------
    // URL forms
    // ----------------------------------------------------------------------

    /** The Sybase jTDS URL is byte-for-byte the pre-SPEC-1 form. */
    @Test
    void jtdsSybaseUrlIsUnchanged() {
        final JtdsDriverStrategy jtds = new JtdsDriverStrategy();
        assertEquals("jdbc:jtds:sybase://db.test:5000/demo",
                jtds.buildJdbcUrl("db.test", 5000, "demo"));
        assertEquals("jdbc:jtds:sybase://db.test:5000/demo",
                jtds.buildJdbcUrl(options(SidecarEngine.SYBASE, "db.test", 5000, "demo")));
    }

    /** jTDS against SQL Server takes the {@code sqlserver} sub-protocol. */
    @Test
    void jtdsSqlServerUrlUsesTheSqlServerSubProtocol() {
        final JtdsDriverStrategy jtds = new JtdsDriverStrategy();
        assertEquals("jdbc:jtds:sqlserver://db.test:1433/demo",
                jtds.buildJdbcUrl(options(SidecarEngine.MSSQL, "db.test", 1433, "demo")));
    }

    /** A named instance and an NTLM domain ride as jTDS URL properties. */
    @Test
    void jtdsSqlServerUrlCarriesInstanceAndDomain() {
        final ConnectionOptions named = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "ntlm", "CORP", true, false, "SQLDEV");
        assertEquals("jdbc:jtds:sqlserver://db.test:1433/demo;instance=SQLDEV;domain=CORP",
                new JtdsDriverStrategy().buildJdbcUrl(named));
    }

    /** The default mssql-jdbc URL: encryption ON, certificate trust OFF. */
    @Test
    void mssqlJdbcUrlDefaultsToEncryptedAndUntrusting() {
        assertEquals(
                "jdbc:sqlserver://db.test:1433;databaseName=demo;encrypt=true;"
                        + "trustServerCertificate=false",
                new MssqlJdbcDriverStrategy()
                        .buildJdbcUrl(options(SidecarEngine.MSSQL, "db.test", 1433, "demo")));
    }

    /** A self-signed corporate certificate needs an EXPLICIT opt-in. */
    @Test
    void mssqlJdbcUrlHonoursTheTrustToggle() {
        final ConnectionOptions trusting = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "sql", null, true, true, null);
        assertEquals(
                "jdbc:sqlserver://db.test:1433;databaseName=demo;encrypt=true;"
                        + "trustServerCertificate=true",
                new MssqlJdbcDriverStrategy().buildJdbcUrl(trusting));

        final ConnectionOptions plaintext = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "sql", null, false, false, null);
        assertTrue(new MssqlJdbcDriverStrategy().buildJdbcUrl(plaintext).contains("encrypt=false"));
    }

    /** A named instance takes the {@code host\instance} form, port still honoured. */
    @Test
    void mssqlJdbcUrlCarriesNamedInstance() {
        final ConnectionOptions named = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "sql", null, true, false, "SQLDEV");
        assertEquals(
                "jdbc:sqlserver://db.test\\SQLDEV:1433;databaseName=demo;encrypt=true;"
                        + "trustServerCertificate=false",
                new MssqlJdbcDriverStrategy().buildJdbcUrl(named));
    }

    /** NTLM adds the pure-Java authentication scheme + the domain. */
    @Test
    void mssqlJdbcUrlCarriesNtlmScheme() {
        final ConnectionOptions ntlm = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "ntlm", "CORP", true, true, null);
        assertEquals(
                "jdbc:sqlserver://db.test:1433;databaseName=demo;encrypt=true;"
                        + "trustServerCertificate=true;authenticationScheme=NTLM;domain=CORP",
                new MssqlJdbcDriverStrategy().buildJdbcUrl(ntlm));
    }

    /** A SQL login never advertises NTLM, even when a domain was supplied. */
    @Test
    void mssqlJdbcUrlOmitsNtlmForSqlLogins() {
        final ConnectionOptions sqlLogin = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "sql", "CORP", true, false, null);
        assertFalse(new MssqlJdbcDriverStrategy().buildJdbcUrl(sqlLogin)
                .contains("authenticationScheme"));
    }

    /**
     * A token that is not a bare identifier never reaches the URL -- otherwise
     * an instance name of {@code x;user=sa} would inject a property.
     */
    @Test
    void urlTokensAreValidatedBeforeSplicing() {
        assertTrue(JtdsDriverStrategy.isSafeUrlToken("SQLDEV"));
        assertTrue(JtdsDriverStrategy.isSafeUrlToken("corp.example-1"));
        assertFalse(JtdsDriverStrategy.isSafeUrlToken("x;user=sa"));
        assertFalse(JtdsDriverStrategy.isSafeUrlToken("has space"));
        assertFalse(JtdsDriverStrategy.isSafeUrlToken(null));

        final ConnectionOptions injected = new ConnectionOptions(
                SidecarEngine.MSSQL, "db.test", 1433, "demo", "u", "p", null, null,
                "ntlm", "CORP;encrypt=false", true, false, "DEV;password=x");
        final String url = new MssqlJdbcDriverStrategy().buildJdbcUrl(injected);
        assertFalse(url.contains("password="));
        assertFalse(url.contains("encrypt=false"));
    }

    // ----------------------------------------------------------------------
    // Resolution order
    // ----------------------------------------------------------------------

    /** Sybase AUTO: jTDS first, jConnect second -- unchanged from before. */
    @Test
    void sybaseAutoOrderIsJtdsThenJconnect() {
        final ConnectionFactory factory = factory();
        final List<DriverStrategy> order = factory.resolveOrder(
                sybase(SybaseDriverChoice.AUTO));
        assertEquals(List.of("jtds", "jconnect"), names(order));
    }

    /** A forced Sybase driver resolves to exactly that one strategy. */
    @Test
    void sybaseForcedChoiceResolvesToOneStrategy() {
        final ConnectionFactory factory = factory();
        assertEquals(List.of("jtds"),
                names(factory.resolveOrder(sybase(SybaseDriverChoice.JTDS))));
        assertEquals(List.of("jconnect"),
                names(factory.resolveOrder(sybase(SybaseDriverChoice.JCONNECT))));
    }

    /**
     * SQL Server: mssql-jdbc first, jTDS as the fallback -- and the Sybase-only
     * {@code driver} field is IGNORED, exactly as the wire contract says.
     */
    @Test
    void mssqlOrderIsMssqlJdbcThenJtdsRegardlessOfDriverField() {
        final ConnectionFactory factory = factory();
        final ConnectionOptions withSybaseDriverField = new ConnectionOptions(
                SidecarEngine.MSSQL, "h", 1433, "d", "u", "p", null,
                SybaseDriverChoice.JCONNECT, "sql", null, true, false, null);
        assertEquals(List.of("mssql-jdbc", "jtds"),
                names(factory.resolveOrder(withSybaseDriverField)));
    }

    /** An unavailable strategy is SKIPPED, never attempted. */
    @Test
    void unavailableStrategiesAreSkippedAndTheRemainingErrorSurfaces() {
        final ConnectionFactory factory = new ConnectionFactory(
                new FakeStrategy("jtds", true, false),
                new FakeStrategy("jconnect", false, false),
                new FakeStrategy("mssql-jdbc", true, false));
        final SQLException thrown = assertThrows(SQLException.class,
                () -> factory.open(sybase(SybaseDriverChoice.AUTO), true));
        // jConnect was unavailable, so the jTDS failure is the honest signal.
        assertTrue(thrown.getMessage().contains("jtds"));
        assertEquals("jtds", factory.lastAttemptedDriverName(sybase(SybaseDriverChoice.AUTO)));
    }

    /** When every candidate fails, the LAST attempt's error is the one raised. */
    @Test
    void lastFailureSurfacesWhenSeveralCandidatesWereTried() {
        final ConnectionFactory factory = new ConnectionFactory(
                new FakeStrategy("jtds", true, false),
                new FakeStrategy("jconnect", true, false),
                new FakeStrategy("mssql-jdbc", true, false));
        final SQLException thrown = assertThrows(SQLException.class,
                () -> factory.open(sybase(SybaseDriverChoice.AUTO), true));
        assertTrue(thrown.getMessage().contains("jconnect"));
    }

    /** The first strategy that opens wins, and its name is reported. */
    @Test
    void firstSuccessfulStrategyIsReported() throws SQLException {
        final ConnectionFactory factory = new ConnectionFactory(
                new FakeStrategy("jtds", true, false),
                new FakeStrategy("jconnect", true, true),
                new FakeStrategy("mssql-jdbc", true, true));
        assertEquals("jconnect",
                factory.open(sybase(SybaseDriverChoice.AUTO), true).driverName());
        assertEquals("mssql-jdbc",
                factory.open(options(SidecarEngine.MSSQL, "h", 1433, "d"), false).driverName());
    }

    /** With no available driver at all the failure names the engine. */
    @Test
    void noAvailableDriverIsALoudFailure() {
        final ConnectionFactory factory = new ConnectionFactory(
                new FakeStrategy("jtds", false, false),
                new FakeStrategy("jconnect", false, false),
                new FakeStrategy("mssql-jdbc", false, false));
        final SQLException thrown = assertThrows(SQLException.class,
                () -> factory.open(options(SidecarEngine.MSSQL, "h", 1433, "d"), false));
        assertTrue(thrown.getMessage().contains("mssql"));
    }

    /** Each strategy declares which engines it can serve. */
    @Test
    void strategiesDeclareTheirEngines() {
        assertTrue(new JtdsDriverStrategy().supports(SidecarEngine.SYBASE));
        assertTrue(new JtdsDriverStrategy().supports(SidecarEngine.MSSQL));
        assertTrue(new JConnectDriverStrategy().supports(SidecarEngine.SYBASE));
        assertFalse(new JConnectDriverStrategy().supports(SidecarEngine.MSSQL));
        assertTrue(new MssqlJdbcDriverStrategy().supports(SidecarEngine.MSSQL));
        assertFalse(new MssqlJdbcDriverStrategy().supports(SidecarEngine.SYBASE));
    }

    /** mssql-jdbc is a regular dependency, so it is always on the classpath. */
    @Test
    void mssqlJdbcDriverIsAvailable() {
        assertTrue(new MssqlJdbcDriverStrategy().isAvailable());
        assertEquals("mssql-jdbc", new MssqlJdbcDriverStrategy().name());
    }

    // ----------------------------------------------------------------------
    // Option resolution
    // ----------------------------------------------------------------------

    /** Engine options resolve their documented defaults. */
    @Test
    void engineOptionDefaults() {
        final EngineOptions opts = new EngineOptions();
        assertEquals(SidecarEngine.SYBASE, opts.resolveEngine());
        assertEquals("sql", opts.resolveAuthScheme());
        assertTrue(opts.resolveEncrypt());
        assertFalse(opts.resolveTrustServerCertificate());
        assertFalse(opts.isNtlm());
        assertEquals(null, opts.resolveInstanceName());
        assertEquals(null, opts.resolveDomain());

        opts.setAuthScheme("  NTLM ");
        assertTrue(opts.isNtlm());
        opts.setInstanceName("  SQLDEV  ");
        assertEquals("SQLDEV", opts.resolveInstanceName());
        opts.setDomain("   ");
        assertEquals(null, opts.resolveDomain());
        opts.setEncrypt(Boolean.FALSE);
        assertFalse(opts.resolveEncrypt());
    }

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------

    private static ConnectionFactory factory() {
        return new ConnectionFactory(
                new FakeStrategy("jtds", true, true),
                new FakeStrategy("jconnect", true, true),
                new FakeStrategy("mssql-jdbc", true, true));
    }

    private static List<String> names(final List<DriverStrategy> order) {
        return order.stream().map(DriverStrategy::name).toList();
    }

    private static ConnectionOptions options(
            final SidecarEngine engine,
            final String host,
            final int port,
            final String database
    ) {
        return new ConnectionOptions(engine, host, port, database, "u", "p", null,
                SybaseDriverChoice.AUTO, "sql", null, true, false, null);
    }

    private static ConnectionOptions sybase(final SybaseDriverChoice choice) {
        return ConnectionOptions.sybase("h", 5000, "d", "u", "p", null, choice);
    }

    /** In-memory strategy: no JDBC stack, just availability + success flags. */
    private static final class FakeStrategy implements DriverStrategy {
        private final String name;
        private final boolean available;
        private final boolean succeed;

        FakeStrategy(final String name, final boolean available, final boolean succeed) {
            this.name = name;
            this.available = available;
            this.succeed = succeed;
        }

        @Override
        public String name() {
            return this.name;
        }

        @Override
        public boolean isAvailable() {
            return this.available;
        }

        @Override
        public boolean supports(final SidecarEngine engine) {
            return true;
        }

        @Override
        public String buildJdbcUrl(final String host, final int port, final String database) {
            return "jdbc:fake:" + this.name + "://" + host + ":" + port + "/" + database;
        }

        @Override
        public Connection openConnection(
                final String host, final int port, final String database,
                final String username, final String password
        ) throws SQLException {
            if (!this.succeed) {
                throw new SQLException(this.name + " login failed (fake)");
            }
            return (Connection) java.lang.reflect.Proxy.newProxyInstance(
                    Connection.class.getClassLoader(),
                    new Class<?>[] {Connection.class},
                    (proxy, method, args) -> {
                        switch (method.getName()) {
                            case "isClosed":
                                return Boolean.FALSE;
                            case "close":
                            case "setReadOnly":
                            case "setAutoCommit":
                                return null;
                            default:
                                throw new SQLException(
                                        "FakeConnection does not implement " + method.getName());
                        }
                    });
        }
    }
}
