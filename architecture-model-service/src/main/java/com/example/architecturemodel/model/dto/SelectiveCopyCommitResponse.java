package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

/**
 * Response shape for the selective-copy commit endpoint. Drives the post-copy
 * toast text on the frontend:
 * <em>"Copied N elements from &lt;source-name&gt; (skipped: X, overwrote: Y,
 * duplicated: Z)"</em>.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>{@code createdMappingCount} is the number of {@code architecture_element_mappings}
 * rows written under the same transaction when {@code autoMap=true}. Equals
 * {@code 0} when {@code autoMap=false}; equals the number of elements actually
 * copied (skipped / overwritten-without-id-change rows produce no mapping;
 * duplicate-action rows produce a mapping from the source id to the new
 * duplicate target id) when {@code autoMap=true}.</p>
 *
 * @param copied               total INSERT or UPDATE row-effects across all
 *                             in-scope tables (the {@code N} in the toast).
 *                             Equal to
 *                             {@code elementIds.size() + autoIncluded - skipped}
 *                             summed across in-scope tables.
 * @param skipped              number of elements whose resolution was {@code skip}.
 * @param overwritten          number of elements whose resolution was {@code overwrite}.
 * @param duplicated           number of elements whose resolution was {@code duplicate}.
 * @param autoIncluded         number of elements pulled in by the cascading-reference
 *                             walk (these are inserted verbatim with the source id
 *                             preserved, never conflict by definition).
 * @param createdMappingCount  number of {@code architecture_element_mappings} rows
 *                             written when {@code autoMap=true}; {@code 0} otherwise.
 */
@CamelCaseWire
public record SelectiveCopyCommitResponse(
    int copied,
    int skipped,
    int overwritten,
    int duplicated,
    int autoIncluded,
    int createdMappingCount
) {

    /**
     * Convenience constructor preserving the pre-spec wire shape — used by
     * legacy callers and existing tests that don't surface the new
     * {@code createdMappingCount} field. Defaults the new field to {@code 0}
     * so non-auto-map flows behave exactly as before.
     */
    public SelectiveCopyCommitResponse(
        int copied,
        int skipped,
        int overwritten,
        int duplicated,
        int autoIncluded
    ) {
        this(copied, skipped, overwritten, duplicated, autoIncluded, 0);
    }
}
