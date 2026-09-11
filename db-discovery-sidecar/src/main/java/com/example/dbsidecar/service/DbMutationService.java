package com.example.dbsidecar.service;

import com.example.dbsidecar.model.ConnectionOptions;
import com.example.dbsidecar.model.MutationResponse;
import com.example.dbsidecar.model.SidecarEngine;
import com.example.dbsidecar.model.SybaseDriverChoice;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Executor for the {@code /mutate} endpoint (Capture-State Discipline Spec 1
 * — the compensation engine's ONLY Sybase write path).
 *
 * <p>Deliberately separate from {@link DbQueryService}, whose
 * connections are opened READ-ONLY ({@code applyReadOnly}) — that posture is
 * exactly right for the query surface and must not be weakened. This service
 * opens its own per-request connection WITHOUT the read-only flag, executes
 * the (guard-admitted) statement batch, and either commits atomically
 * (transactional=true, the default) or runs statement-at-a-time with
 * autocommit (transactional=false — the identity reseed, which cannot run
 * inside a user transaction).</p>
 *
 * <p>Never logs SQL bodies or credentials; error messages are
 * password-masked before leaving the JVM.</p>
 */
@Service
public class DbMutationService {

    private static final Logger LOG = LoggerFactory.getLogger(DbMutationService.class);

    private final ConnectionFactory connections;

    /** Default constructor used by Spring. */
    public DbMutationService() {
        this(new JtdsDriverStrategy(), new JConnectDriverStrategy());
    }

    /** Constructor used by tests to inject fake / stub strategies. */
    DbMutationService(final DriverStrategy jtds, final DriverStrategy jconnect) {
        this.connections = new ConnectionFactory(jtds, jconnect);
    }

    /**
     * Execute the batch. Statements are assumed guard-admitted by the
     * controller ({@link MutationSqlGuard}); this method re-asserts anyway —
     * no caller is trusted, matching the read path's two-layer posture.
     */
    public MutationResponse mutate(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final List<String> statements,
            final boolean transactional,
            final int timeoutSeconds,
            final boolean restoreMode
    ) {
        return this.mutate(choice, host, port, database, username, password,
                statements, transactional, timeoutSeconds, restoreMode, null);
    }

    /** Charset-aware variant (2026-08-23). */
    public MutationResponse mutate(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final List<String> statements,
            final boolean transactional,
            final int timeoutSeconds,
            final boolean restoreMode,
            final String charset
    ) {
        return this.mutate(
                ConnectionOptions.sybase(host, port, database, username, password, charset, choice),
                statements, transactional, timeoutSeconds, restoreMode);
    }

    /**
     * Engine-aware execution (SPEC-1 §1.2). The guard grammar is keyed on the
     * SAME engine the connection is opened for, so a SQL Server reseed
     * ({@code DBCC CHECKIDENT}) can never be admitted against an ASE
     * connection, nor the ASE {@code sp_chgattribute} form against SQL Server.
     */
    public MutationResponse mutate(
            final ConnectionOptions options,
            final List<String> statements,
            final boolean transactional,
            final int timeoutSeconds,
            final boolean restoreMode
    ) {
        final SidecarEngine engine = options.engine();
        final String password = options.password();
        try {
            if (restoreMode) {
                MutationSqlGuard.assertRestoreBatch(statements, engine);
            } else {
                MutationSqlGuard.assertCompensationBatch(statements, engine);
            }
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            return new MutationResponse(false, "SQL guard rejected: " + e.getMessage(),
                    Collections.emptyList());
        }

        Connection conn = null;
        final List<Integer> rowCounts = new ArrayList<>();
        try {
            // WRITABLE: no read-only flag -- a compensation batch writes.
            conn = this.connections.open(options, false).connection();
            if (transactional) {
                conn.setAutoCommit(false);
            }
            try (Statement st = conn.createStatement()) {
                try {
                    st.setQueryTimeout(Math.max(1, Math.min(300, timeoutSeconds)));
                } catch (final SQLException ignored) {
                    // Driver may not support per-statement timeouts; proceed.
                }
                for (final String sql : statements) {
                    // SET IDENTITY_INSERT and EXEC return no update count;
                    // execute() covers both shapes.
                    final boolean isResultSet = st.execute(sql);
                    rowCounts.add(isResultSet ? 0 : Math.max(0, st.getUpdateCount()));
                }
            }
            if (transactional) {
                conn.commit();
            }
            LOG.info("[diag-sidecar] op=mutate status=200 result=ok statements={} transactional={}",
                    statements.size(), transactional);
            return new MutationResponse(true, null, rowCounts);
        } catch (final SQLException e) {
            if (conn != null && transactional) {
                try {
                    conn.rollback();
                } catch (final SQLException rollbackErr) {
                    LOG.warn("[diag-sidecar] op=mutate rollback_failed reason_class={}",
                            rollbackErr.getClass().getSimpleName());
                }
            }
            LOG.warn("[diag-sidecar] op=mutate status=200 result=fail statements={} applied={}",
                    statements.size(), rowCounts.size());
            return new MutationResponse(false, maskPassword(e.getMessage(), password),
                    Collections.emptyList());
        } finally {
            if (conn != null) {
                try {
                    if (transactional) {
                        conn.setAutoCommit(true);
                    }
                    conn.close();
                } catch (final SQLException ignored) {
                    // Per-request connection; nothing more to release.
                }
            }
        }
    }

    /** Mask every occurrence of the password in an error message. */
    static String maskPassword(final String message, final String password) {
        if (message == null) {
            return null;
        }
        if (password == null || password.isEmpty()) {
            return message;
        }
        return message.replace(password, "***");
    }
}
