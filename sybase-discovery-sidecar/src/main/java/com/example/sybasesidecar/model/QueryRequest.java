package com.example.sybasesidecar.model;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Request body for {@code POST /query}. {@code sql} MUST be SELECT-only or
 * the sidecar's {@code SidecarSqlGuard} will reject it with HTTP 400.
 * {@code queryTimeoutSeconds} is enforced via
 * {@code Statement.setQueryTimeout}; {@code maxRows} caps the result-set
 * walk regardless of the server's response size.
 */
public class QueryRequest {

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

    @NotBlank
    private String sql;

    private Integer queryTimeoutSeconds;
    private Integer maxRows;

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

    public String getSql() {
        return this.sql;
    }

    public void setSql(final String sql) {
        this.sql = sql;
    }

    public Integer getQueryTimeoutSeconds() {
        return this.queryTimeoutSeconds;
    }

    public void setQueryTimeoutSeconds(final Integer queryTimeoutSeconds) {
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    public Integer getMaxRows() {
        return this.maxRows;
    }

    public void setMaxRows(final Integer maxRows) {
        this.maxRows = maxRows;
    }

    public String getCharset() {
        return this.charset;
    }

    public void setCharset(final String charset) {
        this.charset = charset;
    }
}
