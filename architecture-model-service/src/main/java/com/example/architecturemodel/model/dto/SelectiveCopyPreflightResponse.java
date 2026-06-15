package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.jackson.CamelCaseWire;

import java.util.List;
import java.util.UUID;

/**
 * Response shape for the selective-copy preflight endpoint.
 *
 * <p>Marked {@code @CamelCaseWire} because the Selective Copy frontend speaks camelCase.</p>
 *
 * <p>Three top-level lists/objects:</p>
 * <ul>
 *   <li>{@link #conflicts} — every selected (or auto-included) element whose id
 *       already exists in the target architecture by UUID match.</li>
 *   <li>{@link #autoIncluded} — every element that the cascading-reference
 *       walk pulled into the copy set because the user's selection
 *       referenced it but the target does not yet contain it.</li>
 *   <li>{@link #summary} — counts the wizard renders in the summary header.</li>
 * </ul>
 */
@CamelCaseWire
public record SelectiveCopyPreflightResponse(
    List<ConflictItem> conflicts,
    List<AutoIncludedItem> autoIncluded,
    Summary summary
) {

    /**
     * One same-UUID conflict — the element id is already present in the
     * target architecture's corresponding table.
     *
     * @param elementId      the conflicting id (same in source + target).
     * @param elementType    the underlying database table name (e.g.
     *                       {@code "applications"}).
     * @param name           the source element's display name (or its id when
     *                       the table has no {@code name} column).
     * @param conflictReason discriminated string — currently always
     *                       {@code "same_uuid"}; reserved for future variants.
     */
    @CamelCaseWire
    public record ConflictItem(
        UUID elementId,
        String elementType,
        String name,
        String conflictReason
    ) {}

    /**
     * One auto-included element — referenced by a selected element but absent
     * from the target.
     *
     * @param elementId       the auto-included id.
     * @param elementType     the underlying database table name.
     * @param name            the source element's display name.
     * @param includedBecause display name of the parent element (the one the
     *                       user originally selected) that pulled this
     *                       element into the copy set.
     */
    @CamelCaseWire
    public record AutoIncludedItem(
        UUID elementId,
        String elementType,
        String name,
        String includedBecause
    ) {}

    /**
     * Aggregate counts for the wizard summary header.
     *
     * @param totalSelected     count of ids in the user's request.
     * @param conflictCount     {@code conflicts.size()}.
     * @param autoIncludedCount {@code autoIncluded.size()}.
     * @param willCopyCount     ids the commit step will actually act on
     *                          (selected + auto-included; conflicts default
     *                          to skip in the resolution UI but are still
     *                          counted in the action set since the user can
     *                          override to overwrite / duplicate).
     */
    @CamelCaseWire
    public record Summary(
        int totalSelected,
        int conflictCount,
        int autoIncludedCount,
        int willCopyCount
    ) {}
}
