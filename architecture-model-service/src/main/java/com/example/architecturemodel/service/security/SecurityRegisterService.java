package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityRegisterResponse;
import com.example.architecturemodel.model.dto.security.SecurityRollupDto;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.security.CveEntity;
import com.example.architecturemodel.model.entity.security.CweEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingCveEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingCweEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingReportEntity;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.security.CveRepository;
import com.example.architecturemodel.repository.security.CweRepository;
import com.example.architecturemodel.repository.security.SecurityFindingCveRepository;
import com.example.architecturemodel.repository.security.SecurityFindingCweRepository;
import com.example.architecturemodel.repository.security.SecurityFindingReportRepository;
import com.example.architecturemodel.repository.security.SecurityFindingRepository;
import com.example.architecturemodel.service.vulnerability.VulnerabilitySeverityNormalizer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The Findings Register + Security Overview rollup reads (Security health
 * dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p><b>This service is the ONE deliberate flattening point</b> of the
 * structured store (findings + M:N joins + world-fact CVE/CWE records +
 * live application names). Provenance is carried in the flattened key names:
 * {@code severity_reported} (the scanner's copy) vs
 * {@code cve_severity_official} (the world's copy) -- divergence stays
 * visible. Nothing else in the codebase may re-flatten these tables.</p>
 *
 * <p>The register endpoint is parameterized on filters AND the column set from
 * day one (register UI-configurability later is pure client work). Application
 * names are resolved LIVE from the model (never denormalized onto findings),
 * so renames don't drift.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SecurityRegisterService {

    /** The full flattened column vocabulary, in default display order. */
    public static final List<String> ALL_COLUMNS = List.of(
        "finding_id",
        "application_id",
        "application_name",
        "linking_value",
        "level",
        "match_status",
        "severity_reported",
        "severity_raw",
        "title",
        "description",
        "detected_at",
        "location",
        "source_path",
        "cvss_vector_reported",
        "source_finding_id",
        "other_identifiers",
        "cve_ids",
        "cwe_ids",
        "cwe_names",
        "cve_summary",
        "cve_severity_official",
        "cve_cvss_score",
        "cve_enrichment_status");

    /** The v1 register screen's fixed default column set. */
    public static final List<String> DEFAULT_COLUMNS = List.of(
        "finding_id",
        "application_name",
        "linking_value",
        "match_status",
        "severity_reported",
        "title",
        "cve_ids",
        "cwe_ids",
        "cwe_names",
        "cve_severity_official",
        "location",
        "detected_at");

    private final SecurityFindingReportRepository reportRepository;
    private final SecurityFindingRepository findingRepository;
    private final SecurityFindingCveRepository findingCveRepository;
    private final SecurityFindingCweRepository findingCweRepository;
    private final CveRepository cveRepository;
    private final CweRepository cweRepository;
    private final ApplicationRepository applicationRepository;

    /**
     * The parameterized register query. {@code reportId} null = latest report;
     * null filters are skipped; {@code columns} null/empty = default set.
     */
    @Transactional(readOnly = true)
    public SecurityRegisterResponse register(UUID projectId,
                                             UUID architectureId,
                                             UUID reportId,
                                             String applicationId,
                                             String matchStatus,
                                             String severity,
                                             String text,
                                             List<String> columns,
                                             int page,
                                             int size) {
        List<String> effectiveColumns = effectiveColumns(columns);
        Optional<SecurityFindingReportEntity> report =
            resolveReport(projectId, architectureId, reportId);
        if (report.isEmpty()) {
            return new SecurityRegisterResponse(List.of(), 0, page, size, effectiveColumns);
        }
        int cappedSize = Math.max(1, Math.min(size, 500));
        Page<SecurityFindingEntity> findings = findingRepository.search(
            report.get().getId(),
            trimToNull(applicationId),
            trimToNull(matchStatus),
            trimToNull(severity),
            null,
            trimToNull(text),
            PageRequest.of(Math.max(0, page), cappedSize));

        List<UUID> findingIds = findings.getContent().stream()
            .map(SecurityFindingEntity::getId)
            .toList();

        Map<UUID, List<String>> cvesByFinding = new HashMap<>();
        Map<UUID, List<String>> cwesByFinding = new HashMap<>();
        Set<String> allCveIds = new LinkedHashSet<>();
        Set<String> allCweIds = new LinkedHashSet<>();
        if (!findingIds.isEmpty()) {
            for (SecurityFindingCveEntity join : findingCveRepository.findByFindingIdIn(findingIds)) {
                cvesByFinding.computeIfAbsent(join.getFindingId(), k -> new ArrayList<>())
                    .add(join.getCveId());
                allCveIds.add(join.getCveId());
            }
            for (SecurityFindingCweEntity join : findingCweRepository.findByFindingIdIn(findingIds)) {
                cwesByFinding.computeIfAbsent(join.getFindingId(), k -> new ArrayList<>())
                    .add(join.getCweId());
                allCweIds.add(join.getCweId());
            }
        }
        Map<String, CveEntity> cvesById = allCveIds.isEmpty() ? Map.of()
            : cveRepository.findByCveIdIn(allCveIds).stream()
                .collect(Collectors.toMap(CveEntity::getCveId, c -> c, (a, b) -> a));
        Map<String, CweEntity> cwesById = allCweIds.isEmpty() ? Map.of()
            : cweRepository.findByCweIdIn(allCweIds).stream()
                .collect(Collectors.toMap(CweEntity::getCweId, c -> c, (a, b) -> a));
        Map<String, String> applicationNames = applicationNames(findings.getContent());

        List<Map<String, Object>> rows = new ArrayList<>(findings.getNumberOfElements());
        for (SecurityFindingEntity f : findings.getContent()) {
            rows.add(flatten(f,
                cvesByFinding.getOrDefault(f.getId(), List.of()),
                cwesByFinding.getOrDefault(f.getId(), List.of()),
                cvesById, cwesById, applicationNames, effectiveColumns));
        }
        return new SecurityRegisterResponse(
            rows, findings.getTotalElements(), page, cappedSize, effectiveColumns);
    }

    /**
     * The Security Overview rollup: severity counts per resolved application +
     * the Not-matched bucket, over one report (latest by default). Render-time
     * data for the diagram circles -- never persisted into diagram content.
     */
    @Transactional(readOnly = true)
    public SecurityRollupDto rollup(UUID projectId, UUID architectureId, UUID reportId) {
        Optional<SecurityFindingReportEntity> reportOpt =
            resolveReport(projectId, architectureId, reportId);
        if (reportOpt.isEmpty()) {
            return new SecurityRollupDto(null, null, null, List.of(), Map.of(), Map.of());
        }
        SecurityFindingReportEntity report = reportOpt.get();
        Map<String, Map<String, Long>> byApplication = new LinkedHashMap<>();
        Map<String, Long> unmatched = new TreeMap<>(SecurityRegisterService::severityOrder);
        Map<String, Long> totals = new TreeMap<>(SecurityRegisterService::severityOrder);
        for (Object[] row : findingRepository.rollupByApplicationAndSeverity(report.getId())) {
            String applicationId = (String) row[0];
            String severity = (String) row[1];
            long count = ((Number) row[2]).longValue();
            totals.merge(severity, count, Long::sum);
            if (applicationId == null) {
                unmatched.merge(severity, count, Long::sum);
            } else {
                byApplication
                    .computeIfAbsent(applicationId,
                        k -> new TreeMap<>(SecurityRegisterService::severityOrder))
                    .merge(severity, count, Long::sum);
            }
        }
        Map<String, String> names = applicationRepository.findAllById(byApplication.keySet())
            .stream()
            .collect(Collectors.toMap(ApplicationEntity::getId, a ->
                a.getName() == null ? a.getId() : a.getName(), (a, b) -> a));
        List<SecurityRollupDto.Entry> entries = byApplication.entrySet().stream()
            .map(e -> new SecurityRollupDto.Entry(
                e.getKey(), names.getOrDefault(e.getKey(), e.getKey()), e.getValue()))
            .toList();
        return new SecurityRollupDto(
            report.getId(), report.getUploadedAt(), report.getAssociationLevel(),
            entries, unmatched, totals);
    }

    /** Upload history, newest first (the compact "Load previous" modal). */
    @Transactional(readOnly = true)
    public List<SecurityFindingReportDto> listReportHistory(UUID projectId, UUID architectureId) {
        return reportRepository
            .findByProjectIdAndArchitectureIdOrderByUploadedAtDesc(projectId, architectureId)
            .stream()
            .map(SecurityFindingReportDto::from)
            .toList();
    }

    /**
     * The wizard's prefill source: the most recent report for the project
     * (column mapping + association level). Null when the project has none.
     */
    @Transactional(readOnly = true)
    public SecurityFindingReportDto latestReportForPrefill(UUID projectId) {
        return reportRepository.findFirstByProjectIdOrderByUploadedAtDesc(projectId)
            .map(SecurityFindingReportDto::from)
            .orElse(null);
    }

    // ---------------------------------------------------------------------

    private Optional<SecurityFindingReportEntity> resolveReport(UUID projectId,
                                                                UUID architectureId,
                                                                UUID reportId) {
        if (reportId != null) {
            return reportRepository.findById(reportId)
                .filter(r -> projectId.equals(r.getProjectId())
                    && architectureId.equals(r.getArchitectureId()));
        }
        return reportRepository.findFirstByProjectIdAndArchitectureIdAndIsLatestTrue(
            projectId, architectureId);
    }

    private Map<String, String> applicationNames(List<SecurityFindingEntity> findings) {
        Set<String> ids = findings.stream()
            .map(SecurityFindingEntity::getApplicationId)
            .filter(id -> id != null && !id.isBlank())
            .collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        return applicationRepository.findAllById(ids).stream()
            .collect(Collectors.toMap(ApplicationEntity::getId, a ->
                a.getName() == null ? a.getId() : a.getName(), (a, b) -> a));
    }

    /**
     * Flatten one finding into an ordered register row containing ONLY the
     * requested columns. The {@code cve_*} columns aggregate over the finding's
     * CVEs: summary from the first enriched record, official severity = the
     * HIGHEST across them (worst-case lens), enrichment status = enriched if
     * any is.
     */
    private static Map<String, Object> flatten(SecurityFindingEntity f,
                                               List<String> cveIds,
                                               List<String> cweIds,
                                               Map<String, CveEntity> cvesById,
                                               Map<String, CweEntity> cwesById,
                                               Map<String, String> applicationNames,
                                               List<String> columns) {
        String cveSummary = null;
        String cveSeverityOfficial = null;
        Object cveCvssScore = null;
        String cveEnrichmentStatus = cveIds.isEmpty() ? null : "pending";
        for (String cveId : cveIds) {
            CveEntity cve = cvesById.get(cveId);
            if (cve == null) {
                continue;
            }
            if (cveSummary == null && cve.getSummary() != null) {
                cveSummary = cve.getSummary();
            }
            if (cve.getSeverityOfficial() != null
                && severityRank(cve.getSeverityOfficial()) > severityRank(cveSeverityOfficial)) {
                cveSeverityOfficial = cve.getSeverityOfficial();
                cveCvssScore = cve.getCvssScore();
            } else if (cveCvssScore == null && cve.getCvssScore() != null) {
                cveCvssScore = cve.getCvssScore();
            }
            if ("enriched".equals(cve.getEnrichmentStatus())) {
                cveEnrichmentStatus = "enriched";
            }
        }
        List<String> cweNames = new ArrayList<>();
        for (String cweId : cweIds) {
            CweEntity cwe = cwesById.get(cweId);
            cweNames.add(cwe != null && cwe.getName() != null
                ? cweId + " " + cwe.getName() : cweId);
        }

        Map<String, Object> all = new LinkedHashMap<>();
        all.put("finding_id", f.getId());
        all.put("application_id", f.getApplicationId());
        all.put("application_name", f.getApplicationId() == null
            ? null : applicationNames.getOrDefault(f.getApplicationId(), f.getApplicationId()));
        all.put("linking_value", f.getLinkingValue());
        all.put("level", f.getLevel());
        all.put("match_status", f.getMatchStatus());
        all.put("severity_reported", f.getSeverity());
        all.put("severity_raw", f.getSeverityRaw());
        all.put("title", f.getTitle());
        all.put("description", f.getDescription());
        all.put("detected_at", f.getDetectedAt());
        all.put("location", f.getLocation());
        all.put("source_path", f.getSourcePath());
        all.put("cvss_vector_reported", f.getCvssVectorReported());
        all.put("source_finding_id", f.getSourceFindingId());
        all.put("other_identifiers", f.getOtherIdentifiers());
        all.put("cve_ids", cveIds);
        all.put("cwe_ids", cweIds);
        all.put("cwe_names", cweNames);
        all.put("cve_summary", cveSummary);
        all.put("cve_severity_official", cveSeverityOfficial);
        all.put("cve_cvss_score", cveCvssScore);
        all.put("cve_enrichment_status", cveEnrichmentStatus);

        Map<String, Object> row = new LinkedHashMap<>();
        for (String column : columns) {
            row.put(column, all.get(column));
        }
        return row;
    }

    /** Requested columns filtered to the known vocabulary; empty result falls back to the default set. */
    private static List<String> effectiveColumns(List<String> requested) {
        if (requested == null || requested.isEmpty()) {
            return DEFAULT_COLUMNS;
        }
        List<String> known = requested.stream()
            .filter(c -> c != null && ALL_COLUMNS.contains(c.trim()))
            .map(String::trim)
            .distinct()
            .toList();
        return known.isEmpty() ? DEFAULT_COLUMNS : known;
    }

    private static int severityRank(String severity) {
        if (severity == null) {
            return -1;
        }
        return VulnerabilitySeverityNormalizer.LADDER.indexOf(severity);
    }

    /** TreeMap comparator: severities keyed worst-first for stable wire order. */
    private static int severityOrder(String a, String b) {
        return Integer.compare(severityRank(b), severityRank(a));
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
