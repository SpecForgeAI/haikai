package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextDto;
import com.example.architecturemodel.model.dto.migration.MigrationDiscoveryContextRequestDto;
import com.example.architecturemodel.model.dto.migration.MigrationGapCodes;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackDecisionEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.apibehaviour.ApiBehaviourBaselineRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingLinkRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackDecisionRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import com.example.architecturemodel.repository.entity.DiscoveryCandidateRepository;
import com.example.architecturemodel.repository.entity.DiscoveryDecisionTaskRepository;
import com.example.architecturemodel.repository.entity.DiscoveryEvidenceRepository;
import com.example.architecturemodel.repository.entity.DiscoveryRunRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for the persistence-tier pack roll-up + gap codes on
 * {@link MigrationDiscoveryContextDto} (Spec 2026-07-02-a — Target Inputs &
 * Pack Wiring, Persistence-Tier Oracle Program).
 *
 * <p>Separate focused class per the established pattern
 * ({@link MigrationDiscoveryContextAggregationTest}); Mockito-wired, no Spring
 * context. Contract:</p>
 * <ol>
 *   <li>sourceEngines extracted (deduped, lowercased) from db-pack finding
 *       {@code detail_json.engineKey}; pack summary populated with open
 *       decision + unapproved translation counts; both advisory gap codes
 *       emitted when counts are non-zero.</li>
 *   <li>DB discovery with NO pack → {@code dbMigrationPack} null +
 *       {@code db_migration_pack_missing} gap; and db findings with no
 *       promoted schema → {@code no_physical_schema_promoted}.</li>
 *   <li>Clean pack (zero open / zero unapproved) → NO pack gap codes.</li>
 *   <li>Regression: no DB discovery at all → none of the four new codes.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDiscoveryContextDbPackReadinessTest {

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID CURRENT_ARCH_ID = UUID.randomUUID();
    private static final UUID PACK_ID = UUID.randomUUID();

    @Mock private ProjectRepository projectRepository;
    @Mock private ArchitectureRepository architectureRepository;
    @Mock private DiscoveryRunRepository discoveryRunRepository;
    @Mock private DiscoveryFindingRepository discoveryFindingRepository;
    @Mock private DiscoveryFindingLinkRepository discoveryFindingLinkRepository;
    @Mock private DiscoveryCandidateRepository discoveryCandidateRepository;
    @Mock private DiscoveryEvidenceRepository discoveryEvidenceRepository;
    @Mock private DiscoveryDecisionTaskRepository discoveryDecisionTaskRepository;
    @Mock private ApiBehaviourBaselineRepository apiBehaviourBaselineRepository;
    @Mock private ArchitectureElementMappingRepository architectureElementMappingRepository;
    @Mock private DbMigrationPackRepository dbMigrationPackRepository;
    @Mock private DbMigrationPackDecisionRepository dbMigrationPackDecisionRepository;
    @Mock private DbMigrationPackTranslationRepository dbMigrationPackTranslationRepository;

    private MigrationDiscoveryContextService service;

    private UUID runId;

    @BeforeEach
    void setUp() {
        service = new MigrationDiscoveryContextService(
            projectRepository,
            architectureRepository,
            discoveryRunRepository,
            discoveryFindingRepository,
            discoveryFindingLinkRepository,
            discoveryCandidateRepository,
            discoveryEvidenceRepository,
            discoveryDecisionTaskRepository,
            apiBehaviourBaselineRepository,
            architectureElementMappingRepository,
            null, null, null, null, null, null, null, null, // coverage gates
            null, // MetaModelSummaryService -- counts 0, hasModel false
            null, // TargetStateCapturedDecisionService -- empty default block
            dbMigrationPackRepository,
            dbMigrationPackDecisionRepository,
            dbMigrationPackTranslationRepository
        );

        runId = UUID.randomUUID();
        when(projectRepository.existsById(PROJECT_ID)).thenReturn(true);
        when(architectureRepository.findById(CURRENT_ARCH_ID))
            .thenReturn(Optional.of(architecture(CURRENT_ARCH_ID)));
        when(apiBehaviourBaselineRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryFindingLinkRepository.findByFindingId(any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryCandidateRepository
            .findByRunIdAndReviewStatusNot(any(), any()))
            .thenReturn(Collections.emptyList());
        lenient().when(discoveryDecisionTaskRepository.findByRunId(any()))
            .thenReturn(Collections.emptyList());
    }

    // -----------------------------------------------------------------------
    // Fixture helpers
    // -----------------------------------------------------------------------

    private void givenDatabaseRunWithFindings(List<DiscoveryFindingEntity> findings) {
        DiscoveryRunEntity run = DiscoveryRunEntity.builder()
            .id(runId)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .status("COMPLETED")
            .discoveryKind("database")
            .build();
        run.setCreatedAt(Instant.now());
        run.setUpdatedAt(Instant.now());
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(List.of(run));
        when(discoveryFindingRepository
            .findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(
                eq(runId), eq(PROJECT_ID), eq(CURRENT_ARCH_ID), any()))
            .thenReturn(findings);
    }

    private DiscoveryFindingEntity dbFinding(Map<String, Object> detailJson) {
        DiscoveryFindingEntity f = DiscoveryFindingEntity.builder()
            .id(UUID.randomUUID())
            .runId(runId)
            .projectId(PROJECT_ID)
            .architectureId(CURRENT_ARCH_ID)
            .findingType("collation_case_sensitivity_hazard")
            .category("data_quality")
            .severity("medium")
            .reviewStatus("approved")
            .title("db finding")
            .source("db_discovery_pack")
            .build();
        f.setDetailJson(detailJson);
        return f;
    }

    private void givenPack(long openDecisions, long unapprovedTranslations) {
        DbMigrationPackEntity pack = mock(DbMigrationPackEntity.class);
        when(pack.getId()).thenReturn(PACK_ID);
        when(pack.getStatus()).thenReturn("generated");
        when(dbMigrationPackRepository
            .findByProjectIdAndArchitectureId(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Optional.of(pack));
        when(dbMigrationPackDecisionRepository
            .countByPackIdAndStatus(PACK_ID, DbMigrationPackDecisionEntity.STATUS_OPEN))
            .thenReturn(openDecisions);
        when(dbMigrationPackTranslationRepository
            .countByPackIdAndReviewStatusIn(eq(PACK_ID), anyCollection()))
            .thenReturn(unapprovedTranslations);
    }

    private MigrationDiscoveryContextDto build() {
        MigrationDiscoveryContextRequestDto request = new MigrationDiscoveryContextRequestDto(
            CURRENT_ARCH_ID, null, null, null,
            null, null, null, null, null,
            null, null, null);
        return service.build(PROJECT_ID, request);
    }

    private static ArchitectureEntity architecture(UUID id) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .name("Current")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
    }

    // -----------------------------------------------------------------------
    // Test 1 — engines + populated pack summary + advisory gap codes
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: sourceEngines deduped from detail_json.engineKey; pack counts populated; unresolved/unapproved gaps emitted")
    void enginesAndPackSummaryAndAdvisoryGaps() {
        givenDatabaseRunWithFindings(List.of(
            dbFinding(Map.of("engineKey", "Sybase")),
            dbFinding(Map.of("engineKey", "sybase")),
            dbFinding(Map.of("tableName", "orders")) // no engineKey — ignored
        ));
        givenPack(2, 1);

        MigrationDiscoveryContextDto result = build();

        MigrationDiscoveryContextDto.DatabaseDiscoverySummary summary =
            result.databaseDiscoverySummary();
        assertThat(summary).isNotNull();
        assertThat(summary.sourceEngines()).containsExactly("sybase");
        assertThat(summary.dbMigrationPack()).isNotNull();
        assertThat(summary.dbMigrationPack().packId()).isEqualTo(PACK_ID);
        assertThat(summary.dbMigrationPack().status()).isEqualTo("generated");
        assertThat(summary.dbMigrationPack().openDecisionCount()).isEqualTo(2);
        assertThat(summary.dbMigrationPack().unapprovedTranslationCount()).isEqualTo(1);

        List<String> gaps = result.readinessAssessment().gaps();
        assertThat(gaps).contains(
            MigrationGapCodes.UNRESOLVED_DB_PACK_DECISIONS,
            MigrationGapCodes.UNAPPROVED_DB_TRANSLATIONS);
        assertThat(gaps).doesNotContain(MigrationGapCodes.DB_MIGRATION_PACK_MISSING);
    }

    // -----------------------------------------------------------------------
    // Test 2 — missing pack + unpromoted schema
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: db findings with no pack -> db_migration_pack_missing; no promoted schema -> no_physical_schema_promoted")
    void missingPackAndUnpromotedSchemaGaps() {
        givenDatabaseRunWithFindings(List.of(dbFinding(Map.of("engineKey", "sybase"))));
        when(dbMigrationPackRepository
            .findByProjectIdAndArchitectureId(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Optional.empty());

        MigrationDiscoveryContextDto result = build();

        assertThat(result.databaseDiscoverySummary().dbMigrationPack()).isNull();
        List<String> gaps = result.readinessAssessment().gaps();
        assertThat(gaps).contains(
            MigrationGapCodes.DB_MIGRATION_PACK_MISSING,
            MigrationGapCodes.NO_PHYSICAL_SCHEMA_PROMOTED);
        assertThat(gaps).doesNotContain(
            MigrationGapCodes.UNRESOLVED_DB_PACK_DECISIONS,
            MigrationGapCodes.UNAPPROVED_DB_TRANSLATIONS);
    }

    // -----------------------------------------------------------------------
    // Test 3 — clean pack emits NO pack gap codes
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: pack with zero open decisions and zero unapproved translations emits no pack gap codes")
    void cleanPackEmitsNoPackGaps() {
        givenDatabaseRunWithFindings(List.of(dbFinding(Map.of("engineKey", "sybase"))));
        givenPack(0, 0);

        List<String> gaps = build().readinessAssessment().gaps();

        assertThat(gaps).doesNotContain(
            MigrationGapCodes.DB_MIGRATION_PACK_MISSING,
            MigrationGapCodes.UNRESOLVED_DB_PACK_DECISIONS,
            MigrationGapCodes.UNAPPROVED_DB_TRANSLATIONS);
    }

    // -----------------------------------------------------------------------
    // Test 4 — regression: no DB discovery -> none of the new codes
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Test 4: no DB discovery at all -> none of the four new gap codes fire")
    void noDbDiscoveryEmitsNoneOfTheNewCodes() {
        when(discoveryRunRepository
            .findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Collections.emptyList());
        lenient().when(dbMigrationPackRepository
            .findByProjectIdAndArchitectureId(PROJECT_ID, CURRENT_ARCH_ID))
            .thenReturn(Optional.empty());

        MigrationDiscoveryContextDto result = build();

        assertThat(result.databaseDiscoverySummary().sourceEngines()).isEmpty();
        assertThat(result.databaseDiscoverySummary().dbMigrationPack()).isNull();
        assertThat(result.readinessAssessment().gaps()).doesNotContain(
            MigrationGapCodes.NO_PHYSICAL_SCHEMA_PROMOTED,
            MigrationGapCodes.DB_MIGRATION_PACK_MISSING,
            MigrationGapCodes.UNRESOLVED_DB_PACK_DECISIONS,
            MigrationGapCodes.UNAPPROVED_DB_TRANSLATIONS);
    }
}
