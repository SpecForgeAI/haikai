package com.example.architecturemodel.service.security;

import com.example.architecturemodel.model.dto.security.SecurityFindingReportDto;
import com.example.architecturemodel.model.dto.security.SecurityRegisterResponse;
import com.example.architecturemodel.model.dto.security.SecurityRollupDto;
import com.example.architecturemodel.model.entity.ApplicationEntity;
import com.example.architecturemodel.model.entity.ApplicationComponentEntity;
import com.example.architecturemodel.model.entity.ServiceEntity;
import com.example.architecturemodel.model.entity.security.CveEntity;
import com.example.architecturemodel.model.entity.security.CweEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingCveEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingCweEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingEntity;
import com.example.architecturemodel.model.entity.security.SecurityFindingReportEntity;
import com.example.architecturemodel.repository.entity.ApplicationComponentRepository;
import com.example.architecturemodel.repository.entity.ApplicationRepository;
import com.example.architecturemodel.repository.entity.ServiceRepository;
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
 * dashboard, 2026-07-19; entity_id generalization second wave).
 *
 * <p><b>This service is the ONE deliberate flattening point</b> of the
 * structured store (findings + M:N joins + world-fact CVE/CWE records + live
 * entity names). Provenance is carried in the flattened key names
 * ({@code severity_reported} vs {@code cve_severity_official}) -- divergence
 * stays visible. Nothing else in the codebase may re-flatten these tables.</p>
 *
 * <p><b>Level-generic attribution (changeset 213):</b> findings reference a
 * model entity via {@code (level, entity_id)}; names AND the ancestor chain
 * (service -&gt; component -&gt; application) are resolved LIVE from the model
 * on every read, so renames and re-parenting never drift. Register entity
 * filters are ANCESTOR-AWARE: filtering by an application matches findings
 * attributed to any of its descendant components/services.</p>
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
        "entity_id",
        "entity_name",
        "application_id",
        "application_name",
        "application_component_id",
        "application_component_name",
        "service_name",
        "service_repo_location",
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
        "application_component_name",
        "service_name",
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

    /** Hibernate rejects an empty IN list; this sentinel never matches an id. */
    private static final List<String> ENTITY_FILTER_SENTINEL = List.of("__none__");

    private final SecurityFindingReportRepository reportRepository;
    private final SecurityFindingRepository findingRepository;
    private final SecurityFindingCveRepository findingCveRepository;
    private final SecurityFindingCweRepository findingCweRepository;
    private final CveRepository cveRepository;
    private final CweRepository cweRepository;
    private final ApplicationRepository applicationRepository;
    private final ApplicationComponentRepository componentRepository;
    private final ServiceRepository serviceRepository;

    /**
     * The parameterized register query. {@code reportId} null = latest report;
     * null filters are skipped; {@code columns} null/empty = default set.
     * Entity filters narrow ancestor-aware: the most specific of
     * {@code serviceId} &gt; {@code applicationComponentId} &gt;
     * {@code applicationId} wins and expands to its descendant id set.
     */
    @Transactional(readOnly = true)
    public SecurityRegisterResponse register(UUID projectId,
                                             UUID architectureId,
                                             UUID reportId,
                                             String applicationId,
                                             String applicationComponentId,
                                             String serviceId,
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
        Set<String> entityIds = expandEntityFilter(
            trimToNull(applicationId), trimToNull(applicationComponentId), trimToNull(serviceId));
        boolean entityIdsEmpty = entityIds.isEmpty();
        int cappedSize = Math.max(1, Math.min(size, 500));
        Page<SecurityFindingEntity> findings = findingRepository.search(
            report.get().getId(),
            entityIdsEmpty,
            entityIdsEmpty ? ENTITY_FILTER_SENTINEL : entityIds,
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

        Set<String> pageEntityIds = findings.getContent().stream()
            .map(SecurityFindingEntity::getEntityId)
            .filter(id -> id != null && !id.isBlank())
            .collect(Collectors.toSet());
        Map<String, ResolvedEntity> resolved = resolveEntities(pageEntityIds);

        List<Map<String, Object>> rows = new ArrayList<>(findings.getNumberOfElements());
        for (SecurityFindingEntity f : findings.getContent()) {
            rows.add(flatten(f,
                cvesByFinding.getOrDefault(f.getId(), List.of()),
                cwesByFinding.getOrDefault(f.getId(), List.of()),
                cvesById, cwesById, resolved, effectiveColumns));
        }
        return new SecurityRegisterResponse(
            rows, findings.getTotalElements(), page, cappedSize, effectiveColumns);
    }

    /**
     * The Security Overview rollup: severity counts per attributed entity at
     * the report's association level + the Not-matched bucket, over one report
     * (latest by default). Render-time data for the diagram circles -- the
     * frontend aggregates entries to the displayed hierarchy levels
     * (nearest-displayed-ancestor rule) using the model ancestry.
     */
    @Transactional(readOnly = true)
    public SecurityRollupDto rollup(UUID projectId, UUID architectureId, UUID reportId) {
        Optional<SecurityFindingReportEntity> reportOpt =
            resolveReport(projectId, architectureId, reportId);
        if (reportOpt.isEmpty()) {
            return new SecurityRollupDto(null, null, null, List.of(), List.of(), Map.of(), Map.of());
        }
        SecurityFindingReportEntity report = reportOpt.get();
        Map<String, Map<String, Long>> byEntity = new LinkedHashMap<>();
        Map<String, Long> unmatched = new TreeMap<>(SecurityRegisterService::severityOrder);
        Map<String, Long> totals = new TreeMap<>(SecurityRegisterService::severityOrder);
        for (Object[] row : findingRepository.rollupByEntityAndSeverity(report.getId())) {
            String entityId = (String) row[0];
            String severity = (String) row[1];
            long count = ((Number) row[2]).longValue();
            totals.merge(severity, count, Long::sum);
            if (entityId == null) {
                unmatched.merge(severity, count, Long::sum);
            } else {
                byEntity
                    .computeIfAbsent(entityId,
                        k -> new TreeMap<>(SecurityRegisterService::severityOrder))
                    .merge(severity, count, Long::sum);
            }
        }
        Map<String, ResolvedEntity> resolved = resolveEntities(byEntity.keySet());
        String level = report.getAssociationLevel();
        List<SecurityRollupDto.EntityEntry> entities = byEntity.entrySet().stream()
            .map(e -> {
                ResolvedEntity r = resolved.getOrDefault(e.getKey(), ResolvedEntity.unknown(e.getKey()));
                return new SecurityRollupDto.EntityEntry(
                    level, e.getKey(), r.name(), r.applicationId(), r.applicationComponentId(),
                    e.getValue());
            })
            .toList();
        // Pre-213 wire shape, still served for application-level reports.
        List<SecurityRollupDto.Entry> applications = "application".equals(level)
            ? entities.stream()
                .map(e -> new SecurityRollupDto.Entry(e.entityId(), e.entityName(), e.counts()))
                .toList()
            : List.of();
        return new SecurityRollupDto(
            report.getId(), report.getUploadedAt(), level,
            entities, applications, unmatched, totals);
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
    // Entity resolution (live model reads -- never denormalized)
    // ---------------------------------------------------------------------

    /**
     * One attributed entity resolved against the live model: its display name
     * plus the resolved ancestor chain. Unknown ids (entity deleted from the
     * model after ingest) degrade to id-as-name with no ancestors -- findings
     * are never hidden by model drift.
     */
    record ResolvedEntity(
        String entityId,
        String name,
        String applicationId,
        String applicationName,
        String applicationComponentId,
        String applicationComponentName,
        String serviceName,
        String serviceRepoLocation
    ) {
        static ResolvedEntity unknown(String entityId) {
            return new ResolvedEntity(entityId, entityId, null, null, null, null, null, null);
        }
    }

    /**
     * Batch-resolve entity ids against ALL THREE families (application /
     * component / service) -- the id families are disjoint in practice, and a
     * report's level constrains which family its ids come from; resolving
     * against all three keeps this read total even across mixed history.
     */
    private Map<String, ResolvedEntity> resolveEntities(Set<String> entityIds) {
        if (entityIds.isEmpty()) {
            return Map.of();
        }
        Map<String, ApplicationEntity> apps = applicationRepository.findAllById(entityIds).stream()
            .collect(Collectors.toMap(ApplicationEntity::getId, a -> a, (a, b) -> a));
        Map<String, ApplicationComponentEntity> comps =
            componentRepository.findAllById(entityIds).stream()
                .collect(Collectors.toMap(ApplicationComponentEntity::getId, c -> c, (a, b) -> a));
        Map<String, ServiceEntity> services = serviceRepository.findAllById(entityIds).stream()
            .collect(Collectors.toMap(ServiceEntity::getId, s -> s, (a, b) -> a));

        // Ancestor rows referenced by the resolved services/components.
        Set<String> ancestorComponentIds = services.values().stream()
            .map(ServiceEntity::getApplicationComponentId)
            .filter(id -> id != null && !id.isBlank())
            .filter(id -> !comps.containsKey(id))
            .collect(Collectors.toSet());
        Map<String, ApplicationComponentEntity> ancestorComps = ancestorComponentIds.isEmpty()
            ? Map.of()
            : componentRepository.findAllById(ancestorComponentIds).stream()
                .collect(Collectors.toMap(ApplicationComponentEntity::getId, c -> c, (a, b) -> a));
        Set<String> ancestorAppIds = new LinkedHashSet<>();
        services.values().forEach(s -> {
            if (s.getApplicationId() != null) ancestorAppIds.add(s.getApplicationId());
        });
        comps.values().forEach(c -> {
            if (c.getApplicationId() != null) ancestorAppIds.add(c.getApplicationId());
        });
        ancestorComps.values().forEach(c -> {
            if (c.getApplicationId() != null) ancestorAppIds.add(c.getApplicationId());
        });
        ancestorAppIds.removeAll(apps.keySet());
        Map<String, ApplicationEntity> ancestorApps = ancestorAppIds.isEmpty()
            ? Map.of()
            : applicationRepository.findAllById(ancestorAppIds).stream()
                .collect(Collectors.toMap(ApplicationEntity::getId, a -> a, (a, b) -> a));

        java.util.function.Function<String, ApplicationEntity> appOf = id ->
            id == null ? null : apps.getOrDefault(id, ancestorApps.get(id));
        java.util.function.Function<String, ApplicationComponentEntity> compOf = id ->
            id == null ? null : comps.getOrDefault(id, ancestorComps.get(id));

        Map<String, ResolvedEntity> out = new HashMap<>();
        for (String id : entityIds) {
            ApplicationEntity app = apps.get(id);
            if (app != null) {
                out.put(id, new ResolvedEntity(id, nameOf(app.getName(), id),
                    app.getId(), nameOf(app.getName(), id), null, null, null, null));
                continue;
            }
            ApplicationComponentEntity comp = comps.get(id);
            if (comp != null) {
                ApplicationEntity parent = appOf.apply(comp.getApplicationId());
                out.put(id, new ResolvedEntity(id, nameOf(comp.getName(), id),
                    comp.getApplicationId(),
                    parent != null ? nameOf(parent.getName(), comp.getApplicationId()) : comp.getApplicationId(),
                    comp.getId(), nameOf(comp.getName(), id), null, null));
                continue;
            }
            ServiceEntity service = services.get(id);
            if (service != null) {
                ApplicationComponentEntity parentComp = compOf.apply(service.getApplicationComponentId());
                String appId = service.getApplicationId() != null
                    ? service.getApplicationId()
                    : parentComp != null ? parentComp.getApplicationId() : null;
                ApplicationEntity parentApp = appOf.apply(appId);
                out.put(id, new ResolvedEntity(id, nameOf(service.getName(), id),
                    appId,
                    parentApp != null ? nameOf(parentApp.getName(), appId) : appId,
                    service.getApplicationComponentId(),
                    parentComp != null ? nameOf(parentComp.getName(), null) : null,
                    nameOf(service.getName(), id),
                    service.getRepoLocation()));
                continue;
            }
            out.put(id, ResolvedEntity.unknown(id));
        }
        return out;
    }

    /**
     * Expand the register's entity filter ancestor-aware. Most specific wins:
     * service &gt; component &gt; application. An application expands to
     * itself + its components + its services; a component to itself + its
     * services. Empty set = no entity filter.
     */
    private Set<String> expandEntityFilter(String applicationId,
                                           String applicationComponentId,
                                           String serviceId) {
        Set<String> out = new LinkedHashSet<>();
        if (serviceId != null) {
            out.add(serviceId);
            return out;
        }
        if (applicationComponentId != null) {
            out.add(applicationComponentId);
            serviceRepository.findByApplicationComponentId(applicationComponentId)
                .forEach(s -> out.add(s.getId()));
            return out;
        }
        if (applicationId != null) {
            out.add(applicationId);
            componentRepository.findByApplicationId(applicationId)
                .forEach(c -> out.add(c.getId()));
            serviceRepository.findByApplicationId(applicationId)
                .forEach(s -> out.add(s.getId()));
        }
        return out;
    }

    // ---------------------------------------------------------------------
    // Internals
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

    /**
     * Flatten one finding into an ordered register row containing ONLY the
     * requested columns. The {@code cve_*} columns aggregate over the finding's
     * CVEs: summary from the first enriched record, official severity = the
     * HIGHEST across them (worst-case lens), enrichment status = enriched if
     * any is. Entity + ancestor columns come from the live-model resolution.
     */
    private static Map<String, Object> flatten(SecurityFindingEntity f,
                                               List<String> cveIds,
                                               List<String> cweIds,
                                               Map<String, CveEntity> cvesById,
                                               Map<String, CweEntity> cwesById,
                                               Map<String, ResolvedEntity> resolvedEntities,
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

        ResolvedEntity resolved = f.getEntityId() == null
            ? null
            : resolvedEntities.getOrDefault(f.getEntityId(),
                ResolvedEntity.unknown(f.getEntityId()));

        Map<String, Object> all = new LinkedHashMap<>();
        all.put("finding_id", f.getId());
        all.put("entity_id", f.getEntityId());
        all.put("entity_name", resolved == null ? null : resolved.name());
        all.put("application_id", resolved == null ? null : resolved.applicationId());
        all.put("application_name", resolved == null ? null : resolved.applicationName());
        all.put("application_component_id",
            resolved == null ? null : resolved.applicationComponentId());
        all.put("application_component_name",
            resolved == null ? null : resolved.applicationComponentName());
        all.put("service_name", resolved == null ? null : resolved.serviceName());
        all.put("service_repo_location", resolved == null ? null : resolved.serviceRepoLocation());
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

    private static String nameOf(String name, String fallback) {
        return name == null || name.isBlank() ? fallback : name;
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
