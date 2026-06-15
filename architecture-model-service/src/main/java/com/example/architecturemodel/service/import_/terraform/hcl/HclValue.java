package com.example.architecturemodel.service.import_.terraform.hcl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sealed value-tree describing a single HCL attribute's right-hand-side.
 *
 * <p>Implementations:
 * <ul>
 *   <li>{@link StringValue} -- quoted string literal. {@code value} is the
 *       unescaped runtime string; {@code rawText} is the verbatim source
 *       (incl. surrounding quotes + any embedded escape sequences).</li>
 *   <li>{@link NumberValue} -- integer / decimal / scientific number.</li>
 *   <li>{@link BoolValue} -- {@code true} / {@code false}.</li>
 *   <li>{@link ListValue} -- HCL tuple {@code [a, b, c]}.</li>
 *   <li>{@link MapValue} -- HCL object {@code &#123; k = v &#125;} or
 *       {@code &#123; k: v &#125;}.</li>
 *   <li>{@link ReferenceValue} -- traversal expression (e.g.
 *       {@code var.region}, {@code local.x}, {@code module.network.id},
 *       {@code google_storage_bucket.assets.name}). {@code rawExpression}
 *       is the verbatim source slice; {@code pathParts} is the dot-split
 *       chain.</li>
 *   <li>{@link RawValue} -- fallback for any expression the parser cannot
 *       classify into one of the above (interpolated strings with
 *       {@code "${...}"} logic, function calls, ternaries, {@code for}
 *       blocks, etc.). The verbatim source is preserved so the importer can
 *       surface it as evidence + soft-warn TODO. Per Q5 the parser MUST
 *       NOT throw for these inputs.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public sealed interface HclValue
    permits HclValue.StringValue,
            HclValue.NumberValue,
            HclValue.BoolValue,
            HclValue.ListValue,
            HclValue.MapValue,
            HclValue.ReferenceValue,
            HclValue.RawValue {

    /**
     * Returns the verbatim source text the parser saw for this value. Always
     * present, including for literal kinds (where it doubles as the parsed
     * representation -- e.g. {@code "10.0.0.0/24"} for a CIDR string).
     */
    String rawText();

    // ---------------------------------------------------------------------
    // Concrete records
    // ---------------------------------------------------------------------

    /** Quoted string literal with escapes processed into the runtime value. */
    record StringValue(String value, String rawText) implements HclValue {
        public StringValue {
            if (value == null) value = "";
            if (rawText == null) rawText = "";
        }
    }

    /** Numeric literal preserved as {@link BigDecimal} for fidelity. */
    record NumberValue(BigDecimal value, String rawText) implements HclValue {
        public NumberValue {
            if (value == null) {
                throw new IllegalArgumentException("NumberValue.value must not be null");
            }
            if (rawText == null) rawText = value.toPlainString();
        }
    }

    /** Boolean literal. */
    record BoolValue(boolean value, String rawText) implements HclValue {
        public BoolValue {
            if (rawText == null) rawText = Boolean.toString(value);
        }

        public BoolValue(boolean value) {
            this(value, Boolean.toString(value));
        }
    }

    /** List / tuple literal {@code [a, b, c]}. */
    record ListValue(List<HclValue> items, String rawText) implements HclValue {
        public ListValue {
            items = items == null ? List.of() : List.copyOf(items);
            if (rawText == null) rawText = "";
        }
    }

    /** Object / map literal {@code &#123; k = v &#125;}. */
    record MapValue(Map<String, HclValue> entries, String rawText) implements HclValue {
        public MapValue {
            // preserve insertion order
            entries = entries == null
                ? Map.of()
                : Map.copyOf(new LinkedHashMap<>(entries));
            if (rawText == null) rawText = "";
        }
    }

    /**
     * Traversal expression: dotted chain of identifiers ({@code var.x},
     * {@code local.x}, {@code module.x.y}, or
     * {@code &lt;resource_type&gt;.&lt;name&gt;.&lt;attr&gt;}).
     *
     * <p>{@code rawExpression} preserves the verbatim source slice for
     * round-trip fidelity / evidence display. {@code pathParts} is the
     * canonical dot-split chain (e.g.
     * {@code ["google_storage_bucket", "assets", "name"]}).
     */
    record ReferenceValue(String rawExpression, List<String> pathParts) implements HclValue {
        public ReferenceValue {
            if (rawExpression == null) rawExpression = "";
            pathParts = pathParts == null ? List.of() : List.copyOf(pathParts);
        }

        @Override
        public String rawText() {
            return rawExpression;
        }
    }

    /**
     * Fallback for any expression the parser cannot classify into one of the
     * concrete kinds above. The verbatim source slice is preserved so the
     * importer can surface it as evidence + soft-warn TODO.
     *
     * <p>Examples: interpolated strings with {@code "${...}"} logic,
     * function calls ({@code length(var.subnets)}), ternaries, {@code for}
     * comprehensions, {@code for_each} / {@code count} expressions.
     */
    record RawValue(String rawText) implements HclValue {
        public RawValue {
            if (rawText == null) rawText = "";
        }
    }
}
