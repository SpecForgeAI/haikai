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
 *   <li>COMPLETENESS 20, AC MEASURABILITY 25, IMPLEMENTATION CONCRETENESS 15,
 *       EVIDENCE DENSITY 15, SIBLING/PARENT ALIGNMENT 10, MECHANICAL TRUTH 15
 *       (sum = 100; reweighted 2026-09-03 — see below)</li>
 *   <li>Grade bands: A &gt;= 85, B 70-84, C 55-69, D 40-54, F &lt; 40</li>
 * </ul>
 *
 * <p><b>Archetype awareness (2026-08-30).</b> v1 measured every row against the
 * LLM shape-spec template: seven bare-label sections and two citation
 * notations. Deterministic carriage generators emit neither, so on a
 * carriage-dominated book the scorer reported COMPLETENESS near zero,
 * EVIDENCE DENSITY at exactly zero for 100% of rows, and SIBLING/PARENT
 * ALIGNMENT as the constant 50 — three of five dimensions carrying no signal,
 * which graded well-formed specs F. The scorer now resolves a
 * {@link SpecArchetype} from {@code focused_context_refs_json.source} and
 * measures each row against the vocabulary its producer actually emits.
 * An unknown or absent source falls back to {@link SpecArchetype#LLM_SHAPE},
 * preserving v1 behaviour exactly for the LLM path.</p>
 *
 * <p>This is a MEASUREMENT fix, not a leniency fix: a genuinely missing
 * acceptance-criteria section is still scored as missing (see
 * {@link SpecArchetype#DB_PACK}), and unresolved references now cost points
 * where previously they cost nothing.</p>
 *
 * <p><b>Discrimination rework (2026-09-03, spec-quality review).</b> On a
 * 116-spec book three of five dimensions were effectively constants: every
 * well-formed spec started at 55 (the bottom of C) and 77% of the book was C.
 * IMPLEMENTATION CONCRETENESS saturated (101/116 at exactly 100) because it
 * capped at ten distinct references and counted the byte-identical
 * "Target technology stack" dump appended to every spec; COMPLETENESS was
 * circular (headings verified against what each generator emits); and the
 * scorer could not tell a spec whose verification oracle passes over an empty
 * scope from one whose oracle is sound. Changes:</p>
 * <ul>
 *   <li>CONCRETENESS is scored on the BODY (the stack section excluded) and
 *       normalised by length — references per hundred words — so padding
 *       lowers it and a long spec needs proportionally more anchors.</li>
 *   <li>New MECHANICAL TRUTH dimension: four archetype-aware checks that fall
 *       straight out of the review — UNRESOLVED dispatch rows, a response
 *       contract present, a non-empty data-effect scope, and acceptance
 *       criteria that name the baseline captures to replay. Checks that do not
 *       apply to an archetype are excluded, not awarded.</li>
 *   <li>Weights reweighted away from COMPLETENESS (30 -&gt; 20) and CONCRETENESS
 *       (20 -&gt; 15) to fund MECHANICAL TRUTH (15).</li>
 *   <li>{@link SpecArchetype#CODE_CARRIAGE} registered: 17 specs of the book
 *       fell to LLM_SHAPE's seven exact-match sections and scored 0/7. The
 *       registration is deliberately LAST in this list — fixing it before
 *       making the dimensions discriminate would have moved those specs to the
 *       same 66/C as the healthiest ones and destroyed the only signal.</li>
 *   <li>AC extraction reads prose: a block with no bullets or table rows
 *       counts each non-empty paragraph as one criterion (the manual gates'
 *       one-sentence "Gate condition" scored zero on entirely correct docs).</li>
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
    public static final String DIMENSION_MECHANICAL_TRUTH = "mechanical_truth";

    // -----------------------------------------------------------------------
    // v1 weights (sum to 100; composite = weighted_sum / 100)
    // -----------------------------------------------------------------------

    private static final int WEIGHT_COMPLETENESS = 20;
    private static final int WEIGHT_AC_MEASURABILITY = 25;
    private static final int WEIGHT_IMPLEMENTATION_CONCRETENESS = 15;
    private static final int WEIGHT_EVIDENCE_DENSITY = 15;
    private static final int WEIGHT_SIBLING_PARENT_ALIGNMENT = 10;
    private static final int WEIGHT_MECHANICAL_TRUTH = 15;

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

    /**
     * Emitted by the heading/reference parser when a spec cites a reference that
     * does not resolve in the committed model. Treated as a referential failure
     * against the parent/sibling context.
     */
    private static final String WARNING_KIND_UNRESOLVED_REFERENCE = "UNRESOLVED_REFERENCE";

    /** Points deducted per unresolved reference, floored at 0 by clamping. */
    private static final int UNRESOLVED_REFERENCE_PENALTY = 5;

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

    /**
     * Heading matcher for DETERMINISTIC CARRIAGE specs.
     *
     * <p>{@link #headingPattern} anchors the whole line ({@code ...\s*$}), which
     * is correct for the LLM shape-spec template whose headings are bare labels
     * ({@code Decisions:}). Carriage generators emit headings that carry a
     * trailing qualifier — e.g.
     * {@code ## Modernization decisions (confirmed — cite, never re-decide)}
     * and {@code ## Files to reproduce byte-for-byte (15)} — so a whole-line
     * anchor can NEVER match them. Every carriage archetype therefore scored
     * 1/7 or 0/7 on COMPLETENESS regardless of how complete it actually was.
     * This matcher requires the ATX marker (carriage headings always have one)
     * and anchors only the PREFIX.</p>
     */
    private static Pattern headingPrefixPattern(String label) {
        return Pattern.compile(
            "\\s*[#]{1,6}\\s+" + label + "\\b.*$",
            Pattern.CASE_INSENSITIVE);
    }

    private static SectionDescriptor carriageSection(String label) {
        return new SectionDescriptor(label, headingPrefixPattern(label));
    }

    // -----------------------------------------------------------------------
    // Spec archetypes (2026-08-30)
    //
    // COMPLETENESS is only meaningful against the section vocabulary the
    // producing generator actually emits. The v1 scorer hardcoded the LLM
    // shape-spec template's seven sections and applied it to every row, so
    // deterministic carriage specs were measured against headings they were
    // never designed to have. The archetype is resolved from
    // `focused_context_refs_json.source` and selects the expected set.
    //
    // DELIBERATELY UNCHANGED: an unknown/absent source falls back to
    // LLM_SHAPE with the original seven exact-match sections, so the LLM
    // path — the only path the v1 scorer measured correctly — keeps its
    // existing scores byte-for-byte.
    // -----------------------------------------------------------------------

    /** Producing-generator family for a spec row. */
    public enum SpecArchetype {
        /** LLM-authored shape spec (v1 behaviour; the default). */
        LLM_SHAPE,
        /** Per-endpoint carriage assembled from the SCL corpus. */
        SCL_CARRIAGE,
        /** DB migration pack carriage (changesets, runbooks, load scripts). */
        DB_PACK,
        /** Internal-process carriage with the DB-delta verification oracle. */
        INTERNAL_CARRIAGE,
        /** Human/wizard gate runbook. */
        MANUAL_GATE,
        /** Application scaffold + seed build files. */
        SCAFFOLD,
        /** Per-endpoint carriage assembled from the COMMITTED MODEL (2026-09-03). */
        CODE_CARRIAGE;

        /** Resolve from {@code focused_context_refs_json.source}. */
        public static SpecArchetype fromSource(String source) {
            if (source == null) return LLM_SHAPE;
            return switch (source.trim().toLowerCase(Locale.ROOT)) {
                case "scl_spec_carriage" -> SCL_CARRIAGE;
                case "db_migration_pack" -> DB_PACK;
                case "committed_model_internal_carriage" -> INTERNAL_CARRIAGE;
                case "committed_model_code_carriage" -> CODE_CARRIAGE;
                case "code_plan_manual_gate" -> MANUAL_GATE;
                case "scaffold_bootstrap_carriage" -> SCAFFOLD;
                default -> LLM_SHAPE;
            };
        }
    }

    /**
     * Expected sections per archetype. Labels are the real headings emitted by
     * each generator, verified against the produced corpus — NOT aspirational.
     *
     * <p>Where an archetype genuinely has no acceptance-criteria heading we
     * still list one if its absence is a real defect worth scoring
     * ({@code DB_PACK}), and omit it where another section carries the
     * acceptance role ({@code INTERNAL_CARRIAGE}'s verification recipe,
     * {@code MANUAL_GATE}'s gate condition). The scorer must not manufacture a
     * permanent penalty for a section the archetype is not supposed to have.</p>
     */
    private static final Map<SpecArchetype, List<SectionDescriptor>> SECTIONS_BY_ARCHETYPE =
        Map.of(
            SpecArchetype.SCL_CARRIAGE, List.of(
                carriageSection("objective"),
                carriageSection("acceptance criteria"),
                carriageSection("modernization decisions"),
                carriageSection("contract blocks"),
                carriageSection("target technology stack"),
                carriageSection("wire-format fidelity")),
            SpecArchetype.DB_PACK, List.of(
                carriageSection("context"),
                carriageSection("requirements"),
                carriageSection("files to reproduce"),
                carriageSection("acceptance criteria")),
            SpecArchetype.INTERNAL_CARRIAGE, List.of(
                carriageSection("context"),
                carriageSection("internal process"),
                carriageSection("verification recipe"),
                carriageSection("target technology stack")),
            SpecArchetype.MANUAL_GATE, List.of(
                carriageSection("manual-gate work item"),
                carriageSection("procedure"),
                carriageSection("gate condition")),
            SpecArchetype.SCAFFOLD, List.of(
                carriageSection("objective"),
                carriageSection("acceptance criteria"),
                carriageSection("seed build files"),
                carriageSection("target technology stack")),
            SpecArchetype.CODE_CARRIAGE, List.of(
                carriageSection("context"),
                carriageSection("endpoint"),
                carriageSection("acceptance criteria"),
                carriageSection("parity obligation"),
                carriageSection("target technology stack")));

    /**
     * Heading that carries the ACCEPTANCE role for archetypes that do not emit
     * a literal {@code ## Acceptance criteria}. Used as an AC-block fallback by
     * {@link #scoreAcMeasurability} so those rows are scored on the statements
     * they DO make rather than reported as "no acceptance criteria found".
     */
    private static final Map<SpecArchetype, Pattern> AC_FALLBACK_HEADING = Map.of(
        SpecArchetype.DB_PACK, headingPrefixPattern("requirements"),
        SpecArchetype.INTERNAL_CARRIAGE, headingPrefixPattern("verification recipe"),
        SpecArchetype.MANUAL_GATE, headingPrefixPattern("gate condition"),
        SpecArchetype.CODE_CARRIAGE, headingPrefixPattern("parity obligation"));

    private static List<SectionDescriptor> expectedSections(SpecArchetype archetype) {
        return SECTIONS_BY_ARCHETYPE.getOrDefault(archetype, EXPECTED_SECTIONS);
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
    // 2026-09-10: verbs the tool's own template criteria use ("passes",
    // "exits 0", "reports 0 changed lines") joined the list; before that the
    // fixed shipped-suite sentence scored one signal in four on every spec.
    private static final Pattern AC_MEASURABLE_VERB = Pattern.compile(
        "\\b(validates|asserts|equals|contains|matches|throws|emits|passes|fails|exits|reports|remains|survives)\\b",
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

    /**
     * Citation notations emitted by the DETERMINISTIC CARRIAGE generators.
     *
     * <p>v1 recognised only the LLM template's {@code Evidence:} prefixes and
     * {@code [finding-...]} brackets. Carriage specs cite their evidence in
     * three entirely different notations, so EVIDENCE DENSITY scored exactly
     * ZERO on every carriage row — the dimension never fired and contributed a
     * flat 0 of its 15 weight to every spec in the corpus:</p>
     * <ul>
     *   <li>{@code [decision:<code>]} — a confirmed architecture decision</li>
     *   <li>{@code SomeClass.java:217} — a source cite behind a contract</li>
     *   <li>{@code pack <uuid>} — provenance of a carried pack artefact</li>
     * </ul>
     */
    private static final Pattern EVIDENCE_DECISION_CITE = Pattern.compile(
        "\\[decision:[^\\]]+\\]", Pattern.CASE_INSENSITIVE);
    private static final Pattern EVIDENCE_SOURCE_LINE_CITE = Pattern.compile(
        "\\b[\\w$]+\\.(?:java|ts|tsx|py|go|sql|xml|jsp|properties)\\s*:\\s*\\d+\\b",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern EVIDENCE_PACK_STAMP = Pattern.compile(
        "\\bpack\\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b",
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
        String storyTitle,
        SpecArchetype archetype
    ) {
        /**
         * Backwards-compatible 6-arg form. {@code archetype} defaults to
         * {@link SpecArchetype#LLM_SHAPE}, which selects the original v1
         * section vocabulary — so every existing caller and test keeps its
         * exact previous behaviour.
         */
        public Input(
                String specText,
                List<String> decisions,
                List<String> interfaces,
                List<String> assumptions,
                List<Map<String, Object>> warnings,
                String storyTitle) {
            this(specText, decisions, interfaces, assumptions, warnings, storyTitle,
                SpecArchetype.LLM_SHAPE);
        }
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
        SpecArchetype archetype =
            safe.archetype() == null ? SpecArchetype.LLM_SHAPE : safe.archetype();

        DimensionScore completeness = scoreCompleteness(specText, archetype);
        DimensionScore acMeasurability = scoreAcMeasurability(specText, archetype);
        DimensionScore concreteness = scoreImplementationConcreteness(specText, safe.storyTitle());
        DimensionScore evidence = scoreEvidenceDensity(specText);
        DimensionScore alignment = scoreSiblingParentAlignment(safe.warnings());
        DimensionScore mechanical = scoreMechanicalTruth(specText, archetype);

        int composite = compositeScore(
            completeness.score(),
            acMeasurability.score(),
            concreteness.score(),
            evidence.score(),
            alignment.score(),
            mechanical.score());
        String grade = mapGrade(composite);

        List<Map<String, Object>> dims = new ArrayList<>(6);
        dims.add(completeness.toMap());
        dims.add(acMeasurability.toMap());
        dims.add(concreteness.toMap());
        dims.add(evidence.toMap());
        dims.add(alignment.toMap());
        dims.add(mechanical.toMap());

        return new Output(composite, grade, dims);
    }

    // -----------------------------------------------------------------------
    // Dimension 1: COMPLETENESS
    // -----------------------------------------------------------------------

    /** v1 entry point — scores against the LLM shape-spec vocabulary. */
    DimensionScore scoreCompleteness(String specText) {
        return scoreCompleteness(specText, SpecArchetype.LLM_SHAPE);
    }

    DimensionScore scoreCompleteness(String specText, SpecArchetype archetype) {
        List<SectionDescriptor> expected = expectedSections(archetype);
        if (specText == null || specText.isBlank()) {
            // Build the full "missing: ..." list verbatim from the expected set.
            String missing = joinLabels(
                expected.stream().map(SectionDescriptor::label).toList());
            return new DimensionScore(
                DIMENSION_COMPLETENESS,
                0,
                "0/" + expected.size() + " expected sections present; missing: " + missing);
        }
        String[] lines = specText.split("\\r?\\n", -1);
        int present = 0;
        List<String> missingLabels = new ArrayList<>();
        for (SectionDescriptor sd : expected) {
            if (anyLineMatches(lines, sd.pattern())) {
                present++;
            } else {
                missingLabels.add(sd.label());
            }
        }
        int score = (int) Math.round((present / (double) expected.size()) * 100.0);
        String reason;
        if (missingLabels.isEmpty()) {
            reason = present + "/" + expected.size() + " expected sections present";
        } else {
            reason = present + "/" + expected.size()
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

    /** v1 entry point — LLM shape-spec AC block only. */
    DimensionScore scoreAcMeasurability(String specText) {
        return scoreAcMeasurability(specText, SpecArchetype.LLM_SHAPE);
    }

    DimensionScore scoreAcMeasurability(String specText, SpecArchetype archetype) {
        if (specText == null || specText.isBlank()) {
            return new DimensionScore(
                DIMENSION_AC_MEASURABILITY, 0, "No acceptance criteria found in spec");
        }
        List<String> acs = extractAcceptanceCriteriaLines(specText, archetype);
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

    /** v1 entry point — LLM shape-spec AC block only. */
    private static List<String> extractAcceptanceCriteriaLines(String specText) {
        return extractAcceptanceCriteriaLines(specText, SpecArchetype.LLM_SHAPE);
    }

    /**
     * Locate and parse the acceptance block.
     *
     * <p>Three fixes over v1, all of which caused a silent 0:</p>
     * <ol>
     *   <li>The heading is matched by the exact v1 pattern FIRST (preserving LLM
     *       behaviour), then by the carriage prefix form, then by the
     *       archetype's ({@link #AC_FALLBACK_HEADING}) — so archetypes whose
     *       acceptance role is carried by another section are scored on the
     *       statements they DO make.</li>
     *   <li>The block boundary is a heading at the SAME OR SHALLOWER depth than
     *       the AC heading. v1 broke on ANY ATX heading, so an AC block
     *       containing sub-headings was truncated at the first one.</li>
     *   <li>Markdown TABLE ROWS count as entries when the block has no bullets.
     *       Carriage generators tabulate acceptance rows; v1 recognised only
     *       bullet/ordered list items and returned empty.</li>
     * </ol>
     */
    static List<String> extractAcceptanceCriteriaLines(
            String specText, SpecArchetype archetype) {
        String[] lines = specText.split("\\r?\\n", -1);
        int startIdx = -1;
        int headingDepth = 0;
        for (int i = 0; i < lines.length && startIdx < 0; i++) {
            if (HEADING_ACCEPTANCE_CRITERIA.matcher(lines[i]).matches()) {
                startIdx = i + 1;
                headingDepth = atxDepth(lines[i]);
            }
        }
        if (startIdx < 0) {
            Pattern carriageAc = headingPrefixPattern("acceptance criteria");
            for (int i = 0; i < lines.length && startIdx < 0; i++) {
                if (carriageAc.matcher(lines[i]).matches()) {
                    startIdx = i + 1;
                    headingDepth = atxDepth(lines[i]);
                }
            }
        }
        if (startIdx < 0) {
            Pattern fallback = archetype == null ? null : AC_FALLBACK_HEADING.get(archetype);
            if (fallback != null) {
                for (int i = 0; i < lines.length && startIdx < 0; i++) {
                    if (fallback.matcher(lines[i]).matches()) {
                        startIdx = i + 1;
                        headingDepth = atxDepth(lines[i]);
                    }
                }
            }
        }
        if (startIdx < 0) return List.of();

        List<String> acs = new ArrayList<>();
        List<String> tableRows = new ArrayList<>();
        for (int i = startIdx; i < lines.length; i++) {
            String raw = lines[i];
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) continue;
            if (isBlockBoundary(raw, headingDepth)) break;
            Matcher b = LIST_BULLET.matcher(raw);
            if (b.matches()) {
                acs.add(b.group(1).trim());
                continue;
            }
            Matcher o = LIST_ORDERED.matcher(raw);
            if (o.matches()) {
                acs.add(o.group(1).trim());
                continue;
            }
            String row = tableRowContent(trimmed);
            if (row != null) tableRows.add(row);
        }
        // Bullets win; tables are the fallback shape for tabulated acceptance.
        if (!acs.isEmpty()) return acs;
        if (!tableRows.isEmpty()) return List.copyOf(tableRows);
        // Prose fallback (2026-09-03): a block with neither bullets nor table
        // rows counts each non-empty paragraph line as ONE criterion. The
        // manual gates' one-sentence "Gate condition" scored zero criteria on
        // three entirely correct documents.
        List<String> prose = new ArrayList<>();
        for (int i = startIdx; i < lines.length; i++) {
            String raw = lines[i];
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) continue;
            if (isBlockBoundary(raw, headingDepth)) break;
            if (atxDepth(raw) > 0) continue;
            prose.add(trimmed);
        }
        return prose;
    }

    /** ATX heading depth ({@code ## x} -> 2); 0 when the line is not a heading. */
    private static int atxDepth(String line) {
        Matcher m = Pattern.compile("^\\s*([#]{1,6})\\s+\\S").matcher(line);
        return m.find() ? m.group(1).length() : 0;
    }

    /**
     * Block boundary: a known non-AC section heading, or an ATX heading at a
     * depth at or above {@code headingDepth}. Deeper sub-headings do NOT end
     * the block.
     */
    private static boolean isBlockBoundary(String line, int headingDepth) {
        for (SectionDescriptor sd : EXPECTED_SECTIONS) {
            if (sd.pattern().matcher(line).matches()
                && !HEADING_ACCEPTANCE_CRITERIA.equals(sd.pattern())) {
                return true;
            }
        }
        // Generic ATX heading (## Something) we don't otherwise know about.
        int depth = atxDepth(line);
        if (depth == 0) return false;
        if (headingDepth <= 0) return true;
        return depth <= headingDepth;
    }

    /**
     * Content of a markdown table row, or {@code null} when the line is not a
     * data row. Separator rows ({@code |---|---|}) and rows whose cells are all
     * empty are rejected.
     */
    private static String tableRowContent(String trimmed) {
        if (!trimmed.startsWith("|")) return null;
        String inner = trimmed.replaceAll("^\\||\\|$", "");
        if (inner.isBlank()) return null;
        if (inner.matches("[\\s:\\-|]+")) return null;
        String flattened = inner.replace('|', ' ').replaceAll("\\s+", " ").trim();
        return flattened.isEmpty() ? null : flattened;
    }

    private static String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    /** Scale so that one distinct reference per ~60 body words scores 100. */
    private static final double CONCRETENESS_PER_HUNDRED_SCALE = 60.0;

    private static final Pattern TARGET_STACK_HEADING = Pattern.compile(
        "^\\s*#{2}\\s+Target technology stack\\b.*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern H2_HEADING = Pattern.compile("^\\s*#{2}\\s+\\S.*$");

    /** The spec text without its "## Target technology stack" section. */
    static String stripTargetStackSection(String specText) {
        if (specText == null) return "";
        StringBuilder sb = new StringBuilder();
        boolean skipping = false;
        for (String line : specText.split("\\r?\\n", -1)) {
            if (TARGET_STACK_HEADING.matcher(line).matches()) {
                skipping = true;
                continue;
            }
            if (skipping && H2_HEADING.matcher(line).matches()) skipping = false;
            if (!skipping) sb.append(line).append('\n');
        }
        return sb.toString();
    }

    // -----------------------------------------------------------------------
    // Dimension 6: MECHANICAL TRUTH (2026-09-03)
    // -----------------------------------------------------------------------

    private static final Pattern UNRESOLVED_ROW = Pattern.compile(
        "\\(UNRESOLVED \\u2014 no corpus contract\\)");
    private static final Pattern ENDPOINT_ANNOTATION = Pattern.compile(
        "Annotations: .*@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|Path|RequestMapping|"
            + "GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\\b");
    private static final String NO_RESPONSE_CONTRACT_MARKER = "_No committed response contract._";
    private static final String RESPONSE_SHAPES_HEADING = "## Response shapes";
    private static final String NOT_CAPTURED_MARKER = "NOT CAPTURED";
    private static final String ZERO_EFFECTS_MARKER = "Data effects (0)";
    private static final String EMPTY_SCOPE_MARKER = "(none committed";
    private static final String REPLAY_BASELINE_MARKER = "replay EVERY accepted capture of baseline";

    /**
     * Four archetype-aware truth checks over the spec text — the facts the
     * review found the shape-only dimensions blind to. Each applicable check
     * contributes up to 25 points and the score is rescaled over the
     * applicable checks; an archetype to which none applies scores 100 with
     * an explicit reason (nothing is awarded for inapplicable checks, and
     * nothing is deducted either).
     */
    DimensionScore scoreMechanicalTruth(String specText, SpecArchetype archetype) {
        String text = specText == null ? "" : specText;
        SpecArchetype a = archetype == null ? SpecArchetype.LLM_SHAPE : archetype;
        boolean hasBehaviourTables = text.contains("### Behaviour:");
        boolean sclEndpointSpec = a == SpecArchetype.SCL_CARRIAGE
            && ENDPOINT_ANNOTATION.matcher(text).find();
        boolean endpointSpec = a == SpecArchetype.CODE_CARRIAGE || sclEndpointSpec;

        int applicable = 0;
        int earned = 0;
        List<String> notes = new ArrayList<>();

        // 1. UNRESOLVED dispatch rows (behaviour-table carriers only).
        if (hasBehaviourTables) {
            applicable++;
            int unresolved = countMatches(UNRESOLVED_ROW, text);
            int pts = unresolved == 0 ? 25 : unresolved <= 2 ? 12 : 0;
            earned += pts;
            notes.add("unresolved rows=" + unresolved + " (" + pts + "/25)");
        }
        // 2. Response contract present (endpoint specs only).
        if (endpointSpec) {
            applicable++;
            boolean ok = a == SpecArchetype.CODE_CARRIAGE
                ? !text.contains(NO_RESPONSE_CONTRACT_MARKER)
                : text.contains(RESPONSE_SHAPES_HEADING);
            earned += ok ? 25 : 0;
            notes.add("response contract " + (ok ? "present" : "ABSENT") + " (" + (ok ? 25 : 0) + "/25)");
        }
        // 3. Non-empty data-effect scope (committed-model carriages only).
        if (a == SpecArchetype.CODE_CARRIAGE || a == SpecArchetype.INTERNAL_CARRIAGE) {
            applicable++;
            boolean empty = text.contains(NOT_CAPTURED_MARKER)
                || text.contains(ZERO_EFFECTS_MARKER)
                || text.contains(EMPTY_SCOPE_MARKER);
            earned += empty ? 0 : 25;
            notes.add("effect scope " + (empty ? "EMPTY / not captured" : "non-empty") + " (" + (empty ? 0 : 25) + "/25)");
        }
        // 4. Acceptance criteria name the baseline captures to replay.
        if (endpointSpec) {
            applicable++;
            boolean ok = text.contains(REPLAY_BASELINE_MARKER);
            earned += ok ? 25 : 0;
            notes.add("AC names baseline captures: " + (ok ? "yes" : "NO") + " (" + (ok ? 25 : 0) + "/25)");
        }

        if (applicable == 0) {
            return new DimensionScore(
                DIMENSION_MECHANICAL_TRUTH,
                100,
                "no mechanical truth checks apply to archetype " + a);
        }
        int score = (int) Math.round(earned / (applicable * 25.0) * 100.0);
        return new DimensionScore(
            DIMENSION_MECHANICAL_TRUTH,
            score,
            applicable + " check(s) applied: " + String.join("; ", notes));
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
        // Score the BODY only (2026-09-03): the "Target technology stack" dump
        // is byte-identical across the book and used to supply most of the
        // references, so a spec with no behavioural content still scored 100.
        String body = stripTargetStackSection(specText);
        int stackWords = countWords(specText) - countWords(body);
        Set<String> distinct = new HashSet<>();
        collectMatches(CONCRETE_FILE_PATH, body, distinct);
        collectMatches(CONCRETE_FQN, body, distinct);
        collectMatches(CONCRETE_REST_OP, body, distinct);
        collectGroup1(CONCRETE_WSDL_OP, body, distinct);
        collectGroup1(CONCRETE_BACKTICK, body, distinct);

        // Story-title entity refs (case-insensitive substring match per token).
        if (storyTitle != null && !storyTitle.isBlank()) {
            for (String token : storyTitle.split("\\s+")) {
                if (token.length() < 3) continue;
                if (body.toLowerCase(Locale.ROOT)
                    .contains(token.toLowerCase(Locale.ROOT))) {
                    distinct.add("title:" + token.toLowerCase(Locale.ROOT));
                }
            }
        }
        int count = distinct.size();
        int bodyWords = countWords(body);
        // Length-normalised: distinct references per hundred body words. A
        // capped raw count (min(100, n*10)) saturated at ten references and
        // detected short documents, not concreteness.
        double perHundred = count / Math.max(1.0, bodyWords / 100.0);
        int score = (int) Math.min(100, Math.round(perHundred * CONCRETENESS_PER_HUNDRED_SCALE));
        String reason = count + " concrete references across ~" + bodyWords
            + " body words; " + String.format(Locale.ROOT, "%.2f", perHundred)
            + " per 100 words"
            + (stackWords > 0 ? " (target-stack section excluded: ~" + stackWords + " words)" : "");
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
        // Carriage citation notations (see the pattern javadoc): without these
        // the dimension is dead for every deterministically-assembled spec.
        refs += countMatches(EVIDENCE_DECISION_CITE, specText);
        refs += countMatches(EVIDENCE_SOURCE_LINE_CITE, specText);
        refs += countMatches(EVIDENCE_PACK_STAMP, specText);
        int wordCount = countWords(specText);
        double density = refs / Math.max(1.0, wordCount / 100.0);
        int score = (int) Math.min(100, Math.round(density * 25.0));
        String reason = refs + " evidence refs across ~" + wordCount
            + " words; density = " + String.format(Locale.ROOT, "%.2f", density);
        return new DimensionScore(DIMENSION_EVIDENCE_DENSITY, score, reason);
    }

    private static int countMatches(Pattern p, String text) {
        Matcher m = p.matcher(text);
        int n = 0;
        while (m.find()) n++;
        return n;
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
        int unresolved = 0;
        if (warnings != null) {
            for (Map<String, Object> w : warnings) {
                if (w == null) continue;
                // Warning rows carry their discriminator under `kind` OR `code`
                // depending on the emitting stage. v1 read only `kind`, so
                // every `code`-keyed warning was invisible here.
                Object kind = w.get("kind");
                if (kind == null) kind = w.get("code");
                if (WARNING_KIND_CONTRADICTS_SIBLING.equals(kind)) contradictions++;
                else if (WARNING_KIND_ALIGNED_WITH_EPIC_DECISION.equals(kind)) alignments++;
                else if (WARNING_KIND_UNRESOLVED_REFERENCE.equals(kind)) unresolved++;
            }
        }
        int raw = 50 - (contradictions * 20) + (alignments * 15)
            - (unresolved * UNRESOLVED_REFERENCE_PENALTY);
        int clamped = Math.max(0, Math.min(100, raw));
        String reason = contradictions + " contradictions, " + alignments
            + " alignments; from baseline 50";
        if (unresolved > 0) {
            // An unresolved reference IS a referential-integrity failure against
            // the parent/sibling model, so it belongs in this dimension. Without
            // it the dimension returned a constant 50 for the entire corpus and
            // contributed no signal at all.
            reason = reason + "; " + unresolved + " unresolved reference(s) penalised";
        }
        return new DimensionScore(DIMENSION_SIBLING_PARENT_ALIGNMENT, clamped, reason);
    }

    // -----------------------------------------------------------------------
    // Composite + grade
    // -----------------------------------------------------------------------

    private static int compositeScore(int completeness, int acMeasurability,
                                      int concreteness, int evidence, int alignment,
                                      int mechanical) {
        int weightedSum = completeness * WEIGHT_COMPLETENESS
            + acMeasurability * WEIGHT_AC_MEASURABILITY
            + concreteness * WEIGHT_IMPLEMENTATION_CONCRETENESS
            + evidence * WEIGHT_EVIDENCE_DENSITY
            + alignment * WEIGHT_SIBLING_PARENT_ALIGNMENT
            + mechanical * WEIGHT_MECHANICAL_TRUTH;
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
