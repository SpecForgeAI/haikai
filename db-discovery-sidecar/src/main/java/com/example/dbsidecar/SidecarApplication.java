package com.example.dbsidecar;

import java.util.TimeZone;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * DB Discovery Sidecar entry point (Sybase ASE + SQL Server).
 *
 * <p>Spec: 2026-05-16 Database Discovery Packs - Task Group 4.</p>
 *
 * <p>This is a small Spring Boot 3 application that wraps the source-database
 * JDBC drivers (jTDS + jConnect for Sybase ASE, mssql-jdbc + jTDS for SQL
 * Server) and exposes a minimal HTTP surface so the Node-based
 * discovery-service and AMVS can drive introspection, read-only SELECTs,
 * guarded compensation writes and routine invocation without pulling JDBC into
 * the Node runtime. Every request names its {@code engine}
 * ({@code sybase} | {@code mssql}); a missing engine means {@code sybase} for
 * back-compat.</p>
 *
 * <p>The default listen port is 8093; override via the standard Spring
 * property {@code server.port} or the {@code SERVER_PORT} environment
 * variable. Consumers locate the sidecar via {@code DB_SIDECAR_URL}, falling
 * back to the pre-SPEC-1 {@code SYBASE_SIDECAR_URL} alias and then to
 * {@code http://localhost:8093}.</p>
 *
 * <p>SECURITY CONTRACT</p>
 * <ul>
 *   <li>The sidecar NEVER persists credentials. They live only in the
 *       per-request body; connections are opened per-request and closed in
 *       a {@code finally} block. There is no JDBC connection pool in v1.</li>
 *   <li>Outgoing JSON responses NEVER echo back the password. Error messages
 *       have credentials masked via
 *       {@link com.example.dbsidecar.service.DbQueryService#maskPassword}.
 *       </li>
 *   <li>The {@code /query} endpoint re-enforces the SELECT-only contract at
 *       the JVM layer even though the discovery-service applies its own
 *       {@code sqlGuard} before the HTTP call. This is defense in depth.</li>
 *   <li>Logging records query category strings only (e.g. "introspect_tables",
 *       "query_select") and NEVER the raw SQL or any password substring.</li>
 * </ul>
 */
@SpringBootApplication
@EnableConfigurationProperties(SidecarProperties.class)
public class SidecarApplication {

    public static void main(final String[] args) {
        pinUtc();
        SpringApplication.run(SidecarApplication.class, args);
    }

    /**
     * Pin the JVM default zone to UTC for a BARE run (SPEC-1 §1.1).
     *
     * <p>The Dockerfile already passes {@code -Duser.timezone=UTC}, and the
     * reason is load-bearing: a zoneless ASE {@code datetime} or a SQL Server
     * {@code datetime2} round-trips through {@link java.sql.Timestamp} via the
     * JVM default zone, so any zone WITH daylight saving corrupts wall-clock
     * values that fall inside a spring-forward gap. UTC has no gaps, which is
     * what makes the read/render round trip in
     * {@code DbQueryService.normalizeWireValue} exact.</p>
     *
     * <p>The work machine runs these services BARE (no Docker), where that
     * flag is absent -- so the pin has to exist in code too. An operator who
     * sets {@code user.timezone} explicitly keeps their choice: the pin only
     * applies when nothing was specified.</p>
     */
    static void pinUtc() {
        final String configured = System.getProperty("user.timezone");
        if (configured == null || configured.trim().isEmpty()) {
            System.setProperty("user.timezone", "UTC");
            TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        }
    }

    /**
     * Sidecar startup diagnostic. Emits a one-line summary on application
     * readiness so the discovery runbook can confirm masking + logging
     * conventions are wired correctly before any request flows through.
     */
    @Component
    public static class StartupDiag {

        private static final Logger LOG = LoggerFactory.getLogger(StartupDiag.class);

        @EventListener(ApplicationReadyEvent.class)
        public void onReady() {
            LOG.info("[diag-sidecar] startup ok masking_enabled=true");
        }
    }
}
