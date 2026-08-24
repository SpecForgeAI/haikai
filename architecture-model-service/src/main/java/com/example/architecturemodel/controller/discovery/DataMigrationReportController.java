package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.model.entity.DataMigrationReportEntity;
import com.example.architecturemodel.repository.entity.DataMigrationReportRepository;
import com.example.architecturemodel.trace.HaikaiTrace;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Data-migration (bulk load) reports — the parity-report sibling.
 *
 * <pre>
 *   POST /api/projects/{p}/architectures/{a}/data-migration-reports        (AMVS runner)
 *   GET  /api/projects/{p}/architectures/{a}/data-migration-reports/latest (diagnosis)
 * </pre>
 *
 * <p>The POST body is the runner's snake_case report, stored verbatim in
 * {@code report_json}; the summary status / counters / pair id / ruleset
 * version are lifted onto columns for a cheap read. Critically, the save
 * logs one WARN line PER INCOMPLETE TABLE naming the table, its
 * loaded-of-source counts and the VERBATIM failure reason — the console
 * answers "why did these 13 tables fail" directly, no row-count
 * inference.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/data-migration-reports")
@RequiredArgsConstructor
@Slf4j
// No-db mode (app.features.include-database=false) runs without JPA
// repositories; every DB-backed controller carries this guard — this one
// missed it and broke the no-db ApplicationContext (found by the
// ApiContractSmokeTest no-db nested classes, 2026-08-24 sweep).
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DataMigrationReportController {

    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    private final DataMigrationReportRepository repository;

    @PostMapping
    public ResponseEntity<Map<String, Object>> save(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody Map<String, Object> report) {
        String status = "unverifiable";
        Integer tablesTotal = null;
        Integer tablesLoaded = null;
        Integer tablesMismatched = null;
        Integer tablesUnverifiable = null;
        Long rowsLoaded = null;
        Object summary = report.get("summary");
        if (summary instanceof Map<?, ?> s) {
            if (s.get("status") instanceof String st && !st.isBlank()) {
                status = st;
            }
            tablesTotal = asInt(s.get("tables"));
            tablesLoaded = asInt(s.get("loaded"));
            tablesMismatched = asInt(s.get("mismatched"));
            tablesUnverifiable = asInt(s.get("unverifiable"));
            rowsLoaded = s.get("rows_loaded") instanceof Number n ? n.longValue() : null;
        }
        String pairId = report.get("pair_id") instanceof String p ? p : null;
        Integer rulesetVersion =
            report.get("ruleset_version") instanceof Number n ? n.intValue() : null;

        DataMigrationReportEntity saved = repository.save(DataMigrationReportEntity.builder()
            .projectId(projectId)
            .architectureId(architectureId)
            .status(status)
            .migrationPair(pairId)
            .rulesetVersion(rulesetVersion)
            .tablesTotal(tablesTotal)
            .tablesLoaded(tablesLoaded)
            .tablesMismatched(tablesMismatched)
            .tablesUnverifiable(tablesUnverifiable)
            .rowsLoaded(rowsLoaded)
            .reportJson(report)
            .build());

        // One WARN per incomplete table with the VERBATIM reason — the whole
        // point of persisting this report: the console names each failure.
        if (report.get("tables") instanceof List<?> tables) {
            for (Object row : tables) {
                if (!(row instanceof Map<?, ?> t)) {
                    continue;
                }
                Object tableStatus = t.get("status");
                if ("loaded".equals(tableStatus) || "empty".equals(tableStatus)) {
                    continue;
                }
                log.warn(
                    "[diag-ams] op=data_migration_table_incomplete project={} table={}.{} "
                        + "status={} loaded={}/{} reason={}",
                    projectId.toString().substring(0, 8),
                    t.get("schema"), t.get("table"),
                    tableStatus, t.get("loadedCount"), t.get("sourceCount"),
                    t.get("reason"));
            }
        }

        log.info("[diag-ams] op=data_migration_report_saved project={} status={} pair={} rows_loaded={}",
            projectId.toString().substring(0, 8), status, pairId, rowsLoaded);
        TRACE.ok("data-migration report saved — status=" + status
                + (pairId != null ? " pair=" + pairId : "")
                + (rowsLoaded != null ? " rows_loaded=" + rowsLoaded : ""),
            HaikaiTrace.Corr.of()
                .project(projectId.toString())
                .arch(architectureId.toString()));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", saved.getId());
        return ResponseEntity.ok(body);
    }

    @GetMapping("/latest")
    public ResponseEntity<DataMigrationReportEntity> latest(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return repository
            .findTopByProjectIdAndArchitectureIdOrderByCreatedAtDesc(projectId, architectureId)
            .map(ResponseEntity::ok)
            .orElseGet(() -> ResponseEntity.notFound().build());
    }

    private static Integer asInt(Object value) {
        return value instanceof Number n ? n.intValue() : null;
    }
}
