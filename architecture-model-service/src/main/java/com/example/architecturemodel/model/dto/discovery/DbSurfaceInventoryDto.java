package com.example.architecturemodel.model.dto.discovery;

import java.util.List;

/**
 * DB surface inventory — Spec Q of the Data-Tier Oracle Program
 * ({@code agent-os/planning/2026-07-14-data-tier-oracle-program.md}).
 *
 * <p>Computed on read (no persistence): every database object the committed
 * architecture model knows about — tables/views from
 * {@code physical_data_entities}, stored procedures / triggers / views from
 * the DB migration pack's translation rows — with per-object reference
 * status derived from {@code endpoint_data_effects}, and the UNCLAIMED
 * surface: objects no discovered effect references (dead schema, or another
 * client writing the same database — the shared-DB estate risk).</p>
 *
 * <p>snake_case wire via the global Jackson strategy (no {@code @CamelCaseWire}).</p>
 */
public record DbSurfaceInventoryDto(
    List<DbSurfaceObjectDto> objects,
    DbSurfaceSummaryDto summary
) {

    /**
     * One database object with its claim status.
     *
     * <p>{@code unclaimed} is {@code null} when the dimension does not apply
     * (triggers fire via their table, never via a direct effect).</p>
     */
    public record DbSurfaceObjectDto(
        String objectRef,
        String kind,
        String source,
        int effectCount,
        boolean readReferenced,
        boolean writeReferenced,
        boolean procCallReferenced,
        String translationDisposition,
        String translationReviewStatus,
        Boolean unclaimed
    ) {
    }

    /** Whole-surface tallies (the judge's SCAN.DBINV predicate actuals). */
    public record DbSurfaceSummaryDto(
        int tables,
        int views,
        int storedProcedures,
        int triggers,
        int effectsTotal,
        int procCallEffects,
        int unclaimedTables,
        int unclaimedViews,
        int unclaimedStoredProcedures
    ) {
    }
}
