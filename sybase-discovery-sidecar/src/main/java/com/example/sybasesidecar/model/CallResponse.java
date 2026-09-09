package com.example.sybasesidecar.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Response body for {@code POST /call} -- the engine-neutral
 * {@code RoutineInvocationEnvelope} of the Stored-Proc Behaviour Program
 * (Spec 2). The Postgres side of AMVS produces the SAME shape from a
 * translated routine, so the two engines' observed behaviour can be compared
 * field by field.
 *
 * <p>Wire keys are snake_case (declared per component with
 * {@link JsonProperty}); the sidecar has no global naming strategy, so every
 * multi-word key is spelled out here rather than inferred.</p>
 *
 * <p>{@code ok}/{@code error} are the TRANSPORT verdict (connection failure,
 * guard rejection, driver blow-up). {@code outcome}/{@code error_detail} are
 * the ROUTINE's verdict: a routine that raises a SQL error still returns
 * {@code ok=true} with {@code outcome=error}, because the invocation itself
 * succeeded and the error IS the observed behaviour worth capturing.</p>
 */
public record CallResponse(
        @JsonProperty("ok") boolean ok,
        @JsonProperty("error") String error,
        @JsonProperty("outcome") String outcome,
        @JsonProperty("return_status") Integer returnStatus,
        @JsonProperty("output_params") Map<String, Object> outputParams,
        @JsonProperty("result_sets") List<ResultSetPayload> resultSets,
        @JsonProperty("update_counts") List<Integer> updateCounts,
        @JsonProperty("messages") List<Message> messages,
        @JsonProperty("error_detail") ErrorDetail errorDetail,
        @JsonProperty("timing_ms") long timingMs,
        @JsonProperty("session") SessionInfo session,
        @JsonProperty("driver_used") String driverUsed
) {

    /** {@code outcome} value for a routine that completed without a SQL error. */
    public static final String OUTCOME_SUCCESS = "success";
    /** {@code outcome} value for a routine that raised a SQL error. */
    public static final String OUTCOME_ERROR = "error";

    /** One column header of a returned result set. */
    public record ColumnMeta(
            @JsonProperty("name") String name,
            @JsonProperty("type") String type
    ) {
    }

    /**
     * One result set the routine returned, in emission order.
     * {@code rows} are positional (column order), values normalised by
     * {@code SybaseQueryService.normalizeWireValue} so decimals/bigints are
     * strings, datetimes are naive {@code yyyy-MM-dd HH:mm:ss.SSS}, and
     * binaries are {@code \x}-hex -- the same wire shapes {@code /query}
     * emits.
     */
    public record ResultSetPayload(
            @JsonProperty("ordinal") int ordinal,
            @JsonProperty("columns") List<ColumnMeta> columns,
            @JsonProperty("rows") List<List<Object>> rows,
            @JsonProperty("row_count") int rowCount,
            @JsonProperty("truncated") boolean truncated
    ) {
    }

    /**
     * A server message drained from the statement / connection warning chain.
     * {@code kind} is {@code print} (number 0 -- a bare PRINT), {@code info}
     * (an informational message with a number) or {@code raiserror} (severity
     * 11+ that arrived as a warning rather than an exception).
     */
    public record Message(
            @JsonProperty("kind") String kind,
            @JsonProperty("number") Integer number,
            @JsonProperty("severity") Integer severity,
            @JsonProperty("state") Integer state,
            @JsonProperty("text") String text
    ) {
    }

    /** The ROUTINE's SQL error, projected from the driver's exception. */
    public record ErrorDetail(
            @JsonProperty("number") Integer number,
            @JsonProperty("sqlstate") String sqlstate,
            @JsonProperty("severity") Integer severity,
            @JsonProperty("state") Integer state,
            @JsonProperty("message") String message
    ) {
    }

    /** Session context the routine actually ran under. */
    public record SessionInfo(
            @JsonProperty("login") String login,
            @JsonProperty("set_options") List<String> setOptions
    ) {
    }

    /**
     * Transport failure envelope: guard rejection, connection failure, or any
     * blow-up BEFORE the routine ran. {@code ok=false} with the (masked)
     * reason; every collection empty so the Node consumer never null-checks.
     */
    public static CallResponse failure(final String error, final String driverUsed) {
        return new CallResponse(
                false,
                error,
                OUTCOME_ERROR,
                null,
                Collections.emptyMap(),
                Collections.emptyList(),
                Collections.emptyList(),
                Collections.emptyList(),
                null,
                0L,
                new SessionInfo(null, Collections.emptyList()),
                driverUsed
        );
    }
}
