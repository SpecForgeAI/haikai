package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.UUID;

/**
 * Response DTO for {@code POST /api/projects/{projectId}/missing-input-resolutions/parse-files}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Mirrors the service-layer {@code OasWsdlContractIngestService.ContractIngestResult}
 * shape with explicit JSON-friendly types so the controller never leaks
 * service-layer internals on the wire.</p>
 *
 * <p>Response shape per spec:</p>
 * <pre>
 * {
 *   files: [
 *     {
 *       fileName, fileSize, format, status, failureReason,
 *       suggestedServiceName, finalServiceName,
 *       operations: [
 *         { identifier, missingInputKey, status, matchedSpecIds[], existingResolutionId }
 *       ]
 *     }
 *   ],
 *   summary: {
 *     totalOperations, matched, alreadyResolved, noMatch,
 *     willCreateResolutions, affectedSpecCount
 *   },
 *   previewOnly
 * }
 * </pre>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md} so a downstream client
 * that round-trips the response back through a PATCH-style endpoint can't
 * silently overwrite columns with primitive defaults.</p>
 */
public record ContractIngestResponse(
    List<FileBlock> files,
    Summary summary,
    Boolean previewOnly
) {

    /**
     * Per-file response block.
     */
    public record FileBlock(
        String fileName,
        Long fileSize,
        String format,
        String status,
        String failureReason,
        String suggestedServiceName,
        String finalServiceName,
        List<OperationBlock> operations
    ) {}

    /**
     * Per-operation response block under each {@link FileBlock}.
     */
    public record OperationBlock(
        String identifier,
        String missingInputKey,
        String status,
        List<UUID> matchedSpecIds,
        UUID existingResolutionId
    ) {}

    /**
     * Summary counts derived from the per-file / per-operation breakdown.
     *
     * @param totalOperations         sum of operations across every PARSED file.
     * @param matched                 operations whose key intersects an
     *                                {@code insufficient_context} spec AND no
     *                                active resolution exists yet.
     * @param alreadyResolved         operations whose key has an existing
     *                                active resolution.
     * @param noMatch                 operations whose key does not intersect
     *                                any {@code insufficient_context} spec in
     *                                the project.
     * @param willCreateResolutions   alias of {@code matched} -- the count of
     *                                rows the commit phase would create.
     * @param affectedSpecCount       DISTINCT spec-generation ids touched by
     *                                at least one matched operation across
     *                                the batch.
     */
    public record Summary(
        Integer totalOperations,
        Integer matched,
        Integer alreadyResolved,
        Integer noMatch,
        Integer willCreateResolutions,
        Integer affectedSpecCount
    ) {}
}
