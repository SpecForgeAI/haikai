package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.CveEnrichmentRequest;
import com.example.architecturemodel.model.dto.security.IngestSecurityFindingRowDto;
import com.example.architecturemodel.model.dto.security.IngestSecurityFindingsRequest;
import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityIngestSummaryDto;
import com.example.architecturemodel.model.dto.security.SecurityLinkingAliasDto;
import com.example.architecturemodel.model.dto.security.SecurityRegisterResponse;
import com.example.architecturemodel.model.dto.security.SecurityRollupDto;
import com.example.architecturemodel.model.dto.security.UpsertSecurityAliasesRequest;
import com.example.architecturemodel.model.entity.ApplicationComponentEntity;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.model.entity.security.CveEntity;
import com.example.architecturemodel.repository.entity.ApplicationComponentRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
import com.example.architecturemodel.repository.security.CveRepository;
import com.example.architecturemodel.repository.security.CweRepository;
import com.example.architecturemodel.repository.security.SecurityFindingReportRepository;
import com.example.architecturemodel.repository.security.SecurityFindingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Service-layer tests for the department-level security store (Security health
 * dashboard, 2026-07-19; entity_id generalization second wave): ingestion
 * (snapshot-list lifecycle, keep-all dedup, world-fact stubs, M:N joins,
 * level-generic attribution with the applicationId wire fallback), the
 * one-flattening-point register (ancestor-aware entity filters + column set +
 * live names + ancestor columns), the level-generic Overview rollup, CVE
 * enrichment grace, and the alias memory.
 *
 * <p>{@code @SpringBootTest} on the H2-in-PostgreSQL-compat profile (JSONB
 * domain alias), mirroring {@code VulnerabilityIngestionServiceTest};
 * {@code @Transactional} rolls back per test.</p>
 */
@SpringBootTest
@Transactional
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:h2:mem:secingestdb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL;NON_KEYWORDS=KEY;INIT=CREATE DOMAIN IF NOT EXISTS JSONB AS JSON"
})
class SecurityFindingIngestionServiceTest {

    @Autowired private SecurityFindingIngestionService ingestionService;
    @Autowired private SecurityRegisterService registerService;
    @Autowired private SecurityReferenceService referenceService;
    @Autowired private SecurityAliasService aliasService;
    @Autowired private SecurityFindingReportRepository reportRepository;
    @Autowired private SecurityFindingRepository findingRepository;
    @Autowired private CveRepository cveRepository;
    @Autowired private CweRepository cweRepository;
    @Autowired private ApplicationRepository applicationRepository;
    @Autowired private ApplicationComponentRepository componentRepository;
    @Autowired private ServiceRepository serviceRepository;

    private UUID projectId;
    private UUID architectureId;

    private static final String APP_MRX = "app-mrx";
    private static final String APP_HIFI = "app-hifi";
    private static final String COMP_CORE = "comp-core";
    private static final String SVC_PAY = "svc-pay";
    private static final String SVC_WEB = "svc-web";

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        architectureId = UUID.randomUUID();
        applicationRepository.save(ApplicationEntity.builder()
            .id(APP_MRX).modelFileId("mf-1").name("MRX").abbreviation("MRX").build());
        applicationRepository.save(ApplicationEntity.builder()
            .id(APP_HIFI).modelFileId("mf-1").name("HiFi").abbreviation("HIFI").build());
        // Hierarchy under MRX: Core component -> payments service (with repo).
        componentRepository.save(ApplicationComponentEntity.builder()
            .id(COMP_CORE).modelFileId("mf-1").applicationId(APP_MRX).name("Core").build());
        serviceRepository.save(ServiceEntity.builder()
            .id(SVC_PAY).modelFileId("mf-1").applicationId(APP_MRX)
            .applicationComponentId(COMP_CORE).name("payments")
            .repoLocation("https://gitlab.example.com/grh/payments.git").build());
        // Service directly under HiFi (no component).
        serviceRepository.save(ServiceEntity.builder()
            .id(SVC_WEB).modelFileId("mf-1").applicationId(APP_HIFI).name("web").build());
    }

    /** App-level row using the PRE-213 applicationId wire field (fallback path). */
    private static IngestSecurityFindingRowDto row(String linkingValue,
                                                   String applicationId,
                                                   String matchStatus,
                                                   String severity,
                                                   String title,
                                                   String sourceFindingId,
                                                   List<String> cveIds,
                                                   List<String> cweIds) {
        return new IngestSecurityFindingRowDto(
            linkingValue, null, applicationId, matchStatus, severity, title,
            "details of " + title, null, "batch/pom.xml",
            "grp/sub/proj/123", "NVD=CVSS:3.1/AV:N/AC:L", sourceFindingId,
            List.of("GHSA-xxxx"), cveIds, cweIds);
    }

    /** Level-generic row using the authoritative entityId field (changeset 213). */
    private static IngestSecurityFindingRowDto rowAt(String linkingValue,
                                                     String entityId,
                                                     String matchStatus,
                                                     String severity,
                                                     String title,
                                                     String sourceFindingId) {
        return new IngestSecurityFindingRowDto(
            linkingValue, entityId, null, matchStatus, severity, title,
            "details of " + title, null, "src/pom.xml",
            "grp/x", null, sourceFindingId, List.of(), List.of("CWE-89"), List.of());
    }

    private SecurityIngestSummaryDto ingestStandardReport() {
        IngestSecurityFindingsRequest request = new IngestSecurityFindingsRequest(
            "gitlab_export", "application",
            List.of("export-a.csv", "export-b.csv"),
            Map.of("Project Name", "linking_value", "Severity", "severity"),
            0, null,
            List.of(
                row("MRX", APP_MRX, "auto", "High", "Spring DoS", "1949555",
                    List.of("CVE-2024-38808"), List.of("CWE-770")),
                row("HiFi", APP_HIFI, "manual", "medium", "SQL Injection", "1949556",
                    List.of(), List.of("CWE-89")),
                row("Unknown App", null, null, "critical", "Orphan finding", "1949557",
                    List.of("CVE-2024-38808"), List.of())));
        return ingestionService.ingest(projectId, architectureId, request);
    }

    private SecurityIngestSummaryDto ingestServiceLevelReport() {
        IngestSecurityFindingsRequest request = new IngestSecurityFindingsRequest(
            "gitlab_export", "service", List.of("service-scan.csv"), null, 0, null,
            List.of(
                new IngestSecurityFindingRowDto(
                    "grh/payments", SVC_PAY, null, "auto", "high",
                    "Spring DoS in payments", "d", null, "pom.xml", "grh/payments/1",
                    null, "svc-1",
                    List.of(), List.of("CVE-2024-38808"), List.of("CWE-770")),
                rowAt("hifi/web", SVC_WEB, "manual", "medium", "XSS in web", "svc-2"),
                rowAt("unknown/repo", null, null, "critical", "Orphan svc finding", "svc-3")));
        return ingestionService.ingest(projectId, architectureId, request);
    }

    /** Register with only an application filter (other entity filters null). */
    private SecurityRegisterResponse registerByApp(String applicationId,
                                                   String matchStatus,
                                                   List<String> columns) {
        return registerService.register(projectId, architectureId, null,
            applicationId, null, null, matchStatus, null, null, columns, 0, 50);
    }

    @Test
    @DisplayName("ingest persists findings + M:N joins, resolves attribution (applicationId wire fallback), creates pending world-fact stubs, and reports no-silent-drop counts")
    void ingestPersistsStructuredStore() {
        SecurityIngestSummaryDto summary = ingestStandardReport();

        assertThat(summary.rowsReceived()).isEqualTo(3);
        assertThat(summary.rowCountIngested()).isEqualTo(3);
        assertThat(summary.rowCountDropped()).isZero();
        assertThat(summary.matchedCount()).isEqualTo(2);
        assertThat(summary.unmatchedCount()).isEqualTo(1);
        assertThat(summary.distinctCves()).isEqualTo(1);
        assertThat(summary.distinctCwes()).isEqualTo(2);
        // Liquibase (and so the MITRE seed) is disabled in tests: both CWEs stub.
        assertThat(summary.cveStubsCreated()).isEqualTo(1);
        assertThat(summary.cweStubsCreated()).isEqualTo(2);
        assertThat(summary.originalFilenames()).containsExactly("export-a.csv", "export-b.csv");

        assertThat(findingRepository.countByReportId(summary.reportId())).isEqualTo(3);
        // Attribution: entity_id authoritative; application_id kept for app level.
        assertThat(findingRepository.findByReportId(summary.reportId()))
            .filteredOn(f -> "auto".equals(f.getMatchStatus()))
            .allSatisfy(f -> {
                assertThat(f.getEntityId()).isNotNull();
                assertThat(f.getApplicationId()).isEqualTo(f.getEntityId());
            });
        assertThat(cveRepository.findByCveId("CVE-2024-38808"))
            .hasValueSatisfying(cve ->
                assertThat(cve.getEnrichmentStatus()).isEqualTo("pending"));
        assertThat(cweRepository.findByCweId("CWE-89")).isPresent();

        // The report carries the wizard's per-upload answers for audit + prefill.
        SecurityFindingReportDto prefill = registerService.latestReportForPrefill(projectId);
        assertThat(prefill.columnMapping()).containsEntry("Project Name", "linking_value");
        assertThat(prefill.associationLevel()).isEqualTo("application");
    }

    @Test
    @DisplayName("dedup collapses ONLY a literal duplicate source_finding_id; null ids never collapse; blank linking values are counted dropped")
    void keepAllDedupModel() {
        IngestSecurityFindingsRequest request = new IngestSecurityFindingsRequest(
            null, null, List.of("f.csv"), null, 0, null,
            List.of(
                row("MRX", APP_MRX, "auto", "high", "A", "dup-1", List.of(), List.of()),
                row("MRX", APP_MRX, "auto", "high", "A again", "dup-1", List.of(), List.of()),
                row("MRX", APP_MRX, "auto", "low", "No id 1", null, List.of(), List.of()),
                row("MRX", APP_MRX, "auto", "low", "No id 2", null, List.of(), List.of()),
                row("   ", null, null, "high", "Blank linking value", "x-1",
                    List.of(), List.of())));
        SecurityIngestSummaryDto summary =
            ingestionService.ingest(projectId, architectureId, request);

        assertThat(summary.rowCountIngested()).isEqualTo(3);
        assertThat(summary.rowCountDropped()).isEqualTo(2);
        assertThat(summary.notes()).contains("dropped_duplicates=1", "dropped_unparseable=1");
    }

    @Test
    @DisplayName("re-upload demotes the prior latest snapshot; history retains both; register + rollup read the new latest by default")
    void snapshotListLifecycle() {
        SecurityIngestSummaryDto first = ingestStandardReport();
        IngestSecurityFindingsRequest second = new IngestSecurityFindingsRequest(
            "gitlab_export", "application", List.of("fresh.csv"), null, 0, null,
            List.of(row("MRX", APP_MRX, "auto", "low", "Only finding", "2000001",
                List.of(), List.of())));
        SecurityIngestSummaryDto latest =
            ingestionService.ingest(projectId, architectureId, second);

        assertThat(reportRepository.findById(first.reportId()))
            .hasValueSatisfying(r -> assertThat(r.getIsLatest()).isFalse());
        assertThat(registerService.listReportHistory(projectId, architectureId))
            .hasSize(2)
            .first()
            .satisfies(r -> assertThat(r.id()).isEqualTo(latest.reportId()));

        SecurityRegisterResponse register = registerByApp(null, null, null);
        assertThat(register.total()).isEqualTo(1);

        // History stays addressable: the demoted report still serves by id.
        SecurityRegisterResponse historic = registerService.register(
            projectId, architectureId, first.reportId(),
            null, null, null, null, null, null, null, 0, 50);
        assertThat(historic.total()).isEqualTo(3);
    }

    @Test
    @DisplayName("register flattens with provenance-named columns, resolves application names live, honours filters + the column-set parameter")
    void registerFlatteningAndParameterization() {
        ingestStandardReport();

        SecurityRegisterResponse all = registerByApp(null, null, null);
        assertThat(all.total()).isEqualTo(3);
        assertThat(all.columns()).isEqualTo(SecurityRegisterService.DEFAULT_COLUMNS);
        Map<String, Object> mrxRow = all.data().stream()
            .filter(r -> "MRX".equals(r.get("application_name")))
            .findFirst().orElseThrow();
        assertThat(mrxRow.get("severity_reported")).isEqualTo("high");
        assertThat(mrxRow.get("match_status")).isEqualTo("auto");
        assertThat(mrxRow.get("cve_ids")).isEqualTo(List.of("CVE-2024-38808"));
        // CWE stub has no name in tests (no seed) -> id-only fallback.
        assertThat(mrxRow.get("cwe_names")).isEqualTo(List.of("CWE-770"));
        // Application-level rows carry no component/service ancestry.
        assertThat(mrxRow.get("service_name")).isNull();
        assertThat(mrxRow.get("application_component_name")).isNull();

        SecurityRegisterResponse unmatchedOnly = registerByApp(null, "unmatched", null);
        assertThat(unmatchedOnly.total()).isEqualTo(1);
        assertThat(unmatchedOnly.data().get(0).get("application_name")).isNull();

        SecurityRegisterResponse byApp = registerByApp(APP_HIFI, null, null);
        assertThat(byApp.total()).isEqualTo(1);
        assertThat(byApp.data().get(0).get("linking_value")).isEqualTo("HiFi");

        SecurityRegisterResponse narrow = registerByApp(null, null,
            List.of("finding_id", "severity_reported", "no_such_column"));
        assertThat(narrow.columns()).containsExactly("finding_id", "severity_reported");
        assertThat(narrow.data().get(0).keySet())
            .containsExactly("finding_id", "severity_reported");
    }

    @Test
    @DisplayName("service-level attribution: ancestors resolved live on the register; entity filters expand ancestor-aware; rollup is level-generic")
    void serviceLevelAttributionAndAncestry() {
        ingestServiceLevelReport();

        // Register rows resolve the full ancestor chain from the live model.
        SecurityRegisterResponse all = registerByApp(null, null, null);
        assertThat(all.total()).isEqualTo(3);
        Map<String, Object> payRow = all.data().stream()
            .filter(r -> "payments".equals(r.get("service_name")))
            .findFirst().orElseThrow();
        assertThat(payRow.get("application_name")).isEqualTo("MRX");
        assertThat(payRow.get("application_component_name")).isEqualTo("Core");
        Map<String, Object> webRow = all.data().stream()
            .filter(r -> "web".equals(r.get("service_name")))
            .findFirst().orElseThrow();
        assertThat(webRow.get("application_name")).isEqualTo("HiFi");
        assertThat(webRow.get("application_component_name")).isNull();

        // Ancestor-aware filters: an application filter matches its services'
        // findings; component and service filters narrow further.
        assertThat(registerByApp(APP_MRX, null, null).total()).isEqualTo(1);
        assertThat(registerByApp(APP_HIFI, null, null).total()).isEqualTo(1);
        assertThat(registerService.register(projectId, architectureId, null,
            null, COMP_CORE, null, null, null, null, null, 0, 50).total()).isEqualTo(1);
        assertThat(registerService.register(projectId, architectureId, null,
            null, null, SVC_WEB, null, null, null, null, 0, 50).total()).isEqualTo(1);
        // Most specific wins: service filter beats a contradictory app filter.
        assertThat(registerService.register(projectId, architectureId, null,
            APP_MRX, null, SVC_WEB, null, null, null, null, 0, 50).total()).isEqualTo(1);

        // Repo location surfaces via the column vocabulary.
        SecurityRegisterResponse withRepo = registerByApp(APP_MRX, null,
            List.of("service_name", "service_repo_location"));
        assertThat(withRepo.data().get(0).get("service_repo_location"))
            .isEqualTo("https://gitlab.example.com/grh/payments.git");

        // Level-generic rollup: entities carry level + ancestor ids; the
        // pre-213 applications list stays EMPTY for non-application levels.
        SecurityRollupDto rollup = registerService.rollup(projectId, architectureId, null);
        assertThat(rollup.associationLevel()).isEqualTo("service");
        assertThat(rollup.applications()).isEmpty();
        assertThat(rollup.entities())
            .anySatisfy(e -> {
                assertThat(e.entityId()).isEqualTo(SVC_PAY);
                assertThat(e.level()).isEqualTo("service");
                assertThat(e.entityName()).isEqualTo("payments");
                assertThat(e.applicationId()).isEqualTo(APP_MRX);
                assertThat(e.applicationComponentId()).isEqualTo(COMP_CORE);
                assertThat(e.counts()).containsEntry("high", 1L);
            })
            .anySatisfy(e -> {
                assertThat(e.entityId()).isEqualTo(SVC_WEB);
                assertThat(e.applicationId()).isEqualTo(APP_HIFI);
                assertThat(e.applicationComponentId()).isNull();
            });
        assertThat(rollup.unmatched()).containsEntry("critical", 1L);

        // Back-compat invariant: service-level rows never write application_id.
        assertThat(findingRepository.findByReportId(rollup.reportId()))
            .allSatisfy(f -> assertThat(f.getApplicationId()).isNull());
    }

    @Test
    @DisplayName("CVE enrichment fills the world-fact record and surfaces on the register; findings' reported copy is untouched; absence degrades gracefully")
    void enrichmentGrace() {
        ingestStandardReport();

        // Before enrichment: register works on stubs (official columns null).
        SecurityRegisterResponse before = registerByApp(APP_MRX, null,
            List.of("severity_reported", "cve_severity_official", "cve_enrichment_status"));
        assertThat(before.data().get(0).get("cve_severity_official")).isNull();
        assertThat(before.data().get(0).get("cve_enrichment_status")).isEqualTo("pending");

        referenceService.applyCveEnrichment("CVE-2024-38808", new CveEnrichmentRequest(
            "Spring Framework DoS", "Long description",
            "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L", new BigDecimal("5.3"),
            "medium", List.of("CWE-770"), List.of("GHSA-9cmq"), List.of("https://osv.dev/x"),
            null, null, Boolean.FALSE, null, "osv", null));

        SecurityRegisterResponse after = registerByApp(APP_MRX, null,
            List.of("severity_reported", "cve_severity_official", "cve_enrichment_status"));
        // Reported copy untouched; official lens now filled.
        assertThat(after.data().get(0).get("severity_reported")).isEqualTo("high");
        assertThat(after.data().get(0).get("cve_severity_official")).isEqualTo("medium");
        assertThat(after.data().get(0).get("cve_enrichment_status")).isEqualTo("enriched");

        CveEntity cve = cveRepository.findByCveId("CVE-2024-38808").orElseThrow();
        assertThat(cve.getEnrichmentStatus()).isEqualTo("enriched");
        assertThat(cve.getSummary()).isEqualTo("Spring Framework DoS");
        // Enrichment queue no longer offers it.
        assertThat(referenceService.listPendingCves(10))
            .noneMatch(dto -> dto.cveId().equals("CVE-2024-38808"));
    }

    @Test
    @DisplayName("rollup groups severity counts per application (live names) with the Not-matched bucket and grand totals")
    void rollupForOverviewCircles() {
        ingestStandardReport();

        SecurityRollupDto rollup = registerService.rollup(projectId, architectureId, null);
        assertThat(rollup.associationLevel()).isEqualTo("application");
        // Pre-213 shape still served for application-level reports...
        assertThat(rollup.applications())
            .anySatisfy(e -> {
                assertThat(e.applicationName()).isEqualTo("MRX");
                assertThat(e.counts()).containsEntry("high", 1L);
            })
            .anySatisfy(e -> {
                assertThat(e.applicationName()).isEqualTo("HiFi");
                assertThat(e.counts()).containsEntry("medium", 1L);
            });
        // ...and the level-generic entities list mirrors it.
        assertThat(rollup.entities())
            .anySatisfy(e -> {
                assertThat(e.level()).isEqualTo("application");
                assertThat(e.entityId()).isEqualTo(APP_MRX);
                assertThat(e.applicationId()).isEqualTo(APP_MRX);
            });
        assertThat(rollup.unmatched()).containsEntry("critical", 1L);
        assertThat(rollup.totals())
            .containsEntry("high", 1L)
            .containsEntry("medium", 1L)
            .containsEntry("critical", 1L);

        // Empty scope degrades to an empty rollup, never an error.
        SecurityRollupDto empty = registerService.rollup(UUID.randomUUID(), architectureId, null);
        assertThat(empty.reportId()).isNull();
        assertThat(empty.entities()).isEmpty();
        assertThat(empty.applications()).isEmpty();
    }

    @Test
    @DisplayName("alias memory: batch upsert teaches pairings, re-teaching updates in place, list is level-scoped")
    void aliasMemory() {
        List<SecurityLinkingAliasDto> taught = aliasService.upsert(projectId,
            new UpsertSecurityAliasesRequest("application", List.of(
                new UpsertSecurityAliasesRequest.AliasPair("MRX (Risk)", APP_MRX, "MRX"),
                new UpsertSecurityAliasesRequest.AliasPair("HiFi Prod", APP_HIFI, "HiFi"),
                new UpsertSecurityAliasesRequest.AliasPair("  ", APP_HIFI, "skipped"))));
        assertThat(taught).hasSize(2);

        // Aliases are level-scoped: teaching at service level is independent.
        aliasService.upsert(projectId,
            new UpsertSecurityAliasesRequest("service", List.of(
                new UpsertSecurityAliasesRequest.AliasPair("grh/payments", SVC_PAY, "payments"))));
        assertThat(aliasService.list(projectId, "application")).hasSize(2);
        assertThat(aliasService.list(projectId, "service")).hasSize(1);

        // Re-teach one alias to a different entity: updated, not duplicated.
        aliasService.upsert(projectId,
            new UpsertSecurityAliasesRequest("application", List.of(
                new UpsertSecurityAliasesRequest.AliasPair("MRX (Risk)", APP_HIFI, "HiFi"))));
        List<SecurityLinkingAliasDto> listed = aliasService.list(projectId, "application");
        assertThat(listed).hasSize(2);
        assertThat(listed).filteredOn(a -> a.aliasValue().equals("MRX (Risk)"))
            .singleElement()
            .satisfies(a -> assertThat(a.entityId()).isEqualTo(APP_HIFI));
    }
}
