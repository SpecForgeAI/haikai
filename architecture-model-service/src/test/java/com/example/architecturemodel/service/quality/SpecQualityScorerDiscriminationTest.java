package com.example.architecturemodel.service.quality;

import com.example.architecturemodel.service.quality.SpecQualityScorer.SpecArchetype;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Discrimination rework of the spec quality scorer (2026-09-03).
 *
 * <p>The review of a 116-spec book found three of five dimensions to be
 * effectively constants — every well-formed spec started at 55 — and the
 * scorer anti-correlated with implementability: the specs whose verification
 * oracle passed over an EMPTY scope graded C while entirely correct manual
 * gates graded D. These pins cover the four changes that make the dimensions
 * discriminate, in the order the review asked for them: dimensions first,
 * archetype registration last.</p>
 */
class SpecQualityScorerDiscriminationTest {

    private final SpecQualityScorer scorer = new SpecQualityScorer();

    private static int dim(SpecQualityScorer.Output out, String name) {
        for (Map<String, Object> d : out.dimensions()) {
            if (name.equals(d.get("name"))) return (Integer) d.get("score");
        }
        throw new AssertionError("dimension not found: " + name);
    }

    private static String reason(SpecQualityScorer.Output out, String name) {
        for (Map<String, Object> d : out.dimensions()) {
            if (name.equals(d.get("name"))) return (String) d.get("reason");
        }
        throw new AssertionError("dimension not found: " + name);
    }

    private static SpecQualityScorer.Input input(String text, SpecArchetype archetype) {
        return new SpecQualityScorer.Input(text, null, null, null, null, "Implement orders", archetype);
    }

    private static final String STACK_DUMP = String.join("\n",
        "## Target technology stack (captured decisions — authoritative)",
        "### Service plane",
        "- `service.framework` — Spring Boot 4.0.0",
        "- `modernize.types.string` — String -> java.lang.String",
        "- `modernize.types.object` — Object -> java.lang.Object",
        "- `modernize.dates.joda-localdate` — org.joda.time.LocalDate -> java.time.LocalDate",
        "- `modernize.http.jaxrs-annotations` — Spring MVC annotations",
        "- `api.auth` — Custom SSO and AD groups",
        "- `db.engine` — PostgreSQL 18");

    // -----------------------------------------------------------------------
    // 1. CONCRETENESS: body only, length-normalised
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("CONCRETENESS ignores the appended target-stack dump and drops when the body is padded")
    void concretenessIsBodyOnlyAndLengthNormalised() {
        String body = String.join("\n",
            "## Endpoint: GET /orders/{id}",
            "Calls: com.app.OrdersController and `findById`",
            "Files: src/com/app/OrdersController.java");
        SpecQualityScorer.DimensionScore bare =
            scorer.scoreImplementationConcreteness(body, null);
        SpecQualityScorer.DimensionScore withStack =
            scorer.scoreImplementationConcreteness(body + "\n\n" + STACK_DUMP, null);
        // The stack dump's twenty-odd backticked codes no longer count.
        assertThat(withStack.score()).isEqualTo(bare.score());
        assertThat(withStack.reason()).contains("target-stack section excluded");

        StringBuilder padded = new StringBuilder(body).append('\n');
        for (int i = 0; i < 300; i++) padded.append("filler prose that anchors nothing at all ");
        SpecQualityScorer.DimensionScore diluted =
            scorer.scoreImplementationConcreteness(padded.toString(), null);
        assertThat(diluted.score()).isLessThan(bare.score());
        assertThat(diluted.reason()).contains("per 100 words");
    }

    // -----------------------------------------------------------------------
    // 2. MECHANICAL TRUTH: the facts shape-only dimensions were blind to
    // -----------------------------------------------------------------------

    private static final String CODE_SPEC_HEALTHY = String.join("\n",
        "/agent-os:shape-spec Implement OrdersController",
        "## Context",
        "text",
        "## Endpoint: GET /orders/{id}",
        "### Request contract (committed, verbatim)",
        "```json",
        "{}",
        "```",
        "### Response contract (committed, verbatim)",
        "```json",
        "{\"produces\": [\"application/json\"]}",
        "```",
        "### Data effects (2)",
        "_2 write effect(s), 0 read effect(s) captured._",
        "## Acceptance criteria",
        "1. `GET /orders/{id}` (ep-1): replay EVERY accepted capture of baseline `bl-9` against the target",
        "## Parity obligation",
        "1. byte-equivalent responses",
        STACK_DUMP);

    private static final String CODE_SPEC_VACUOUS = String.join("\n",
        "/agent-os:shape-spec Implement OrdersController",
        "## Context",
        "text",
        "## Endpoint: GET /orders/{id}",
        "### Request contract (committed, verbatim)",
        "```json",
        "{}",
        "```",
        "### Response contract (committed, verbatim)",
        "_No committed response contract._",
        "### Data effects (0)",
        "_**NOT CAPTURED** — zero effect rows of ANY access mode_",
        "## Parity obligation",
        "1. byte-equivalent responses",
        STACK_DUMP);

    @Test
    @DisplayName("MECHANICAL TRUTH separates a code spec with a response contract, effects and replay ACs from a vacuous one")
    void mechanicalTruthDiscriminatesCodeSpecs() {
        SpecQualityScorer.Output healthy = scorer.score(input(CODE_SPEC_HEALTHY, SpecArchetype.CODE_CARRIAGE));
        SpecQualityScorer.Output vacuous = scorer.score(input(CODE_SPEC_VACUOUS, SpecArchetype.CODE_CARRIAGE));
        assertThat(dim(healthy, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).isEqualTo(100);
        assertThat(dim(vacuous, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).isEqualTo(0);
        assertThat(reason(vacuous, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH))
            .contains("response contract ABSENT")
            .contains("effect scope EMPTY")
            .contains("AC names baseline captures: NO");
        assertThat(healthy.score()).isGreaterThan(vacuous.score());
        assertThat(healthy.dimensions()).hasSize(6);
    }

    @Test
    @DisplayName("MECHANICAL TRUTH: unresolved dispatch rows cost an SCL endpoint spec; a shape-layer spec has no applicable checks")
    void mechanicalTruthSclAndFoundation() {
        String sclEndpoint = String.join("\n",
            "/agent-os:shape-spec Implement OrdersController (1 endpoints)",
            "## Objective",
            "## Acceptance criteria",
            "1. tests green",
            "4. Endpoint `ep-1`: replay EVERY accepted capture of baseline `bl-1` against the target",
            "## Contract blocks (verbatim — the construction truth)",
            "### Behaviour: com.app.OrdersController#getOrder(String)",
            "Annotations: `@GET`, `@Path(\"/orders/{id}\")`",
            "| 1 | dispatch | — | call → (UNRESOLVED — no corpus contract) com.app.Loader#load(String) |",
            "| 2 | dispatch | — | call → (UNRESOLVED — no corpus contract) com.app.Loader#dates(String,boolean) |",
            "| 3 | dispatch | — | call → (UNRESOLVED — no corpus contract) com.app.Loader#index(String) |",
            "## Response shapes (joined by declared return type)",
            "### Shape: com.app.OrderResponse",
            STACK_DUMP);
        SpecQualityScorer.Output out = scorer.score(input(sclEndpoint, SpecArchetype.SCL_CARRIAGE));
        // 3 checks apply (unresolved, response shape, AC baseline): 0 + 25 + 25 of 75.
        assertThat(dim(out, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).isEqualTo(67);
        assertThat(reason(out, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).contains("unresolved rows=3 (0/25)");

        String shapeLayer = String.join("\n",
            "/agent-os:shape-spec DTO & domain shapes (part 1)",
            "## Objective",
            "## Acceptance criteria",
            "1. fields verified",
            "## Contract blocks (verbatim — the construction truth)",
            "### Shape: com.app.OrderResponse",
            "| Field | Kind |",
            STACK_DUMP);
        SpecQualityScorer.Output foundation = scorer.score(input(shapeLayer, SpecArchetype.SCL_CARRIAGE));
        assertThat(dim(foundation, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).isEqualTo(100);
        assertThat(reason(foundation, SpecQualityScorer.DIMENSION_MECHANICAL_TRUTH)).contains("no mechanical truth checks apply");
    }

    // -----------------------------------------------------------------------
    // 3. AC extraction reads prose
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("A one-sentence Gate condition counts as one criterion (manual gates no longer score zero ACs)")
    void proseAcceptanceCriteriaCount() {
        String gate = String.join("\n",
            "/agent-os:shape-spec Run the full-surface parity verification sweep",
            "## Manual-gate work item",
            "text",
            "## Procedure",
            "1. do the thing",
            "## Gate condition",
            "The operator confirms every replayed capture returned status 200 and the diff report shows 0 mismatches.",
            "");
        List<String> acs = scorer.extractAcceptanceCriteriaLines(gate, SpecArchetype.MANUAL_GATE);
        assertThat(acs).hasSize(1);
        assertThat(acs.get(0)).startsWith("The operator confirms");
        SpecQualityScorer.Output out = scorer.score(input(gate, SpecArchetype.MANUAL_GATE));
        assertThat(dim(out, SpecQualityScorer.DIMENSION_AC_MEASURABILITY)).isGreaterThan(0);
    }

    // -----------------------------------------------------------------------
    // 4. Archetype registration (LAST, per the review's ordering)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("CODE_CARRIAGE is registered: its real headings score COMPLETENESS 100, no longer 0/7 against the LLM template")
    void codeCarriageSectionsRegistered() {
        SpecQualityScorer.Output out = scorer.score(input(CODE_SPEC_HEALTHY, SpecArchetype.CODE_CARRIAGE));
        assertThat(dim(out, SpecQualityScorer.DIMENSION_COMPLETENESS)).isEqualTo(100);
        assertThat(reason(out, SpecQualityScorer.DIMENSION_COMPLETENESS)).contains("5/5");
        // Same text against the LLM template is what the book graded F on.
        SpecQualityScorer.Output asLlm = scorer.score(input(CODE_SPEC_HEALTHY, SpecArchetype.LLM_SHAPE));
        assertThat(dim(asLlm, SpecQualityScorer.DIMENSION_COMPLETENESS)).isLessThan(50);
    }
}
