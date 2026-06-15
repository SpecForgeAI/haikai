package com.example.jiraservice.util;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Helpers for converting between plain text and Atlassian Document Format (ADF),
 * the JSON tree structure required by Jira Cloud REST API v3 for rich-text fields
 * such as {@code description}.
 *
 * <p>For our v1 needs we only handle plain text: writes wrap the string in a single
 * paragraph; reads walk the tree and concatenate {@code text} nodes, joining
 * paragraphs with a blank line. Lists, links, and other rich elements are flattened
 * to their text content.</p>
 */
public final class AdfHelper {

    private AdfHelper() {}

    /**
     * Wraps a plain-text string in a minimal ADF document containing a single paragraph.
     * Returns {@code null} for null input.
     */
    public static Map<String, Object> wrap(String text) {
        if (text == null) {
            return null;
        }
        return Map.of(
            "type", "doc",
            "version", 1,
            "content", List.of(
                Map.of(
                    "type", "paragraph",
                    "content", List.of(
                        Map.of("type", "text", "text", text)
                    )
                )
            )
        );
    }

    /**
     * Extracts plain text from an ADF document (or a string, for backwards compatibility
     * with v2 responses). Walks the tree depth-first, concatenating all {@code text}
     * nodes; paragraph-level nodes are joined with {@code \n\n}.
     *
     * @param adf the ADF object as returned by Jackson (typically a Map), or a raw String
     * @return the flattened plain text, or {@code null} if the input is null/blank
     */
    public static String unwrap(Object adf) {
        if (adf == null) {
            return null;
        }
        if (adf instanceof String s) {
            return s.isBlank() ? null : s;
        }
        if (!(adf instanceof Map<?, ?> doc)) {
            return null;
        }

        List<String> paragraphs = new ArrayList<>();
        collectParagraphs(doc, paragraphs);
        if (paragraphs.isEmpty()) {
            return null;
        }
        return String.join("\n\n", paragraphs);
    }

    @SuppressWarnings("unchecked")
    private static void collectParagraphs(Map<?, ?> node, List<String> out) {
        Object type = node.get("type");
        Object content = node.get("content");

        if ("paragraph".equals(type) || "heading".equals(type)) {
            String text = collectText(node);
            if (!text.isEmpty()) {
                out.add(text);
            }
            return;
        }

        if (content instanceof List<?> children) {
            for (Object child : children) {
                if (child instanceof Map<?, ?> childMap) {
                    collectParagraphs(childMap, out);
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static String collectText(Map<?, ?> node) {
        Object type = node.get("type");
        if ("text".equals(type)) {
            Object text = node.get("text");
            return text instanceof String s ? s : "";
        }

        Object content = node.get("content");
        if (!(content instanceof List<?> children)) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        for (Object child : children) {
            if (child instanceof Map<?, ?> childMap) {
                sb.append(collectText(childMap));
            }
        }
        return sb.toString();
    }
}
