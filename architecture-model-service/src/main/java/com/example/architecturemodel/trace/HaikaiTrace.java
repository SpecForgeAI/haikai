package com.example.architecturemodel.trace;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Haikai workflow trace logger -- see {@code docs/trace-logging.md}.
 *
 * <p>Java counterpart to the canonical Node helper
 * ({@code api-migration-validation-service/src/trace.ts}). The emitted line
 * format is byte-for-byte identical so the shared, multi-writer
 * {@code trace.log} interleaves cleanly across stacks and
 * {@code scripts/haikai-trace-summarize.mjs} parses every line uniformly.</p>
 *
 * <p>Plain static utility -- <b>no Spring dependency</b> so it can be called
 * from anywhere (controllers, services, plain helpers). OFF by default
 * (zero overhead: no filesystem touch, no string building, no JSON
 * serialisation). Controlled by two environment variables read ONCE at class
 * initialisation:</p>
 *
 * <pre>
 *   HAIKAI_TRACE       = off | summary | detail   (default off)
 *   HAIKAI_TRACE_FILE  = path                      (default ~/.haikai/trace.log)
 * </pre>
 *
 * <p>Two tiers, one shared file (atomic single-line {@code O_APPEND} writes):</p>
 * <ul>
 *   <li>{@code [SUMMARY]} -- human prose, one glyph-led line per step
 *       (tier &gt;= summary).</li>
 *   <li>{@code [detail]} -- event + compact JSON for diagnosis
 *       (tier == detail).</li>
 * </ul>
 *
 * <p>Tracing must NEVER throw: every filesystem / serialisation failure is
 * swallowed.</p>
 *
 * <p>Predicate self-scoring layer (rides the SUMMARY tier; greppable markers
 * {@code HAIKAI_PREDICATE}, {@code HAIKAI_STAGE_START}, {@code HAIKAI_SCORECARD},
 * {@code HAIKAI_CONFIG}) — same wire shapes as the Node helper; see
 * {@code agent-os/planning/2026-07-10-predicate-run-judging-design.md}.</p>
 */
public final class HaikaiTrace {

    /** Trace tiers, in increasing verbosity. */
    private enum Tier { OFF, SUMMARY, DETAIL }

    /**
     * Stable correlation-id order. Only set keys are emitted; values containing
     * whitespace are quoted. Mirrors {@code CORR_ORDER} in {@code trace.ts}.
     */
    private static final String[] CORR_ORDER =
        {"run", "session", "job", "bug", "project", "arch"};

    /**
     * ISO-8601 UTC formatter with FIXED millisecond precision ending in
     * {@code Z} (e.g. {@code 2026-06-16T16:11:39.335Z}). Deliberately NOT
     * {@code DateTimeFormatter.ISO_INSTANT}, whose fractional-second width
     * varies with the value -- a fixed 3-digit field matches JavaScript's
     * {@code Date.toISOString()} byte-for-byte.
     */
    private static final DateTimeFormatter TS_FORMATTER = new DateTimeFormatterBuilder()
        .appendPattern("yyyy-MM-dd'T'HH:mm:ss")
        .appendFraction(ChronoField.MILLI_OF_SECOND, 3, 3, true)
        .appendLiteral('Z')
        .toFormatter()
        .withZone(ZoneOffset.UTC);

    /**
     * Resolved ONCE at class initialisation from the environment. In production
     * nothing mutates these after init -- they are effectively read-once. The
     * package-private {@link #resetForTest(String, String)} seam re-resolves
     * them for tests that cannot guarantee env-before-classload ordering in a
     * shared test JVM; it is never called in production.
     */
    private static Tier tier = resolveTier();
    private static Path file = resolveFile();

    /** Ensure-parent-dir is attempted once (idempotent; failure is swallowed). */
    private static volatile boolean dirEnsured = false;

    /**
     * Predicate self-scoring tally, per-process, keyed by the stage prefix of
     * the predicate id ({@code "SCAN.EDGE.03"} tallies under {@code "SCAN"}) —
     * no ambient current-stage state, so concurrent request threads can't
     * mis-attribute a predicate. Guarded by {@link #TALLY_LOCK}.
     */
    private static final Map<String, StageTally> TALLY = new LinkedHashMap<>();
    private static final Object TALLY_LOCK = new Object();
    /** Caps keep predicate/scorecard lines bounded however hot a failing loop gets. */
    private static final int SCORECARD_FAILED_CAP = 25;
    private static final int SCORECARD_ACTUAL_CAP = 160;
    private static final int PREDICATE_TEXT_CAP = 400;

    private static final class StageTally {
        private int pass;
        private int fail;
        private int skip;
        private final List<Map<String, Object>> failed = new ArrayList<>();
    }

    /**
     * Test-only seam: re-read the configuration from the supplied raw values
     * (mirroring the env semantics) and reset the dir-ensured latch. NOT used in
     * production. Package-private so only the trace tests in this package reach
     * it.
     */
    static void resetForTest(String traceEnv, String fileEnv) {
        tier = parseTier(traceEnv);
        file = (fileEnv != null && !fileEnv.trim().isEmpty())
            ? Paths.get(fileEnv.trim())
            : Paths.get(System.getProperty("user.home"), ".haikai", "trace.log");
        dirEnsured = false;
        synchronized (TALLY_LOCK) {
            TALLY.clear();
        }
    }

    private HaikaiTrace() {
    }

    private static Tier resolveTier() {
        return parseTier(System.getenv("HAIKAI_TRACE"));
    }

    private static Tier parseTier(String v) {
        if (v == null) {
            return Tier.OFF;
        }
        switch (v.trim().toLowerCase()) {
            case "summary":
                return Tier.SUMMARY;
            case "detail":
                return Tier.DETAIL;
            default:
                return Tier.OFF;
        }
    }

    private static Path resolveFile() {
        String v = System.getenv("HAIKAI_TRACE_FILE");
        if (v != null && !v.trim().isEmpty()) {
            return Paths.get(v.trim());
        }
        // Default matches docs/trace-logging.md (~/.haikai/trace.log). The old
        // hardcoded C:\dev\data\haikai-trace.log default was a bug — the doc
        // was never implemented (fixed 2026-07-10, predicate-run-judging batch).
        return Paths.get(System.getProperty("user.home"), ".haikai", "trace.log");
    }

    /** Build a tracer bound to a service name (see the registry in the doc). */
    public static Tracer forService(String service) {
        return new Tracer(service);
    }

    // -----------------------------------------------------------------------
    // Correlation ids
    // -----------------------------------------------------------------------

    /**
     * Small ordered correlation bag. Keys are emitted in the fixed order
     * {@code run, session, job, bug, project, arch}; only set (non-null,
     * non-blank) keys appear. Mirrors the {@code Corr} interface in
     * {@code trace.ts}.
     */
    public static final class Corr {
        private final Map<String, String> values = new LinkedHashMap<>();

        public static Corr of() {
            return new Corr();
        }

        public Corr run(String v) {
            return put("run", v);
        }

        public Corr session(String v) {
            return put("session", v);
        }

        public Corr job(String v) {
            return put("job", v);
        }

        public Corr bug(String v) {
            return put("bug", v);
        }

        public Corr project(String v) {
            return put("project", v);
        }

        public Corr arch(String v) {
            return put("arch", v);
        }

        private Corr put(String key, String v) {
            if (v != null && !v.isEmpty()) {
                values.put(key, v);
            }
            return this;
        }

        String get(String key) {
            return values.get(key);
        }
    }

    /**
     * Format the correlation bag into the space-joined {@code key=value} string,
     * keys in {@link #CORR_ORDER}, values with whitespace quoted. Returns an
     * empty string when nothing is set (the caller drops empty parts).
     */
    private static String fmtCorr(Corr corr) {
        if (corr == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (String k : CORR_ORDER) {
            String val = corr.get(k);
            if (val == null || val.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(k).append('=');
            if (hasWhitespace(val)) {
                sb.append('"').append(val).append('"');
            } else {
                sb.append(val);
            }
        }
        return sb.toString();
    }

    private static boolean hasWhitespace(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (Character.isWhitespace(s.charAt(i))) {
                return true;
            }
        }
        return false;
    }

    /** Stage a predicate id belongs to: the prefix before the first {@code '.'}. */
    private static String stageOf(String id) {
        int dot = id.indexOf('.');
        return dot > 0 ? id.substring(0, dot) : id;
    }

    private static String capText(String s, int n) {
        if (s == null) {
            return "";
        }
        return s.length() > n ? s.substring(0, n) + "…" : s;
    }

    /** Corr as an ordered map (stable key order, only set keys) for embedding in JSON. */
    private static Map<String, String> corrMap(Corr corr) {
        Map<String, String> out = new LinkedHashMap<>();
        if (corr != null) {
            for (String k : CORR_ORDER) {
                String v = corr.get(k);
                if (v != null && !v.isEmpty()) {
                    out.put(k, v);
                }
            }
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Emission
    // -----------------------------------------------------------------------

    /** ISO-8601 UTC, millisecond precision, e.g. {@code 2026-06-16T16:11:39.335Z}. */
    private static String nowTs() {
        return TS_FORMATTER.format(java.time.Instant.now());
    }

    private static void ensureDir() {
        if (dirEnsured) {
            return;
        }
        try {
            Path parent = file.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
        } catch (Exception ignored) {
            // tracing must never throw
        }
        dirEnsured = true;
    }

    /**
     * Join the supplied parts with TWO spaces, dropping null / empty parts, and
     * append the resulting line (plus a trailing newline) as a single atomic
     * {@code O_APPEND} write. Mirrors {@code emit()} in {@code trace.ts}.
     */
    private static void emit(String... parts) {
        ensureDir();
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.isEmpty()) {
                continue;
            }
            if (sb.length() > 0) {
                sb.append("  ");
            }
            sb.append(p);
        }
        sb.append('\n');
        try {
            Files.write(
                file,
                sb.toString().getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND);
        } catch (IOException | RuntimeException ignored) {
            // never throw from tracing
        }
    }

    // -----------------------------------------------------------------------
    // Minimal JSON serialisation (byte-compatible with JSON.stringify for the
    // value types a detail payload uses: String, Number, Boolean, null, Map,
    // Iterable). Hand-rolled so the line matches the Node helper exactly and the
    // util carries no JSON dependency.
    // -----------------------------------------------------------------------

    private static String toJson(Object value) {
        StringBuilder sb = new StringBuilder();
        writeJson(sb, value);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void writeJson(StringBuilder sb, Object value) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            writeJsonString(sb, (String) value);
        } else if (value instanceof Boolean) {
            sb.append(value.toString());
        } else if (value instanceof Integer || value instanceof Long
                || value instanceof Short || value instanceof Byte) {
            sb.append(value.toString());
        } else if (value instanceof Number) {
            // Match JSON.stringify: finite -> the number; non-finite -> null.
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("null");
            } else if (d == Math.floor(d) && !Double.isInfinite(d)
                    && Math.abs(d) < 1e15) {
                sb.append(Long.toString((long) d));
            } else {
                sb.append(value.toString());
            }
        } else if (value instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) value).entrySet()) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                writeJsonString(sb, String.valueOf(e.getKey()));
                sb.append(':');
                writeJson(sb, e.getValue());
            }
            sb.append('}');
        } else if (value instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Iterable<Object>) value) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                writeJson(sb, item);
            }
            sb.append(']');
        } else if (value instanceof Object[]) {
            sb.append('[');
            Object[] arr = (Object[]) value;
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) {
                    sb.append(',');
                }
                writeJson(sb, arr[i]);
            }
            sb.append(']');
        } else {
            // Fallback: stringify whatever it is.
            writeJsonString(sb, String.valueOf(value));
        }
    }

    /** Escape a string the way {@code JSON.stringify} does. */
    private static void writeJsonString(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    // -----------------------------------------------------------------------
    // Tracer
    // -----------------------------------------------------------------------

    /** A tracer bound to a service name. All calls are cheap no-ops when OFF. */
    public static final class Tracer {

        private static final String GLYPH_STEP = "▶"; // ▶
        private static final String GLYPH_OK = "✓";   // ✓
        private static final String GLYPH_WARN = "⚠";  // ⚠
        private static final String GLYPH_FAIL = "✗";  // ✗

        private final String service;
        private final boolean off;
        private final boolean detailOn;

        private Tracer(String service) {
            this.service = service;
            this.off = tier == Tier.OFF;
            this.detailOn = tier == Tier.DETAIL;
        }

        /** True when tracing is enabled (tier &gt;= summary). */
        public boolean isEnabled() {
            return !off;
        }

        /** Write a {@code [SUMMARY]} line (when tier &gt;= summary). */
        public void summary(String glyph, String message, Corr corr) {
            if (off) {
                return;
            }
            emit(nowTs(), "[SUMMARY]", service, emptyToNull(fmtCorr(corr)), glyph + " " + message);
        }

        public void step(String message, Corr corr) {
            summary(GLYPH_STEP, message, corr);
        }

        public void ok(String message, Corr corr) {
            summary(GLYPH_OK, message, corr);
        }

        public void warn(String message, Corr corr) {
            summary(GLYPH_WARN, message, corr);
        }

        public void fail(String message, Corr corr) {
            summary(GLYPH_FAIL, message, corr);
        }

        /**
         * Write a {@code [detail]} line (only when tier == detail). The
         * correlation ids are merged into the JSON (in {@link #CORR_ORDER},
         * before the supplied data) so a detail line is self-contained.
         */
        public void detail(String event, Map<String, ?> data, Corr corr) {
            if (!detailOn) {
                return;
            }
            Map<String, Object> merged = new LinkedHashMap<>();
            if (corr != null) {
                for (String k : CORR_ORDER) {
                    String v = corr.get(k);
                    if (v != null && !v.isEmpty()) {
                        merged.put(k, v);
                    }
                }
            }
            if (data != null) {
                merged.putAll(data);
            }
            String json;
            try {
                json = toJson(merged);
            } catch (RuntimeException ex) {
                json = "{\"_traceError\":\"unserializable\"}";
            }
            emit(nowTs(), "[detail]", service, emptyToNull(fmtCorr(corr)), event + " " + json);
        }

        /** Write the {@code === HAIKAI TRACE … ===} run-delimiter header. */
        public void runHeader(String runId, String project, String arch) {
            if (off) {
                return;
            }
            StringBuilder header = new StringBuilder();
            header.append("=== HAIKAI TRACE  run=").append(runId);
            if (project != null && !project.isEmpty()) {
                header.append(" project=\"").append(project).append('"');
            }
            if (arch != null && !arch.isEmpty()) {
                header.append(" arch=\"").append(arch).append('"');
            }
            header.append("  ").append(nowTs()).append(" ===");
            // Leading blank line delimits runs in the shared append-only file.
            emit("\n" + header.toString());
        }

        /**
         * Emit a {@code HAIKAI_PREDICATE} line (pass/fail from {@code ok}) and
         * tally it for the stage scorecard.
         */
        public void predicate(String id, String title, boolean ok,
                              String expected, String actual, Corr corr) {
            emitPredicate(id, title, ok ? "pass" : "fail", expected, actual, corr);
        }

        /**
         * Emit a skipped {@code HAIKAI_PREDICATE} — the check was not exercised
         * this run; {@code why} says why.
         */
        public void predicateSkip(String id, String title, String why, Corr corr) {
            emitPredicate(id, title, "skip", "", why, corr);
        }

        private void emitPredicate(String id, String title, String verdict,
                                   String expected, String actual, Corr corr) {
            if (off) {
                return;
            }
            try {
                synchronized (TALLY_LOCK) {
                    StageTally t = TALLY.computeIfAbsent(stageOf(id), k -> new StageTally());
                    if ("pass".equals(verdict)) {
                        t.pass++;
                    } else if ("fail".equals(verdict)) {
                        t.fail++;
                    } else {
                        t.skip++;
                    }
                    if ("fail".equals(verdict) && t.failed.size() < SCORECARD_FAILED_CAP) {
                        Map<String, Object> f = new LinkedHashMap<>();
                        f.put("id", id);
                        f.put("actual", capText(actual, SCORECARD_ACTUAL_CAP));
                        t.failed.add(f);
                    }
                }
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("id", id);
                payload.put("title", title);
                payload.put("verdict", verdict);
                payload.put("expected", capText(expected, PREDICATE_TEXT_CAP));
                payload.put("actual", capText(actual, PREDICATE_TEXT_CAP));
                Map<String, String> cj = corrMap(corr);
                if (!cj.isEmpty()) {
                    payload.put("corr", cj);
                }
                String glyph = "pass".equals(verdict) ? GLYPH_OK
                    : "fail".equals(verdict) ? GLYPH_FAIL : GLYPH_WARN;
                emit(nowTs(), "[SUMMARY]", service, emptyToNull(fmtCorr(corr)),
                    glyph + " HAIKAI_PREDICATE " + toJson(payload));
            } catch (RuntimeException ignored) {
                // never throw from tracing
            }
        }

        /** Emit the {@code HAIKAI_STAGE_START} banner (absence detection). */
        public void stageStart(String stage, Corr corr) {
            if (off) {
                return;
            }
            try {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("stage", stage);
                emit(nowTs(), "[SUMMARY]", service, emptyToNull(fmtCorr(corr)),
                    GLYPH_STEP + " HAIKAI_STAGE_START " + toJson(payload));
            } catch (RuntimeException ignored) {
                // never throw from tracing
            }
        }

        /**
         * Emit the stage's {@code HAIKAI_SCORECARD} — per-stage tally plus the
         * process-cumulative totals; doubles as the stage-END banner.
         */
        public void stageEnd(String stage, Corr corr) {
            if (off) {
                return;
            }
            try {
                int pass = 0;
                int fail = 0;
                int skip = 0;
                List<Map<String, Object>> failed = new ArrayList<>();
                int cumPass = 0;
                int cumFail = 0;
                int cumSkip = 0;
                synchronized (TALLY_LOCK) {
                    StageTally t = TALLY.get(stage);
                    if (t != null) {
                        pass = t.pass;
                        fail = t.fail;
                        skip = t.skip;
                        failed.addAll(t.failed);
                    }
                    for (StageTally v : TALLY.values()) {
                        cumPass += v.pass;
                        cumFail += v.fail;
                        cumSkip += v.skip;
                    }
                }
                Map<String, Object> cumulative = new LinkedHashMap<>();
                cumulative.put("pass", cumPass);
                cumulative.put("fail", cumFail);
                cumulative.put("skip", cumSkip);
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("stage", stage);
                payload.put("service", service);
                payload.put("pass", pass);
                payload.put("fail", fail);
                payload.put("skip", skip);
                payload.put("failed", failed);
                payload.put("cumulative", cumulative);
                emit(nowTs(), "[SUMMARY]", service, emptyToNull(fmtCorr(corr)),
                    (fail > 0 ? GLYPH_FAIL : GLYPH_OK) + " HAIKAI_SCORECARD " + toJson(payload));
            } catch (RuntimeException ignored) {
                // never throw from tracing
            }
        }

        /**
         * Emit the startup {@code HAIKAI_CONFIG} header. Pass booleans/counts
         * only — never secret values.
         */
        public void configHeader(Map<String, ?> config, Corr corr) {
            if (off) {
                return;
            }
            try {
                Map<String, Object> payload = new LinkedHashMap<>();
                payload.put("service", service);
                if (config != null) {
                    payload.putAll(config);
                }
                emit(nowTs(), "[SUMMARY]", service, emptyToNull(fmtCorr(corr)),
                    GLYPH_STEP + " HAIKAI_CONFIG " + toJson(payload));
            } catch (RuntimeException ignored) {
                // never throw from tracing
            }
        }

        private static String emptyToNull(String s) {
            return (s == null || s.isEmpty()) ? null : s;
        }
    }
}
