package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationGapCodes;
import com.example.architecturemodel.model.dto.migration.ReadinessAssessmentDto;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.CoverageAggregates;
import com.example.architecturemodel.service.migration.MigrationDiscoveryContextService.ReadinessContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused tests for the {@code db_consumers_unrevalidated} readiness gap
 * (Spec 2026-07-06-f §4, Tier-1 batch 2026-07-10).
 *
 * <p>Pins: dialect-affected consumers with NO scoped-parity diff emit the gap
 * (advisory, dataReadiness downgraded to partial); a scoped-parity diff
 * CLEARS it; zero/null counts never emit; the pre-batch 11-arg
 * {@link ReadinessContext} constructor still folds identically (no scoped
 * diff, back-compat).</p>
 */
class MigrationDbConsumersReadinessTest {

    private static ReadinessContext ctx(
            Integer affectedConsumerCount, boolean scopedParityDiffExists) {
        MigrationDiscoveryContextDto.ArchitectureSummary arch =
            new MigrationDiscoveryContextDto.ArchitectureSummary(
                UUID.randomUUID(), "Current",
                1, 1, 1, 1, 1, 0, 0, 0, 0, true);
        com.example.architecturemodel.model.entity.DiscoveryRunEntity run =
            com.example.architecturemodel.model.entity.DiscoveryRunEntity.builder()
                .id(UUID.randomUUID())
                .projectId(UUID.randomUUID())
                .architectureId(UUID.randomUUID())
                .status("COMPLETED")
                .discoveryKind("combined")
                .build();
        MigrationDiscoveryContextDto.DatabaseDiscoverySummary dbSummary =
            new MigrationDiscoveryContextDto.DatabaseDiscoverySummary(
                3, 1, 1, true, List.of("sybase"),
                new MigrationDiscoveryContextDto.DbMigrationPackSummary(
                    UUID.randomUUID(), "generated", 0, 0),
                affectedConsumerCount);
        MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary baselines =
            new MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary(
                1, 1, 0, List.of());
        return new ReadinessContext(
            arch, null, List.of(run), List.of(), List.of(),
            baselines, null, dbSummary, null, false,
            CoverageAggregates.empty(), scopedParityDiffExists);
    }

    @Test
    @DisplayName("affected consumers with NO scoped-parity diff emit the gap (advisory)")
    void emitsGapWhenUnrevalidated() {
        ReadinessAssessmentDto readiness =
            MigrationDiscoveryContextService.assessReadiness(ctx(2, false));
        assertThat(readiness.gaps())
            .contains(MigrationGapCodes.DB_CONSUMERS_UNREVALIDATED);
        assertThat(readiness.dataReadiness())
            .isEqualTo(MigrationGapCodes.STATUS_PARTIAL);
    }

    @Test
    @DisplayName("a scoped-parity diff CLEARS the gap")
    void scopedDiffClearsGap() {
        ReadinessAssessmentDto readiness =
            MigrationDiscoveryContextService.assessReadiness(ctx(2, true));
        assertThat(readiness.gaps())
            .doesNotContain(MigrationGapCodes.DB_CONSUMERS_UNREVALIDATED);
    }

    @Test
    @DisplayName("zero / null affected counts never emit the gap")
    void zeroOrNullCountsNeverEmit() {
        assertThat(MigrationDiscoveryContextService.assessReadiness(ctx(0, false)).gaps())
            .doesNotContain(MigrationGapCodes.DB_CONSUMERS_UNREVALIDATED);
        assertThat(MigrationDiscoveryContextService.assessReadiness(ctx(null, false)).gaps())
            .doesNotContain(MigrationGapCodes.DB_CONSUMERS_UNREVALIDATED);
    }

    @Test
    @DisplayName("back-compat: the pre-batch 11-arg ReadinessContext folds as no-scoped-diff")
    void backCompatConstructor() {
        ReadinessContext legacy = new ReadinessContext(
            null, null, List.of(), List.of(), List.of(),
            new MigrationDiscoveryContextDto.ApiBehaviourBaselineSummary(0, 0, 0, List.of()),
            null,
            new MigrationDiscoveryContextDto.DatabaseDiscoverySummary(
                1, 1, 1, true, List.of(),
                new MigrationDiscoveryContextDto.DbMigrationPackSummary(
                    UUID.randomUUID(), "generated", 0, 0),
                3),
            null, false, CoverageAggregates.empty());
        assertThat(legacy.scopedParityDiffExists()).isFalse();
        assertThat(MigrationDiscoveryContextService.assessReadiness(legacy).gaps())
            .contains(MigrationGapCodes.DB_CONSUMERS_UNREVALIDATED);
    }
}
