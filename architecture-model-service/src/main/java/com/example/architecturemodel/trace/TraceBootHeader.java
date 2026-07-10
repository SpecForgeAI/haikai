package com.example.architecturemodel.trace;

import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Emits the BOOT-stage trace header + predicates at startup — predicate
 * run-judging batch, see {@code docs/trace-logging.md} §Predicate self-scoring
 * layer.
 *
 * <p>One {@code HAIKAI_CONFIG} line (git sha + applied-changeset count) and the
 * {@code BOOT.AMS.01} predicate: all Liquibase changesets applied, including
 * the 205–209 oracle-program tables the downstream stages depend on.</p>
 *
 * <p>Full no-op unless {@code HAIKAI_TRACE} is on; every failure is swallowed —
 * the header must never affect boot.</p>
 */
@Component
public class TraceBootHeader implements CommandLineRunner {

    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    /**
     * Applied-changeset floor as of the predicate-run-judging batch (changesets
     * 205–209 = persistence-oracle + code-tier-oracle tables). A fresh database
     * that Liquibase just migrated lands exactly here or above.
     */
    private static final int EXPECTED_MIN_CHANGESETS = 209;

    private final JdbcTemplate jdbcTemplate;

    public TraceBootHeader(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(String... args) {
        if (!TRACE.isEnabled()) {
            return;
        }
        try {
            Integer changesets = countAppliedChangesets();
            Map<String, Object> cfg = new LinkedHashMap<>();
            cfg.put("git_sha", resolveGitSha());
            cfg.put("changesets_applied", changesets == null ? -1 : changesets);
            TRACE.configHeader(cfg, null);
            TRACE.stageStart("BOOT", null);
            if (changesets == null) {
                TRACE.predicate("BOOT.AMS.01", "liquibase changesets applied", false,
                    "databasechangelog readable with >= " + EXPECTED_MIN_CHANGESETS + " rows",
                    "databasechangelog query failed", null);
            } else {
                TRACE.predicate("BOOT.AMS.01", "liquibase changesets applied",
                    changesets >= EXPECTED_MIN_CHANGESETS,
                    ">= " + EXPECTED_MIN_CHANGESETS, String.valueOf(changesets), null);
            }
            TRACE.stageEnd("BOOT", null);
        } catch (RuntimeException ignored) {
            // never affect boot
        }
    }

    private Integer countAppliedChangesets() {
        try {
            return jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM databasechangelog", Integer.class);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private String resolveGitSha() {
        try {
            Process p = new ProcessBuilder("git", "rev-parse", "--short", "HEAD")
                .redirectErrorStream(true)
                .start();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
                String line = r.readLine();
                if (!p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                    p.destroyForcibly();
                    return "unknown";
                }
                return (p.exitValue() == 0 && line != null && !line.isBlank())
                    ? line.trim() : "unknown";
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return "unknown";
        } catch (Exception ex) {
            return "unknown";
        }
    }
}
