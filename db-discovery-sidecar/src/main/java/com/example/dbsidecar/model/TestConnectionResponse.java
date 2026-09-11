package com.example.dbsidecar.model;

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
        String driverUsed,
        /**
         * The engine this probe ran against ({@code sybase} / {@code mssql});
         * SPEC-1 §1.2 / wire contract v2 §1. Echoed so a caller can confirm
         * the sidecar resolved the same engine it intended -- in particular
         * that an omitted {@code engine} field defaulted to {@code sybase}.
         */
        String engine,
        /**
         * SQL Server {@code SERVERPROPERTY('Edition')}; null on engines that
         * have no edition concept (ASE reports everything in
         * {@code @@version}). Optional / nullable.
         */
        String serverEdition
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
        this(ok, error, serverVersion, null, null, null);
    }

    /**
     * Pre-SPEC-1 four-field form: no engine / edition (a Sybase-only caller).
     */
    public TestConnectionResponse(
            final boolean ok,
            final String error,
            final String serverVersion,
            final String driverUsed
    ) {
        this(ok, error, serverVersion, driverUsed, null, null);
    }
}
