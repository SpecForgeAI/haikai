package com.example.dbsidecar.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonUnwrapped;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Request body for {@code POST /call} (Stored-Proc Behaviour Program, Spec 2 --
 * the sidecar's routine-invocation surface).
 *
 * <p>Deliberately carries NO SQL text. The caller names a routine and supplies
 * typed parameters; {@code RoutineCallService} composes the JDBC call escape
 * ({@code &#123;?= call schema.name(?, ?)&#125;}) from identifier parts that
 * {@code CallSqlGuard} has already proven to be bare identifiers. Injection is
 * impossible by construction: there is no field an attacker could put SQL
 * into.</p>
 *
 * <p>Connection fields mirror {@link MutationRequest} exactly (the connection
 * is opened WRITABLE -- a routine may legitimately write).</p>
 *
 * <p>Limits may be supplied either nested ({@code limits: &#123;...&#125;}) or
 * flat at the top level; the nested form wins when both are present. All three
 * are clamped by {@link #resolveMaxRowsPerResultSet()} /
 * {@link #resolveMaxResultSets()} / {@link #resolveQueryTimeoutSeconds()}.
 * NOTE the timeout clamp is the LONG one ({@code [1, 86400]}), NOT the 300s
 * {@code /query} clamp: a batch routine may legitimately run for hours.</p>
 */
public class CallRequest implements ConnectionRequest {

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

    /**
     * The {@code /call} timeout ceiling in seconds (24h). Declared here so the
     * controller, the service and the tests share ONE constant, and so nobody
     * mistakes it for the {@code /query} 300s clamp.
     */
    public static final int MAX_CALL_TIMEOUT_SECONDS = 86_400;

    /** Row cap default per result set. */
    public static final int DEFAULT_MAX_ROWS_PER_RESULT_SET = 1000;
    /** Row cap ceiling per result set. */
    public static final int MAX_ROWS_PER_RESULT_SET_CEILING = 10_000;
    /** Result-set count default. */
    public static final int DEFAULT_MAX_RESULT_SETS = 10;
    /** Result-set count ceiling. */
    public static final int MAX_RESULT_SETS_CEILING = 50;
    /** Query timeout default (seconds). */
    public static final int DEFAULT_CALL_TIMEOUT_SECONDS = 30;

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

    /** Optional DETECTED server charset (e.g. iso_1), as on the other endpoints. */
    private String charset;

    /** Optional driver preference; {@link SybaseDriverChoice#AUTO} when absent. */
    private SybaseDriverChoice driver;

    /** Owning schema; {@code dbo} when absent. May itself be dotted (db.dbo). */
    @JsonAlias({"schema_name"})
    private String schemaName;

    /** Routine name. May be dotted (schema.name / db.schema.name), never quoted. */
    @NotBlank
    @JsonAlias({"routine_name"})
    private String routineName;

    /** {@code procedure} (default) or {@code function}. */
    @JsonAlias({"routine_kind"})
    private String routineKind;

    @Valid
    private List<CallParam> params;

    /** Capture the {@code @@rc} return status; default true for procedures. */
    @JsonAlias({"return_status"})
    private Boolean returnStatus;

    /** Guard-allowlisted SET lines applied before the call (e.g. {@code set nocount off}). */
    @JsonAlias({"session_set"})
    private List<String> sessionSet;

    /** Nested limits object; wins over the flat fields when present. */
    @Valid
    private CallLimits limits;

    @JsonAlias({"max_rows_per_result_set"})
    private Integer maxRowsPerResultSet;

    @JsonAlias({"max_result_sets"})
    private Integer maxResultSets;

    @JsonAlias({"query_timeout_seconds"})
    private Integer queryTimeoutSeconds;

    /** Nested {@code limits} bean; every field optional. */
    public static class CallLimits {

        @JsonAlias({"max_rows_per_result_set"})
        private Integer maxRowsPerResultSet;

        @JsonAlias({"max_result_sets"})
        private Integer maxResultSets;

        @JsonAlias({"query_timeout_seconds"})
        private Integer queryTimeoutSeconds;

        public Integer getMaxRowsPerResultSet() {
            return this.maxRowsPerResultSet;
        }

        public void setMaxRowsPerResultSet(final Integer maxRowsPerResultSet) {
            this.maxRowsPerResultSet = maxRowsPerResultSet;
        }

        public Integer getMaxResultSets() {
            return this.maxResultSets;
        }

        public void setMaxResultSets(final Integer maxResultSets) {
            this.maxResultSets = maxResultSets;
        }

        public Integer getQueryTimeoutSeconds() {
            return this.queryTimeoutSeconds;
        }

        public void setQueryTimeoutSeconds(final Integer queryTimeoutSeconds) {
            this.queryTimeoutSeconds = queryTimeoutSeconds;
        }
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

    @Override
    public String getCharset() {
        return this.charset;
    }

    public void setCharset(final String charset) {
        this.charset = charset;
    }

    @Override
    public SybaseDriverChoice getDriver() {
        return this.driver == null ? SybaseDriverChoice.AUTO : this.driver;
    }

    public void setDriver(final SybaseDriverChoice driver) {
        this.driver = driver;
    }

    public String getSchemaName() {
        return this.schemaName;
    }

    public void setSchemaName(final String schemaName) {
        this.schemaName = schemaName;
    }

    /** Trimmed schema, defaulting to {@code dbo} when absent/blank. */
    public String resolveSchemaName() {
        return this.schemaName == null || this.schemaName.trim().isEmpty()
                ? "dbo"
                : this.schemaName.trim();
    }

    public String getRoutineName() {
        return this.routineName;
    }

    public void setRoutineName(final String routineName) {
        this.routineName = routineName;
    }

    public String getRoutineKind() {
        return this.routineKind;
    }

    public void setRoutineKind(final String routineKind) {
        this.routineKind = routineKind;
    }

    /** TRUE only for the exact kind {@code function}; everything else is a procedure. */
    public boolean isFunction() {
        return "function".equals(
                this.routineKind == null ? "" : this.routineKind.trim().toLowerCase(Locale.ROOT));
    }

    public List<CallParam> getParams() {
        return this.params;
    }

    public void setParams(final List<CallParam> params) {
        this.params = params;
    }

    /** Never null. */
    public List<CallParam> resolveParams() {
        return this.params == null ? Collections.emptyList() : this.params;
    }

    public Boolean getReturnStatus() {
        return this.returnStatus;
    }

    public void setReturnStatus(final Boolean returnStatus) {
        this.returnStatus = returnStatus;
    }

    /**
     * Capture the return status? Default TRUE for procedures. A function has no
     * {@code @@rc} -- its {@code ?} placeholder carries the function RESULT
     * instead -- so the flag is meaningless there and reported as false.
     */
    public boolean resolveReturnStatus() {
        if (this.isFunction()) {
            return false;
        }
        return this.returnStatus == null || this.returnStatus;
    }

    public List<String> getSessionSet() {
        return this.sessionSet;
    }

    public void setSessionSet(final List<String> sessionSet) {
        this.sessionSet = sessionSet;
    }

    /** Never null. */
    public List<String> resolveSessionSet() {
        return this.sessionSet == null ? Collections.emptyList() : this.sessionSet;
    }

    public CallLimits getLimits() {
        return this.limits;
    }

    public void setLimits(final CallLimits limits) {
        this.limits = limits;
    }

    public Integer getMaxRowsPerResultSet() {
        return this.maxRowsPerResultSet;
    }

    public void setMaxRowsPerResultSet(final Integer maxRowsPerResultSet) {
        this.maxRowsPerResultSet = maxRowsPerResultSet;
    }

    public Integer getMaxResultSets() {
        return this.maxResultSets;
    }

    public void setMaxResultSets(final Integer maxResultSets) {
        this.maxResultSets = maxResultSets;
    }

    public Integer getQueryTimeoutSeconds() {
        return this.queryTimeoutSeconds;
    }

    public void setQueryTimeoutSeconds(final Integer queryTimeoutSeconds) {
        this.queryTimeoutSeconds = queryTimeoutSeconds;
    }

    /** Nested-wins picker shared by the three limit resolvers. */
    private static Integer pick(final Integer nested, final Integer flat) {
        return nested != null ? nested : flat;
    }

    /** Clamped to {@code [1, 10000]}; default 1000. */
    public int resolveMaxRowsPerResultSet() {
        final Integer raw = pick(
                this.limits == null ? null : this.limits.getMaxRowsPerResultSet(),
                this.maxRowsPerResultSet);
        return raw == null
                ? DEFAULT_MAX_ROWS_PER_RESULT_SET
                : Math.max(1, Math.min(MAX_ROWS_PER_RESULT_SET_CEILING, raw));
    }

    /** Clamped to {@code [1, 50]}; default 10. */
    public int resolveMaxResultSets() {
        final Integer raw = pick(
                this.limits == null ? null : this.limits.getMaxResultSets(),
                this.maxResultSets);
        return raw == null
                ? DEFAULT_MAX_RESULT_SETS
                : Math.max(1, Math.min(MAX_RESULT_SETS_CEILING, raw));
    }

    /**
     * Clamped to {@code [1, 86400]} (NOT the 300s {@code /query} ceiling);
     * default 30.
     */
    public int resolveQueryTimeoutSeconds() {
        final Integer raw = pick(
                this.limits == null ? null : this.limits.getQueryTimeoutSeconds(),
                this.queryTimeoutSeconds);
        return raw == null
                ? DEFAULT_CALL_TIMEOUT_SECONDS
                : Math.max(1, Math.min(MAX_CALL_TIMEOUT_SECONDS, raw));
    }
}
