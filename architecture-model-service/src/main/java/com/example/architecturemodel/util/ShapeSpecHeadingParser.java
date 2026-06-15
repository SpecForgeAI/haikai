package com.example.architecturemodel.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic heading parser for the migration shape-spec body
 * ({@code /agent-os:shape-spec ...}).
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 2.</p>
 *
 * <p>This is the single canonical source for the structured
 * {@code decisions_json} / {@code interfaces_json} / {@code assumptions_json}
 * columns persisted on {@code migration_story_spec_generations}. The
 * AMS persistence write path invokes the parser at write time; the
 * resolver later reads the structured columns directly, never re-parsing the
 * spec text at request time.</p>
 *
 * <p>The parser is intentionally regex-based and policy-free. NO LLM call is
 * issued at parse time. Parser failures NEVER throw at the persistence
 * boundary -- on a missing heading the parser returns an empty list for that
 * section AND emits a {@link Warning} entry with kind
 * {@code parser_missing_heading} that the caller appends to
 * {@code warnings_json}.</p>
 *
 * <p><b>Supported heading shapes (case-insensitive):</b></p>
 * <ul>
 *   <li>Plain prose heading: {@code Decisions:} / {@code Interfaces:} /
 *       {@code Assumptions:} (trailing colon, optional leading whitespace).</li>
 *   <li>Markdown ATX heading: {@code ## Decisions} / {@code ## Interfaces} /
 *       {@code ## Assumptions} (any heading level 1-6; optional trailing colon).</li>
 * </ul>
 *
 * <p>A section ends at the next recognised heading (either a different section
 * heading or any other markdown heading) or at end of input. Within a section
 * the parser admits both bullet list items ({@code - ...} / {@code * ...}) and
 * numbered list items ({@code 1. ...}); blank lines and trailing whitespace are
 * trimmed. Each surviving non-empty line becomes one array entry.</p>
 *
 * <p>The spec template heading structure is load-bearing -- per the
 * Cross-Story Context Injection spec it is the contract between the LLM
 * prompt and this parser. Heading additions, removals, or renames require a
 * matching prompt-template update (Task Group 6.3) AND a regression-tested
 * parser update.</p>
 */
@Component
@Slf4j
public class ShapeSpecHeadingParser {

    /** Stable warning kind appended to {@code warnings_json} on missing heading. */
    public static final String WARNING_KIND_MISSING_HEADING = "parser_missing_heading";

    /** Stable warning kind appended to {@code warnings_json} on parser exception. */
    public static final String WARNING_KIND_PARSE_ERROR = "parser_error";

    // Anchored on (^...) optional leading whitespace, then the literal heading
    // word, an optional colon, and end of line (with optional trailing colon
    // tolerated for the markdown form like "## Decisions:").
    // The (?:[#]{1,6}\\s+)? prefix matches an optional ATX-heading marker so
    // we cover BOTH "Decisions:" and "## Decisions".
    private static final Pattern DECISIONS_HEADING_PATTERN = Pattern.compile(
        "^\\s*(?:[#]{1,6}\\s+)?decisions\\s*:?\\s*$",
        Pattern.CASE_INSENSITIVE);

    private static final Pattern INTERFACES_HEADING_PATTERN = Pattern.compile(
        "^\\s*(?:[#]{1,6}\\s+)?interfaces\\s*:?\\s*$",
        Pattern.CASE_INSENSITIVE);

    private static final Pattern ASSUMPTIONS_HEADING_PATTERN = Pattern.compile(
        "^\\s*(?:[#]{1,6}\\s+)?assumptions\\s*:?\\s*$",
        Pattern.CASE_INSENSITIVE);

    // Generic "any heading-ish line" boundary -- a line that LOOKS like a
    // section heading even if it's not one of the three we extract. Matches:
    //   - Markdown ATX: "# Word" / "## Word" / ...
    //   - Prose:        "Word:" or "Multi Word:" (no leading bullet, capital
    //                   first letter, single trailing colon)
    // This is what tells the body-extractor to stop accumulating lines.
    private static final Pattern GENERIC_HEADING_BOUNDARY_PATTERN = Pattern.compile(
        "^\\s*(?:[#]{1,6}\\s+\\S.*|[A-Z][A-Za-z0-9 _/&-]{0,80}:\\s*)$");

    // Bullet list item: "- foo" / "* foo" / "+ foo". Captures the body.
    private static final Pattern BULLET_ITEM_PATTERN = Pattern.compile(
        "^\\s*[-*+]\\s+(.+?)\\s*$");

    // Ordered list item: "1. foo" / "10. foo". Captures the body.
    private static final Pattern ORDERED_ITEM_PATTERN = Pattern.compile(
        "^\\s*\\d+\\.\\s+(.+?)\\s*$");

    /**
     * Parser output. Carries the three structured arrays plus any warnings the
     * caller should append to {@code warnings_json}.
     *
     * @param decisions     parsed decisions list (may be empty)
     * @param interfaces    parsed interfaces list (may be empty)
     * @param assumptions   parsed assumptions list (may be empty)
     * @param warnings      list of warning entries; each entry shape mirrors the
     *                      {@code warnings_json} column format
     */
    public record ParseResult(
        List<String> decisions,
        List<String> interfaces,
        List<String> assumptions,
        List<Warning> warnings
    ) {
        public ParseResult {
            decisions = decisions == null ? List.of() : List.copyOf(decisions);
            interfaces = interfaces == null ? List.of() : List.copyOf(interfaces);
            assumptions = assumptions == null ? List.of() : List.copyOf(assumptions);
            warnings = warnings == null ? List.of() : List.copyOf(warnings);
        }

        /** Convenience: an all-empty result with no warnings. */
        public static ParseResult empty() {
            return new ParseResult(List.of(), List.of(), List.of(), List.of());
        }
    }

    /**
     * A structured parser warning. Materialises onto {@code warnings_json}
     * via {@link #toMap()}.
     *
     * @param kind     stable warning kind (e.g. {@link #WARNING_KIND_MISSING_HEADING})
     * @param section  the section name the warning relates to ({@code decisions} /
     *                 {@code interfaces} / {@code assumptions}), or {@code null}
     * @param message  optional human-readable detail
     */
    public record Warning(String kind, String section, String message) {
        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("kind", kind);
            if (section != null) m.put("section", section);
            if (message != null) m.put("message", message);
            return m;
        }
    }

    /**
     * Parse the supplied shape-spec text. NEVER throws; on any internal
     * failure the result is an empty extraction plus a single
     * {@code parser_error} warning, so the caller can persist the spec text
     * unchanged.
     *
     * @param specText the {@code generated_spec_text} body (may be null/blank)
     * @return the structured parse result, never {@code null}
     */
    public ParseResult parse(String specText) {
        if (specText == null || specText.isBlank()) {
            // No body to parse. Emit three missing-heading warnings so the row
            // surfaces the gap; persistence proceeds with empty arrays.
            List<Warning> warnings = new ArrayList<>();
            warnings.add(missingHeading("decisions"));
            warnings.add(missingHeading("interfaces"));
            warnings.add(missingHeading("assumptions"));
            return new ParseResult(List.of(), List.of(), List.of(), warnings);
        }
        try {
            String[] lines = specText.split("\\r?\\n", -1);
            List<String> decisions = extractSection(lines, DECISIONS_HEADING_PATTERN);
            List<String> interfaces = extractSection(lines, INTERFACES_HEADING_PATTERN);
            List<String> assumptions = extractSection(lines, ASSUMPTIONS_HEADING_PATTERN);

            List<Warning> warnings = new ArrayList<>();
            if (decisions == null) {
                warnings.add(missingHeading("decisions"));
                decisions = List.of();
            }
            if (interfaces == null) {
                warnings.add(missingHeading("interfaces"));
                interfaces = List.of();
            }
            if (assumptions == null) {
                warnings.add(missingHeading("assumptions"));
                assumptions = List.of();
            }
            return new ParseResult(decisions, interfaces, assumptions, warnings);
        } catch (RuntimeException ex) {
            // Parser failures NEVER throw at the persistence boundary. Persist
            // empty arrays and surface a single parser_error warning so the
            // operator can investigate without losing the spec text itself.
            log.warn("[diag-ams] spec_generation parser_error message={}", ex.getMessage());
            List<Warning> warnings = List.of(
                new Warning(WARNING_KIND_PARSE_ERROR, null, ex.getMessage()));
            return new ParseResult(List.of(), List.of(), List.of(), warnings);
        }
    }

    /**
     * Locate the first occurrence of the heading matching {@code headingPattern}
     * and return the body lines (one entry per non-empty content line) until
     * the next recognised heading boundary or end of input.
     *
     * <p>Returns {@code null} (NOT an empty list) when the heading is not
     * present anywhere -- the caller distinguishes "missing heading" from
     * "heading present but no content" so the warning is only emitted in the
     * former case.</p>
     */
    private static List<String> extractSection(String[] lines, Pattern headingPattern) {
        int headingIdx = -1;
        for (int i = 0; i < lines.length; i++) {
            if (headingPattern.matcher(lines[i]).matches()) {
                headingIdx = i;
                break;
            }
        }
        if (headingIdx < 0) {
            return null; // heading absent -- caller emits missing-heading warning
        }
        List<String> body = new ArrayList<>();
        for (int i = headingIdx + 1; i < lines.length; i++) {
            String raw = lines[i];
            String trimmed = raw.trim();
            if (trimmed.isEmpty()) {
                // Blank lines inside a section are tolerated; they do not end
                // the section. They are simply dropped.
                continue;
            }
            if (isHeadingBoundary(raw)) {
                break;
            }
            String item = stripListMarker(trimmed);
            if (!item.isEmpty()) {
                body.add(item);
            }
        }
        return Collections.unmodifiableList(body);
    }

    /**
     * A line counts as a heading-boundary if it matches a markdown ATX
     * heading or a "Word:" / "Multi Word:" prose heading. Bullet / numbered
     * list items NEVER count as boundaries -- they are body content.
     */
    private static boolean isHeadingBoundary(String line) {
        String trimmed = line.trim();
        if (trimmed.isEmpty()) return false;
        // Bullet / numbered list items are NOT headings.
        if (BULLET_ITEM_PATTERN.matcher(trimmed).matches()) return false;
        if (ORDERED_ITEM_PATTERN.matcher(trimmed).matches()) return false;
        return GENERIC_HEADING_BOUNDARY_PATTERN.matcher(line).matches();
    }

    /**
     * Strip the leading bullet / numbered-list marker if present. Plain prose
     * lines pass through verbatim (already trimmed by the caller).
     */
    private static String stripListMarker(String trimmedLine) {
        Matcher b = BULLET_ITEM_PATTERN.matcher(trimmedLine);
        if (b.matches()) {
            return b.group(1).trim();
        }
        Matcher o = ORDERED_ITEM_PATTERN.matcher(trimmedLine);
        if (o.matches()) {
            return o.group(1).trim();
        }
        return trimmedLine;
    }

    private static Warning missingHeading(String section) {
        return new Warning(
            WARNING_KIND_MISSING_HEADING,
            section.toLowerCase(Locale.ROOT),
            "spec body did not contain a '" + section + "' section heading");
    }
}
