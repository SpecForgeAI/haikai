package com.example.architecturemodel.service;

/**
 * Stateless utility that appends a {@code [decision:<code>]} tag to the
 * free-form {@code notes} field of an architecture-element mapping row,
 * idempotently.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 7.4.</p>
 *
 * <h2>Why a tag and not a foreign key</h2>
 * <p>Per the spec, no foreign key is added from
 * {@code target_state_captured_decisions} to
 * {@code architecture_element_mappings}; reverse-discovery from a mapping
 * row back to its source decision happens by grepping the {@code notes}
 * field for {@code [decision:<code>]}. The tag format is deliberately
 * human-readable and greppable.</p>
 *
 * <h2>Idempotency contract</h2>
 * <ul>
 *   <li>If the exact substring {@code [decision:<code>]} is already present
 *       anywhere in {@code currentNotes}, the input is returned unchanged.
 *       The same decision code is never duplicated.</li>
 *   <li>Multiple distinct decision codes can coexist in the same notes
 *       string (e.g. {@code "foo [decision:db.engine] [decision:api.protocol]"}).</li>
 *   <li>{@code null} {@code currentNotes} is treated as empty -- the bare
 *       tag is returned.</li>
 * </ul>
 *
 * <h2>Not wired in this spec</h2>
 * <p>This spec ships the helper only. Spec 3 (and possibly Spec 4) is
 * responsible for calling it from the mapping-write path. Callers are
 * responsible for persisting the returned string -- the helper performs
 * no database access.</p>
 */
public final class ArchitectureElementMappingNotesDecorator {

    /** Format string for the decision tag (single curly placeholder for the code). */
    private static final String TAG_FORMAT = "[decision:%s]";

    private ArchitectureElementMappingNotesDecorator() {
        // Stateless utility -- no instances.
    }

    /**
     * Returns {@code currentNotes} with {@code [decision:decisionCode]} appended
     * idempotently. If the exact tag is already present anywhere in the input
     * string, the input is returned unchanged (same reference).
     *
     * <p>A single space separator is inserted between any non-empty existing
     * notes and the appended tag. If {@code currentNotes} is {@code null} or
     * empty, the bare tag is returned with no leading whitespace.</p>
     *
     * @param currentNotes   Existing notes string from the architecture-element
     *                       mapping row; may be {@code null}.
     * @param decisionCode   The Spec-3-owned decision code to tag with;
     *                       interpolated verbatim. Must not be {@code null}.
     * @return               Notes string with the decision tag appended (or
     *                       unchanged if the tag was already present).
     */
    public static String decorateWithDecision(String currentNotes, String decisionCode) {
        if (decisionCode == null) {
            throw new IllegalArgumentException(
                "decisionCode is required for Architecture Model Service mapping-notes decoration");
        }

        String tag = String.format(TAG_FORMAT, decisionCode);

        if (currentNotes == null || currentNotes.isEmpty()) {
            return tag;
        }

        if (currentNotes.contains(tag)) {
            // Idempotent: same code already tagged, return input unchanged.
            return currentNotes;
        }

        return currentNotes + " " + tag;
    }
}
