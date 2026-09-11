package com.example.dbsidecar.model;

/**
 * The connection surface every sidecar request bean exposes (SQL Server pair
 * programme, SPEC-1 §1.2).
 *
 * <p>The five request beans ({@code TestConnectionRequest},
 * {@code IntrospectionRequest}, {@code QueryRequest}, {@code MutationRequest},
 * {@code CallRequest}) already declared the same connection fields; this
 * interface names that shared shape so the ONE
 * {@link com.example.dbsidecar.service.ConnectionFactory} can open a
 * connection from any of them without five overloads, and so the
 * {@code engine} + mssql option block is declared once (in
 * {@link EngineOptions}) rather than five times.</p>
 */
public interface ConnectionRequest {

    String getHost();

    Integer getPort();

    String getDatabase();

    String getUsername();

    String getPassword();

    /** The unwrapped engine / auth option block; never null on a bound bean. */
    EngineOptions getEngineOptions();

    /**
     * Sybase-only DETECTED server charset. Defaulted to null here because
     * {@code /test-connection} has never carried one.
     */
    default String getCharset() {
        return null;
    }

    /** Sybase-only driver preference; {@link SybaseDriverChoice#AUTO} by default. */
    default SybaseDriverChoice getDriver() {
        return SybaseDriverChoice.AUTO;
    }

    /** The request's engine; {@link SidecarEngine#SYBASE} when the field is absent. */
    default SidecarEngine resolveEngine() {
        final EngineOptions opts = this.getEngineOptions();
        return opts == null ? SidecarEngine.defaultWhenMissing() : opts.resolveEngine();
    }

    /** Fully resolved connection inputs for the {@code ConnectionFactory}. */
    default ConnectionOptions toConnectionOptions() {
        final EngineOptions opts =
                this.getEngineOptions() == null ? new EngineOptions() : this.getEngineOptions();
        return new ConnectionOptions(
                opts.resolveEngine(),
                this.getHost(),
                this.getPort() == null ? 0 : this.getPort(),
                this.getDatabase(),
                this.getUsername(),
                this.getPassword(),
                this.getCharset(),
                this.getDriver(),
                opts.resolveAuthScheme(),
                opts.resolveDomain(),
                opts.resolveEncrypt(),
                opts.resolveTrustServerCertificate(),
                opts.resolveInstanceName());
    }
}
