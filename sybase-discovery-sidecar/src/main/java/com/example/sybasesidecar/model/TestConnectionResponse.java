package com.example.sybasesidecar.model;

/**
 * Response body for {@code POST /test-connection}. Either {@code ok=true}
 * with {@code serverVersion} populated, or {@code ok=false} with
 * {@code error} populated (password-masked).
 *
 * <p>{@code driverUsed} reports which JDBC driver actually opened the
 * connection (jtds / jconnect). On a failure the field carries the last
 * driver that was attempted -- callers can use it to diagnose whether the
 * auto path exhausted its options. The field is null when no driver attempt
 * was made (e.g. validation error short-circuit).</p>
 */
public record TestConnectionResponse(
        boolean ok,
        String error,
        String serverVersion,
        String driverUsed
) {
    /**
     * Convenience constructor for call sites that pre-date the
     * {@code driverUsed} field. Defaults the new field to null.
     */
    public TestConnectionResponse(
            final boolean ok,
            final String error,
            final String serverVersion
    ) {
        this(ok, error, serverVersion, null);
    }
}
