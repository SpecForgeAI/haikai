package com.example.sybasesidecar.model;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * Caller-supplied driver preference on every Sybase sidecar request.
 *
 * <ul>
 *   <li>{@link #AUTO} -- try jTDS first; on any SQL-level failure (login
 *       rejected, protocol mismatch, etc.) re-attempt with jConnect. If
 *       jConnect is unavailable (jar not on classpath) the auto path is
 *       jTDS-only.</li>
 *   <li>{@link #JTDS} -- force the LGPL jTDS driver.</li>
 *   <li>{@link #JCONNECT} -- force the SAP jConnect driver. Requires the
 *       jconn4.jar to be present (see {@code lib/} README).</li>
 * </ul>
 *
 * <p>JSON parsing is case-insensitive and accepts unknown values by falling
 * back to {@link #AUTO} -- safer than failing the request, since the auto
 * path tries both drivers anyway.</p>
 */
public enum SybaseDriverChoice {
    AUTO,
    JTDS,
    JCONNECT;

    /**
     * Jackson-friendly factory. Case-insensitive; unknown / null values
     * fall back to {@link #AUTO}.
     *
     * @param raw the raw JSON string value, may be null
     * @return the matching enum or {@link #AUTO}
     */
    @JsonCreator
    public static SybaseDriverChoice fromJson(final String raw) {
        if (raw == null) {
            return AUTO;
        }
        final String normalised = raw.trim().toUpperCase();
        switch (normalised) {
            case "JTDS":
                return JTDS;
            case "JCONNECT":
            case "JCONN":
            case "JCONN4":
                return JCONNECT;
            case "AUTO":
            case "":
                return AUTO;
            default:
                return AUTO;
        }
    }
}
