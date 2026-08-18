package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.mapper.SclMapper;
import com.example.architecturemodel.model.dto.SclContractDto;
import com.example.architecturemodel.model.dto.SclReachabilityItemDto;
import com.example.architecturemodel.model.dto.SclScanDto;
import com.example.architecturemodel.model.entity.SclContractEntity;
import com.example.architecturemodel.model.entity.SclScanStatus;
import com.example.architecturemodel.service.SclCorpusService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Persistence + service round-trip tests for the SCL corpus tables added by
 * Liquibase changeset {@code 224}: {@code scl_scan} + {@code scl_contract} +
 * {@code scl_reachability_item}.
 *
 * <p>Spec: SCL corpus persistence (Structural Contract Language)
 * (2026-08-18).</p>
 *
 * <p>Mirrors the {@link MigrationExecutionRunStatePersistenceTest} harness
 * exactly (the {@code @DataJpaTest} + H2 PostgreSQL-mode +
 * {@code CREATE DOMAIN JSONB AS JSON} idiom) so the opaque JSONB blobs
 * round-trip through persist + reload. The {@link SclCorpusService} is
 * instantiated directly over the autowired repositories (the
 * {@code @DataJpaTest} slice does not register {@code @Service} beans),
 * exercising the full create / bulk-upsert / replace path.</p>
 *
 * <p>Focused tests (5 -- within the 2-8 budget):</p>
 * <ol>
 *   <li>scan persists with defaults (status {@code in_progress}, created_at
 *       set) and the latest-scan read finds it.</li>
 *   <li>contract bulk-upsert inserts a batch, then a re-upsert of the same
 *       (scan_id, contract_key) OVERWRITES the row instead of duplicating it
 *       (the unique-pair round-trip).</li>
 *   <li>the opaque JSONB maps (stats / roots / body / gloss / signals)
 *       survive persist + flush + clear + reload, nested structures intact.</li>
 *   <li>the repo finders behave: kind-scoped, fan-in-floored (descending) and
 *       substring search listings, plus the corpus counts.</li>
 *   <li>reachability replace-on-write: persist a worklist, replace it, verify
 *       {@code deleteByScanId} wiped the old rows.</li>
 * </ol>
 */
@DataJpaTest
@ActiveProfiles("test")
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:sclcorpusdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class SclCorpusPersistenceTest {

    @Autowired
    private TestEntityManager entityManager;

    @Autowired
    private SclScanRepository scanRepository;

    @Autowired
    private SclContractRepository contractRepository;

    @Autowired
    private SclReachabilityItemRepository reachabilityItemRepository;

    private SclCorpusService service;

    @BeforeEach
    void setUp() {
        service = new SclCorpusService(
            scanRepository, contractRepository, reachabilityItemRepository, new SclMapper());
    }

    private static Map<String, Object> map(String key, Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(key, value);
        return m;
    }

    /**
     * A fresh contract DTO for bulk-upsert. The 15 record components in order
     * are: id, projectId, architectureId, scanId, contractKey, kind,
     * sourcePath, sourceSymbol, contentHash, fanIn, rootsJson, bodyJson,
     * glossJson, createdAt, updatedAt.
     */
    private static SclContractDto contract(
            String key, String kind, String hash, Integer fanIn,
            Map<String, Object> body) {
        return new SclContractDto(
            null, null, null, null,
            key, kind,
            "src/legacy/" + key + ".java", "Legacy" + key,
            hash, fanIn,
            map("roots", List.of("main")), body, null,
            null, null);
    }

    /**
     * A fresh reachability item DTO. The 9 record components in order are:
     * id, projectId, scanId, sourcePath, symbol, signalsJson, disposition,
     * createdAt, updatedAt.
     */
    private static SclReachabilityItemDto reachabilityItem(String path, String symbol) {
        return new SclReachabilityItemDto(
            null, null, null, path, symbol,
            map("signals", List.of("no-caller-found")), null,
            null, null);
    }

    @Test
    @DisplayName("scan persists with in_progress default + created_at; latest-scan read finds it")
    void scanPersistsWithDefaults() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();

        SclScanDto created = service.createScan(projectId, architectureId);
        entityManager.flush();
        entityManager.clear();

        assertThat(created.id()).isNotNull();
        assertThat(created.status()).isEqualTo(SclScanStatus.IN_PROGRESS);
        assertThat(created.createdAt()).isNotNull();

        SclScanDto latest = service.getLatestScan(projectId, architectureId).orElseThrow();
        assertThat(latest.id()).isEqualTo(created.id());
        assertThat(latest.projectId()).isEqualTo(projectId);
        assertThat(latest.architectureId()).isEqualTo(architectureId);
        assertThat(latest.status()).isEqualTo(SclScanStatus.IN_PROGRESS);

        // An unmined pair reads back empty.
        assertThat(service.getLatestScan(UUID.randomUUID(), UUID.randomUUID())).isEmpty();
        assertThat(service.listScans(projectId, architectureId)).hasSize(1);
    }

    @Test
    @DisplayName("bulk-upsert inserts, then a re-upsert of the same (scan_id, contract_key) overwrites instead of duplicating")
    void bulkUpsertUniquePairRoundTrip() {
        UUID projectId = UUID.randomUUID();
        SclScanDto scan = service.createScan(projectId, UUID.randomUUID());

        int first = service.bulkUpsertContracts(scan.id(), List.of(
            contract("T-abc123", "behaviour_table", "hash-v1", 3, map("rows", List.of("r1"))),
            contract("S-def456", "shape_contract", "hash-s1", 0, map("shape", "wide"))));
        entityManager.flush();
        entityManager.clear();
        assertThat(first).isEqualTo(2);
        assertThat(contractRepository.countByScanId(scan.id())).isEqualTo(2);

        // Re-mine T-abc123: same key, new body/hash/fan-in -> OVERWRITE.
        int second = service.bulkUpsertContracts(scan.id(), List.of(
            contract("T-abc123", "behaviour_table", "hash-v2", 7, map("rows", List.of("r1", "r2")))));
        entityManager.flush();
        entityManager.clear();
        assertThat(second).isEqualTo(1);

        assertThat(contractRepository.countByScanId(scan.id()))
            .as("re-upserting an existing (scan_id, contract_key) must NOT add a row")
            .isEqualTo(2);

        SclContractEntity reloaded = contractRepository
            .findByScanIdAndContractKey(scan.id(), "T-abc123").orElseThrow();
        assertThat(reloaded.getContentHash()).isEqualTo("hash-v2");
        assertThat(reloaded.getFanIn()).isEqualTo(7);
        assertThat(reloaded.getBodyJson()).containsEntry("rows", List.of("r1", "r2"));
        // Project / architecture ids are inherited from the scan row.
        assertThat(reloaded.getProjectId()).isEqualTo(projectId);
        assertThat(reloaded.getArchitectureId()).isEqualTo(scan.architectureId());
    }

    @Test
    @DisplayName("opaque JSONB maps (stats / roots / body / gloss) survive persist + reload with nested structures intact")
    void jsonbMapsSurvive() {
        SclScanDto scan = service.createScan(UUID.randomUUID(), UUID.randomUUID());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("columns", List.of("input", "state", "output"));
        body.put("rows", List.of(map("input", "x"), map("input", "y")));
        service.bulkUpsertContracts(scan.id(), List.of(
            contract("B-nested", "boundary_contract", "hash-b", 1, body)));
        service.patchContractGloss(scan.id(), "B-nested",
            map("summary", "guards the ledger boundary"));
        service.updateScan(scan.id(), SclScanStatus.COMPLETED,
            map("contracts", Map.of("behaviour_table", 0, "boundary_contract", 1)));
        entityManager.flush();
        entityManager.clear();

        SclContractDto full = service.getContract(scan.id(), "B-nested");
        assertThat(full.bodyJson()).containsEntry("columns", List.of("input", "state", "output"));
        assertThat(full.bodyJson().get("rows"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST)
            .hasSize(2);
        assertThat(full.glossJson()).containsEntry("summary", "guards the ledger boundary");
        assertThat(full.rootsJson()).containsEntry("roots", List.of("main"));

        SclScanDto reloadedScan = service.getLatestScan(
            scan.projectId(), scan.architectureId()).orElseThrow();
        assertThat(reloadedScan.status()).isEqualTo(SclScanStatus.COMPLETED);
        assertThat(reloadedScan.statsJson()).isNotNull();
        assertThat(reloadedScan.statsJson().get("contracts"))
            .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
            .containsEntry("boundary_contract", 1);
    }

    @Test
    @DisplayName("repo finders: kind-scoped, fan-in-floored (desc), substring search, counts")
    void repoFindersBehave() {
        SclScanDto scan = service.createScan(UUID.randomUUID(), UUID.randomUUID());
        service.bulkUpsertContracts(scan.id(), List.of(
            contract("T-low", "behaviour_table", "h1", 1, map("k", "v")),
            contract("T-high", "behaviour_table", "h2", 9, map("k", "v")),
            contract("F-frag", "fragment", "h3", 5, map("k", "v"))));
        entityManager.flush();
        entityManager.clear();

        assertThat(contractRepository.findByScanIdAndKindOrderByContractKeyAsc(
                scan.id(), "behaviour_table"))
            .extracting(SclContractEntity::getContractKey)
            .containsExactly("T-high", "T-low");

        assertThat(contractRepository.findByScanIdAndFanInGreaterThanEqualOrderByFanInDesc(
                scan.id(), 5))
            .extracting(SclContractEntity::getContractKey)
            .containsExactly("T-high", "F-frag");

        // Substring search hits contract_key OR source_symbol OR source_path,
        // case-insensitively ("FRAG" matches key F-frag / symbol LegacyF-frag).
        assertThat(contractRepository.searchByScanIdAndQuery(scan.id(), "FRAG"))
            .extracting(SclContractEntity::getContractKey)
            .containsExactly("F-frag");

        assertThat(contractRepository.countByScanId(scan.id())).isEqualTo(3);
        assertThat(contractRepository.countByScanIdAndKind(scan.id(), "fragment")).isEqualTo(1);
        assertThat(contractRepository.findByScanIdOrderByContractKeyAsc(scan.id())).hasSize(3);
    }

    @Test
    @DisplayName("reachability replace-on-write: persist, replace, deleteByScanId wipes the old rows")
    void reachabilityReplaceAndDelete() {
        SclScanDto scan = service.createScan(UUID.randomUUID(), UUID.randomUUID());

        int inserted = service.replaceReachability(scan.id(), List.of(
            reachabilityItem("src/legacy/A.java", "A.run"),
            reachabilityItem("src/legacy/B.java", "B.run")));
        entityManager.flush();
        entityManager.clear();
        assertThat(inserted).isEqualTo(2);

        List<SclReachabilityItemDto> worklist = service.listReachability(scan.id());
        assertThat(worklist).hasSize(2);
        assertThat(worklist.get(0).sourcePath()).isEqualTo("src/legacy/A.java");
        assertThat(worklist.get(0).signalsJson())
            .containsEntry("signals", List.of("no-caller-found"));
        assertThat(worklist.get(0).disposition()).isNull();

        // Triage one item, then replace the whole worklist -- the old rows
        // (including the triaged one) must be GONE, only the fresh row remains.
        service.patchReachabilityDisposition(worklist.get(0).id(), "dead_code");
        entityManager.flush();

        int replaced = service.replaceReachability(scan.id(), List.of(
            reachabilityItem("src/legacy/C.java", "C.run")));
        entityManager.flush();
        entityManager.clear();
        assertThat(replaced).isEqualTo(1);

        List<SclReachabilityItemDto> fresh = service.listReachability(scan.id());
        assertThat(fresh)
            .as("deleteByScanId must wipe the previous worklist wholesale")
            .hasSize(1);
        assertThat(fresh.get(0).sourcePath()).isEqualTo("src/legacy/C.java");
        assertThat(reachabilityItemRepository.findAll()).hasSize(1);
    }
}
