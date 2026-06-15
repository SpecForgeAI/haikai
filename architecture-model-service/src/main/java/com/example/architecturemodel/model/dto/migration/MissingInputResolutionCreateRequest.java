package com.example.architecturemodel.model.dto.migration;

import java.util.Map;

/**
 * POST body for creating a {@code missing_input_resolutions} row.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 2.</p>
 *
 * <p>The caller MAY supply a pre-computed {@code missingInputKey} (the typical
 * case -- the frontend already knows the key from the spec's
 * {@code missing_input_keys_json}) OR supply the per-type canonical descriptor
 * fields and let the service compute the key via {@link
 * com.example.architecturemodel.service.MissingInputKeyHasher}. Exactly one of
 * the two paths must yield a non-empty key; the service throws
 * {@link IllegalArgumentException} otherwise.</p>
 *
 * <p>{@code canonicalDescriptor} is the type-specific canonical descriptor
 * already pre-canonicalised by the caller (rare path, used by upstream tests
 * and by tooling that has already produced the canonical string). The per-
 * field {@code serviceName} / {@code operationName} / {@code sourceElementId} /
 * {@code targetElementId} / {@code targetElementLogicalName} are the usual
 * inputs -- the service feeds them through the appropriate canonicalisation
 * helper before hashing.</p>
 *
 * <p>All fields are boxed reference types so an omitted JSON key arrives as
 * {@code null} (not as a primitive zero/false) -- per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
public record MissingInputResolutionCreateRequest(
    String missingInputKey,
    String missingInputType,
    String canonicalDescriptor,
    String serviceName,
    String operationName,
    String sourceElementId,
    String targetElementId,
    String targetElementLogicalName,
    Map<String, Object> resolutionPayload,
    String resolvedBy
) {}
