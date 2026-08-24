package com.example.architecturemodel.service.discovery;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto;
import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto.DbSurfaceObjectDto;
import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto.DbSurfaceSummaryDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.model.entity.PhysicalDataEntityEntity;
import com.example.architecturemodel.model.entity.discovery.EndpointDataEffectEntity;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.discovery.EndpointDataEffectRepository;
import com.example.architecturemodel.repository.entity.DataEntityPointRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackRepository;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import com.example.architecturemodel.repository.entity.LogicalDataEntityRepository;
import com.example.architecturemodel.repository.entity.PhysicalDataEntityRepository;
import com.example.architecturemodel.trace.HaikaiTrace;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * DB surface inventory + unclaimed surface — Spec Q of the Data-Tier Oracle
 * Program ({@code agent-os/planning/2026-07-14-data-tier-oracle-program.md}).
 *
 * <p>Read-only aggregation in the {@code MigrationDiscoveryContextService}
 * idiom: no new tables, no Liquibase changesets, no writes. Sources:</p>
 * <ul>
 *   <li>{@code physical_data_entities} — tables / views / materialized views;</li>
 *   <li>{@code db_migration_pack_translations} — stored procedures, triggers
 *       and views with their translation dispositions;</li>
 *   <li>{@code endpoint_data_effects} — the CLAIM evidence: which objects the
 *       discovered application actually touches.</li>
 * </ul>
 *
 * <h2>Claim resolution</h2>
 * <p>A physical table/view is CLAIMED when an effect resolves to its
 * {@code dep_phy_*} point directly, or to a {@code dep_log_*} point whose
 * logical entity carries the SAME NAME case-insensitively (the name-bridge
 * heuristic v1 — code-scan effects usually bind logical entities; a
 * mapping-table join is the recorded follow-up). A stored procedure is
 * CLAIMED when any effect's {@code path_metadata_json.proc_name} matches its
 * translation {@code object_ref} tail. Triggers are never directly claimable
 * ({@code unclaimed = null}).</p>
 *
 * <h2>Unclaimed surface</h2>
 * <p>An UNCLAIMED object has zero claims: dead schema, or another client
 * reads/writes the same database — the shared-database estate risk a DB-only
 * migration must scope before cutover.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
// No-db mode (app.features.include-database=false) runs without JPA
// repositories; every repository-backed bean carries this guard (2026-08-24
// sweep — unguarded beans broke the no-db ApplicationContext).
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class DbSurfaceInventoryService {

    /** Haikai workflow tracer (no-op unless HAIKAI_TRACE is set). */
    private static final HaikaiTrace.Tracer TRACE = HaikaiTrace.forService("ams");

    private final ModelFileRepository modelFileRepository;
    private final PhysicalDataEntityRepository physicalDataEntityRepository;
    private final LogicalDataEntityRepository logicalDataEntityRepository;
    private final DataEntityPointRepository dataEntityPointRepository;
    private final EndpointDataEffectRepository endpointDataEffectRepository;
    private final DbMigrationPackRepository dbMigrationPackRepository;
    private final DbMigrationPackTranslationRepository dbMigrationPackTranslationRepository;

    /** Per-object claim tallies accumulated from effects. */
    private static final class Refs {
        private int count;
        private boolean read;
        private boolean write;
        private boolean procCall;
    }

    @Transactional(readOnly = true)
    public DbSurfaceInventoryDto build(UUID projectId, UUID architectureId) {
        long startedAt = System.currentTimeMillis();
        ModelFileEntity modelFile = modelFileRepository
            .findByProjectIdAndArchitectureId(projectId, architectureId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Model file not found for project: " + projectId
                    + " architecture: " + architectureId));
        String modelFileId = modelFile.getId();

        List<PhysicalDataEntityEntity> physicals =
            physicalDataEntityRepository.findByModelFileId(modelFileId);
        List<LogicalDataEntityEntity> logicals =
            logicalDataEntityRepository.findByModelFileId(modelFileId);
        List<DataEntityPointEntity> points =
            dataEntityPointRepository.findByModelFileId(modelFileId);
        List<EndpointDataEffectEntity> effects =
            endpointDataEffectRepository.findByModelFileId(modelFileId);

        // dep point id -> owning entity id, split by point kind.
        Map<String, String> physicalIdByPointId = new HashMap<>();
        Map<String, String> logicalIdByPointId = new HashMap<>();
        for (DataEntityPointEntity p : points) {
            if (p.getPhysicalEntityId() != null) {
                physicalIdByPointId.put(p.getId(), p.getPhysicalEntityId());
            }
            if (p.getLogicalEntityId() != null) {
                logicalIdByPointId.put(p.getId(), p.getLogicalEntityId());
            }
        }
        Map<String, String> logicalNameById = new HashMap<>();
        for (LogicalDataEntityEntity l : logicals) {
            if (l.getName() != null) {
                logicalNameById.put(l.getId(), normalizeName(l.getName()));
            }
        }
        // Name-bridge: physical entities indexed by normalized name.
        Map<String, String> physicalIdByName = new HashMap<>();
        for (PhysicalDataEntityEntity phy : physicals) {
            if (phy.getName() != null) {
                physicalIdByName.putIfAbsent(normalizeName(phy.getName()), phy.getId());
            }
        }

        // Walk effects once: physical claims (direct + name-bridge) and
        // proc-name claims.
        Map<String, Refs> refsByPhysicalId = new HashMap<>();
        Set<String> procNamesReferenced = new HashSet<>();
        int procCallEffects = 0;
        for (EndpointDataEffectEntity e : effects) {
            String mode = e.getAccessMode() == null
                ? "" : e.getAccessMode().toLowerCase(Locale.ROOT);
            boolean isProcCall = false;
            Map<String, Object> meta = e.getPathMetadataJson();
            Object procName = meta == null ? null : meta.get("proc_name");
            if (procName instanceof String s && !s.isBlank()) {
                procCallEffects++;
                procNamesReferenced.add(normalizeName(s));
                isProcCall = true;
            }

            String pointId = e.getDataEntityPointId();
            String physId = pointId == null ? null : physicalIdByPointId.get(pointId);
            if (physId == null && pointId != null) {
                String logId = logicalIdByPointId.get(pointId);
                String logName = logId == null ? null : logicalNameById.get(logId);
                if (logName != null) {
                    physId = physicalIdByName.get(logName);
                }
            }
            if (physId != null) {
                Refs r = refsByPhysicalId.computeIfAbsent(physId, k -> new Refs());
                r.count++;
                if (mode.contains("read")) {
                    r.read = true;
                }
                if (mode.contains("write")) {
                    r.write = true;
                }
                if (isProcCall || "execute".equals(mode)) {
                    r.procCall = true;
                }
            }
        }

        // Translation rows (procs / triggers / views with dispositions).
        List<DbMigrationPackTranslationEntity> translations =
            dbMigrationPackRepository.findByProjectIdAndArchitectureId(projectId, architectureId)
                .map(pack -> dbMigrationPackTranslationRepository
                    .findByPackIdOrderByCreatedAtAsc(pack.getId()))
                .orElse(List.of());
        Map<String, DbMigrationPackTranslationEntity> viewTranslationByName = new HashMap<>();
        for (DbMigrationPackTranslationEntity t : translations) {
            if ("view".equalsIgnoreCase(t.getKind()) && t.getObjectRef() != null) {
                viewTranslationByName.putIfAbsent(normalizeName(t.getObjectRef()), t);
            }
        }

        List<DbSurfaceObjectDto> objects = new ArrayList<>();
        int tables = 0;
        int views = 0;
        int procs = 0;
        int triggers = 0;
        int unclaimedTables = 0;
        int unclaimedViews = 0;
        int unclaimedProcs = 0;

        for (PhysicalDataEntityEntity phy : physicals) {
            String kind = phy.getPhysicalType() == null
                ? "table" : phy.getPhysicalType().toLowerCase(Locale.ROOT);
            boolean isView = kind.contains("view");
            Refs r = refsByPhysicalId.get(phy.getId());
            boolean unclaimed = r == null || r.count == 0;
            DbMigrationPackTranslationEntity viewT = isView && phy.getName() != null
                ? viewTranslationByName.remove(normalizeName(phy.getName()))
                : null;
            objects.add(new DbSurfaceObjectDto(
                phy.getName(),
                kind,
                "model",
                r == null ? 0 : r.count,
                r != null && r.read,
                r != null && r.write,
                r != null && r.procCall,
                viewT == null ? null : viewT.getDisposition(),
                viewT == null ? null : viewT.getReviewStatus(),
                unclaimed
            ));
            if (isView) {
                views++;
                if (unclaimed) {
                    unclaimedViews++;
                }
            } else {
                tables++;
                if (unclaimed) {
                    unclaimedTables++;
                }
            }
        }

        for (DbMigrationPackTranslationEntity t : translations) {
            String kind = t.getKind() == null ? "" : t.getKind().toLowerCase(Locale.ROOT);
            if ("view".equals(kind) && t.getObjectRef() != null
                && !viewTranslationByName.containsKey(normalizeName(t.getObjectRef()))) {
                // Already merged onto its physical row above.
                continue;
            }
            switch (kind) {
                case "stored_procedure" -> {
                    boolean claimed = t.getObjectRef() != null
                        && procNamesReferenced.contains(normalizeName(t.getObjectRef()));
                    objects.add(new DbSurfaceObjectDto(
                        t.getObjectRef(), kind, "translation_pack",
                        0, false, false, claimed,
                        t.getDisposition(), t.getReviewStatus(),
                        !claimed
                    ));
                    procs++;
                    if (!claimed) {
                        unclaimedProcs++;
                    }
                }
                case "trigger" -> {
                    objects.add(new DbSurfaceObjectDto(
                        t.getObjectRef(), kind, "translation_pack",
                        0, false, false, false,
                        t.getDisposition(), t.getReviewStatus(),
                        null
                    ));
                    triggers++;
                }
                case "view" -> {
                    // A pack view with no matching physical row: standalone.
                    objects.add(new DbSurfaceObjectDto(
                        t.getObjectRef(), kind, "translation_pack",
                        0, false, false, false,
                        t.getDisposition(), t.getReviewStatus(),
                        true
                    ));
                    views++;
                    unclaimedViews++;
                }
                default -> { /* unknown kind: skip, never throw */ }
            }
        }

        objects.sort(Comparator
            .comparing(DbSurfaceObjectDto::kind)
            .thenComparing(o -> o.objectRef() == null ? "" : o.objectRef()));

        DbSurfaceSummaryDto summary = new DbSurfaceSummaryDto(
            tables, views, procs, triggers,
            effects.size(), procCallEffects,
            unclaimedTables, unclaimedViews, unclaimedProcs);

        log.info("[diag-ams] op=db_surface_inventory project={} elapsed_ms={} "
                + "tables={} views={} procs={} triggers={} effects={} "
                + "unclaimed={}/{}/{}",
            projectId.toString().substring(0, 8),
            System.currentTimeMillis() - startedAt,
            tables, views, procs, triggers, effects.size(),
            unclaimedTables, unclaimedViews, unclaimedProcs);

        // SCAN.DBINV predicates (predicate run-judging): the inventory is the
        // DB-only migration's book-of-work basis; the unclaimed surface is the
        // shared-database risk signal. Emission only.
        HaikaiTrace.Corr corr = HaikaiTrace.Corr.of()
            .project(projectId.toString())
            .arch(architectureId.toString());
        TRACE.predicate("SCAN.DBINV.01", "db surface inventory computed",
            true,
            "committed model yields a per-object inventory",
            "tables=" + tables + " views=" + views + " procs=" + procs
                + " triggers=" + triggers + " effects=" + effects.size()
                + " proc_call_effects=" + procCallEffects,
            corr);
        TRACE.predicate("SCAN.DBINV.02", "unclaimed db surface enumerated",
            true,
            "objects with zero effect claims are enumerated, never hidden",
            "unclaimed tables=" + unclaimedTables + " views=" + unclaimedViews
                + " procs=" + unclaimedProcs
                + " (unclaimed writes may belong to another client — scope before cutover)",
            corr);

        return new DbSurfaceInventoryDto(objects, summary);
    }

    /** Lowercase, strip brackets/quotes, take the segment after the last dot. */
    static String normalizeName(String raw) {
        String s = raw.trim().toLowerCase(Locale.ROOT)
            .replace("[", "").replace("]", "").replace("\"", "");
        int dot = s.lastIndexOf('.');
        return dot >= 0 ? s.substring(dot + 1) : s;
    }
}
