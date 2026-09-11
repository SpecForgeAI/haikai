package com.example.dbsidecar.model;

import java.util.Locale;

/**
 * The engine-selection + engine-specific connection options every sidecar
 * request carries (SQL Server pair programme, SPEC-1 §1.2; wire contract v2
 * §1).
 *
 * <p>Declared ONCE here and mixed into each request bean with
 * {@code @JsonUnwrapped}, so the wire stays FLAT ({@code engine},
 * {@code authScheme}, ... at the top level of the request body, exactly as the
 * contract specifies) while the Java side has a single definition to evolve.
 * The pre-existing connection fields ({@code host}, {@code port}, ...) stay
 * declared on each request bean untouched -- this class adds only what SPEC-1
 * introduces.</p>
 *
 * <p>All fields are optional. {@code engine} missing means
 * {@link SidecarEngine#SYBASE}; {@code authScheme} missing means {@code sql};
 * {@code encrypt} missing means TRUE (mssql-jdbc 12.x encrypts by default and
 * the contract pins that); {@code trustServerCertificate} missing means FALSE
 * (a self-signed corporate certificate needs an EXPLICIT opt-in, never an
 * implicit one). The mssql-only fields are ignored for Sybase.</p>
 */
public class EngineOptions {

    /** {@code sql} (default) -- a SQL Server login, username + password. */
    public static final String AUTH_SCHEME_SQL = "sql";
    /** {@code ntlm} -- a Windows domain login via mssql-jdbc's pure-Java NTLM. */
    public static final String AUTH_SCHEME_NTLM = "ntlm";

    private SidecarEngine engine;

    private String authScheme;

    private String domain;

    private Boolean encrypt;

    private Boolean trustServerCertificate;

    private String instanceName;

    public SidecarEngine getEngine() {
        return this.engine;
    }

    public void setEngine(final SidecarEngine engine) {
        this.engine = engine;
    }

    /** The engine, defaulting to {@link SidecarEngine#SYBASE} when absent. */
    public SidecarEngine resolveEngine() {
        return this.engine == null ? SidecarEngine.defaultWhenMissing() : this.engine;
    }

    public String getAuthScheme() {
        return this.authScheme;
    }

    public void setAuthScheme(final String authScheme) {
        this.authScheme = authScheme;
    }

    /** Lower-cased scheme; {@code sql} when absent / blank. */
    public String resolveAuthScheme() {
        final String raw = this.authScheme == null
                ? "" : this.authScheme.trim().toLowerCase(Locale.ROOT);
        return raw.isEmpty() ? AUTH_SCHEME_SQL : raw;
    }

    /** TRUE only for the exact scheme {@code ntlm}. */
    public boolean isNtlm() {
        return AUTH_SCHEME_NTLM.equals(this.resolveAuthScheme());
    }

    public String getDomain() {
        return this.domain;
    }

    public void setDomain(final String domain) {
        this.domain = domain;
    }

    public Boolean getEncrypt() {
        return this.encrypt;
    }

    public void setEncrypt(final Boolean encrypt) {
        this.encrypt = encrypt;
    }

    /** Encryption ON unless the caller explicitly turned it off. */
    public boolean resolveEncrypt() {
        return this.encrypt == null || this.encrypt;
    }

    public Boolean getTrustServerCertificate() {
        return this.trustServerCertificate;
    }

    public void setTrustServerCertificate(final Boolean trustServerCertificate) {
        this.trustServerCertificate = trustServerCertificate;
    }

    /** Certificate trust is OFF unless the caller explicitly opted in. */
    public boolean resolveTrustServerCertificate() {
        return Boolean.TRUE.equals(this.trustServerCertificate);
    }

    public String getInstanceName() {
        return this.instanceName;
    }

    public void setInstanceName(final String instanceName) {
        this.instanceName = instanceName;
    }

    /** Trimmed instance name, or null when absent / blank. */
    public String resolveInstanceName() {
        if (this.instanceName == null || this.instanceName.trim().isEmpty()) {
            return null;
        }
        return this.instanceName.trim();
    }

    /** Trimmed NTLM domain, or null when absent / blank. */
    public String resolveDomain() {
        if (this.domain == null || this.domain.trim().isEmpty()) {
            return null;
        }
        return this.domain.trim();
    }
}
