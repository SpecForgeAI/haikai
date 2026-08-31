package com.example.architecturemodel.service.quality;

import com.example.architecturemodel.service.quality.SpecQualityScorer.SpecArchetype;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Archetype-aware scoring (2026-08-30).
 *
 * <p>v1 measured every row against the LLM shape-spec template (seven
 * bare-label sections + two citation notations). Deterministic carriage
 * generators emit neither, so on a carriage-dominated book COMPLETENESS
 * averaged near zero, EVIDENCE DENSITY was exactly 0 for 100% of rows, and
 * SIBLING/PARENT ALIGNMENT was the constant 50 — three of five dimensions
 * carrying no signal, grading well-formed specs F. These tests pin:</p>
 * <ul>
 *   <li>{@code fromSource} resolution incl. unknown/null -&gt; LLM_SHAPE;</li>
 *   <li>per-archetype COMPLETENESS against the headings each generator
 *       actually emits (with their trailing qualifiers);</li>
 *   <li>the DB_PACK 3-of-4 honesty pin (a measurement fix, not amnesty);</li>
 *   <li>carriage citation notations firing EVIDENCE DENSITY;</li>
 *   <li>the AC block: carriage prefix heading, archetype fallbacks,
 *       depth-aware boundary, markdown-table rows (bullets win);</li>
 *   <li>alignment reading {@code code}-keyed warnings + the
 *       UNRESOLVED_REFERENCE penalty (clamped at 0);</li>
 *   <li>the 6-arg Input keeping the LLM path byte-identical.</li>
 * </ul>
 */
class SpecQualityScorerArchetypeTest {

    private final SpecQualityScorer scorer = new SpecQualityScorer();

    private static SpecQualityScorer.Input input(String text, SpecArchetype archetype) {
        return new SpecQualityScorer.Input(text, null, null, null, null, null, archetype);
    }

    private static int dim(SpecQualityScorer.Output out, String name) {
        for (Map<String, Object> d : out.dimensions()) {
            if (name.equals(d.get("name"))) return (Integer) d.get("score");
        }
        throw new AssertionError("dimension not found: " + name);
    }

    private static String dimReason(SpecQualityScorer.Output out, String name) {
        for (Map<String, Object> d : out.dimensions()) {
            if (name.equals(d.get("name"))) return (String) d.get("reason");
        }
        throw new AssertionError("dimension not found: " + name);
    }

    // -----------------------------------------------------------------------
    // fromSource resolution
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("fromSource maps the five carriage markers; unknown/null fall back to LLM_SHAPE")
    void fromSourceResolution() {
        assertThat(SpecArchetype.fromSource("scl_spec_carriage"))
            .isEqualTo(SpecArchetype.SCL_CARRIAGE);
        assertThat(SpecArchetype.fromSource("db_migration_pack"))
            .isEqualTo(SpecArchetype.DB_PACK);
        assertThat(SpecArchetype.fromSource("committed_model_internal_carriage"))
            .isEqualTo(SpecArchetype.INTERNAL_CARRIAGE);
        assertThat(SpecArchetype.fromSource("code_plan_manual_gate"))
            .isEqualTo(SpecArchetype.MANUAL_GATE);
        assertThat(SpecArchetype.fromSource("scaffold_bootstrap_carriage"))
            .isEqualTo(SpecArchetype.SCAFFOLD);
        assertThat(SpecArchetype.fromSource("  DB_MIGRATION_PACK  "))
            .isEqualTo(SpecArchetype.DB_PACK);
        assertThat(SpecArchetype.fromSource("some_future_source"))
            .isEqualTo(SpecArchetype.LLM_SHAPE);
        assertThat(SpecArchetype.fromSource(null)).isEqualTo(SpecArchetype.LLM_SHAPE);
    }

    // -----------------------------------------------------------------------
    // COMPLETENESS per archetype (headings with trailing qualifiers)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("SCL carriage: qualified headings score COMPLETENESS 100 (v1 whole-line anchor could never match)")
    void sclCarriageCompleteness() {
        String text = String.join("\n",
            "/agent-os:shape-spec Implement widget endpoints",
            "## Objective",
            "body",
            "## Acceptance criteria",
            "- All 12 rows verified",
            "## Modernization decisions (confirmed — cite, never re-decide)",
            "- keep [decision:modernize.dates.localdate]",
            "## Contract blocks (verbatim — the construction truth)",
            "block",
            "## Target technology stack (captured decisions — authoritative)",
            "stack",
            "## Wire-format fidelity (mined from the captured API baseline)",
            "wire");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.SCL_CARRIAGE));
        assertThat(dim(out, "completeness")).isEqualTo(100);
        assertThat(dimReason(out, "completeness")).contains("6/6");
    }

    @Test
    @DisplayName("DB_PACK: 3 of 4 sections = 75 — genuinely missing acceptance criteria STAYS missing (measurement, not amnesty)")
    void dbPackHonestyPin() {
        // Context + Requirements + Files-to-reproduce present; NO acceptance
        // criteria (the pre-fix DB-tier shape).
        String text = String.join("\n",
            "/agent-os:shape-spec Land the pack changesets",
            "## Context",
            "assembled deterministically",
            "## Requirements",
            "1. Write every file byte-for-byte",
            "## Files to reproduce byte-for-byte (3)",
            "### `liquibase/changesets/010-tables/dbo.screen_filter.sql`");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.DB_PACK));
        // 75 = 3 of 4. This must NOT become 100: the archetype fix is a
        // measurement fix, not an amnesty for rows genuinely missing their
        // acceptance-criteria section.
        assertThat(dim(out, "completeness")).isEqualTo(75);
        assertThat(dimReason(out, "completeness")).contains("missing: acceptance criteria");
    }

    @Test
    @DisplayName("MANUAL_GATE: the three runbook sections score 100")
    void manualGateCompleteness() {
        String text = String.join("\n",
            "/agent-os:shape-spec Full-surface parity sweep",
            "## Manual-gate work item",
            "human work",
            "## Procedure",
            "1. open the capture wizard",
            "## Gate condition",
            "an unscoped clean parity result");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.MANUAL_GATE));
        assertThat(dim(out, "completeness")).isEqualTo(100);
    }

    @Test
    @DisplayName("SCAFFOLD: seed-build-files heading (upper case + qualifier) matches by prefix")
    void scaffoldCompleteness() {
        String text = String.join("\n",
            "# Scaffold the target application",
            "## Objective",
            "boot",
            "## Acceptance criteria",
            "- app boots",
            "## SEED BUILD FILES — AUTHORITATIVE, WRITE FIRST (do these before any other implementation)",
            "pom",
            "## Target technology stack (captured decisions — authoritative)",
            "stack");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.SCAFFOLD));
        assertThat(dim(out, "completeness")).isEqualTo(100);
    }

    @Test
    @DisplayName("INTERNAL_CARRIAGE: context / internal process / verification recipe / target stack")
    void internalCarriageCompleteness() {
        String text = String.join("\n",
            "/agent-os:shape-spec Implement the nightly job",
            "## Context",
            "internal",
            "## Internal process: SCHEDULED 0 0 * * * *",
            "detail",
            "## Verification recipe (DB-delta oracle — Spec 2026-07-06-m)",
            "recipe",
            "## Target technology stack (captured decisions — authoritative)",
            "stack");
        SpecQualityScorer.Output out =
            scorer.score(input(text, SpecArchetype.INTERNAL_CARRIAGE));
        assertThat(dim(out, "completeness")).isEqualTo(100);
    }

    @Test
    @DisplayName("LLM_SHAPE via the 6-arg Input is byte-identical to v1 (archetype defaults)")
    void sixArgInputPreservesV1() {
        String text = String.join("\n",
            "## Decisions",
            "- d",
            "## Acceptance Criteria",
            "- returns 200");
        SpecQualityScorer.Output legacy = scorer.score(new SpecQualityScorer.Input(
            text, null, null, null, null, null));
        SpecQualityScorer.Output explicit = scorer.score(input(text, SpecArchetype.LLM_SHAPE));
        assertThat(legacy.score()).isEqualTo(explicit.score());
        assertThat(legacy.dimensions()).isEqualTo(explicit.dimensions());
        // v1 vocabulary: 2 of 7 sections.
        assertThat(dimReason(legacy, "completeness")).contains("2/7");
    }

    // -----------------------------------------------------------------------
    // EVIDENCE DENSITY — carriage citation notations
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("decision cites, source-line cites and pack stamps all count as evidence")
    void carriageEvidenceNotations() {
        String text = String.join("\n",
            "## Context",
            "Target engine: `postgresql` [decision:db.engine]",
            "Derived from OrderService.java:217 and WidgetDao.sql:9.",
            "Pack provenance: pack 3f2a9c1e-0b5d-4a7e-9c1f-2d3e4f5a6b7c holds the queue.");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.DB_PACK));
        // 1 decision cite + 2 source-line cites + 1 pack stamp = 4 refs.
        assertThat(dimReason(out, "evidence_density")).startsWith("4 evidence refs");
        assertThat(dim(out, "evidence_density")).isGreaterThan(0);
    }

    @Test
    @DisplayName("a spec with NONE of the notations still scores evidence 0 (no free points)")
    void evidenceStillZeroWithoutCites() {
        SpecQualityScorer.Output out = scorer.score(
            input("## Context\nplain text with no citations at all", SpecArchetype.DB_PACK));
        assertThat(dim(out, "evidence_density")).isEqualTo(0);
    }

    // -----------------------------------------------------------------------
    // AC block extraction
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("carriage-qualified AC heading is found (v1 exact pattern missed the trailing qualifier)")
    void carriageAcHeading() {
        String text = String.join("\n",
            "## Acceptance criteria (mechanical + story)",
            "- The pack's expected-schema diff returns GREEN after these changesets apply.");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.DB_PACK));
        assertThat(dimReason(out, "ac_measurability"))
            .doesNotContain("No acceptance criteria found");
    }

    @Test
    @DisplayName("DB_PACK falls back to the Requirements heading when no AC heading exists")
    void dbPackAcFallback() {
        String text = String.join("\n",
            "## Requirements",
            "1. Write every file byte-for-byte at its exact path.",
            "2. The expected-schema diff returns GREEN after apply.");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.DB_PACK));
        // Extraction is the pin here: both requirement lines land as AC
        // entries (how many score "measurable" is the per-AC signal count).
        assertThat(dimReason(out, "ac_measurability")).contains("of 2 ACs");
        assertThat(dimReason(out, "ac_measurability"))
            .doesNotContain("No acceptance criteria found");
    }

    @Test
    @DisplayName("MANUAL_GATE falls back to Gate condition; INTERNAL_CARRIAGE to Verification recipe")
    void gateAndRecipeFallbacks() {
        String gate = String.join("\n",
            "## Gate condition",
            "- An UNSCOPED clean parity result over the full stream surface.");
        assertThat(dimReason(scorer.score(input(gate, SpecArchetype.MANUAL_GATE)),
            "ac_measurability")).doesNotContain("No acceptance criteria found");

        String recipe = String.join("\n",
            "## Verification recipe (DB-delta oracle — Spec 2026-07-06-m)",
            "- The delta matches the committed effect scope exactly.");
        assertThat(dimReason(scorer.score(input(recipe, SpecArchetype.INTERNAL_CARRIAGE)),
            "ac_measurability")).doesNotContain("No acceptance criteria found");
    }

    @Test
    @DisplayName("LLM_SHAPE gets NO fallback: absent AC heading still reports none found")
    void llmShapeHasNoFallback() {
        String text = String.join("\n",
            "## Requirements",
            "- looks like criteria but the LLM template has no fallback");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.LLM_SHAPE));
        assertThat(dimReason(out, "ac_measurability"))
            .contains("No acceptance criteria found");
    }

    @Test
    @DisplayName("a DEEPER sub-heading no longer truncates the AC block; a same-depth heading ends it")
    void depthAwareBoundary() {
        String text = String.join("\n",
            "## Acceptance criteria",
            "- first criterion returns 200",
            "### Mechanical checks",
            "- second criterion under the sub-heading matches 3 rows",
            "## Decisions carried (cite, never re-decide)",
            "- never counted: not in the AC block");
        SpecQualityScorer.Output out = scorer.score(input(text, SpecArchetype.DB_PACK));
        // Both criteria (across the deeper sub-heading) counted; the
        // same-depth `## Decisions carried` ends the block.
        assertThat(dimReason(out, "ac_measurability")).contains("of 2 ACs");
    }

    @Test
    @DisplayName("markdown TABLE rows count as AC entries when the block has no bullets; bullets win otherwise")
    void tableRowsAsAcEntries() {
        String tabulated = String.join("\n",
            "## Acceptance criteria",
            "| check | expected |",
            "|---|---|",
            "| row count | 42 rows loaded |",
            "| diff | returns GREEN |");
        SpecQualityScorer.Output out = scorer.score(input(tabulated, SpecArchetype.DB_PACK));
        // 3 entries: the header row counts too (a data row and a header are
        // indistinguishable without schema knowledge); the separator row is
        // rejected. What matters is the block no longer reads as EMPTY.
        assertThat(dimReason(out, "ac_measurability")).contains("of 3 ACs");

        String mixed = String.join("\n",
            "## Acceptance criteria",
            "- bullet criterion returns 200",
            "| table row | ignored because bullets win |");
        SpecQualityScorer.Output mixedOut = scorer.score(input(mixed, SpecArchetype.DB_PACK));
        assertThat(dimReason(mixedOut, "ac_measurability")).contains("of 1 ACs");
    }

    // -----------------------------------------------------------------------
    // SIBLING/PARENT ALIGNMENT — code-keyed warnings + unresolved references
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("warnings keyed by `code` are read (v1 read only `kind`), and unresolved references cost 5 each")
    void alignmentReadsCodeAndPenalisesUnresolved() {
        List<Map<String, Object>> warnings = List.of(
            Map.of("code", "UNRESOLVED_REFERENCE", "message", "ref A"),
            Map.of("code", "UNRESOLVED_REFERENCE", "message", "ref B"),
            Map.of("kind", "aligned_with_epic_decision"));
        SpecQualityScorer.Output out = scorer.score(new SpecQualityScorer.Input(
            "## Context\nx", null, null, null, warnings, null, SpecArchetype.DB_PACK));
        // 50 + 15 (alignment) - 2*5 (unresolved) = 55.
        assertThat(dim(out, "sibling_parent_alignment")).isEqualTo(55);
        assertThat(dimReason(out, "sibling_parent_alignment"))
            .contains("2 unresolved reference(s) penalised");
    }

    @Test
    @DisplayName("the unresolved penalty clamps at 0 and `kind` still wins over `code` on one row")
    void alignmentClampAndKindPrecedence() {
        List<Map<String, Object>> many = new java.util.ArrayList<>();
        for (int i = 0; i < 20; i++) {
            many.add(Map.of("code", "UNRESOLVED_REFERENCE"));
        }
        SpecQualityScorer.Output out = scorer.score(new SpecQualityScorer.Input(
            "x", null, null, null, many, null, SpecArchetype.LLM_SHAPE));
        assertThat(dim(out, "sibling_parent_alignment")).isEqualTo(0);

        // A row carrying BOTH keys is classified by `kind`.
        List<Map<String, Object>> both = List.of(
            Map.of("kind", "contradicts_sibling", "code", "UNRESOLVED_REFERENCE"));
        SpecQualityScorer.Output bothOut = scorer.score(new SpecQualityScorer.Input(
            "x", null, null, null, both, null, SpecArchetype.LLM_SHAPE));
        assertThat(dim(bothOut, "sibling_parent_alignment")).isEqualTo(30);
    }

    @Test
    @DisplayName("no warnings keeps the baseline-50 reason without an unresolved suffix")
    void alignmentBaselineUnchanged() {
        SpecQualityScorer.Output out = scorer.score(input("x", SpecArchetype.DB_PACK));
        assertThat(dim(out, "sibling_parent_alignment")).isEqualTo(50);
        assertThat(dimReason(out, "sibling_parent_alignment"))
            .doesNotContain("unresolved reference");
    }
}
