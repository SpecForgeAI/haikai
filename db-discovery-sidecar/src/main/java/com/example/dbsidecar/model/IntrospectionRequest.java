package com.example.dbsidecar.model;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * Request body for {@code POST /introspect}. {@code includeSchemas} and
 * {@code includeTables} are optional case-insensitive filters; an empty or
 * null list means "no filter".
 */
public class IntrospectionRequest implements ConnectionRequest {

    /**
     * Engine selection + the mssql-only connection options (SPEC-1 §1.2).
     * {@code @JsonUnwrapped} keeps the wire FLAT ({@code engine},
     * {@code authScheme}, {@code domain}, {@code encrypt},
     * {@code trustServerCertificate}, {@code instanceName} at the top level of
     * the body) while the Java definition lives in one place.
     */
    @JsonUnwrapped
    private EngineOptions engineOptions = new EngineOptions();

    @Override
    public EngineOptions getEngineOptions() {
        return this.engineOptions;
    }

    public void setEngineOptions(final EngineOptions engineOptions) {
        this.engineOptions = engineOptions == null ? new EngineOptions() : engineOptions;
    }

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

    private List<String> includeSchemas;
    private List<String> includeTables;

    /**
     * Per-query timeout in seconds. Applied via Statement.setQueryTimeout
     * for every catalog walk. Default 30s when missing/zero.
     */
    private Integer queryTimeoutSeconds;

    /**
     * Optional driver preference; defaults to {@link SybaseDriverChoice#AUTO}
     * when null/missing.
     */
    private SybaseDriverChoice driver;

    @Override
    public SybaseDriverChoice getDriver() {
        return this.driver == null ? SybaseDriverChoice.AUTO : this.driver;
    }

    public void setDriver(final SybaseDriverChoice driver) {
        this.driver = driver;
    }

    @Override
    public String getHost() {
        return this.host;
    }

    public void setHost(final String host) {
        this.host = host;
    }

    @Override
    public Integer getPort() {
        return this.port;
    }

    public void setPort(final Integer port) {
        this.port = port;
    }

    @Override
    public String getDatabase() {
        return this.database;
    }

    public void setDatabase(final String database) {
        this.database = database;
    }

    @Override
    public String getUsername() {
        return this.username;
    }

    public void setUsername(final String username) {
        this.username = username;
    }

    @Override
    public String getPassword() {
        return this.password;
    }

    public void setPassword(final String password) {
        this.password = password;
    }

    public List<String> getIncludeSchemas() {
        return this.includeSchemas;
    }

    public void setIncludeSchemas(final List<String> includeSchemas) {
        this.includeSchemas = includeSchemas;
    }

    public List<String> getIncludeTables() {
        return this.includeTables;
    }

    public void setIncludeTables(final List<String> includeTables) {
        this.includeTables = includeTables;
    }

    public Integer getQueryTimeoutSeconds() {
        return this.queryTimeoutSeconds;
    }

    public void setQueryTimeoutSeconds(final Integer queryTimeoutSeconds) {
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    @Override
    public String getCharset() {
        return this.charset;
    }

    public void setCharset(final String charset) {
        this.charset = charset;
    }
}
