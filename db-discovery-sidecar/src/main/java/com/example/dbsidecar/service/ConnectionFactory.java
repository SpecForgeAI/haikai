package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.SidecarEngine;
import com.example.dbsidecar.model.SybaseDriverChoice;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The ONE place a sidecar JDBC connection is opened (SQL Server pair
 * programme, SPEC-1 §1.2).
 *
 * <p>Before this class the same AUTO fallback loop existed three times (query,
 * mutation and call services), each with its own diagnostic spelling and its
 * own subtle divergence. Adding a second engine would have made that three
 * copies of a four-branch resolution. The resolution now lives here:</p>
 *
 * <ul>
 *   <li><b>Sybase</b> -- {@code jtds} / {@code jconnect} force one strategy;
 *       {@code auto} tries jTDS then jConnect. When jConnect's jar is absent
 *       the auto path is jTDS-only and the ORIGINAL jTDS error surfaces
 *       (unchanged from the pre-SPEC-1 behaviour, byte for byte).</li>
 *   <li><b>SQL Server</b> -- {@code mssql-jdbc} first, jTDS
 *       ({@code jdbc:jtds:sqlserver://}) as the fallback. The Sybase-only
 *       {@code driver} field is IGNORED here (wire contract §1).</li>
 * </ul>
 *
 * <p>Read-only posture is the CALLER's choice: {@code /query} +
 * {@code /introspect} ask for a read-only connection, {@code /mutate} and
 * {@code /call} do not (a compensation batch and a routine both legitimately
 * write). {@code setReadOnly} is best-effort -- some drivers ignore it -- and
 * the database GRANT remains the real enforcement.</p>
 */
public class ConnectionFactory {

    private static final Logger LOG = LoggerFactory.getLogger(ConnectionFactory.class);

    private final DriverStrategy jtds;
    private final DriverStrategy jconnect;
    private final DriverStrategy mssql;

    /** Production wiring: all three strategies, each reporting its own availability. */
    public ConnectionFactory() {
        this(new JtdsDriverStrategy(), new JConnectDriverStrategy(), new MssqlJdbcDriverStrategy());
    }

    /** Sybase-only wiring kept for the pre-SPEC-1 two-strategy call sites + tests. */
    public ConnectionFactory(final DriverStrategy jtds, final DriverStrategy jconnect) {
        this(jtds, jconnect, new MssqlJdbcDriverStrategy());
    }

    /** Full wiring, used by tests to inject fakes for any of the three. */
    public ConnectionFactory(
            final DriverStrategy jtds,
            final DriverStrategy jconnect,
            final DriverStrategy mssql
    ) {
        this.jtds = jtds;
        this.jconnect = jconnect;
        this.mssql = mssql;
    }

    /** An open connection plus the strategy name that produced it. */
    public record Opened(Connection connection, String driverName) {
    }

    /**
     * The ordered strategies that may serve this request. Pure -- unit tests
     * assert the order without opening a connection.
     */
    public List<DriverStrategy> resolveOrder(final ConnectionOptions options) {
        final List<DriverStrategy> order = new ArrayList<>(2);
        if (options.engine() == SidecarEngine.MSSQL) {
            order.add(this.mssql);
            order.add(this.jtds);
            return order;
        }
        final SybaseDriverChoice choice =
                options.driver() == null ? SybaseDriverChoice.AUTO : options.driver();
        if (choice == SybaseDriverChoice.JCONNECT) {
            order.add(this.jconnect);
            return order;
        }
        if (choice == SybaseDriverChoice.JTDS) {
            order.add(this.jtds);
            return order;
        }
        order.add(this.jtds);
        order.add(this.jconnect);
        return order;
    }

    /**
     * The driver name to report on an error path (no connection was opened, so
     * there is no "driver used"): the LAST strategy the order would have
     * reached that is actually available, else the first.
     */
    public String lastAttemptedDriverName(final ConnectionOptions options) {
        final List<DriverStrategy> order = this.resolveOrder(options);
        DriverStrategy last = order.get(0);
        for (final DriverStrategy strategy : order) {
            if (strategy.isAvailable()) {
                last = strategy;
            }
        }
        return last.name();
    }

    /**
     * Open a connection, walking the resolved order. A strategy whose driver
     * jar is absent is SKIPPED (never attempted); when every candidate failed
     * the FIRST failure is rethrown for a single-candidate order and the LAST
     * failure for a multi-candidate one -- the same signal the pre-SPEC-1
     * Sybase loop surfaced (jConnect's error is typically the more accurate
     * one for ASE 15.7+).
     *
     * @param options fully resolved connection inputs
     * @param readOnly best-effort read-only + autocommit posture
     */
    public Opened open(final ConnectionOptions options, final boolean readOnly)
            throws SQLException {
        final List<DriverStrategy> order = this.resolveOrder(options);
        final boolean forced = order.size() == 1;
        SQLException firstError = null;
        SQLException lastError = null;
        for (final DriverStrategy strategy : order) {
            if (!strategy.isAvailable()) {
                LOG.info("[diag-sidecar] driver_attempt driver={} skipped=unavailable engine={}",
                        strategy.name(), options.engine().wireValue());
                continue;
            }
            try {
                final Connection conn = strategy.openConnection(options);
                if (readOnly) {
                    applyReadOnly(conn);
                }
                LOG.info("[diag-sidecar] driver_attempt driver={} result=ok engine={} forced={} "
                                + "charset_set={}",
                        strategy.name(), options.engine().wireValue(), forced,
                        options.charset() != null && !options.charset().isEmpty());
                return new Opened(conn, strategy.name());
            } catch (final SQLException e) {
                if (firstError == null) {
                    firstError = e;
                }
                lastError = e;
                LOG.info("[diag-sidecar] driver_attempt driver={} result=fail engine={} sqlstate={}",
                        strategy.name(), options.engine().wireValue(),
                        e.getSQLState() == null ? "?" : e.getSQLState());
            }
        }
        if (lastError != null) {
            // One available candidate -> its own error. Several -> the last
            // attempt's error, which is the more accurate diagnosis.
            throw firstError == lastError ? firstError : lastError;
        }
        throw new SQLException("No JDBC driver available for engine "
                + options.engine().wireValue() + " on this sidecar build.");
    }

    /**
     * Best-effort read-only + autocommit. Some drivers reject
     * {@code setReadOnly} silently and that is not fatal -- the GRANT layer is
     * the real enforcement.
     */
    static void applyReadOnly(final Connection conn) {
        try {
            conn.setReadOnly(true);
            conn.setAutoCommit(true);
        } catch (final SQLException ignored) {
            // intentionally swallowed -- driver-specific quirk
        }
    }
}
