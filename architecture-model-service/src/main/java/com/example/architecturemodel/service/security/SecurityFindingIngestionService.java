package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.IngestSecurityFindingRowDto;
import com.example.architecturemodel.model.dto.security.IngestSecurityFindingsRequest;
import com.example.architecturemodel.model.dto.security.SecurityIngestSummaryDto;
import com.example.architecturemodel.model.entity.security.SecurityFindingCveEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingCweEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingReportEntity;
import com.example.architecturemodel.repository.security.SecurityFindingCveRepository;
import com.example.architecturemodel.repository.security.SecurityFindingCweRepository;
import com.example.architecturemodel.repository.security.SecurityFindingReportRepository;
import com.example.architecturemodel.repository.security.SecurityFindingRepository;
import com.example.architecturemodel.service.vulnerability.VulnerabilitySeverityNormalizer;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Deterministic ingestion for the department-level security store (Security
 * health dashboard, 2026-07-19, Spec 1 of 3).
 *
 * <p>The gateway has already parsed each file, appended the normalized rows
 * (multi-file upload = ONE report) and resolved attribution through the wizard
 * (application id + match status via exact match / alias / manual pick). This
 * service runs ONLY deterministic work:</p>
 *
 * <ol>
 *   <li>demote the prior latest report for {@code (project, architecture)}
 *       (snapshot-list lifecycle -- history retained, no deletes);</li>
 *   <li>defensive severity normalization (raw preserved);</li>
 *   <li>within-report dedup ONLY on a literal duplicate
 *       {@code source_finding_id} (mirrors the migration-workflow keep-all
 *       model); null ids never collapse;</li>
 *   <li>persist findings + M:N CVE/CWE join rows (by identifier string);</li>
 *   <li>upsert PENDING world-fact stubs for unseen CVE/CWE ids via
 *       {@link SecurityReferenceService} -- enrichment never blocks ingest.</li>
 * </ol>
 *
 * <p>No-silent-drop: every dropped row is counted into
 * {@code row_count_dropped} and summarized in {@code notes}.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class SecurityFindingIngestionService {

    private static final String DEFAULT_SOURCE = "gitlab_export";
    private static final String DEFAULT_LEVEL = "application";

    private final SecurityFindingReportRepository reportRepository;
    private final SecurityFindingRepository findingRepository;
    private final SecurityFindingCveRepository findingCveRepository;
    private final SecurityFindingCweRepository findingCweRepository;
    private final SecurityReferenceService referenceService;

    /**
     * Ingest one wizard-completed upload (all files appended) as a new latest
     * report snapshot.
     */
    @Transactional
    public SecurityIngestSummaryDto ingest(UUID projectId,
                                           UUID architectureId,
                                           IngestSecurityFindingsRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("Security findings ingest request body is required");
        }
        String source = blankToDefault(request.source(), DEFAULT_SOURCE);
        String level = blankToDefault(request.associationLevel(), DEFAULT_LEVEL);
        List<IngestSecurityFindingRowDto> rows =
            request.rows() == null ? List.of() : request.rows();
        int rowsReceived = rows.size();
        int parserDropped = request.parserDroppedCount() == null
            ? 0 : Math.max(0, request.parserDroppedCount());

        // 1) Demote the prior latest snapshot for this (project, architecture).
        Optional<SecurityFindingReportEntity> priorLatest =
            reportRepository.findFirstByProjectIdAndArchitectureIdAndIsLatestTrue(
                projectId, architectureId);
        priorLatest.ifPresent(prior -> {
            prior.setIsLatest(false);
            reportRepository.save(prior);
            log.debug("Security ingest: demoted prior latest report {} "
                + "(project={}, architecture={})", prior.getId(), projectId, architectureId);
        });

        // 2) Insert the new latest report row (counts filled after persistence).
        UUID reportId = UUID.randomUUID();
        SecurityFindingReportEntity report = SecurityFindingReportEntity.builder()
            .id(reportId)
            .projectId(projectId)
            .architectureId(architectureId)
            .source(source)
            .associationLevel(level)
            .originalFilenames(request.originalFilenames() == null
                ? new ArrayList<>() : new ArrayList<>(request.originalFilenames()))
            .columnMapping(request.columnMapping())
            .isLatest(Boolean.TRUE)
            .build();

        // 3) Normalize + literal-duplicate dedup, keeping ALL other rows.
        Map<String, SecurityFindingEntity> firstByKey = new LinkedHashMap<>();
        Map<UUID, List<String>> cvesByFinding = new LinkedHashMap<>();
        Map<UUID, List<String>> cwesByFinding = new LinkedHashMap<>();
        Set<String> distinctCves = new LinkedHashSet<>();
        Set<String> distinctCwes = new LinkedHashSet<>();
        int droppedDuplicates = 0;
        int droppedUnparseable = parserDropped;
        int matchedCount = 0;
        int unmatchedCount = 0;

        for (int i = 0; i < rows.size(); i++) {
            IngestSecurityFindingRowDto row = rows.get(i);
            if (row == null || isBlank(row.linkingValue())) {
                // A row with no linking value cannot be attributed OR bucketed
                // by application -- it is a parse anomaly, counted, never silent.
                droppedUnparseable++;
                continue;
            }
            String dedupKey = dedupKey(row, i);
            if (firstByKey.containsKey(dedupKey)) {
                droppedDuplicates++;
                continue;
            }
            String matchStatus = normalizeMatchStatus(row.matchStatus(), row.applicationId());
            if ("unmatched".equals(matchStatus)) {
                unmatchedCount++;
            } else {
                matchedCount++;
            }
            SecurityFindingEntity entity = toEntity(
                projectId, architectureId, reportId, level, row, matchStatus);
            firstByKey.put(dedupKey, entity);

            List<String> cveIds = normalizedIdentifierList(row.cveIds());
            List<String> cweIds = normalizedIdentifierList(row.cweIds());
            if (!cveIds.isEmpty()) {
                cvesByFinding.put(entity.getId(), cveIds);
                distinctCves.addAll(cveIds);
            }
            if (!cweIds.isEmpty()) {
                cwesByFinding.put(entity.getId(), cweIds);
                distinctCwes.addAll(cweIds);
            }
        }

        // 4) Persist report + findings + join rows.
        int ingestedCount = firstByKey.size();
        int totalDropped = droppedDuplicates + droppedUnparseable;
        report.setRowCountIngested(ingestedCount);
        report.setRowCountDropped(totalDropped);
        report.setNotes(buildNotes(rowsReceived, ingestedCount, droppedDuplicates,
            droppedUnparseable, matchedCount, unmatchedCount, request.parserNotes()));
        reportRepository.save(report);

        if (!firstByKey.isEmpty()) {
            findingRepository.saveAll(new ArrayList<>(firstByKey.values()));
        }
        List<SecurityFindingCveEntity> cveJoins = new ArrayList<>();
        cvesByFinding.forEach((findingId, ids) -> ids.forEach(cveId ->
            cveJoins.add(SecurityFindingCveEntity.builder()
                .id(UUID.randomUUID())
                .findingId(findingId)
                .cveId(cveId)
                .build())));
        if (!cveJoins.isEmpty()) {
            findingCveRepository.saveAll(cveJoins);
        }
        List<SecurityFindingCweEntity> cweJoins = new ArrayList<>();
        cwesByFinding.forEach((findingId, ids) -> ids.forEach(cweId ->
            cweJoins.add(SecurityFindingCweEntity.builder()
                .id(UUID.randomUUID())
                .findingId(findingId)
                .cweId(cweId)
                .build())));
        if (!cweJoins.isEmpty()) {
            findingCweRepository.saveAll(cweJoins);
        }

        // 5) World-fact stubs for unseen identifiers (pending; never blocks).
        int cveStubs = referenceService.ensureCveStubs(distinctCves);
        int cweStubs = referenceService.ensureCweStubs(distinctCwes);

        findingRepository.flush();

        log.info("Security ingest complete: project={}, architecture={}, reportId={}, "
            + "level={}, files={}, rowsReceived={}, ingested={}, droppedDuplicates={}, "
            + "droppedUnparseable={}, matched={}, unmatched={}, distinctCves={}, "
            + "distinctCwes={}, cveStubs={}, cweStubs={}",
            projectId, architectureId, reportId, level,
            report.getOriginalFilenames().size(), rowsReceived, ingestedCount,
            droppedDuplicates, droppedUnparseable, matchedCount, unmatchedCount,
            distinctCves.size(), distinctCwes.size(), cveStubs, cweStubs);

        return new SecurityIngestSummaryDto(
            reportId, source, level, report.getUploadedAt(),
            report.getOriginalFilenames(), rowsReceived, ingestedCount, totalDropped,
            matchedCount, unmatchedCount, distinctCves.size(), distinctCwes.size(),
            cveStubs, cweStubs, report.getNotes());
    }

    // ---------------------------------------------------------------------

    private static String dedupKey(IngestSecurityFindingRowDto row, int rowIndex) {
        String findingId = trimToNull(row.sourceFindingId());
        if (findingId != null) {
            return "finding " + findingId.toLowerCase();
        }
        return "row " + rowIndex;
    }

    /**
     * Attribution invariant: a row with a resolved application id is matched
     * ({@code auto} unless the wizard says {@code manual}); a row without one
     * is {@code unmatched} regardless of what the payload claims.
     */
    private static String normalizeMatchStatus(String claimed, String applicationId) {
        if (isBlank(applicationId)) {
            return "unmatched";
        }
        return "manual".equalsIgnoreCase(trimToEmpty(claimed)) ? "manual" : "auto";
    }

    private static SecurityFindingEntity toEntity(UUID projectId,
                                                  UUID architectureId,
                                                  UUID reportId,
                                                  String level,
                                                  IngestSecurityFindingRowDto row,
                                                  String matchStatus) {
        String severity = VulnerabilitySeverityNormalizer.normalize(row.severityRaw());
        return SecurityFindingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .architectureId(architectureId)
            .reportId(reportId)
            .linkingValue(row.linkingValue().trim())
            .level(level)
            .applicationId("unmatched".equals(matchStatus)
                ? null : trimToNull(row.applicationId()))
            .matchStatus(matchStatus)
            .severity(severity)
            .severityRaw(trimToNull(row.severityRaw()))
            .title(trimToNull(row.title()))
            .description(trimToNull(row.description()))
            .detectedAt(row.detectedAt())
            .location(trimToNull(row.location()))
            .sourcePath(trimToNull(row.sourcePath()))
            .cvssVectorReported(trimToNull(row.cvssVectorReported()))
            .sourceFindingId(trimToNull(row.sourceFindingId()))
            .otherIdentifiers(row.otherIdentifiers() == null
                ? new ArrayList<>() : new ArrayList<>(row.otherIdentifiers()))
            .build();
    }

    /** Uppercase-trim identifier cells; drop blanks; preserve first-seen order. */
    private static List<String> normalizedIdentifierList(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<String> out = new LinkedHashSet<>();
        for (String id : ids) {
            String t = trimToNull(id);
            if (t != null) {
                out.add(t.toUpperCase());
            }
        }
        return new ArrayList<>(out);
    }

    private static String buildNotes(int rowsReceived,
                                     int ingestedCount,
                                     int droppedDuplicates,
                                     int droppedUnparseable,
                                     int matchedCount,
                                     int unmatchedCount,
                                     String parserNotes) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ingest: received=").append(rowsReceived)
          .append(", ingested=").append(ingestedCount)
          .append(", dropped_duplicates=").append(droppedDuplicates)
          .append(", dropped_unparseable=").append(droppedUnparseable)
          .append(", matched=").append(matchedCount)
          .append(", unmatched=").append(unmatchedCount)
          .append('.');
        if (parserNotes != null && !parserNotes.isBlank()) {
            sb.append(" Parser notes: ").append(parserNotes.trim());
        }
        return sb.toString();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static String trimToEmpty(String s) {
        return s == null ? "" : s.trim();
    }

    private static String blankToDefault(String s, String fallback) {
        return (s == null || s.isBlank()) ? fallback : s.trim();
    }
}
