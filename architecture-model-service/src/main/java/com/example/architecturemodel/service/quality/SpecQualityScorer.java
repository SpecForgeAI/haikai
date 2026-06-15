package com.example.architecturemodel.service.quality;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic, rules-based five-dimension quality scorer for generated
 * migration-story shape specs.
 *
 * <p>Spec: Spec Quality Scoring (2026-05-20) -- Task Group 2.</p>
 *
 * <p>The scorer is pure-Java and policy-only: no LLM call, no Spring
 * autowiring of collaborators, no database access. Inputs are a single
 * {@link Input} record carrying the generated spec text plus the four
 * parser-extracted lists ({@code decisions} / {@code interfaces} /
 * {@code assumptions} / {@code warnings}) already persisted on the row.
 * Output is a single {@link Output} record carrying the composite 0-100
 * {@code score}, the derived A-F {@code grade}, and a {@code dimensions} list
 * of {@code {name, score, reason}} maps ready to be JSON-persisted onto
 * {@code migration_story_spec_generations.quality_dimensions_json}.</p>
 *
 * <p><b>Robustness:</b> the scorer NEVER throws on malformed input. Empty
 * spec text + null lists yield a valid (low) composite score, not an
 * exception. The persist-time hook in
 * {@code MigrationStorySpecGenerationService.persistOne} additionally wraps
 * the call in a try/catch so a programming error here never blocks
 * persistence of the spec text itself.</p>
 *
 * <p><b>Weights and thresholds (v1, pinned as code constants):</b></p>
 * <ul>
 *   <li>COMPLETENESS 30, AC MEASURABILITY 25, IMPLEMENTATION CONCRETENESS 20,
 *       EVIDENCE DENSITY 15, SIBLING/PARENT ALIGNMENT 10 (sum = 100)</li>
 *   <li>Grade bands: A &gt;= 85, B 70-84, C 55-69, D 40-54, F &lt; 40</li>
 * </ul>
 */
@Component
@Slf4j
public class SpecQualityScorer {

    // -----------------------------------------------------------------------
    // Dimension names (stable strings persisted into quality_dimensions_json)
    // -----------------------------------------------------------------------

    public static final String DIMENSION_COMPLETENESS = "completeness";
    public static final String DIMENSION_AC_MEASURABILITY = "ac_measurability";
    public static final String DIMENSION_IMPLEMENTATION_CONCRETENESS =
        "implementation_concreteness";
    public static final String DIMENSION_EVIDENCE_DENSITY = "evidence_density";
    public static final String DIMENSION_SIBLING_PARENT_ALIGNMENT =
        "sibling_parent_alignment";

    // -----------------------------------------------------------------------
    // v1 weights (sum to 100; composite = weighted_sum / 100)
    // -----------------------------------------------------------------------

    private static final int WEIGHT_COMPLETENESS = 30;
    private static final int WEIGHT_AC_MEASURABILITY = 25;
    private static final int WEIGHT_IMPLEMENTATION_CONCRETENESS = 20;
    private static final int WEIGHT_EVIDENCE_DENSITY = 15;
    private static final int WEIGHT_SIBLING_PARENT_ALIGNMENT = 10;

    // -----------------------------------------------------------------------
    // Grade-band thresholds
    // -----------------------------------------------------------------------

    private static final int GRADE_A_MIN = 85;
    private static final int GRADE_B_MIN = 70;
    private static final int GRADE_C_MIN = 55;
    private static final int GRADE_D_MIN = 40;

    // -----------------------------------------------------------------------
    // Warning kinds we react to
    // -----------------------------------------------------------------------

    private static final String WARNING_KIND_CONTRADICTS_SIBLING = "contradicts_sibling";
    private static final String WARNING_KIND_ALIGNED_WITH_EPIC_DECISION =
        "aligned_with_epic_decision";

    // -----------------------------------------------------------------------
    // Section heading detection (COMPLETENESS). Tolerant of leading optional
    // ATX heading marker, trailing colon, plural suffixes, and case.
    // -----------------------------------------------------------------------

    private static final Pattern HEADING_DECISIONS = headingPattern("decisions?");
    private static final Pattern HEADING_INTERFACES = headingPattern("interfaces?");
    private static final Pattern HEADING_ASSUMPTIONS = headingPattern("assumptions?");
    private static final Pattern HEADING_ACCEPTANCE_CRITERIA =
        headingPattern("acceptance\\s+criteria");
    private static final Pattern HEADING_TESTS = headingPattern("tests?");
    private static final Pattern HEADING_EVIDENCE =
        headingPattern("(?:evidence(?:\\s+refs?)?|evidence\\s+references?)");
    private static final Pattern HEADING_FILES_AFFECTED =
        headingPattern("files\\s+affected");

    /**
     * Stable label-by-label section descriptors. The list ordering controls the
     * "missing: X, Y, Z" reason ordering.
     */
    private static final List<SectionDescriptor> EXPECTED_SECTIONS = List.of(
        new SectionDescriptor("decisions", HEADING_DECISIONS),
        new SectionDescriptor("interfaces", HEADING_INTERFACES),
        new SectionDescriptor("assumptions", HEADING_ASSUMPTIONS),
        new SectionDescriptor("acceptance criteria", HEADING_ACCEPTANCE_CRITERIA),
        new SectionDescriptor("tests", HEADING_TESTS),
        new SectionDescriptor("evidence refs", HEADING_EVIDENCE),
        new SectionDescriptor("files affected", HEADING_FILES_AFFECTED)
    );

    private record SectionDescriptor(String label, Pattern pattern) {}

    private static Pattern headingPattern(String label) {
        return Pattern.compile(
            "^\\s*(?:[#]{1,6}\\s+)?" + label + "\\s*:?\\s*$",
            Pattern.CASE_INSENSITIVE);
    }

    // -----------------------------------------------------------------------
    // AC MEASURABILITY signal patterns (per-AC up-to-100 from four +25 signals)
    // -----------------------------------------------------------------------

    private static final Pattern AC_NUMERIC_TOKEN = Pattern.compile("\\d+");
    private static final Pattern AC_STATUS_KEYWORD = Pattern.compile(
        "\\b(returns|should|given|when|then|must|will)\\b",
        Pattern.CASE_INSENSITIVE);
    /**
     * Named-entity reference: a CapitalisedWord, a camelCaseToken, OR a
     * backtick-wrapped identifier. We intentionally require length 2+ chars on
     * the all-caps / camel branches so single capital letters at sentence start
     * (e.g. "A user can...") do not register.
     */
    private static final Pattern AC_NAMED_ENTITY = Pattern.compile(
        "(?:`[^`]+`|\\b[A-Z][a-zA-Z0-9]{2,}\\b|\\b[a-z]+(?:[A-Z][a-zA-Z0-9]+)+\\b)");
    private static final Pattern AC_MEASURABLE_VERB = Pattern.compile(
        "\\b(validates|asserts|equals|contains|matches|throws|emits)\\b",
        Pattern.CASE_INSENSITIVE);

    // -----------------------------------------------------------------------
    // AC line shape ("- foo" / "* foo" / "1. foo" / "1) foo")
    // -----------------------------------------------------------------------

    private static final Pattern LIST_BULLET = Pattern.compile(
        "^\\s*[-*+]\\s+(.+?)\\s*$");
    private static final Pattern LIST_ORDERED = Pattern.compile(
        "^\\s*\\d+[.)]\\s+(.+?)\\s*$");

    // -----------------------------------------------------------------------
    // IMPLEMENTATION CONCRETENESS regexes (count DISTINCT hits, not total)
    // -----------------------------------------------------------------------

    private static final Pattern CONCRETE_FILE_PATH = Pattern.compile(
        "[\\w./-]+\\.(?:java|ts|tsx|py|go|sql|md|yml|yaml|json|js|jsx)\\b");
    private static final Pattern CONCRETE_FQN = Pattern.compile(
        "\\b[a-zA-Z_][\\w]*(?:\\.[a-zA-Z_][\\w]*){2,}\\b");
    private static final Pattern CONCRETE_REST_OP = Pattern.compile(
        "\\b(?:GET|POST|PUT|PATCH|DELETE)\\s+/\\S+");
    private static final Pattern CONCRETE_WSDL_OP = Pattern.compile(
        "<operation\\s+name\\s*=\\s*\"([^\"]+)\"",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern CONCRETE_BACKTICK = Pattern.compile(
        "`([\\w./\\-:]+)`");

    // -----------------------------------------------------------------------
    // EVIDENCE DENSITY regexes
    // -----------------------------------------------------------------------

    private static final Pattern EVIDENCE_LINE_PREFIX = Pattern.compile(
        "^\\s*(?:[-*+]\\s+)?(?:Evidence\\s*:|evidence_ref\\s*:|-\\s*finding-id\\s*:|finding-id\\s*:)",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern EVIDENCE_BRACKETED = Pattern.compile(
        "\\[(?:finding-[^\\]]+|baseline-[^\\]]+|evidence-[^\\]]+)\\]",
        Pattern.CASE_INSENSITIVE);

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Input record. All fields are nullable; the scorer treats null/empty as
     * zero-content for the affected dimension.
     */
    public record Input(
        String specText,
        List<String> decisions,
        List<String> interfaces,
        List<String> assumptions,
        List<Map<String, Object>> warnings,
        String storyTitle
    ) {
    }

    /**
     * Per-dimension breakdown row. Persisted as a map entry on
     * {@code quality_dimensions_json}.
     */
    public record DimensionScore(String name, int score, String reason) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("score", score);
            m.put("reason", reason);
            return m;
        }
    }

    /** Output record. */
    public record Output(int score, String grade, List<Map<String, Object>> dimensions) {
    }

    /**
     * Score the supplied input. NEVER throws -- empty / null inputs yield a
     * valid (low) composite score and a complete five-row breakdown.
     */
    public Output score(Input input) {
        Input safe = input == null
            ? new Input(null, null, null, null, null, null)
            : input;
        String specText = safe.specText() == null ? "" : safe.specText();

        DimensionScore completeness = scoreCompleteness(specText);
        DimensionScore acMeasurability = scoreAcMeasurability(specText);
        DimensionScore concreteness = scoreImplementationConcreteness(specText, safe.storyTitle());
        DimensionScore evidence = scoreEvidenceDensity(specText);
        DimensionScore alignment = scoreSiblingParentAlignment(safe.warnings());

        int composite = compositeScore(
            completeness.score(),
            acMeasurability.score(),
            concreteness.score(),
            evidence.score(),
            alignment.score());
        String grade = mapGrade(composite);

        List<Map<String, Object>> dims = new ArrayList<>(5);
        dims.add(completeness.toMap());
        dims.add(acMeasurability.toMap());
        dims.add(concreteness.toMap());
        dims.add(evidence.toMap());
        dims.add(alignment.toMap());

        return new Output(composite, grade, dims);
    }

    // -----------------------------------------------------------------------
    // Dimension 1: COMPLETENESS
    // -----------------------------------------------------------------------

    DimensionScore scoreCompleteness(String specText) {
        if (specText == null || specText.isBlank()) {
            // Build the full "missing: ..." list verbatim from EXPECTED_SECTIONS.
            String missing = joinLabels(
                EXPECTED_SECTIONS.stream().map(SectionDescriptor::label).toList());
            return new DimensionScore(
                DIMENSION_COMPLETENESS,
                0,
                "0/" + EXPECTED_SECTIONS.size() + " expected sections present; missing: " + missing);
        }
        String[] lines = specText.split("\\r?\\n", -1);
        int present = 0;
        List<String> missingLabels = new ArrayList<>();
        for (SectionDescriptor sd : EXPECTED_SECTIONS) {
            if (anyLineMatches(lines, sd.pattern())) {
                present++;
            } else {
                missingLabels.add(sd.label());
            }
        }
        int score = (int) Math.round((present / (double) EXPECTED_SECTIONS.size()) * 100.0);
        String reason;
        if (missingLabels.isEmpty()) {
            reason = present + "/" + EXPECTED_SECTIONS.size() + " expected sections present";
        } else {
            reason = present + "/" + EXPECTED_SECTIONS.size()
                + " expected sections present; missing: "
                + joinLabels(missingLabels);
        }
        return new DimensionScore(DIMENSION_COMPLETENESS, score, reason);
    }

    private static boolean anyLineMatches(String[] lines, Pattern p) {
        for (String line : lines) {
            if (p.matcher(line).matches()) return true;
        }
        return false;
    }

    private static String joinLabels(List<String> labels) {
        return String.join(", ", labels);
    }

    // -----------------------------------------------------------------------
    // Dimension 2: AC MEASURABILITY
    // -----------------------------------------------------------------------

    DimensionScore scoreAcMeasurability(String specText) {
        if (specText == null || specText.isBlank()) {
            return new DimensionScore(
                DIMENSION_AC_MEASURABILITY, 0, "No acceptance criteria found in spec");
        }
        List<String> acs = extractAcceptanceCriteriaLines(specText);
        if (acs.isEmpty()) {
            return new DimensionScore(
                DIMENSION_AC_MEASURABILITY, 0, "No acceptance criteria found in spec");
        }
        int total = 0;
        int measurableAcCount = 0;
        String weakestSnippet = null;
        int weakestScore = Integer.MAX_VALUE;
        for (String ac : acs) {
            int perAc = scoreSingleAc(ac);
            total += perAc;
            if (perAc >= 50) {
                measurableAcCount++;
            }
            if (perAc < weakestScore) {
                weakestScore = perAc;
                weakestSnippet = ac;
            }
        }
        int mean = (int) Math.round(total / (double) acs.size());
        String snippet = weakestSnippet == null ? "" : truncate(weakestSnippet, 60);
        String reason = measurableAcCount + " of " + acs.size()
            + " ACs include measurable signals; weakest: " + snippet;
        return new DimensionScore(DIMENSION_AC_MEASURABILITY, mean, reason);
    }

    /**
     * Score a single AC line out of 100. Four +25 signals: numeric token,
     * status keyword, named-entity reference, measurable verb.
     */
    private static int scoreSingleAc(String ac) {
        int s = 0;
        if (AC_NUMERIC_TOKEN.matcher(ac).find()) s += 25;
        if (AC_STATUS_KEYWORD.matcher(ac).find()) s += 25;
        if (AC_NAMED_ENTITY.matcher(ac).find()) s += 25;
        if (AC_MEASURABLE_VERB.matcher(ac).find()) s += 25;
        return Math.min(100, s);
    }

    /**
     * Pull the block between {@code ## Acceptance Criteria} (any heading level
     * / tolerant pluralisation) and the next heading boundary, then split into
     * AC entries (bullet / ordered list items). Returns an empty list when no
     * AC heading is present OR when the block contains no list items.
     */
    private static List<String> extractAcceptanceCriteriaLines(String specText) {
        String[] lines = specText.split("\\r?\\n", -1);
        int startIdx = -1;
        for (int i = 0; i < lines.length; i++) {
            if (HEADING_ACCEPTANCE_CRITERIA.matcher(lines[i]).matches()) {
                startIdx = i + 1;
                break;
            }
        }
        if (startIdx < 0) return List.of();
        List<String> acs = new ArrayList<>();
        for (int i = startIdx; i < lines.length; i++) {
            String raw = lines[i];
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) continue;
            if (isAnotherHeading(raw)) break;
            Matcher b = LIST_BULLET.matcher(raw);
            if (b.matches()) {
                acs.add(b.group(1).trim());
                continue;
            }
            Matcher o = LIST_ORDERED.matcher(raw);
            if (o.matches()) {
                acs.add(o.group(1).trim());
            }
        }
        return acs;
    }

    /**
     * "Another heading" boundary detector for the AC block. Matches any of the
     * known section headings OR a generic ATX-style heading line.
     */
    private static boolean isAnotherHeading(String line) {
        for (SectionDescriptor sd : EXPECTED_SECTIONS) {
            if (sd.pattern().matcher(line).matches()
                && !HEADING_ACCEPTANCE_CRITERIA.equals(sd.pattern())) {
                return true;
            }
        }
        // Generic ATX heading (## Something) we don't otherwise know about.
        return line.matches("^\\s*[#]{1,6}\\s+\\S.*$");
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    // -----------------------------------------------------------------------
    // Dimension 3: IMPLEMENTATION CONCRETENESS
    // -----------------------------------------------------------------------

    DimensionScore scoreImplementationConcreteness(String specText, String storyTitle) {
        if (specText == null || specText.isBlank()) {
            return new DimensionScore(
                DIMENSION_IMPLEMENTATION_CONCRETENESS,
                0,
                "0 concrete references found (files, classes, operations)");
        }
        Set<String> distinct = new HashSet<>();
        collectMatches(CONCRETE_FILE_PATH, specText, distinct);
        collectMatches(CONCRETE_FQN, specText, distinct);
        collectMatches(CONCRETE_REST_OP, specText, distinct);
        collectGroup1(CONCRETE_WSDL_OP, specText, distinct);
        collectGroup1(CONCRETE_BACKTICK, specText, distinct);

        // Story-title entity refs (case-insensitive substring match per token).
        if (storyTitle != null && !storyTitle.isBlank()) {
            for (String token : storyTitle.split("\\s+")) {
                if (token.length() < 3) continue;
                if (specText.toLowerCase(Locale.ROOT)
                    .contains(token.toLowerCase(Locale.ROOT))) {
                    distinct.add("title:" + token.toLowerCase(Locale.ROOT));
                }
            }
        }
        int count = distinct.size();
        int score = Math.min(100, count * 10);
        String reason = count + " concrete references found (files, classes, operations)";
        return new DimensionScore(DIMENSION_IMPLEMENTATION_CONCRETENESS, score, reason);
    }

    private static void collectMatches(Pattern p, String text, Set<String> sink) {
        Matcher m = p.matcher(text);
        while (m.find()) {
            sink.add(m.group());
        }
    }

    private static void collectGroup1(Pattern p, String text, Set<String> sink) {
        Matcher m = p.matcher(text);
        while (m.find()) {
            sink.add(m.group(1));
        }
    }

    // -----------------------------------------------------------------------
    // Dimension 4: EVIDENCE DENSITY
    // -----------------------------------------------------------------------

    DimensionScore scoreEvidenceDensity(String specText) {
        if (specText == null || specText.isBlank()) {
            return new DimensionScore(
                DIMENSION_EVIDENCE_DENSITY,
                0,
                "0 evidence refs across ~0 words; density = 0.00");
        }
        int refs = 0;
        for (String line : specText.split("\\r?\\n", -1)) {
            if (EVIDENCE_LINE_PREFIX.matcher(line).find()) refs++;
        }
        Matcher bm = EVIDENCE_BRACKETED.matcher(specText);
        while (bm.find()) refs++;
        int wordCount = countWords(specText);
        double density = refs / Math.max(1.0, wordCount / 100.0);
        int score = (int) Math.min(100, Math.round(density * 25.0));
        String reason = refs + " evidence refs across ~" + wordCount
            + " words; density = " + String.format(Locale.ROOT, "%.2f", density);
        return new DimensionScore(DIMENSION_EVIDENCE_DENSITY, score, reason);
    }

    private static int countWords(String text) {
        if (text == null) return 0;
        String trimmed = text.trim();
        if (trimmed.isEmpty()) return 0;
        return trimmed.split("\\s+").length;
    }

    // -----------------------------------------------------------------------
    // Dimension 5: SIBLING/PARENT ALIGNMENT
    // -----------------------------------------------------------------------

    DimensionScore scoreSiblingParentAlignment(List<Map<String, Object>> warnings) {
        int contradictions = 0;
        int alignments = 0;
        if (warnings != null) {
            for (Map<String, Object> w : warnings) {
                if (w == null) continue;
                Object kind = w.get("kind");
                if (WARNING_KIND_CONTRADICTS_SIBLING.equals(kind)) contradictions++;
                else if (WARNING_KIND_ALIGNED_WITH_EPIC_DECISION.equals(kind)) alignments++;
            }
        }
        int raw = 50 - (contradictions * 20) + (alignments * 15);
        int clamped = Math.max(0, Math.min(100, raw));
        String reason = contradictions + " contradictions, " + alignments
            + " alignments; from baseline 50";
        return new DimensionScore(DIMENSION_SIBLING_PARENT_ALIGNMENT, clamped, reason);
    }

    // -----------------------------------------------------------------------
    // Composite + grade
    // -----------------------------------------------------------------------

    private static int compositeScore(int completeness, int acMeasurability,
                                      int concreteness, int evidence, int alignment) {
        int weightedSum = completeness * WEIGHT_COMPLETENESS
            + acMeasurability * WEIGHT_AC_MEASURABILITY
            + concreteness * WEIGHT_IMPLEMENTATION_CONCRETENESS
            + evidence * WEIGHT_EVIDENCE_DENSITY
            + alignment * WEIGHT_SIBLING_PARENT_ALIGNMENT;
        return (int) Math.round(weightedSum / 100.0);
    }

    static String mapGrade(int score) {
        if (score >= GRADE_A_MIN) return "A";
        if (score >= GRADE_B_MIN) return "B";
        if (score >= GRADE_C_MIN) return "C";
        if (score >= GRADE_D_MIN) return "D";
        return "F";
    }
}
