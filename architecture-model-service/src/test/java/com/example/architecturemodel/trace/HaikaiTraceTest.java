package com.example.architecturemodel.trace;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Format-parity tests for {@link HaikaiTrace}.
 *
 * <p>{@code HaikaiTrace} resolves {@code HAIKAI_TRACE} / {@code HAIKAI_TRACE_FILE}
 * ONCE at class initialisation. In a shared test JVM that read may already have
 * happened (other services hold a static tracer), so these tests use the
 * package-private {@link HaikaiTrace#resetForTest(String, String)} seam to point
 * the tracer at a temp file at the {@code detail} tier deterministically -- the
 * seam is never used in production.</p>
 *
 * <p>The assertions pin the line shape that {@code scripts/haikai-trace-summarize.mjs}
 * and the Node {@code src/trace.ts} both depend on: two-space separators, the
 * fixed millisecond-precision UTC {@code …Z} timestamp, the stable correlation
 * key order, and the corr ids merged into the detail JSON.</p>
 */
class HaikaiTraceTest {

    private static Path traceFile;

    // ISO-8601 UTC, millisecond precision, ending in Z (NOT variable-width).
    private static final Pattern TS =
        Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$");

    @BeforeAll
    static void pointTracerAtTempFile() throws IOException {
        traceFile = Files.createTempFile("haikai-trace-test", ".log");
        HaikaiTrace.resetForTest("detail", traceFile.toAbsolutePath().toString());
        // The detail tier implies enabled; a tracer built now must be live.
        assertThat(HaikaiTrace.forService("ams").isEnabled())
            .as("resetForTest must enable the tracer at the detail tier")
            .isTrue();
    }

    @BeforeEach
    void truncate() throws IOException {
        Files.write(traceFile, new byte[0]);
    }

    @Test
    void summaryLineMatchesGoldenFormat() throws IOException {
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        t.fail(
            "plan readiness INSUFFICIENT — baselines=0; gaps: no_api_baseline, inventory_mismatch",
            HaikaiTrace.Corr.of().project("Demo SVC DB Migration").arch("Current State"));

        String line = onlyLine();

        // Top-level anchor the summarizer + Node helper rely on.
        assertThat(line).matches("^\\S+  \\[SUMMARY\\]  ams  .*");

        // Exactly TWO spaces between the five logical parts (no part is empty here).
        String[] parts = line.split(" {2}");
        assertThat(parts).hasSize(5);
        assertThat(parts[0]).matches(TS);                 // ts (ms-UTC-Z)
        assertThat(parts[1]).isEqualTo("[SUMMARY]");
        assertThat(parts[2]).isEqualTo("ams");
        // corr: stable order project before arch; the value with a space is quoted.
        assertThat(parts[3]).isEqualTo("project=\"Demo SVC DB Migration\" arch=\"Current State\"");
        // body: glyph + space + message.
        assertThat(parts[4]).isEqualTo(
            "✗ plan readiness INSUFFICIENT — baselines=0; gaps: no_api_baseline, inventory_mismatch");
    }

    @Test
    void glyphsMatchTierWrappers() throws IOException {
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        t.step("a", null);
        t.ok("b", null);
        t.warn("c", null);
        t.fail("d", null);

        List<String> lines = allLines();
        assertThat(lines).hasSize(4);
        // No corr -> the empty corr part is dropped: only 4 logical parts.
        assertThat(lines.get(0)).endsWith("  ams  ▶ a");
        assertThat(lines.get(1)).endsWith("  ams  ✓ b");
        assertThat(lines.get(2)).endsWith("  ams  ⚠ c");
        assertThat(lines.get(3)).endsWith("  ams  ✗ d");
        // Empty corr is dropped (4 parts, not 5).
        assertThat(lines.get(0).split(" {2}")).hasSize(4);
    }

    @Test
    void corrEmittedInStableKeyOrderRegardlessOfCallOrder() throws IOException {
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        // Set keys OUT of order; expect run, session, job, bug, project, arch.
        t.ok("x", HaikaiTrace.Corr.of()
            .arch("Current State")
            .project("P")
            .session("abc123")
            .run("mig-7f3"));

        String corrPart = onlyLine().split(" {2}")[3];
        assertThat(corrPart).isEqualTo("run=mig-7f3 session=abc123 project=P arch=\"Current State\"");
    }

    @Test
    void detailLineMergesCorrIdsIntoJsonInOrder() throws IOException {
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("verdict", "insufficient");
        data.put("totalBaselines", 0);
        data.put("gaps", List.of("no_api_baseline"));

        t.detail("readiness.assessed", data,
            HaikaiTrace.Corr.of().project("Demo SVC DB Migration").arch("Current State"));

        String line = onlyLine();
        assertThat(line).matches("^\\S+  \\[detail\\]  ams  .*");

        String[] parts = line.split(" {2}");
        assertThat(parts).hasSize(5);
        assertThat(parts[0]).matches(TS);
        assertThat(parts[1]).isEqualTo("[detail]");
        assertThat(parts[2]).isEqualTo("ams");
        assertThat(parts[3]).isEqualTo("project=\"Demo SVC DB Migration\" arch=\"Current State\"");
        // event + compact JSON; corr ids merged FIRST, in CORR_ORDER, then data.
        assertThat(parts[4]).isEqualTo(
            "readiness.assessed "
                + "{\"project\":\"Demo SVC DB Migration\",\"arch\":\"Current State\","
                + "\"verdict\":\"insufficient\",\"totalBaselines\":0,"
                + "\"gaps\":[\"no_api_baseline\"]}");
    }

    @Test
    void predicateLinesCarryVerdictGlyphAndStableJsonKeyOrder() throws IOException {
        // Re-point (same file/tier) to CLEAR the per-process predicate tally.
        HaikaiTrace.resetForTest("detail", traceFile.toAbsolutePath().toString());
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        t.predicate("COMMIT.DIAL.01", "committed effects keep sql_dialect", true,
            "all sampled carry dialect", "12/12", HaikaiTrace.Corr.of().run("mig-1"));
        t.predicateSkip("CAP.SOAP.01", "soap operations captured",
            "pilot has no SOAP endpoints", null);
        t.predicate("CONV.07", "api-lock derived values consumed", false,
            "consumed", "ignored (known-open)", null);

        List<String> lines = allLines();
        // Key order is the cross-stack contract (byte-identical to the Node emitter).
        assertThat(lines.get(0)).endsWith(
            "✓ HAIKAI_PREDICATE {\"id\":\"COMMIT.DIAL.01\","
                + "\"title\":\"committed effects keep sql_dialect\",\"verdict\":\"pass\","
                + "\"expected\":\"all sampled carry dialect\",\"actual\":\"12/12\","
                + "\"corr\":{\"run\":\"mig-1\"}}");
        assertThat(lines.get(1)).contains("⚠ HAIKAI_PREDICATE ");
        assertThat(lines.get(1)).contains("\"verdict\":\"skip\"");
        assertThat(lines.get(1)).contains("\"actual\":\"pilot has no SOAP endpoints\"");
        assertThat(lines.get(2)).contains("✗ HAIKAI_PREDICATE ");
        assertThat(lines.get(2)).contains("\"verdict\":\"fail\"");
    }

    @Test
    void scorecardTalliesByStagePrefixWithCumulativeTotals() throws IOException {
        HaikaiTrace.resetForTest("detail", traceFile.toAbsolutePath().toString());
        HaikaiTrace.Tracer t = HaikaiTrace.forService("ams");
        t.stageStart("BOOT", null);
        t.predicate("BOOT.A.01", "a", true, "x", "x", null);
        t.predicate("BOOT.A.02", "b", false, "y", "z", null);
        t.predicateSkip("BOOT.A.03", "c", "why", null);
        t.predicate("COMMIT.B.01", "other stage", true, "1", "1", null);
        t.stageEnd("BOOT", null);

        List<String> lines = allLines();
        assertThat(lines.get(0)).endsWith("▶ HAIKAI_STAGE_START {\"stage\":\"BOOT\"}");
        // BOOT tallies exclude the COMMIT predicate; cumulative includes it.
        assertThat(lines.get(5)).endsWith(
            "✗ HAIKAI_SCORECARD {\"stage\":\"BOOT\",\"service\":\"ams\","
                + "\"pass\":1,\"fail\":1,\"skip\":1,"
                + "\"failed\":[{\"id\":\"BOOT.A.02\",\"actual\":\"z\"}],"
                + "\"cumulative\":{\"pass\":2,\"fail\":1,\"skip\":1}}");
    }

    @Test
    void configHeaderLeadsWithServiceAndMergesConfig() throws IOException {
        Map<String, Object> cfg = new LinkedHashMap<>();
        cfg.put("git_sha", "abc1234");
        cfg.put("db_creds_present", true);
        cfg.put("changesets_applied", 209);
        HaikaiTrace.forService("ams").configHeader(cfg, null);

        assertThat(onlyLine()).endsWith(
            "▶ HAIKAI_CONFIG {\"service\":\"ams\",\"git_sha\":\"abc1234\","
                + "\"db_creds_present\":true,\"changesets_applied\":209}");
    }

    @Test
    void runHeaderHasLeadingBlankDelimiterAndQuotesNames() throws IOException {
        HaikaiTrace.forService("ams").runHeader("mig-7f3", "Demo SVC DB Migration", "Current State");
        // A leading blank line delimits runs in the shared append-only file.
        assertThat(Files.readAllLines(traceFile, StandardCharsets.UTF_8).get(0)).isEmpty();
        String line = onlyLine();
        assertThat(line).startsWith("=== HAIKAI TRACE  run=mig-7f3 project=\"Demo SVC DB Migration\" arch=\"Current State\"  ");
        assertThat(line).endsWith(" ===");
        // The ts inside the header is ms-UTC-Z.
        assertThat(line).matches(".*  \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z ===$");
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    private static String onlyLine() throws IOException {
        List<String> lines = allLines();
        assertThat(lines).hasSize(1);
        return lines.get(0);
    }

    private static List<String> allLines() throws IOException {
        return Files.readAllLines(traceFile, StandardCharsets.UTF_8).stream()
            .filter(l -> !l.isEmpty())
            .toList();
    }
}
