package com.example.dbsidecar;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.TimeZone;
import org.junit.jupiter.api.Test;

/**
 * The UTC pin for a BARE (non-Docker) run (SPEC-1 §1.1).
 *
 * <p>The Dockerfile passes {@code -Duser.timezone=UTC} and the reason is
 * load-bearing: a zoneless ASE {@code datetime} or a SQL Server
 * {@code datetime2} round-trips through {@link java.sql.Timestamp} via the JVM
 * default zone, so any zone WITH daylight saving corrupts wall-clock values
 * that fall inside a spring-forward gap. The work machine runs these services
 * bare, where that flag is absent -- so the pin has to exist in code too.</p>
 */
class SidecarApplicationTest {

    /** With nothing configured, the default zone becomes UTC. */
    @Test
    void bareRunPinsUtc() {
        final String previous = System.getProperty("user.timezone");
        final TimeZone previousZone = TimeZone.getDefault();
        try {
            System.clearProperty("user.timezone");
            TimeZone.setDefault(TimeZone.getTimeZone("Europe/London"));
            SidecarApplication.pinUtc();
            assertEquals("UTC", TimeZone.getDefault().getID());
            assertEquals("UTC", System.getProperty("user.timezone"));
        } finally {
            if (previous == null) {
                System.clearProperty("user.timezone");
            } else {
                System.setProperty("user.timezone", previous);
            }
            TimeZone.setDefault(previousZone);
        }
    }

    /** An operator who set the zone explicitly keeps their choice. */
    @Test
    void explicitTimezoneIsRespected() {
        final String previous = System.getProperty("user.timezone");
        final TimeZone previousZone = TimeZone.getDefault();
        try {
            System.setProperty("user.timezone", "Europe/Paris");
            TimeZone.setDefault(TimeZone.getTimeZone("Europe/Paris"));
            SidecarApplication.pinUtc();
            assertEquals("Europe/Paris", System.getProperty("user.timezone"));
            assertEquals("Europe/Paris", TimeZone.getDefault().getID());
        } finally {
            if (previous == null) {
                System.clearProperty("user.timezone");
            } else {
                System.setProperty("user.timezone", previous);
            }
            TimeZone.setDefault(previousZone);
        }
    }
}
