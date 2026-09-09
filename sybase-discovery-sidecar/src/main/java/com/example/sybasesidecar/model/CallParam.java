package com.example.sybasesidecar.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Locale;

/**
 * One parameter of a {@code POST /call} routine invocation (Stored-Proc
 * Behaviour Program, Spec 2 — invocation surface).
 *
 * <p>There is NO SQL text anywhere on the call request: the service composes
 * {@code {?= call schema.name(?, ?)}} from the guard-validated identifier and
 * binds every parameter positionally through a
 * {@link java.sql.CallableStatement}. A parameter therefore carries only what
 * the binder needs — its position, its declared Sybase type, its direction and
 * its wire value.</p>
 *
 * <p>{@code value} is ALWAYS the wire string form (the same shape
 * {@code /query} emits: {@code yyyy-MM-dd HH:mm:ss.SSS} for datetimes,
 * {@code \x}-prefixed lowercase hex for binaries, plain decimal digits for
 * numerics). The binder parses it back into the JDBC type implied by
 * {@code sybaseType}; {@code isNull=true} (or a null {@code value}) binds a
 * typed SQL NULL instead.</p>
 */
public class CallParam {

    /**
     * Parameter name as declared by the routine (e.g. {@code @roll_id}). Used
     * only as the {@code output_params} key on the response envelope — binding
     * is positional, so an absent name is not fatal.
     */
    private String name;

    /**
     * 1-based position within the routine's declared parameter list. The
     * return-status / function-result placeholder is NOT counted here; the
     * service offsets the JDBC index itself. Null means "use this element's
     * position in the {@code params} list".
     */
    private Integer ordinal;

    /**
     * Declared Sybase type, verbatim from the catalog (e.g. {@code int},
     * {@code varchar(40)}, {@code numeric(10,2)}, {@code datetime},
     * {@code bit}, {@code money}, {@code text}, {@code image}). Only the base
     * token before the first parenthesis drives the binder.
     */
    @JsonAlias({"sybase_type"})
    private String sybaseType;

    /**
     * {@code in} (default), {@code output}, or {@code inout}. {@code inout}
     * both binds the supplied value and registers the OUT slot.
     */
    private String direction;

    /** Wire-form value; ignored when {@link #getIsNull()} is true. */
    private String value;

    /** Explicit typed-NULL request. A null {@code value} implies the same. */
    @JsonProperty("isNull")
    @JsonAlias({"is_null"})
    private Boolean isNull;

    public String getName() {
        return this.name;
    }

    public void setName(final String name) {
        this.name = name;
    }

    public Integer getOrdinal() {
        return this.ordinal;
    }

    public void setOrdinal(final Integer ordinal) {
        this.ordinal = ordinal;
    }

    public String getSybaseType() {
        return this.sybaseType;
    }

    public void setSybaseType(final String sybaseType) {
        this.sybaseType = sybaseType;
    }

    public String getDirection() {
        return this.direction;
    }

    public void setDirection(final String direction) {
        this.direction = direction;
    }

    public String getValue() {
        return this.value;
    }

    public void setValue(final String value) {
        this.value = value;
    }

    @JsonProperty("isNull")
    public Boolean getIsNull() {
        return this.isNull;
    }

    @JsonProperty("isNull")
    public void setIsNull(final Boolean isNull) {
        this.isNull = isNull;
    }

    /** Lower-cased, trimmed direction; {@code in} when absent. */
    public String normalizedDirection() {
        final String raw = this.direction == null ? "" : this.direction.trim().toLowerCase(Locale.ROOT);
        if (raw.isEmpty()) {
            return "in";
        }
        return raw;
    }

    /** TRUE when an OUT slot must be registered for this parameter. */
    public boolean isOutput() {
        final String dir = this.normalizedDirection();
        return "output".equals(dir) || "out".equals(dir) || "inout".equals(dir);
    }

    /** TRUE when a value must be bound for this parameter. */
    public boolean isInput() {
        final String dir = this.normalizedDirection();
        return "in".equals(dir) || "inout".equals(dir);
    }

    /** TRUE when the bind must be a typed SQL NULL. */
    public boolean bindsNull() {
        return Boolean.TRUE.equals(this.isNull) || this.value == null;
    }
}
