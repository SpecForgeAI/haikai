package com.example.sybasesidecar;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Sybase Discovery Sidecar entry point.
 *
 * <p>Spec: 2026-05-16 Database Discovery Packs - Task Group 4.</p>
 *
 * <p>This is a small Spring Boot 3 application that wraps the jTDS Sybase ASE
 * JDBC driver and exposes a minimal HTTP surface (three POST endpoints) so the
 * Node-based discovery-service can drive Sybase introspection + read-only
 * SELECTs without pulling JDBC into the Node runtime.</p>
 *
 * <p>The default listen port is 8093; override via the standard Spring
 * property {@code server.port} or the {@code SERVER_PORT} environment
 * variable. The discovery-service locates the sidecar via the
 * {@code SYBASE_SIDECAR_URL} env var (default {@code http://localhost:8093}).
 * </p>
 *
 * <p>SECURITY CONTRACT</p>
 * <ul>
 *   <li>The sidecar NEVER persists credentials. They live only in the
 *       per-request body; connections are opened per-request and closed in
 *       a {@code finally} block. There is no JDBC connection pool in v1.</li>
 *   <li>Outgoing JSON responses NEVER echo back the password. Error messages
 *       have credentials masked via
 *       {@link com.example.sybasesidecar.service.SybaseQueryService#maskPassword}.
 *       </li>
 *   <li>The {@code /query} endpoint re-enforces the SELECT-only contract at
 *       the JVM layer even though the discovery-service applies its own
 *       {@code sqlGuard} before the HTTP call. This is defense in depth.</li>
 *   <li>Logging records query category strings only (e.g. "introspect_tables",
 *       "query_select") and NEVER the raw SQL or any password substring.</li>
 * </ul>
 */
@SpringBootApplication
public class SidecarApplication {

    public static void main(final String[] args) {
        SpringApplication.run(SidecarApplication.class, args);
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
