package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ArchitectureElementMappingNotesDecorator}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 7.3.</p>
 *
 * <p>The decorator appends a {@code [decision:<code>]} tag to the existing
 * mapping notes string idempotently. Multiple distinct decision codes can
 * coexist, but the same code is never duplicated.</p>
 *
 * <p>Tests:</p>
 * <ol>
 *   <li>Empty/null input plus a decision code produces a tagged string.</li>
 *   <li>Null input plus a decision code yields exactly the bare tag.</li>
 *   <li>Input that already contains the exact tag for the same code is
 *       returned unchanged (idempotency).</li>
 *   <li>Input with one tag plus a different code appends a second tag;
 *       both coexist.</li>
 * </ol>
 */
class ArchitectureElementMappingNotesDecoratorTest {

    @Test
    @DisplayName("empty input + code -> bare tag appended")
    void emptyInputProducesBareTag() {
        String result = ArchitectureElementMappingNotesDecorator.decorateWithDecision("", "db.engine");

        assertThat(result).isEqualTo("[decision:db.engine]");
    }

    @Test
    @DisplayName("null input + code -> bare tag (treated as empty)")
    void nullInputTreatedAsEmpty() {
        String result = ArchitectureElementMappingNotesDecorator.decorateWithDecision(null, "db.engine");

        assertThat(result).isEqualTo("[decision:db.engine]");
    }

    @Test
    @DisplayName("non-empty input + code -> tag appended with single space separator")
    void nonEmptyInputAppendsTagWithSpace() {
        String result = ArchitectureElementMappingNotesDecorator.decorateWithDecision(
            "existing notes", "db.engine");

        assertThat(result).isEqualTo("existing notes [decision:db.engine]");
    }

    @Test
    @DisplayName("idempotent: same tag already present returns input unchanged")
    void idempotentForSameCode() {
        String input = "human notes here [decision:db.engine] more text";

        String result = ArchitectureElementMappingNotesDecorator.decorateWithDecision(
            input, "db.engine");

        assertThat(result).isSameAs(input);
    }

    @Test
    @DisplayName("different decision code appends a second distinct tag")
    void differentCodeAppendsSecondTag() {
        String input = "foo bar [decision:db.engine]";

        String result = ArchitectureElementMappingNotesDecorator.decorateWithDecision(
            input, "service.framework");

        assertThat(result).isEqualTo("foo bar [decision:db.engine] [decision:service.framework]");
        // Both tags coexist
        assertThat(result).contains("[decision:db.engine]");
        assertThat(result).contains("[decision:service.framework]");
    }
}
