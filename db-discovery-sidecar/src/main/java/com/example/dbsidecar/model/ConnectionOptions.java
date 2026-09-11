package com.example.dbsidecar.model;

/**
 * The complete, resolved set of inputs needed to open ONE per-request JDBC
 * connection (SQL Server pair programme, SPEC-1 §1.2).
 *
 * <p>Immutable and engine-agnostic: every driver strategy takes this one
 * record rather than a widening positional argument list, and the single
 * {@code ConnectionFactory} resolves the strategy order from
 * {@link #engine()} + {@link #driver()}. Values are ALREADY resolved (engine
 * defaulted, auth scheme lower-cased, encrypt / trust defaulted) by
 * {@link ConnectionRequest#toConnectionOptions()} -- a strategy never
 * re-interprets a null.</p>
 *
 * <p>The password lives here for the duration of one request only; the
 * sidecar never persists or logs it.</p>
 */
public record ConnectionOptions(
        SidecarEngine engine,
        String host,
        int port,
        String database,
        String username,
        String password,
        /** Sybase-only: the DETECTED server charset declared on the connection. */
        String charset,
        /** Sybase-only driver preference; ignored for {@link SidecarEngine#MSSQL}. */
        SybaseDriverChoice driver,
        /** mssql-only: {@code sql} (default) or {@code ntlm}. */
        String authScheme,
        /** mssql-only: the NTLM domain; null unless {@code authScheme=ntlm}. */
        String domain,
        /** mssql-only: TLS on the connection (default TRUE). */
        boolean encrypt,
        /** mssql-only: accept a self-signed server certificate (default FALSE). */
        boolean trustServerCertificate,
        /** mssql-only: named instance; null for the default instance. */
        String instanceName
) {

    /** TRUE when the NTLM (Windows domain) authentication scheme is requested. */
    public boolean isNtlm() {
        return EngineOptions.AUTH_SCHEME_NTLM.equals(this.authScheme);
    }

    /** Convenience for a Sybase-shaped options bag (tests + back-compat paths). */
    public static ConnectionOptions sybase(
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String charset,
            final SybaseDriverChoice driver
    ) {
        return new ConnectionOptions(
                SidecarEngine.SYBASE, host, port, database, username, password, charset,
                driver == null ? SybaseDriverChoice.AUTO : driver,
                EngineOptions.AUTH_SCHEME_SQL, null, true, false, null);
    }
}
