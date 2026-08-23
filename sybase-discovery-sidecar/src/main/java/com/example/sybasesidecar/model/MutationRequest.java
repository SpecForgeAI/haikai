package com.example.sybasesidecar.model;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * Request body for {@code POST /mutate} (Capture-State Discipline Spec 1 —
 * the compensation engine's Sybase write surface).
 *
 * <p>{@code statements} MUST each individually satisfy
 * {@code MutationSqlGuard} (plain single-statement INSERT/UPDATE/DELETE, the
 * IDENTITY_INSERT toggles, or the identity_burn_max reseed) or the sidecar
 * rejects the whole batch with HTTP 400 before touching JDBC.</p>
 *
 * <p>{@code transactional=true} (the default) applies the batch atomically:
 * autocommit off, all statements, one commit — rollback on any failure.
 * {@code transactional=false} exists ONLY for the reseed statement
 * ({@code sp_chgattribute} cannot run inside a user transaction).</p>
 */
public class MutationRequest {

    @NotBlank
    private String host;

    @NotNull
    @Min(1)
    private Integer port;

    @NotBlank
    private String database;

    @NotBlank
    private String username;

    @NotBlank
    private String password;

    /** Optional DETECTED server charset (e.g. iso_1) declared on the JDBC
     *  connection so single-byte data decodes correctly (2026-08-23). */
    private String charset;

    @NotNull
    @NotEmpty
    private List<String> statements;

    private Boolean transactional;

    private Integer queryTimeoutSeconds;

    /**
     * Guard mode: {@code "compensation"} (default) admits only the derived
     * inverse grammar; {@code "restore"} (Spec 2 — the S0 safety-net payout)
     * additionally admits {@code TRUNCATE TABLE <t>}. Anything else is
     * treated as compensation (the stricter mode).
     */
    private String mode;

    /**
     * Optional driver preference; defaults to {@link SybaseDriverChoice#AUTO}
     * when null/missing.
     */
    private SybaseDriverChoice driver;

    public SybaseDriverChoice getDriver() {
        return this.driver == null ? SybaseDriverChoice.AUTO : this.driver;
    }

    public void setDriver(final SybaseDriverChoice driver) {
        this.driver = driver;
    }

    public String getHost() {
        return this.host;
    }

    public void setHost(final String host) {
        this.host = host;
    }

    public Integer getPort() {
        return this.port;
    }

    public void setPort(final Integer port) {
        this.port = port;
    }

    public String getDatabase() {
        return this.database;
    }

    public void setDatabase(final String database) {
        this.database = database;
    }

    public String getUsername() {
        return this.username;
    }

    public void setUsername(final String username) {
        this.username = username;
    }

    public String getPassword() {
        return this.password;
    }

    public void setPassword(final String password) {
        this.password = password;
    }

    public List<String> getStatements() {
        return this.statements;
    }

    public void setStatements(final List<String> statements) {
        this.statements = statements;
    }

    public Boolean getTransactional() {
        return this.transactional;
    }

    public void setTransactional(final Boolean transactional) {
        this.transactional = transactional;
    }

    public Integer getQueryTimeoutSeconds() {
        return this.queryTimeoutSeconds;
    }

    public void setQueryTimeoutSeconds(final Integer queryTimeoutSeconds) {
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    /** Normalised: only the exact string {@code "restore"} relaxes the guard. */
    public boolean isRestoreMode() {
        return "restore".equalsIgnoreCase(this.mode == null ? "" : this.mode.trim());
    }

    public String getMode() {
        return this.mode;
    }

    public void setMode(final String mode) {
        this.mode = mode;
    }

    public String getCharset() {
        return this.charset;
    }

    public void setCharset(final String charset) {
        this.charset = charset;
    }
}
