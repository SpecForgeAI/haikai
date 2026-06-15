package com.example.architecturemodel.service.export;

import com.example.architecturemodel.model.dto.diagram.*;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Utility class for canonicalizing diagram data to produce deterministic JSON output.
 *
 * Canonicalization ensures:
 * - diagramNodes are sorted by id
 * - diagramEdges are sorted by id
 * - decorations are sorted by id
 * - typedContent Maps use TreeMap (sorted keys) recursively
 * - typedContent Lists preserve order but recursively canonicalize elements
 */
@Component
public class DiagramCanonicalizer {

    /**
     * Canonicalizes a DiagramDto to produce deterministic ordering.
     *
     * @param in The input diagram DTO
     * @return A new DiagramDto with sorted collections and canonicalized typedContent
     */
    public DiagramDto canonicalize(DiagramDto in) {
        if (in == null) {
            return null;
        }

        // Sort diagram nodes by id
        List<DiagramNodeDto> sortedNodes = sortByIdIfNotNull(in.diagramNodes());

        // Sort diagram edges by id
        List<DiagramEdgeDto> sortedEdges = sortByIdIfNotNull(in.diagramEdges());

        // Sort decorations by id
        List<DecorationDto> sortedDecorations = sortByIdIfNotNull(in.decorations());

        // Canonicalize typedContent
        @SuppressWarnings("unchecked")
        Map<String, Object> canonicalizedTypedContent = in.typedContent() != null
            ? (Map<String, Object>) canonicalizeJson(in.typedContent())
            : null;

        return new DiagramDto(
            in.id(),
            in.name(),
            in.description(),
            in.diagramType(),
            in.settings(),
            in.viewQuarter(),
            sortedNodes,
            sortedEdges,
            sortedDecorations,
            in.interactionEdges(),
            canonicalizedTypedContent
        );
    }

    /**
     * Recursively canonicalizes JSON-like objects.
     *
     * - Map: converted to TreeMap with recursively canonicalized values
     * - List: preserved order but each element is recursively canonicalized
     * - Other (primitives, null): returned unchanged
     *
     * @param o The object to canonicalize
     * @return The canonicalized object
     */
    private Object canonicalizeJson(Object o) {
        if (o == null) {
            return null;
        }

        if (o instanceof Map<?, ?> map) {
            TreeMap<String, Object> treeMap = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = entry.getKey() != null ? entry.getKey().toString() : null;
                Object value = canonicalizeJson(entry.getValue());
                treeMap.put(key, value);
            }
            return treeMap;
        }

        if (o instanceof List<?> list) {
            List<Object> result = new ArrayList<>(list.size());
            for (Object item : list) {
                result.add(canonicalizeJson(item));
            }
            return result;
        }

        // Primitives (String, Number, Boolean) and other types - return unchanged
        return o;
    }

    /**
     * Sorts a list of DTOs by their id field.
     * Handles null input by returning null.
     *
     * @param items The list to sort
     * @param <T> The type of items (must have an accessible id field via interface or record)
     * @return A new sorted list, or null if input was null
     */
    private <T> List<T> sortByIdIfNotNull(List<T> items) {
        if (items == null) {
            return null;
        }

        List<T> sorted = new ArrayList<>(items);
        sorted.sort(Comparator.comparing(this::extractId, Comparator.nullsFirst(Comparator.naturalOrder())));
        return sorted;
    }

    /**
     * Extracts the id from various DTO types.
     */
    private String extractId(Object dto) {
        if (dto instanceof DiagramNodeDto node) {
            return node.id();
        }
        if (dto instanceof DiagramEdgeDto edge) {
            return edge.id();
        }
        if (dto instanceof DecorationDto decoration) {
            return decoration.id();
        }
        return null;
    }
}
