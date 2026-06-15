package com.example.architecturemodel.model.dto.discovery;

import java.util.List;

/**
 * Pagination envelope for {@code GET .../findings} list responses.
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 2.</p>
 *
 * @param items   findings on this page (with embedded links)
 * @param total   total matching rows across all pages
 * @param page    zero-based page index of this response
 * @param size    page size used for this response
 */
public record DiscoveryFindingSearchResponse(
    List<DiscoveryFindingDto> items,
    long total,
    int page,
    int size
) {}
