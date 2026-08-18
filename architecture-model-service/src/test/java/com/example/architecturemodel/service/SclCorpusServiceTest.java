package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.SclMapper;
import com.example.architecturemodel.model.dto.SclContractDto;
import com.example.architecturemodel.model.dto.SclReachabilityItemDto;
import com.example.architecturemodel.model.dto.SclScanDto;
import com.example.architecturemodel.model.entity.SclContractEntity;
import com.example.architecturemodel.model.entity.SclReachabilityItemEntity;
import com.example.architecturemodel.model.entity.SclScanEntity;
import com.example.architecturemodel.model.entity.SclScanStatus;
import com.example.architecturemodel.repository.entity.SclContractRepository;
import com.example.architecturemodel.repository.entity.SclReachabilityItemRepository;
import com.example.architecturemodel.repository.entity.SclScanRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Mockito unit tests for {@link SclCorpusService} (SCL corpus persistence,
 * Structural Contract Language, 2026-08-18).
 *
 * <p>Mirrors the {@link MigrationExecutionRunReconcileStatusTest} style:
 * {@code @ExtendWith(MockitoExtension.class)}, {@code @Mock} repositories,
 * {@code @InjectMocks} service (with a real {@link SclMapper} spy -- the
 * mapper is pure hand-written conversion).</p>
 *
 * <p>Covered: createScan defaults; updateScan status validation (bad value ->
 * IllegalArgumentException, unknown id -> ResourceNotFoundException) +
 * null-guarded patch; bulkUpsertContracts insert-new / overwrite-existing /
 * blank-key rejection; listContracts body-stripping when includeBody=false;
 * patchContractGloss gloss-only update; patchReachabilityDisposition
 * vocabulary validation.</p>
 */
@ExtendWith(MockitoExtension.class)
class SclCorpusServiceTest {

    @Mock
    private SclScanRepository scanRepository;

    @Mock
    private SclContractRepository contractRepository;

    @Mock
    private SclReachabilityItemRepository reachabilityItemRepository;

    @Spy
    private SclMapper mapper = new SclMapper();

    @InjectMocks
    private SclCorpusService service;

    private static final UUID PROJECT_ID = UUID.randomUUID();
    private static final UUID ARCHITECTURE_ID = UUID.randomUUID();
    private static final UUID SCAN_ID = UUID.randomUUID();

    private SclScanEntity scanEntity() {
        return SclScanEntity.builder()
            .id(SCAN_ID)
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .status(SclScanStatus.IN_PROGRESS)
            .build();
    }

    /**
     * A contract DTO for bulk-upsert. The 15 record components in order are:
     * id, projectId, architectureId, scanId, contractKey, kind, sourcePath,
     * sourceSymbol, contentHash, fanIn, rootsJson, bodyJson, glossJson,
     * createdAt, updatedAt.
     */
    private static SclContractDto contractDto(String key, Map<String, Object> body) {
        return new SclContractDto(
            null, null, null, null,
            key, "behaviour_table",
            "src/legacy/X.java", "LegacyX",
            "hash-" + key, 4,
            Map.of("roots", List.of("main")), body, null,
            null, null);
    }

    // ------------------------------------------------------------------
    // createScan
    // ------------------------------------------------------------------

    @Test
    @DisplayName("createScan assigns a fresh UUID and defaults status to in_progress")
    void createScanDefaults() {
        when(scanRepository.save(any(SclScanEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        SclScanDto created = service.createScan(PROJECT_ID, ARCHITECTURE_ID);

        ArgumentCaptor<SclScanEntity> captor = ArgumentCaptor.forClass(SclScanEntity.class);
        verify(scanRepository).save(captor.capture());
        assertThat(captor.getValue().getId()).isNotNull();
        assertThat(captor.getValue().getProjectId()).isEqualTo(PROJECT_ID);
        assertThat(captor.getValue().getArchitectureId()).isEqualTo(ARCHITECTURE_ID);
        assertThat(created.status()).isEqualTo(SclScanStatus.IN_PROGRESS);
        assertThat(created.statsJson()).isNull();
    }

    // ------------------------------------------------------------------
    // updateScan
    // ------------------------------------------------------------------

    @Test
    @DisplayName("updateScan rejects a status outside SclScanStatus.ALL with IllegalArgumentException")
    void updateScanRejectsBadStatus() {
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.of(scanEntity()));

        assertThatThrownBy(() -> service.updateScan(SCAN_ID, "definitely_not_a_status", null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid SCL scan status");
        verify(scanRepository, never()).save(any());
    }

    @Test
    @DisplayName("updateScan throws ResourceNotFoundException for an unknown scan id")
    void updateScanUnknownIdIs404() {
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.updateScan(SCAN_ID, SclScanStatus.COMPLETED, null))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("SCL scan not found");
    }

    @Test
    @DisplayName("updateScan patches with null-guards: omitted status keeps the stored value, stats apply")
    void updateScanNullGuardedPatch() {
        SclScanEntity entity = scanEntity();
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.of(entity));
        when(scanRepository.save(any(SclScanEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        SclScanDto updated = service.updateScan(SCAN_ID, null, Map.of("contracts_total", 42));

        assertThat(updated.status())
            .as("a null status on the PATCH must leave the stored status intact")
            .isEqualTo(SclScanStatus.IN_PROGRESS);
        assertThat(updated.statsJson()).containsEntry("contracts_total", 42);

        // And a status-only PATCH leaves the stats intact.
        SclScanDto statusOnly = service.updateScan(SCAN_ID, SclScanStatus.COMPLETED, null);
        assertThat(statusOnly.status()).isEqualTo(SclScanStatus.COMPLETED);
        assertThat(statusOnly.statsJson()).containsEntry("contracts_total", 42);
    }

    // ------------------------------------------------------------------
    // bulkUpsertContracts
    // ------------------------------------------------------------------

    @Test
    @DisplayName("bulkUpsertContracts inserts new keys and overwrites existing ones, returning the total")
    void bulkUpsertInsertsAndOverwrites() {
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.of(scanEntity()));

        SclContractEntity existing = SclContractEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .scanId(SCAN_ID)
            .contractKey("T-existing")
            .kind("behaviour_table")
            .contentHash("hash-old")
            .fanIn(1)
            .bodyJson(Map.of("old", true))
            .build();
        when(contractRepository.findByScanIdAndContractKey(SCAN_ID, "T-existing"))
            .thenReturn(Optional.of(existing));
        when(contractRepository.findByScanIdAndContractKey(SCAN_ID, "T-new"))
            .thenReturn(Optional.empty());
        when(contractRepository.save(any(SclContractEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        int upserted = service.bulkUpsertContracts(SCAN_ID, List.of(
            contractDto("T-existing", Map.of("new", true)),
            contractDto("T-new", Map.of("fresh", true))));

        assertThat(upserted).isEqualTo(2);

        ArgumentCaptor<SclContractEntity> captor = ArgumentCaptor.forClass(SclContractEntity.class);
        verify(contractRepository, times(2)).save(captor.capture());

        SclContractEntity overwritten = captor.getAllValues().get(0);
        assertThat(overwritten.getId())
            .as("an existing row keeps its id -- overwrite, not re-insert")
            .isEqualTo(existing.getId());
        assertThat(overwritten.getBodyJson()).containsEntry("new", true);
        assertThat(overwritten.getContentHash()).isEqualTo("hash-T-existing");
        assertThat(overwritten.getFanIn()).isEqualTo(4);

        SclContractEntity inserted = captor.getAllValues().get(1);
        assertThat(inserted.getId()).isNotNull().isNotEqualTo(existing.getId());
        assertThat(inserted.getScanId()).isEqualTo(SCAN_ID);
        assertThat(inserted.getProjectId())
            .as("project id must be inherited from the scan row, not the body")
            .isEqualTo(PROJECT_ID);
        assertThat(inserted.getArchitectureId()).isEqualTo(ARCHITECTURE_ID);
    }

    @Test
    @DisplayName("bulkUpsertContracts rejects blank contract keys and null bodies, listing the offenders")
    void bulkUpsertRejectsBlankKeysAndNullBodies() {
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.of(scanEntity()));

        List<SclContractDto> batch = List.of(
            contractDto("  ", Map.of("k", "v")),
            contractDto("T-bodiless", null),
            contractDto("T-fine", Map.of("k", "v")));

        assertThatThrownBy(() -> service.bulkUpsertContracts(SCAN_ID, batch))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("blank contract_key or null body_json")
            .hasMessageContaining("index 0")
            .hasMessageContaining("T-bodiless");
        verify(contractRepository, never()).save(any());
    }

    @Test
    @DisplayName("bulkUpsertContracts throws ResourceNotFoundException for an unknown scan")
    void bulkUpsertUnknownScanIs404() {
        when(scanRepository.findById(SCAN_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.bulkUpsertContracts(
                SCAN_ID, List.of(contractDto("T-x", Map.of("k", "v")))))
            .isInstanceOf(ResourceNotFoundException.class)
            .hasMessageContaining("SCL scan not found");
    }

    // ------------------------------------------------------------------
    // listContracts
    // ------------------------------------------------------------------

    @Test
    @DisplayName("listContracts strips body_json AND gloss_json when includeBody=false, and carries them when true")
    void listContractsStripsBodyWhenAsked() {
        SclContractEntity entity = SclContractEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .scanId(SCAN_ID)
            .contractKey("T-abc123")
            .kind("behaviour_table")
            .contentHash("hash-1")
            .fanIn(6)
            .bodyJson(Map.of("rows", List.of("r1")))
            .glossJson(Map.of("summary", "does things"))
            .build();
        when(contractRepository.findByScanIdOrderByContractKeyAsc(SCAN_ID))
            .thenReturn(List.of(entity));

        List<SclContractDto> light = service.listContracts(SCAN_ID, null, null, null, false);
        assertThat(light).hasSize(1);
        assertThat(light.get(0).bodyJson()).isNull();
        assertThat(light.get(0).glossJson()).isNull();
        assertThat(light.get(0).contractKey()).isEqualTo("T-abc123");
        assertThat(light.get(0).contentHash()).isEqualTo("hash-1");
        assertThat(light.get(0).fanIn()).isEqualTo(6);

        List<SclContractDto> full = service.listContracts(SCAN_ID, null, null, null, true);
        assertThat(full.get(0).bodyJson()).containsEntry("rows", List.of("r1"));
        assertThat(full.get(0).glossJson()).containsEntry("summary", "does things");

        // In-memory filters compose on top of the repo read.
        assertThat(service.listContracts(SCAN_ID, null, 7, null, false)).isEmpty();
        assertThat(service.listContracts(SCAN_ID, null, 6, "ABC", false)).hasSize(1);
        assertThat(service.listContracts(SCAN_ID, null, null, "no-such-needle", false)).isEmpty();
    }

    // ------------------------------------------------------------------
    // patchContractGloss
    // ------------------------------------------------------------------

    @Test
    @DisplayName("patchContractGloss updates ONLY the gloss -- body/hash/fan-in untouched")
    void patchContractGlossUpdatesOnlyGloss() {
        SclContractEntity entity = SclContractEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .architectureId(ARCHITECTURE_ID)
            .scanId(SCAN_ID)
            .contractKey("T-abc123")
            .kind("behaviour_table")
            .contentHash("hash-keep")
            .fanIn(2)
            .bodyJson(Map.of("keep", "me"))
            .build();
        when(contractRepository.findByScanIdAndContractKey(SCAN_ID, "T-abc123"))
            .thenReturn(Optional.of(entity));
        when(contractRepository.save(any(SclContractEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        SclContractDto updated = service.patchContractGloss(
            SCAN_ID, "T-abc123", Map.of("summary", "LLM annotation"));

        assertThat(updated.glossJson()).containsEntry("summary", "LLM annotation");
        assertThat(updated.bodyJson()).containsEntry("keep", "me");
        assertThat(updated.contentHash()).isEqualTo("hash-keep");
        assertThat(updated.fanIn()).isEqualTo(2);

        assertThatThrownBy(() -> service.patchContractGloss(SCAN_ID, "T-missing", Map.of()))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    // ------------------------------------------------------------------
    // patchReachabilityDisposition
    // ------------------------------------------------------------------

    @Test
    @DisplayName("patchReachabilityDisposition accepts the vocabulary + null (reopen), rejects anything else")
    void patchReachabilityDispositionValidatesVocabulary() {
        UUID itemId = UUID.randomUUID();
        SclReachabilityItemEntity entity = SclReachabilityItemEntity.builder()
            .id(itemId)
            .projectId(PROJECT_ID)
            .scanId(SCAN_ID)
            .sourcePath("src/legacy/A.java")
            .disposition("dead_code")
            .build();
        when(reachabilityItemRepository.findById(itemId)).thenReturn(Optional.of(entity));
        when(reachabilityItemRepository.save(any(SclReachabilityItemEntity.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));

        for (String allowed : List.of("dead_code", "missed_entrypoint", "framework_invoked")) {
            SclReachabilityItemDto updated =
                service.patchReachabilityDisposition(itemId, allowed);
            assertThat(updated.disposition()).isEqualTo(allowed);
        }

        // Null REOPENS the item.
        assertThat(service.patchReachabilityDisposition(itemId, null).disposition()).isNull();

        assertThatThrownBy(() -> service.patchReachabilityDisposition(itemId, "gone_fishing"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Invalid SCL reachability disposition");

        when(reachabilityItemRepository.findById(itemId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.patchReachabilityDisposition(itemId, "dead_code"))
            .isInstanceOf(ResourceNotFoundException.class);
    }
}
