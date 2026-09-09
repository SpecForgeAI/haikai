package com.example.sybasesidecar.service;

import com.example.sybasesidecar.model.CallParam;
import com.example.sybasesidecar.model.CallRequest;
import com.example.sybasesidecar.model.CallResponse;
import com.example.sybasesidecar.model.SybaseDriverChoice;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.sql.Types;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Executor for the {@code /call} endpoint (Stored-Proc Behaviour Program,
 * Spec 2) -- invoke ONE stored procedure or function and return the FULL
 * observed behaviour as an engine-neutral envelope.
 *
 * <p>Sibling of {@link SybaseQueryService} (read-only SELECTs) and
 * {@link SybaseMutationService} (the compensation write batch). Like the
 * mutation service it opens its own per-request connection WITHOUT the
 * read-only flag -- a routine may legitimately write -- but unlike it, the
 * connection stays on AUTOCOMMIT: a routine owns its own transaction
 * semantics ({@code chained} mode, explicit BEGIN/COMMIT in the body,
 * {@code @@trancount} juggling), and wrapping it in an outer transaction
 * would change the very behaviour being captured.</p>
 *
 * <p>There is NO SQL text on the request. {@link CallSqlGuard} proves the
 * routine identifier is 1-3 bare identifier parts and this service composes
 * the JDBC call escape itself, so nothing a caller supplies can become SQL.
 * Parameters are bound positionally through a {@link CallableStatement}.</p>
 *
 * <p>Never logs routine names, parameters or values; error messages are
 * password-masked (via {@link SybaseMutationService#maskPassword}) before
 * leaving the JVM.</p>
 */
@Service
public class SybaseCallService {

    private static final Logger LOG = LoggerFactory.getLogger(SybaseCallService.class);

    /**
     * Timeout ceiling for a routine invocation, in seconds (24h). Deliberately
     * NOT the {@code /query} 300s clamp: a nightly batch procedure is a
     * legitimate capture target and truncating it at five minutes would turn a
     * slow success into a false timeout. Mirrors
     * {@link CallRequest#MAX_CALL_TIMEOUT_SECONDS} so the controller, the
     * service and the tests share one number.
     */
    public static final int MAX_CALL_TIMEOUT_SECONDS = CallRequest.MAX_CALL_TIMEOUT_SECONDS;

    /** Envelope-level message text when {@code maxResultSets} clipped the walk. */
    static final String MSG_RESULT_SETS_CAPPED = "result_sets_capped";

    /** {@code output_params} key for a function result with no declared name. */
    static final String DEFAULT_FUNCTION_RESULT_KEY = "return_value";

    /** Defensive bound on the result/update-count walk (a pathological driver). */
    private static final int MAX_WALK_STEPS = 10_000;

    /** Defensive bound on a warning chain walk. */
    private static final int MAX_WARNING_CHAIN = 1000;

    private final DriverStrategy jtds;
    private final DriverStrategy jconnect;

    /** Default constructor used by Spring. */
    public SybaseCallService() {
        this(new JtdsDriverStrategy(), new JConnectDriverStrategy());
    }

    /** Constructor used by tests to inject fake / stub strategies. */
    SybaseCallService(final DriverStrategy jtds, final DriverStrategy jconnect) {
        this.jtds = jtds;
        this.jconnect = jconnect;
    }

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    /**
     * Invoke the routine and return the full envelope.
     *
     * <p>{@code ok=false} means the INVOCATION failed (guard rejection,
     * connection failure, bind failure, session-SET failure) -- nothing about
     * the routine was observed. {@code ok=true} with {@code outcome=error}
     * means the routine RAN and raised: that error is itself the captured
     * behaviour, and everything collected before it (result sets, messages) is
     * kept.</p>
     *
     * @param req the validated request bean
     * @param timeoutSeconds already-clamped statement timeout
     * @param maxRowsPerResultSet already-clamped per-result-set row cap
     * @param maxResultSets already-clamped result-set count cap
     */
    public CallResponse call(
            final CallRequest req,
            final int timeoutSeconds,
            final int maxRowsPerResultSet,
            final int maxResultSets
    ) {
        final String qualifiedName;
        final List<String> sessionSets;
        try {
            // Re-assert the guard at the service layer: no caller is trusted,
            // matching the read + write paths' two-layer posture.
            qualifiedName = CallSqlGuard.assertCall(req);
            sessionSets = CallSqlGuard.assertSessionSet(req.resolveSessionSet());
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            LOG.warn("[diag-sidecar] op=call status=rejected reason={}", e.getReason());
            return CallResponse.failure("Call guard rejected: " + e.getMessage(), null);
        }

        final String password = req.getPassword();
        final boolean function = req.isFunction();
        final boolean returnStatus = req.resolveReturnStatus();
        final CallParam functionResultDescriptor = returnDescriptor(req.resolveParams());
        final List<CallParam> ordered = orderParams(req.resolveParams());
        final String callString =
                composeCallString(qualifiedName, function, returnStatus, ordered.size());
        // The return-status / function-result placeholder occupies JDBC index 1.
        final int indexOffset = function || returnStatus ? 1 : 0;

        final List<CallResponse.ResultSetPayload> resultSets = new ArrayList<>();
        final List<Integer> updateCounts = new ArrayList<>();
        final List<CallResponse.Message> messages = new ArrayList<>();
        final Map<String, Object> outputParams = new LinkedHashMap<>();
        final CallResponse.SessionInfo session =
                new CallResponse.SessionInfo(req.getUsername(), sessionSets);

        Connection conn = null;
        String driverUsed = this.lastAttemptedDriverName(req.getDriver());
        Integer returnStatusValue = null;
        CallResponse.ErrorDetail errorDetail = null;
        long timingMs = 0L;

        try {
            final OpenResult opened = this.openWritableConnection(
                    req.getDriver(), req.getHost(), req.getPort(), req.getDatabase(),
                    req.getUsername(), password, req.getCharset());
            conn = opened.connection();
            driverUsed = opened.driverName();
            conn.setAutoCommit(true);
            applySessionSets(conn, sessionSets);

            try (CallableStatement cs = conn.prepareCall(callString)) {
                try {
                    cs.setQueryTimeout(
                            Math.max(1, Math.min(MAX_CALL_TIMEOUT_SECONDS, timeoutSeconds)));
                } catch (final SQLException ignored) {
                    // Driver may not support per-statement timeouts; proceed.
                }
                try {
                    // Sentinel: fetch ONE row beyond the cap so a clipped set is
                    // observable (same trick as /query, gold standard 2026-08-07).
                    cs.setMaxRows(maxRowsPerResultSet + 1);
                } catch (final SQLException ignored) {
                    // Row cap re-checked in the collection loop regardless.
                }

                if (returnStatus) {
                    cs.registerOutParameter(1, Types.INTEGER);
                } else if (function) {
                    registerFunctionResult(cs, functionResultDescriptor);
                }
                bindAll(cs, ordered, indexOffset);

                final long startedNanos = System.nanoTime();
                boolean capped = false;
                try {
                    capped = walkResults(
                            cs, resultSets, updateCounts, messages,
                            maxRowsPerResultSet, maxResultSets, password);
                } catch (final SQLException e) {
                    // The ROUTINE raised. Keep everything observed so far.
                    errorDetail = projectError(e, password);
                    LOG.warn("[diag-sidecar] op=call routine_error number={} sqlstate={}",
                            e.getErrorCode(), e.getSQLState() == null ? "?" : e.getSQLState());
                }
                if (capped) {
                    markResultSetsCapped(resultSets, messages);
                }

                if (errorDetail == null) {
                    returnStatusValue = readReturnStatus(
                            cs, function, returnStatus, functionResultDescriptor,
                            outputParams, messages, password);
                    readOutputParams(cs, ordered, indexOffset, outputParams, messages, password);
                }
                drainWarnings(safeWarnings(cs), messages, password);
                drainWarnings(safeWarnings(conn), messages, password);
                timingMs = (System.nanoTime() - startedNanos) / 1_000_000L;
            }
        } catch (final SQLException e) {
            // Transport-level: connection, prepare, session SET, or an OUT
            // registration failed. Nothing about the routine was observed.
            LOG.warn("[diag-sidecar] op=call status=200 result=fail stage=transport sqlstate={}",
                    e.getSQLState() == null ? "?" : e.getSQLState());
            return CallResponse.failure(
                    SybaseMutationService.maskPassword(e.getMessage(), password), driverUsed);
        } catch (final IllegalArgumentException | DateTimeException e) {
            // A parameter could not be coerced from its wire form. Loud, and
            // never echoes the value (only the parameter label + type).
            LOG.warn("[diag-sidecar] op=call status=200 result=fail stage=bind");
            return CallResponse.failure(
                    SybaseMutationService.maskPassword(e.getMessage(), password), driverUsed);
        } finally {
            closeQuietly(conn);
        }

        return new CallResponse(
                true,
                null,
                errorDetail == null ? CallResponse.OUTCOME_SUCCESS : CallResponse.OUTCOME_ERROR,
                returnStatusValue,
                outputParams,
                resultSets,
                updateCounts,
                messages,
                errorDetail,
                timingMs,
                session,
                driverUsed
        );
    }

    // ------------------------------------------------------------------
    // Call-string composition (pure)
    // ------------------------------------------------------------------

    /**
     * Compose the JDBC call escape. {@code qualifiedName} MUST already have
     * passed {@link CallSqlGuard#assertRoutineName} -- every part is a bare
     * identifier, so the composed string cannot carry injected SQL.
     *
     * <ul>
     *   <li>procedure, return status captured: {@code &#123;?= call n(?, ?)&#125;}</li>
     *   <li>procedure, no return status: {@code &#123;call n(?, ?)&#125;}</li>
     *   <li>function: {@code &#123;? = call n(?, ?)&#125;} -- the leading
     *       placeholder is the function RESULT, not a status</li>
     * </ul>
     */
    static String composeCallString(
            final String qualifiedName,
            final boolean function,
            final boolean returnStatus,
            final int paramCount
    ) {
        final StringBuilder markers = new StringBuilder();
        for (int i = 0; i < paramCount; i++) {
            if (i > 0) {
                markers.append(", ");
            }
            markers.append('?');
        }
        final String tail = qualifiedName + "(" + markers + ")";
        if (function) {
            return "{? = call " + tail + "}";
        }
        if (returnStatus) {
            return "{?= call " + tail + "}";
        }
        return "{call " + tail + "}";
    }

    /**
     * Positional parameters in bind order: ordinal 0 is reserved for the
     * optional function-result descriptor and is excluded here; the rest are
     * sorted by ordinal (absent ordinals last, original order preserved --
     * {@link List#sort} is stable). JDBC indexes are then assigned DENSELY
     * from the resulting order, because the composed call string has exactly
     * one marker per element and JDBC forbids gaps.
     */
    static List<CallParam> orderParams(final List<CallParam> params) {
        final List<CallParam> ordered = new ArrayList<>();
        if (params == null) {
            return ordered;
        }
        for (final CallParam p : params) {
            if (p != null && !isReturnDescriptor(p)) {
                ordered.add(p);
            }
        }
        ordered.sort(Comparator.comparingInt(
                p -> p.getOrdinal() == null ? Integer.MAX_VALUE : p.getOrdinal()));
        return ordered;
    }

    /**
     * The optional {@code ordinal = 0} entry, which describes the FUNCTION
     * RESULT slot (its {@code sybaseType} gives the registered JDBC type and
     * its {@code name} the {@code output_params} key). Ordinals for real
     * parameters are 1-based, so 0 is free for this purpose.
     */
    static CallParam returnDescriptor(final List<CallParam> params) {
        if (params == null) {
            return null;
        }
        for (final CallParam p : params) {
            if (p != null && isReturnDescriptor(p)) {
                return p;
            }
        }
        return null;
    }

    private static boolean isReturnDescriptor(final CallParam p) {
        return p.getOrdinal() != null && p.getOrdinal() == 0;
    }

    // ------------------------------------------------------------------
    // Type mapping (pure)
    // ------------------------------------------------------------------

    /** Bind families -- which JDBC setter a Sybase type maps onto. */
    enum BindFamily {
        /** int / smallint / tinyint. */
        INTEGRAL,
        /** bigint. */
        BIGINT,
        /** bit. */
        BOOLEAN,
        /** numeric / decimal / money / smallmoney. */
        DECIMAL,
        /** float / real / double precision. */
        DOUBLE,
        /** datetime / smalldatetime / bigdatetime. */
        TIMESTAMP,
        /** date. */
        DATE,
        /** time / bigtime. */
        TIME,
        /** binary / varbinary / image (and the ASE rowversion "timestamp"). */
        BYTES,
        /** char / varchar / text and everything unrecognised. */
        STRING
    }

    /**
     * The base type token: everything before the first parenthesis,
     * lower-cased and trimmed, with a leading {@code unsigned} stripped and
     * whitespace runs collapsed ({@code "NUMERIC(10, 2)"} to {@code numeric},
     * {@code "DOUBLE  PRECISION"} to {@code double precision}).
     */
    static String baseTypeToken(final String sybaseType) {
        if (sybaseType == null) {
            return "";
        }
        String token = sybaseType.trim().toLowerCase(Locale.ROOT);
        final int paren = token.indexOf('(');
        if (paren >= 0) {
            token = token.substring(0, paren);
        }
        token = token.trim().replaceAll("\\s+", " ");
        if (token.startsWith("unsigned ")) {
            token = token.substring("unsigned ".length()).trim();
        }
        return token;
    }

    /** Which setter family binds this Sybase type. Unknown types bind as strings. */
    static BindFamily familyFor(final String sybaseType) {
        switch (baseTypeToken(sybaseType)) {
            case "int":
            case "integer":
            case "smallint":
            case "tinyint":
                return BindFamily.INTEGRAL;
            case "bigint":
                return BindFamily.BIGINT;
            case "bit":
                return BindFamily.BOOLEAN;
            case "numeric":
            case "decimal":
            case "dec":
            case "money":
            case "smallmoney":
                return BindFamily.DECIMAL;
            case "float":
            case "real":
            case "double":
            case "double precision":
                return BindFamily.DOUBLE;
            case "datetime":
            case "smalldatetime":
            case "bigdatetime":
                return BindFamily.TIMESTAMP;
            case "date":
                return BindFamily.DATE;
            case "time":
            case "bigtime":
                return BindFamily.TIME;
            case "binary":
            case "varbinary":
            case "image":
            // ASE's "timestamp" is a rowversion (binary(8)), NOT a datetime.
            case "timestamp":
                return BindFamily.BYTES;
            default:
                return BindFamily.STRING;
        }
    }

    /**
     * The {@link Types} constant used for typed NULLs and OUT registration.
     * Unknown types resolve to {@link Types#VARCHAR}, the most forgiving
     * choice on both drivers.
     */
    static int jdbcTypeFor(final String sybaseType) {
        switch (baseTypeToken(sybaseType)) {
            case "int":
            case "integer":
                return Types.INTEGER;
            case "smallint":
                return Types.SMALLINT;
            case "tinyint":
                return Types.TINYINT;
            case "bigint":
                return Types.BIGINT;
            case "bit":
                return Types.BIT;
            case "numeric":
            case "decimal":
            case "dec":
                return Types.NUMERIC;
            case "money":
            case "smallmoney":
                return Types.DECIMAL;
            case "float":
            case "double":
            case "double precision":
                return Types.DOUBLE;
            case "real":
                return Types.REAL;
            case "datetime":
            case "smalldatetime":
            case "bigdatetime":
                return Types.TIMESTAMP;
            case "date":
                return Types.DATE;
            case "time":
            case "bigtime":
                return Types.TIME;
            case "binary":
                return Types.BINARY;
            case "varbinary":
            case "timestamp":
                return Types.VARBINARY;
            case "image":
                return Types.LONGVARBINARY;
            case "char":
            case "nchar":
            case "unichar":
                return Types.CHAR;
            case "text":
            case "unitext":
                return Types.LONGVARCHAR;
            default:
                return Types.VARCHAR;
        }
    }

    // ------------------------------------------------------------------
    // Wire-value coercion (pure)
    // ------------------------------------------------------------------

    /**
     * Lenient wire datetime parser. Accepts the canonical
     * {@code yyyy-MM-dd HH:mm:ss.SSS} the sidecar emits plus the shapes a
     * caller (or an LLM-authored scenario) realistically produces: a
     * {@code T} separator, a missing / longer / shorter fraction, a missing
     * seconds field, a bare date, and a trailing {@code Z}.
     */
    private static final DateTimeFormatter LENIENT_DATETIME = new DateTimeFormatterBuilder()
            .appendPattern("yyyy-MM-dd")
            .optionalStart()
            .optionalStart().appendLiteral('T').optionalEnd()
            .optionalStart().appendLiteral(' ').optionalEnd()
            .appendPattern("HH:mm")
            .optionalStart().appendPattern(":ss").optionalEnd()
            .optionalStart().appendFraction(ChronoField.NANO_OF_SECOND, 1, 9, true).optionalEnd()
            .optionalEnd()
            .parseDefaulting(ChronoField.HOUR_OF_DAY, 0)
            .parseDefaulting(ChronoField.MINUTE_OF_HOUR, 0)
            .parseDefaulting(ChronoField.SECOND_OF_MINUTE, 0)
            .parseDefaulting(ChronoField.NANO_OF_SECOND, 0)
            .toFormatter(Locale.ROOT);

    /** Lenient time-of-day parser: {@code HH:mm[:ss[.fraction]]}. */
    private static final DateTimeFormatter LENIENT_TIME = new DateTimeFormatterBuilder()
            .appendPattern("HH:mm")
            .optionalStart().appendPattern(":ss").optionalEnd()
            .optionalStart().appendFraction(ChronoField.NANO_OF_SECOND, 1, 9, true).optionalEnd()
            .parseDefaulting(ChronoField.SECOND_OF_MINUTE, 0)
            .parseDefaulting(ChronoField.NANO_OF_SECOND, 0)
            .toFormatter(Locale.ROOT);

    /** Strip surrounding whitespace and a trailing zone marker. */
    private static String trimTemporal(final String value) {
        String v = value == null ? "" : value.trim();
        if (v.endsWith("Z") || v.endsWith("z")) {
            v = v.substring(0, v.length() - 1).trim();
        }
        return v;
    }

    /** Wire string to {@link LocalDateTime} (naive; no zone conversion ever). */
    static LocalDateTime parseWireDateTime(final String value) {
        final TemporalAccessor parsed = LENIENT_DATETIME.parse(trimTemporal(value));
        return LocalDateTime.from(parsed);
    }

    /** Wire string to {@link java.sql.Timestamp}. */
    static java.sql.Timestamp parseWireTimestamp(final String value) {
        return java.sql.Timestamp.valueOf(parseWireDateTime(value));
    }

    /** Wire string to {@link java.sql.Date} (a full datetime is truncated). */
    static java.sql.Date parseWireDate(final String value) {
        final LocalDate date = parseWireDateTime(value).toLocalDate();
        return java.sql.Date.valueOf(date);
    }

    /**
     * Wire string to {@link java.sql.Time}. Accepts a bare time-of-day or a
     * full datetime (whose time part is taken).
     */
    static java.sql.Time parseWireTime(final String value) {
        final String trimmed = trimTemporal(value);
        final LocalTime time = trimmed.indexOf('-') >= 0
                ? parseWireDateTime(trimmed).toLocalTime()
                : LocalTime.from(LENIENT_TIME.parse(trimmed));
        return java.sql.Time.valueOf(time.withNano(0));
    }

    /**
     * Decode the sidecar's binary wire form: a {@code \x} (or {@code 0x})
     * prefixed lowercase-hex string, whitespace tolerated. Mirrors the
     * encoder in {@code SybaseQueryService.normalizeWireValue}, so a value
     * read from one endpoint binds unchanged on this one.
     */
    static byte[] decodeHexBytes(final String value) {
        if (value == null) {
            return null;
        }
        String hex = value.trim().replaceAll("\\s+", "");
        if (hex.startsWith("\\x") || hex.startsWith("\\X")) {
            hex = hex.substring(2);
        } else if (hex.startsWith("0x") || hex.startsWith("0X")) {
            hex = hex.substring(2);
        }
        if (hex.isEmpty()) {
            return new byte[0];
        }
        if (hex.length() % 2 != 0) {
            throw new IllegalArgumentException("binary value has an odd hex length");
        }
        final byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            final int hi = Character.digit(hex.charAt(i * 2), 16);
            final int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) {
                throw new IllegalArgumentException("binary value is not hexadecimal");
            }
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    /** Lenient integral parse: tolerates a leading {@code +} and a decimal tail. */
    static long parseWireLong(final String value) {
        final String v = value == null ? "" : value.trim();
        try {
            return Long.parseLong(v.startsWith("+") ? v.substring(1) : v);
        } catch (final NumberFormatException e) {
            return new BigDecimal(v).longValueExact();
        }
    }

    /** Lenient boolean parse for {@code bit}: 1/0, true/false, t/f, y/n, yes/no, on/off. */
    static boolean parseWireBoolean(final String value) {
        final String v = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        switch (v) {
            case "1":
            case "true":
            case "t":
            case "y":
            case "yes":
            case "on":
                return true;
            case "0":
            case "false":
            case "f":
            case "n":
            case "no":
            case "off":
                return false;
            default:
                throw new IllegalArgumentException("bit value is neither true nor false");
        }
    }

    // ------------------------------------------------------------------
    // Binding
    // ------------------------------------------------------------------

    private static void bindAll(
            final CallableStatement cs,
            final List<CallParam> ordered,
            final int indexOffset
    ) throws SQLException {
        for (int i = 0; i < ordered.size(); i++) {
            final CallParam p = ordered.get(i);
            final int index = i + 1 + indexOffset;
            if (p.isOutput()) {
                cs.registerOutParameter(index, jdbcTypeFor(p.getSybaseType()));
            }
            if (p.isInput()) {
                bindParam(cs, index, p);
            }
        }
    }

    /**
     * Bind ONE parameter from its wire string. A coercion failure is a loud
     * {@link IllegalArgumentException} naming the parameter and its type --
     * never its value (values may carry business data).
     */
    static void bindParam(final CallableStatement cs, final int index, final CallParam p)
            throws SQLException {
        final int jdbcType = jdbcTypeFor(p.getSybaseType());
        if (p.bindsNull()) {
            cs.setNull(index, jdbcType);
            return;
        }
        final String value = p.getValue();
        try {
            switch (familyFor(p.getSybaseType())) {
                case INTEGRAL:
                    cs.setInt(index, Math.toIntExact(parseWireLong(value)));
                    break;
                case BIGINT:
                    cs.setLong(index, parseWireLong(value));
                    break;
                case BOOLEAN:
                    cs.setBoolean(index, parseWireBoolean(value));
                    break;
                case DECIMAL:
                    cs.setBigDecimal(index, new BigDecimal(value.trim()));
                    break;
                case DOUBLE:
                    cs.setDouble(index, Double.parseDouble(value.trim()));
                    break;
                case TIMESTAMP:
                    cs.setTimestamp(index, parseWireTimestamp(value));
                    break;
                case DATE:
                    cs.setDate(index, parseWireDate(value));
                    break;
                case TIME:
                    cs.setTime(index, parseWireTime(value));
                    break;
                case BYTES:
                    cs.setBytes(index, decodeHexBytes(value));
                    break;
                case STRING:
                default:
                    cs.setString(index, value);
                    break;
            }
        } catch (final ArithmeticException | IllegalArgumentException | DateTimeException e) {
            throw new IllegalArgumentException(
                    "Parameter " + paramLabel(p, index) + " of declared type '"
                            + (p.getSybaseType() == null ? "?" : p.getSybaseType())
                            + "' could not be bound from its wire value ("
                            + e.getClass().getSimpleName() + ").");
        }
    }

    /**
     * Register the FUNCTION result placeholder at index 1. Uses the declared
     * type of the optional {@code ordinal = 0} descriptor when the caller
     * supplied one; otherwise falls back through {@link Types#OTHER} to
     * {@link Types#VARCHAR}, the shape every driver accepts.
     */
    private static void registerFunctionResult(
            final CallableStatement cs,
            final CallParam descriptor
    ) throws SQLException {
        if (descriptor != null && descriptor.getSybaseType() != null) {
            cs.registerOutParameter(1, jdbcTypeFor(descriptor.getSybaseType()));
            return;
        }
        try {
            cs.registerOutParameter(1, Types.OTHER);
        } catch (final SQLException e) {
            cs.registerOutParameter(1, Types.VARCHAR);
        }
    }

    // ------------------------------------------------------------------
    // Result walk
    // ------------------------------------------------------------------

    /**
     * Walk every result set and update count the routine produced, in emission
     * order, until both {@code getResultSet()} is null and
     * {@code getUpdateCount()} is -1.
     *
     * @return TRUE when {@code maxResultSets} clipped the walk
     */
    private static boolean walkResults(
            final CallableStatement cs,
            final List<CallResponse.ResultSetPayload> resultSets,
            final List<Integer> updateCounts,
            final List<CallResponse.Message> messages,
            final int maxRowsPerResultSet,
            final int maxResultSets,
            final String password
    ) throws SQLException {
        boolean capped = false;
        boolean isResultSet = cs.execute();
        int steps = 0;
        while (steps++ < MAX_WALK_STEPS) {
            if (isResultSet) {
                final ResultSet rs = cs.getResultSet();
                if (rs != null) {
                    if (resultSets.size() < maxResultSets) {
                        resultSets.add(collectResultSet(
                                rs, resultSets.size() + 1, maxRowsPerResultSet));
                    } else {
                        // Still advance past it (below) so OUT params become
                        // readable, but do not materialise its rows.
                        capped = true;
                    }
                }
            } else {
                final int updateCount = cs.getUpdateCount();
                if (updateCount == -1) {
                    break;
                }
                updateCounts.add(updateCount);
            }
            // PRINT output arrives between results on Sybase; drain per step so
            // message ORDER approximates the routine's own emission order.
            drainWarnings(safeWarnings(cs), messages, password);
            try {
                cs.clearWarnings();
            } catch (final SQLException ignored) {
                // Non-fatal; the chain is re-read (and de-duplicated by
                // clearWarnings on the next driver that supports it).
            }
            isResultSet = cs.getMoreResults();
        }
        return capped;
    }

    /** Materialise one result set, honouring the per-set row cap sentinel. */
    private static CallResponse.ResultSetPayload collectResultSet(
            final ResultSet rs,
            final int ordinal,
            final int maxRows
    ) throws SQLException {
        final ResultSetMetaData md = rs.getMetaData();
        final int columnCount = md.getColumnCount();
        final List<CallResponse.ColumnMeta> columns = new ArrayList<>(columnCount);
        for (int i = 1; i <= columnCount; i++) {
            columns.add(new CallResponse.ColumnMeta(md.getColumnLabel(i), safeTypeName(md, i)));
        }
        final List<List<Object>> rows = new ArrayList<>();
        boolean truncated = false;
        while (rs.next()) {
            if (rows.size() >= maxRows) {
                truncated = true;
                break;
            }
            final List<Object> row = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++) {
                row.add(SybaseQueryService.normalizeWireValue(rs.getObject(i)));
            }
            rows.add(row);
        }
        return new CallResponse.ResultSetPayload(
                ordinal, columns, rows, rows.size(), truncated);
    }

    private static String safeTypeName(final ResultSetMetaData md, final int column) {
        try {
            return md.getColumnTypeName(column);
        } catch (final SQLException e) {
            return null;
        }
    }

    /**
     * Envelope-level truncation: the last COLLECTED set is flagged and an
     * {@code info} message names the cap, so a consumer can never mistake a
     * clipped walk for the routine's complete output.
     */
    private static void markResultSetsCapped(
            final List<CallResponse.ResultSetPayload> resultSets,
            final List<CallResponse.Message> messages
    ) {
        if (!resultSets.isEmpty()) {
            final int last = resultSets.size() - 1;
            final CallResponse.ResultSetPayload payload = resultSets.get(last);
            resultSets.set(last, new CallResponse.ResultSetPayload(
                    payload.ordinal(), payload.columns(), payload.rows(),
                    payload.rowCount(), true));
        }
        messages.add(new CallResponse.Message("info", null, null, null, MSG_RESULT_SETS_CAPPED));
    }

    // ------------------------------------------------------------------
    // OUT params + return status
    // ------------------------------------------------------------------

    private static Integer readReturnStatus(
            final CallableStatement cs,
            final boolean function,
            final boolean returnStatus,
            final CallParam descriptor,
            final Map<String, Object> outputParams,
            final List<CallResponse.Message> messages,
            final String password
    ) {
        try {
            if (returnStatus) {
                return cs.getInt(1);
            }
            if (function) {
                final Object raw = cs.getObject(1);
                final String key = descriptor != null && descriptor.getName() != null
                        && !descriptor.getName().trim().isEmpty()
                        ? descriptor.getName().trim()
                        : DEFAULT_FUNCTION_RESULT_KEY;
                outputParams.put(key, SybaseQueryService.normalizeWireValue(raw));
                // Mirror an integral function result into return_status so a
                // status-style function reads identically on both engines.
                if (raw instanceof Integer || raw instanceof Short || raw instanceof Byte) {
                    return ((Number) raw).intValue();
                }
            }
        } catch (final SQLException e) {
            messages.add(new CallResponse.Message(
                    "info", null, null, null,
                    "return placeholder unreadable: "
                            + SybaseMutationService.maskPassword(e.getMessage(), password)));
        }
        return null;
    }

    private static void readOutputParams(
            final CallableStatement cs,
            final List<CallParam> ordered,
            final int indexOffset,
            final Map<String, Object> outputParams,
            final List<CallResponse.Message> messages,
            final String password
    ) {
        for (int i = 0; i < ordered.size(); i++) {
            final CallParam p = ordered.get(i);
            if (!p.isOutput()) {
                continue;
            }
            final int index = i + 1 + indexOffset;
            final String key = outputKey(p, i + 1);
            try {
                outputParams.put(key, SybaseQueryService.normalizeWireValue(cs.getObject(index)));
            } catch (final SQLException e) {
                outputParams.put(key, null);
                messages.add(new CallResponse.Message(
                        "info", null, null, null,
                        "output param " + key + " unreadable: "
                                + SybaseMutationService.maskPassword(e.getMessage(), password)));
            }
        }
    }

    /** {@code output_params} key: the declared name, else {@code pN}. */
    static String outputKey(final CallParam p, final int position) {
        final String name = p.getName();
        return name == null || name.trim().isEmpty() ? "p" + position : name.trim();
    }

    /** Human label for a bind failure: the declared name, else the JDBC index. */
    private static String paramLabel(final CallParam p, final int index) {
        final String name = p.getName();
        return name == null || name.trim().isEmpty() ? "#" + index : "'" + name.trim() + "'";
    }

    // ------------------------------------------------------------------
    // Messages + errors
    // ------------------------------------------------------------------

    /**
     * Classify a drained server message. Number 0 is a bare {@code PRINT};
     * a message the driver marks severity 11+ is a {@code raiserror} that
     * arrived as a warning rather than an exception; everything else is
     * informational. Pure.
     */
    static String classifyMessageKind(final int number, final Integer severity) {
        if (number == 0) {
            return "print";
        }
        if (severity != null && severity >= 11) {
            return "raiserror";
        }
        return "info";
    }

    /** Drain a driver warning chain into the envelope's message list. */
    private static void drainWarnings(
            final SQLWarning first,
            final List<CallResponse.Message> messages,
            final String password
    ) {
        SQLWarning warning = first;
        int guard = 0;
        while (warning != null && guard++ < MAX_WARNING_CHAIN) {
            final Integer severity = reflectInt(warning, "getSeverity");
            final Integer state = reflectInt(warning, "getState");
            final int number = warning.getErrorCode();
            messages.add(new CallResponse.Message(
                    classifyMessageKind(number, severity),
                    number,
                    severity,
                    state,
                    SybaseMutationService.maskPassword(warning.getMessage(), password)));
            SQLWarning next;
            try {
                next = warning.getNextWarning();
            } catch (final RuntimeException e) {
                next = null;
            }
            warning = next;
        }
    }

    private static SQLWarning safeWarnings(final Statement st) {
        try {
            return st.getWarnings();
        } catch (final SQLException e) {
            return null;
        }
    }

    private static SQLWarning safeWarnings(final Connection conn) {
        try {
            return conn.getWarnings();
        } catch (final SQLException e) {
            return null;
        }
    }

    /**
     * Project a driver exception onto the envelope's {@code error_detail}.
     * {@code severity} / {@code state} are Sybase-specific and only jConnect
     * exposes them (through {@code EedInfo}); they are read reflectively and
     * are null on jTDS. The message is password-masked. Pure.
     */
    static CallResponse.ErrorDetail projectError(final SQLException e, final String password) {
        if (e == null) {
            return null;
        }
        return new CallResponse.ErrorDetail(
                e.getErrorCode(),
                e.getSQLState(),
                reflectInt(e, "getSeverity"),
                reflectInt(e, "getState"),
                SybaseMutationService.maskPassword(e.getMessage(), password));
    }

    /**
     * Best-effort reflective int read (jConnect's {@code EedInfo.getSeverity()}
     * / {@code getState()}). Null whenever the method is absent or unusable --
     * the sidecar compiles and runs without the jConnect jar.
     */
    static Integer reflectInt(final Object target, final String methodName) {
        if (target == null) {
            return null;
        }
        try {
            final Method method = target.getClass().getMethod(methodName);
            Object value;
            try {
                value = method.invoke(target);
            } catch (final IllegalAccessException retry) {
                method.setAccessible(true);
                value = method.invoke(target);
            }
            return value instanceof Number ? ((Number) value).intValue() : null;
        } catch (final ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Connection
    // ------------------------------------------------------------------

    /** An open connection plus the strategy name that produced it. */
    private record OpenResult(Connection connection, String driverName) {
    }

    /**
     * Open a WRITABLE per-request connection (no read-only flag: a routine may
     * write). Same AUTO jTDS-then-jConnect fallback the mutation service uses.
     */
    private OpenResult openWritableConnection(
            final SybaseDriverChoice choice,
            final String host,
            final int port,
            final String database,
            final String username,
            final String password,
            final String charset
    ) throws SQLException {
        if (choice == SybaseDriverChoice.AUTO) {
            SQLException jtdsErr;
            try {
                final Connection conn =
                        this.jtds.openConnection(host, port, database, username, password, charset);
                LOG.info("[diag-sidecar] op=call driver_attempt driver=jtds result=ok auto=true");
                return new OpenResult(conn, this.jtds.name());
            } catch (final SQLException e) {
                jtdsErr = e;
            }
            if (!this.jconnect.isAvailable()) {
                LOG.info("[diag-sidecar] op=call driver_attempt driver=jconnect skipped=unavailable");
                throw jtdsErr;
            }
            final Connection conn =
                    this.jconnect.openConnection(host, port, database, username, password, charset);
            LOG.info("[diag-sidecar] op=call driver_attempt driver=jconnect result=ok auto=true");
            return new OpenResult(conn, this.jconnect.name());
        }
        final DriverStrategy strategy =
                choice == SybaseDriverChoice.JCONNECT ? this.jconnect : this.jtds;
        final Connection conn =
                strategy.openConnection(host, port, database, username, password, charset);
        LOG.info("[diag-sidecar] op=call driver_attempt driver={} result=ok forced=true",
                strategy.name());
        return new OpenResult(conn, strategy.name());
    }

    /**
     * Apply the guard-allowlisted session options. Each line is re-asserted
     * immediately before execution, so only text the guard normalised can ever
     * reach the server. A failure here is a TRANSPORT failure: the session
     * profile the capture claims could not be established.
     */
    private static void applySessionSets(final Connection conn, final List<String> sessionSets)
            throws SQLException {
        if (sessionSets == null || sessionSets.isEmpty()) {
            return;
        }
        try (Statement st = conn.createStatement()) {
            for (final String line : sessionSets) {
                st.execute(CallSqlGuard.assertSessionSetLine(line));
            }
        }
    }

    /** Report the driver we would have tried, for error-path envelopes. */
    private String lastAttemptedDriverName(final SybaseDriverChoice choice) {
        if (choice == SybaseDriverChoice.JCONNECT) {
            return this.jconnect.name();
        }
        return this.jtds.name();
    }

    private static void closeQuietly(final Connection conn) {
        if (conn == null) {
            return;
        }
        try {
            conn.close();
        } catch (final SQLException ignored) {
            // Per-request connection; nothing more to release.
        }
    }
}
