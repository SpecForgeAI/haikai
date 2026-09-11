package com.example.dbsidecar;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The sidecar's own configurable defaults (SQL Server pair programme,
 * SPEC-1 §1.1).
 *
 * <p>Before this class {@code application.yml} carried two {@code sybase.*}
 * keys that NOTHING read -- the 30-second timeout and 1000-row cap were
 * hardcoded in the controller, so editing the YAML changed nothing and the
 * file actively misled an operator. The keys now live under {@code sidecar.*},
 * are bound here, and ARE the values the controller applies when a request
 * omits its own.</p>
 *
 * <p>Per-request values still win, and the controller still clamps them; these
 * are only the fallbacks.</p>
 */
@ConfigurationProperties(prefix = "sidecar")
public class SidecarProperties {

    /** Default per-statement timeout when a request does not specify one. */
    private int defaultQueryTimeoutSeconds = 30;

    /** Default row cap for {@code /query} when a request does not specify one. */
    private int defaultMaxRows = 1000;

    public int getDefaultQueryTimeoutSeconds() {
        return this.defaultQueryTimeoutSeconds;
    }

    public void setDefaultQueryTimeoutSeconds(final int defaultQueryTimeoutSeconds) {
        this.defaultQueryTimeoutSeconds = defaultQueryTimeoutSeconds;
    }

    public int getDefaultMaxRows() {
        return this.defaultMaxRows;
    }

    public void setDefaultMaxRows(final int defaultMaxRows) {
        this.defaultMaxRows = defaultMaxRows;
    }
}
