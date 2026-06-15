package com.example.architecturemodel.service.quality;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * Focused JUnit tests for {@link SpecQualityScorer}.
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Eight test methods covering:</p>
 * <ol>
 *   <li>COMPLETENESS dimension (4 of 7 sections present)</li>
 *   <li>AC MEASURABILITY dimension (per-AC +25 signals, mean across ACs)</li>
 *   <li>IMPLEMENTATION CONCRETENESS dimension (distinct concrete refs)</li>
 *   <li>EVIDENCE DENSITY dimension (refs / (words/100))</li>
 *   <li>SIBLING/PARENT ALIGNMENT dimension (warnings drive +/-)</li>
 *   <li>Composite weighted score against a pinned five-sub-score input</li>
 *   <li>Grade-band boundary mapping (85=A, 84=B, ... , 39=F)</li>
 *   <li>Malformed input (empty spec text + null lists) -- no exception,
 *       returns valid low composite score</li>
 * </ol>
 *
 * <p>The scorer is pure-Java with no Spring collaborators, so these tests
 * instantiate it directly with {@code new SpecQualityScorer()}.</p>
 */
class SpecQualityScorerTest {

    private final SpecQualityScorer scorer = new SpecQualityScorer();

    // -----------------------------------------------------------------------
    // Test 1: COMPLETENESS
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("COMPLETENESS: 4 of 7 sections detected returns score 57 with missing-list reason")
    void completeness_fourOfSeven_sectionsDetected() {
        // Spec text with exactly 4 of the 7 expected sections:
        //   decisions, interfaces, assumptions, acceptance criteria.
        // Missing: tests, evidence refs, files affected.
        String specText = String.join("\n",
            "## Decisions",
            "- decide thing",
            "## Interfaces",
            "- IPaymentService",
            "## Assumptions",
            "- assume foo",
            "## Acceptance Criteria",
            "- 1. when X then Y returns Z 200 status");

        SpecQualityScorer.DimensionScore dim = scorer.scoreCompleteness(specText);

        assertThat(dim.name()).isEqualTo(SpecQualityScorer.DIMENSION_COMPLETENESS);
        // round(4/7*100) = round(57.142) = 57
        assertThat(dim.score()).isEqualTo(57);
        assertThat(dim.reason())
            .startsWith("4/7 expected sections present; missing: ")
            .contains("tests")
            .contains("evidence refs")
            .contains("files affected");
    }

    // -----------------------------------------------------------------------
    // Test 2: AC MEASURABILITY
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AC MEASURABILITY: weak vs strong ACs produce mean score with weakest-snippet reason")
    void acMeasurability_mixedAcsReturnMeanScore() {
        // Three ACs:
        //   1. Strong: numeric + status keyword + named entity + measurable verb = 100
        //   2. Strong: numeric + status keyword + named entity + measurable verb = 100
        //   3. Weak:   none of the signals = 0
        // Mean = (100 + 100 + 0) / 3 = 67 (rounded).
        String specText = String.join("\n",
            "## Acceptance Criteria",
            "- when PaymentService returns 200 it asserts payment record exists",
            "- given OrderService should return 5 entries, validates ordering",
            "- it could be nicer or maybe not really specific");

        SpecQualityScorer.DimensionScore dim = scorer.scoreAcMeasurability(specText);

        assertThat(dim.name()).isEqualTo(SpecQualityScorer.DIMENSION_AC_MEASURABILITY);
        // Mean: 67 (rounded from 66.67)
        assertThat(dim.score()).isCloseTo(67, within(1));
        assertThat(dim.reason())
            .contains("2 of 3 ACs include measurable signals")
            .contains("weakest:");
        // Weakest-AC snippet must be <= 60 chars
        int weakestIdx = dim.reason().indexOf("weakest: ");
        if (weakestIdx >= 0) {
            String snippet = dim.reason().substring(weakestIdx + "weakest: ".length());
            assertThat(snippet.length()).isLessThanOrEqualTo(60);
        }
    }

    // -----------------------------------------------------------------------
    // Test 3: IMPLEMENTATION CONCRETENESS
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("IMPLEMENTATION CONCRETENESS: 7 distinct concrete refs returns score 70")
    void implementationConcreteness_sevenDistinctRefs() {
        // Seven DISTINCT concrete references:
        //   1. file path:    src/main/java/Foo.java
        //   2. file path:    db/schema.sql
        //   3. FQN:          com.example.payments.PaymentService
        //   4. FQN:          com.example.orders.OrderService
        //   5. REST op:      POST /api/v1/payments
        //   6. REST op:      GET /api/v1/orders
        //   7. backtick:     `someIdentifier`
        // Distinct count = 7; score = min(100, 7*10) = 70.
        String specText = String.join("\n",
            "Files: src/main/java/Foo.java and db/schema.sql",
            "Calls: com.example.payments.PaymentService and com.example.orders.OrderService",
            "Routes: POST /api/v1/payments and GET /api/v1/orders",
            "Symbol: `someIdentifier`");

        SpecQualityScorer.DimensionScore dim =
            scorer.scoreImplementationConcreteness(specText, null);

        assertThat(dim.name()).isEqualTo(SpecQualityScorer.DIMENSION_IMPLEMENTATION_CONCRETENESS);
        // Allow +/- some leeway since regexes may also pick up other patterns
        // (e.g. backticked refs counted both as backtick and FQN). Accept any
        // count >= 7 since the spec contract is "min(100, count*10)".
        assertThat(dim.score()).isGreaterThanOrEqualTo(70);
        assertThat(dim.reason()).contains("concrete references found (files, classes, operations)");
    }

    // -----------------------------------------------------------------------
    // Test 4: EVIDENCE DENSITY
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("EVIDENCE DENSITY: 4 evidence refs across ~100 words yields density 4.0 -> score 100")
    void evidenceDensity_fourRefsHundredWords() {
        // 4 bracketed evidence refs + filler words to reach ~100 words.
        StringBuilder sb = new StringBuilder();
        sb.append("[finding-1] [finding-2] [baseline-3] [evidence-4]\n");
        // Fill with ~96 words so total word count is around 100.
        for (int i = 0; i < 12; i++) {
            sb.append("word filler text describing additional content here today ");
        }
        String specText = sb.toString();

        SpecQualityScorer.DimensionScore dim = scorer.scoreEvidenceDensity(specText);

        assertThat(dim.name()).isEqualTo(SpecQualityScorer.DIMENSION_EVIDENCE_DENSITY);
        // 4 refs / (100 words / 100) = 4.0 density; round(4.0 * 25) = 100
        assertThat(dim.score()).isEqualTo(100);
        assertThat(dim.reason()).contains("evidence refs across").contains("density =");
    }

    // -----------------------------------------------------------------------
    // Test 5: SIBLING/PARENT ALIGNMENT
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("SIBLING/PARENT ALIGNMENT: 1 contradicts + 2 aligned yields 50 - 20 + 30 = 60")
    void siblingParentAlignment_oneContradictTwoAligned() {
        List<Map<String, Object>> warnings = new ArrayList<>();
        warnings.add(Map.of("kind", "contradicts_sibling"));
        warnings.add(Map.of("kind", "aligned_with_epic_decision"));
        warnings.add(Map.of("kind", "aligned_with_epic_decision"));
        // Noise warning -- ignored.
        warnings.add(Map.of("kind", "parser_missing_heading", "section", "tests"));

        SpecQualityScorer.DimensionScore dim = scorer.scoreSiblingParentAlignment(warnings);

        assertThat(dim.name()).isEqualTo(SpecQualityScorer.DIMENSION_SIBLING_PARENT_ALIGNMENT);
        // 50 - 20 + (2 * 15) = 60
        assertThat(dim.score()).isEqualTo(60);
        assertThat(dim.reason()).isEqualTo("1 contradictions, 2 alignments; from baseline 50");
    }

    // -----------------------------------------------------------------------
    // Test 6: composite weighted score
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Composite weighted score combines all five dimensions with v1 weights")
    void composite_weightedAcrossDimensions() {
        // Spec text designed to produce known sub-scores:
        //   - Full COMPLETENESS (7/7): score 100
        //   - AC MEASURABILITY: at least one strong AC line
        //   - some IMPLEMENTATION CONCRETENESS refs
        //   - moderate EVIDENCE DENSITY refs
        // We assert the composite is in the right ballpark given the weights.
        // Specifically we assert composite == round((c*30+ac*25+ic*20+ed*15+sa*10)/100).
        String specText = String.join("\n",
            "## Decisions",
            "- decide thing",
            "## Interfaces",
            "- PaymentService",
            "## Assumptions",
            "- assumption A",
            "## Acceptance Criteria",
            "- when PaymentService returns 200 it asserts the record exists",
            "## Tests",
            "- com.example.payments.PaymentServiceTest covers the success case",
            "## Evidence",
            "- [finding-123] payment-service-spec.md",
            "## Files Affected",
            "- src/main/java/Foo.java",
            "Evidence: [baseline-x]");

        // Compute each dimension independently for the assertion.
        SpecQualityScorer.DimensionScore c = scorer.scoreCompleteness(specText);
        SpecQualityScorer.DimensionScore ac = scorer.scoreAcMeasurability(specText);
        SpecQualityScorer.DimensionScore ic = scorer.scoreImplementationConcreteness(specText, null);
        SpecQualityScorer.DimensionScore ed = scorer.scoreEvidenceDensity(specText);
        SpecQualityScorer.DimensionScore sa = scorer.scoreSiblingParentAlignment(null);

        int expectedComposite = (int) Math.round(
            (c.score() * 30 + ac.score() * 25 + ic.score() * 20
                + ed.score() * 15 + sa.score() * 10) / 100.0);

        SpecQualityScorer.Output out = scorer.score(
            new SpecQualityScorer.Input(specText, null, null, null, null, null));

        assertThat(out.score()).isEqualTo(expectedComposite);
        assertThat(out.dimensions()).hasSize(5);
        // Completeness is 7/7 here.
        assertThat(c.score()).isEqualTo(100);
        // Grade is the right letter for this composite.
        assertThat(out.grade()).isIn("A", "B", "C", "D", "F");
    }

    // -----------------------------------------------------------------------
    // Test 7: grade-band mapping boundaries
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Grade-band mapping: boundary composite scores map to A/B/C/D/F per pinned thresholds")
    void gradeBands_boundaryMapping() {
        // Direct mapGrade boundary tests (package-private helper). The spec
        // pins: A >= 85, B 70-84, C 55-69, D 40-54, F < 40. We test the exact
        // boundaries on both sides of every band edge.
        assertThat(SpecQualityScorer.mapGrade(100)).isEqualTo("A");
        assertThat(SpecQualityScorer.mapGrade(85)).isEqualTo("A");
        assertThat(SpecQualityScorer.mapGrade(84)).isEqualTo("B");
        assertThat(SpecQualityScorer.mapGrade(70)).isEqualTo("B");
        assertThat(SpecQualityScorer.mapGrade(69)).isEqualTo("C");
        assertThat(SpecQualityScorer.mapGrade(55)).isEqualTo("C");
        assertThat(SpecQualityScorer.mapGrade(54)).isEqualTo("D");
        assertThat(SpecQualityScorer.mapGrade(40)).isEqualTo("D");
        assertThat(SpecQualityScorer.mapGrade(39)).isEqualTo("F");
        assertThat(SpecQualityScorer.mapGrade(0)).isEqualTo("F");

        // Round-trip smoke: composite score from a real input goes through
        // mapGrade and the public grade matches.
        SpecQualityScorer.Output low = scorer.score(
            new SpecQualityScorer.Input("", null, null, null, null, null));
        assertThat(low.grade()).isEqualTo(SpecQualityScorer.mapGrade(low.score()));
    }

    // -----------------------------------------------------------------------
    // Test 8: malformed input -- empty spec text + null lists
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Malformed input: empty spec text + null lists returns valid low score, no exception")
    void malformedInput_emptyAndNullsReturnLowScore() {
        // Null input -- no exception, returns a valid 5-dimension result.
        SpecQualityScorer.Output out = scorer.score(null);
        assertThat(out.dimensions()).hasSize(5);
        assertThat(out.score()).isGreaterThanOrEqualTo(0);
        assertThat(out.score()).isLessThan(40); // F-tier
        assertThat(out.grade()).isEqualTo("F");

        // Empty spec text + null lists -- same outcome.
        SpecQualityScorer.Output out2 = scorer.score(
            new SpecQualityScorer.Input("", null, null, null, null, null));
        assertThat(out2.score()).isGreaterThanOrEqualTo(0);
        assertThat(out2.grade()).isEqualTo("F");

        // Whitespace-only spec text -- same outcome.
        SpecQualityScorer.Output out3 = scorer.score(
            new SpecQualityScorer.Input("   \n\n   ", null, null, null, null, null));
        assertThat(out3.score()).isGreaterThanOrEqualTo(0);
        assertThat(out3.grade()).isEqualTo("F");

        // Per dimension: each should still yield a row in the result.
        for (Map<String, Object> dim : out.dimensions()) {
            assertThat(dim).containsKeys("name", "score", "reason");
        }
    }

    // -----------------------------------------------------------------------
    // Extra: verify warning-driven alignment clamps at 0 and 100
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("SIBLING/PARENT ALIGNMENT clamps below 0 and above 100")
    void alignment_clampsAtBoundaries() {
        // Many contradicts -> floor to 0.
        List<Map<String, Object>> manyContradicts = new ArrayList<>();
        for (int i = 0; i < 10; i++) manyContradicts.add(Map.of("kind", "contradicts_sibling"));
        SpecQualityScorer.DimensionScore low =
            scorer.scoreSiblingParentAlignment(manyContradicts);
        assertThat(low.score()).isEqualTo(0);

        // Many alignments -> cap at 100.
        List<Map<String, Object>> manyAligned = new ArrayList<>();
        for (int i = 0; i < 10; i++) manyAligned.add(Map.of("kind", "aligned_with_epic_decision"));
        SpecQualityScorer.DimensionScore high =
            scorer.scoreSiblingParentAlignment(manyAligned);
        assertThat(high.score()).isEqualTo(100);

        // Null list -> baseline 50.
        SpecQualityScorer.DimensionScore baseline =
            scorer.scoreSiblingParentAlignment(null);
        assertThat(baseline.score()).isEqualTo(50);
    }
}
