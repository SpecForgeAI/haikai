package com.example.dbsidecar.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The SOURCE database engine a sidecar request targets (SQL Server pair
 * programme, SPEC-1 §1.2; wire contract v2 §1).
 *
 * <p>The wire values are the programme's engine keys -- {@code "sybase"} and
 * {@code "mssql"} -- the same tokens discovery, the gateway and AMVS stamp on
 * packs, findings and report rows. Parsing is case-insensitive and tolerates
 * surrounding whitespace.</p>
 *
 * <p><b>Missing means {@code SYBASE}.</b> Every consumer that predates this
 * spec omits the field, and the sidecar served exactly one engine then, so a
 * missing engine is unambiguous back-compat rather than an error. The fallback
 * is logged ONCE per process (not per request: the log would otherwise be one
 * line per introspection call) so an operator can see that an un-migrated
 * consumer is still in the fleet.</p>
 *
 * <p>An UNKNOWN value is a hard error: {@link #fromJson} throws
 * {@link IllegalArgumentException}, which Jackson surfaces as a 400 at the
 * controller. A silent fallback there would run SQL Server catalog reads
 * against ASE (or vice versa) and produce a confusing empty introspection.</p>
 */
public enum SidecarEngine {

    /** Sybase ASE (the original, and the default when the field is absent). */
    SYBASE("sybase"),

    /** Microsoft SQL Server (2022 / 16.x is the pair's pinned version). */
    MSSQL("mssql");

    private static final Logger LOG = LoggerFactory.getLogger(SidecarEngine.class);

    /** One-shot latch for the "engine missing -> sybase" diagnostic. */
    private static final AtomicBoolean DEFAULT_LOGGED = new AtomicBoolean(false);

    private final String wireValue;

    SidecarEngine(final String wireValue) {
        this.wireValue = wireValue;
    }

    /** The wire token ({@code sybase} / {@code mssql}). */
    @JsonValue
    public String wireValue() {
        return this.wireValue;
    }

    /** TRUE for {@link #MSSQL} -- reads better than an {@code ==} at call sites. */
    public boolean isMssql() {
        return this == MSSQL;
    }

    /**
     * Jackson factory. Case-insensitive, whitespace-tolerant. {@code null} /
     * blank resolves to {@link #SYBASE} (back-compat, logged once); anything
     * else that is not a known engine key throws.
     */
    @JsonCreator
    public static SidecarEngine fromJson(final String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return defaultWhenMissing();
        }
        final String normalised = raw.trim().toLowerCase(Locale.ROOT);
        for (final SidecarEngine engine : values()) {
            if (engine.wireValue.equals(normalised)) {
                return engine;
            }
        }
        throw new IllegalArgumentException(
                "Unknown engine '" + raw.trim() + "'. Supported engines: sybase, mssql.");
    }

    /**
     * The back-compat default for a request that carries no {@code engine}.
     * Logs ONCE per process so the un-migrated consumer is visible without
     * flooding the log.
     */
    public static SidecarEngine defaultWhenMissing() {
        if (DEFAULT_LOGGED.compareAndSet(false, true)) {
            LOG.info("[diag-sidecar] engine_field_missing default=sybase "
                    + "note=request_carried_no_engine_field (logged once per process)");
        }
        return SYBASE;
    }
}
