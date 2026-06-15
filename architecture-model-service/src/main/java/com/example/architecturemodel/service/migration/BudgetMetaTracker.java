package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.BudgetMeta;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.SiblingSummary;
import com.example.architecturemodel.model.dto.migration.MigrationSpecContextDto.Trimmed;

import java.util.ArrayList;
import java.util.List;

/**
 * Tiered-trimming token-budget tracker used by
 * {@link MigrationSpecContextResolver} when assembling the cross-story
 * envelope for pass-2 of the bounded two-pass loop.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 3 (helper introduced here in step 3.6).</p>
 *
 * <p><b>Two caps, two budgets.</b> The tracker holds both the per-story cap
 * (default 24000) and the cross-story cap (default 12000). Sibling summaries
 * and workstream context spend against the cross-story cap; per-story blocks
 * (focused context, findings, evidence refs) spend against the per-story cap.
 * The story description, parent rollup, and epic captured decisions are
 * <b>never</b> trimmed by this tracker -- they are always added regardless of
 * remaining budget, and any overflow is recorded as used_tokens > max_tokens
 * so the UI can render an overspend warning.</p>
 *
 * <p><b>Tiered trimming order.</b> When the cross-story budget runs out, the
 * tracker drops sibling summaries first (lowest-relevance first via the
 * caller-supplied ordering -- the resolver pre-sorts by some relevance signal
 * and just passes the ordered list here), then evidence refs, then findings.
 * Each drop is recorded so the resolver / gateway can surface the trim to the
 * UI via {@code budget_meta.trimmed}.</p>
 *
 * <p><b>Project-config wiring (Task Group 9).</b> The constructor accepts both
 * caps as explicit arguments; {@link MigrationSpecContextResolver} reads
 * {@code per_story_context_token_cap} and
 * {@code cross_story_context_token_cap} from the {@code project} row and
 * passes them here. Null values fall through to
 * {@link #DEFAULT_PER_STORY_TOKEN_CAP} /
 * {@link #DEFAULT_CROSS_STORY_TOKEN_CAP} -- defensive two-layer defaulting
 * so a missing column value never starves the budget.</p>
 * <p><b>Token estimation.</b> The tracker uses a simple
 * 4-chars-per-token heuristic (see {@link #estimateTokens}). This matches the
 * order of magnitude of the gateway's existing token accounting at
 * application boundary and is purely an envelope estimator -- the LLM's actual
 * token count is reported separately by the gateway after the call.</p>
 */
public final class BudgetMetaTracker {

    /** Default per-story budget when project config has not been wired. */
    public static final int DEFAULT_PER_STORY_TOKEN_CAP = 24_000;

    /** Default cross-story budget when project config has not been wired. */
    public static final int DEFAULT_CROSS_STORY_TOKEN_CAP = 12_000;

    /** Warning kind emitted when even one sibling summary won't fit. */
    public static final String WARN_NO_SIBLING_CONTEXT_AVAILABLE =
        "no_sibling_context_available";

    /**
     * Rough 4-chars-per-token heuristic mirroring the gateway's existing
     * envelope accounting at the application boundary.
     *
     * @param text any text payload (null treated as empty)
     * @return estimated token count, never negative
     */
    public static int estimateTokens(String text) {
        if (text == null || text.isEmpty()) return 0;
        // +3 to round up rather than floor -- conservative when near the cap.
        return (text.length() + 3) / 4;
    }

    /**
     * Token estimate for a single sibling summary (decisions + interfaces +
     * assumptions). Used both when admitting and when dropping a summary so
     * the accounting stays consistent.
     */
    public static int estimateTokens(SiblingSummary s) {
        if (s == null) return 0;
        int total = 0;
        total += estimateTokens(s.title());
        total += estimateLines(s.decisions());
        total += estimateLines(s.interfaces());
        total += estimateLines(s.assumptions());
        // Small overhead for the wrapping JSON shape.
        return total + 16;
    }

    private static int estimateLines(List<String> lines) {
        if (lines == null || lines.isEmpty()) return 0;
        int total = 0;
        for (String l : lines) total += estimateTokens(l);
        return total;
    }

    // -----------------------------------------------------------------------
    // Instance state
    // -----------------------------------------------------------------------

    private final int perStoryMaxTokens;
    private final int crossStoryMaxTokens;

    private int perStoryUsed;
    private int crossStoryUsed;
    private int siblingSpecsDropped;
    private int evidenceRefsDropped;
    private int findingsDropped;
    private final List<String> warnings = new ArrayList<>();

    /** Construct with explicit caps; pass {@code null} to use defaults. */
    public BudgetMetaTracker(Integer perStoryMaxTokens, Integer crossStoryMaxTokens) {
        this.perStoryMaxTokens = (perStoryMaxTokens != null && perStoryMaxTokens > 0)
            ? perStoryMaxTokens : DEFAULT_PER_STORY_TOKEN_CAP;
        this.crossStoryMaxTokens = (crossStoryMaxTokens != null && crossStoryMaxTokens > 0)
            ? crossStoryMaxTokens : DEFAULT_CROSS_STORY_TOKEN_CAP;
    }

    /**
     * Construct with default caps (used by tests that don't care about the
     * specific budget values).
     */
    public static BudgetMetaTracker withDefaults() {
        return new BudgetMetaTracker(
            DEFAULT_PER_STORY_TOKEN_CAP,
            DEFAULT_CROSS_STORY_TOKEN_CAP);
    }

    /**
     * Reserve tokens against the per-story budget for non-trimmable content
     * (story description, parent rollup, epic captured decisions). Overspend
     * is recorded so the caller can surface it without ever dropping the
     * payload.
     */
    public void reservePerStoryNonTrimmable(int tokens) {
        if (tokens > 0) perStoryUsed += tokens;
    }

    /**
     * Reserve tokens against the cross-story budget for non-trimmable content
     * (parent rollup, epic captured decisions, story description -- when they
     * appear in the cross-story envelope rather than the per-story envelope).
     */
    public void reserveCrossStoryNonTrimmable(int tokens) {
        if (tokens > 0) crossStoryUsed += tokens;
    }

    /**
     * Apply tiered trimming to an ordered list of sibling summaries. The
     * caller is responsible for ordering by relevance (highest first). This
     * method returns the trimmed list (in input order) and updates the
     * dropped-count counter.
     *
     * <p>Emits {@link #WARN_NO_SIBLING_CONTEXT_AVAILABLE} when the cross-story
     * budget cannot fit even the first (highest-relevance) sibling AND at
     * least one sibling was offered.</p>
     */
    public List<SiblingSummary> admitSiblings(List<SiblingSummary> orderedByRelevance) {
        if (orderedByRelevance == null || orderedByRelevance.isEmpty()) {
            return List.of();
        }
        List<SiblingSummary> admitted = new ArrayList<>();
        boolean firstChecked = false;
        for (SiblingSummary s : orderedByRelevance) {
            int cost = estimateTokens(s);
            if (!firstChecked) {
                firstChecked = true;
                if (crossStoryUsed + cost > crossStoryMaxTokens) {
                    // Cannot fit even the first sibling -- explicit warning.
                    if (!warnings.contains(WARN_NO_SIBLING_CONTEXT_AVAILABLE)) {
                        warnings.add(WARN_NO_SIBLING_CONTEXT_AVAILABLE);
                    }
                }
            }
            if (crossStoryUsed + cost <= crossStoryMaxTokens) {
                admitted.add(s);
                crossStoryUsed += cost;
            } else {
                siblingSpecsDropped++;
            }
        }
        return admitted;
    }

    /**
     * Apply tiered trimming to an ordered list of evidence refs after sibling
     * summaries have already spent against the per-story budget. Evidence is
     * dropped only when the per-story budget is exhausted.
     */
    public <T> List<T> admitEvidenceRefs(List<T> orderedByRelevance, EvidenceCoster<T> coster) {
        if (orderedByRelevance == null || orderedByRelevance.isEmpty()) {
            return List.of();
        }
        List<T> admitted = new ArrayList<>();
        for (T e : orderedByRelevance) {
            int cost = coster.tokensFor(e);
            if (perStoryUsed + cost <= perStoryMaxTokens) {
                admitted.add(e);
                perStoryUsed += cost;
            } else {
                evidenceRefsDropped++;
            }
        }
        return admitted;
    }

    /**
     * Apply tiered trimming to an ordered list of findings (last to be
     * dropped). Findings are dropped only after sibling specs and evidence
     * refs have been exhausted.
     */
    public <T> List<T> admitFindings(List<T> orderedByRelevance, EvidenceCoster<T> coster) {
        if (orderedByRelevance == null || orderedByRelevance.isEmpty()) {
            return List.of();
        }
        List<T> admitted = new ArrayList<>();
        for (T f : orderedByRelevance) {
            int cost = coster.tokensFor(f);
            if (perStoryUsed + cost <= perStoryMaxTokens) {
                admitted.add(f);
                perStoryUsed += cost;
            } else {
                findingsDropped++;
            }
        }
        return admitted;
    }

    /**
     * Build the {@link BudgetMeta} snapshot that gets serialised into the
     * resolver response and mirrored onto
     * {@code migration_story_spec_generations.budget_meta_json}.
     */
    public BudgetMeta toBudgetMeta() {
        Trimmed trimmed = new Trimmed(
            Integer.valueOf(siblingSpecsDropped),
            Integer.valueOf(evidenceRefsDropped),
            Integer.valueOf(findingsDropped)
        );
        return new BudgetMeta(
            Integer.valueOf(perStoryUsed + crossStoryUsed),
            Integer.valueOf(perStoryMaxTokens + crossStoryMaxTokens),
            Integer.valueOf(perStoryMaxTokens),
            Integer.valueOf(crossStoryMaxTokens),
            trimmed,
            warnings.isEmpty() ? null : new ArrayList<>(warnings)
        );
    }

    // -----------------------------------------------------------------------
    // Test / inspection accessors (package-private)
    // -----------------------------------------------------------------------

    int siblingSpecsDropped() { return siblingSpecsDropped; }
    int evidenceRefsDropped() { return evidenceRefsDropped; }
    int findingsDropped() { return findingsDropped; }
    int perStoryUsed() { return perStoryUsed; }
    int crossStoryUsed() { return crossStoryUsed; }
    List<String> warnings() { return new ArrayList<>(warnings); }

    /**
     * Lightweight cost callback so callers can plug in arbitrary token
     * estimation for evidence / finding records without dragging more types
     * into this helper.
     */
    @FunctionalInterface
    public interface EvidenceCoster<T> {
        int tokensFor(T item);
    }
}
