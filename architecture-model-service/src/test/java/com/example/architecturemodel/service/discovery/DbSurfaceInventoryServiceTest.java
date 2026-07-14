package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto;
import com.example.architecturemodel.model.dto.discovery.DbSurfaceInventoryDto.DbSurfaceObjectDto;
import com.example.architecturemodel.model.entity.DataEntityPointEntity;
import com.example.architecturemodel.model.entity.DbMigrationPackEntity;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Spec Q (Data-Tier Oracle Program) — DB surface inventory + unclaimed
 * surface. Pins:
 *
 *   CLAIM PIN     — a table is claimed via its dep_phy point directly AND via
 *                   the dep_log name-bridge; access modes accumulate
 *   PROC PIN      — a stored procedure is claimed when an effect's
 *                   path_metadata_json.proc_name matches its object_ref tail
 *   UNCLAIMED PIN — zero-claim objects are enumerated, never hidden; triggers
 *                   carry unclaimed=null (dimension not applicable)
 *   MERGE PIN     — a pack view row merges onto its physical view row (one
 *                   object, translation disposition attached)
 *   NAME PIN      — normalizeName strips schema prefix, brackets and case
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DbSurfaceInventoryServiceTest {

    private static final UUID PROJECT = UUID.randomUUID();
    private static final UUID ARCH = UUID.randomUUID();
    private static final UUID PACK = UUID.randomUUID();

    @Mock private ModelFileRepository modelFileRepository;
    @Mock private PhysicalDataEntityRepository physicalDataEntityRepository;
    @Mock private LogicalDataEntityRepository logicalDataEntityRepository;
    @Mock private DataEntityPointRepository dataEntityPointRepository;
    @Mock private EndpointDataEffectRepository endpointDataEffectRepository;
    @Mock private DbMigrationPackRepository dbMigrationPackRepository;
    @Mock private DbMigrationPackTranslationRepository dbMigrationPackTranslationRepository;

    private DbSurfaceInventoryService service;

    @BeforeEach
    void setUp() {
        service = new DbSurfaceInventoryService(
            modelFileRepository,
            physicalDataEntityRepository,
            logicalDataEntityRepository,
            dataEntityPointRepository,
            endpointDataEffectRepository,
            dbMigrationPackRepository,
            dbMigrationPackTranslationRepository);

        ModelFileEntity modelFile = mock(ModelFileEntity.class);
        when(modelFile.getId()).thenReturn("mf-1");
        when(modelFileRepository.findByProjectIdAndArchitectureId(PROJECT, ARCH))
            .thenReturn(Optional.of(modelFile));

        // Physical surface: two tables + one view.
        PhysicalDataEntityEntity orders = physical("P1", "orders", "table");
        PhysicalDataEntityEntity auditLog = physical("P2", "audit_log", "table");
        PhysicalDataEntityEntity vOrders = physical("P3", "v_orders", "view");
        when(physicalDataEntityRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(orders, auditLog, vOrders));

        // Logical entity named like the orders table (name-bridge target).
        LogicalDataEntityEntity ordersLogical = mock(LogicalDataEntityEntity.class);
        when(ordersLogical.getId()).thenReturn("L1");
        when(ordersLogical.getName()).thenReturn("Orders");
        when(logicalDataEntityRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(ordersLogical));

        // dep points: one physical, one logical.
        DataEntityPointEntity phyPoint = mock(DataEntityPointEntity.class);
        when(phyPoint.getId()).thenReturn("dep_phy_P1");
        when(phyPoint.getPhysicalEntityId()).thenReturn("P1");
        when(phyPoint.getLogicalEntityId()).thenReturn(null);
        DataEntityPointEntity logPoint = mock(DataEntityPointEntity.class);
        when(logPoint.getId()).thenReturn("dep_log_L1");
        when(logPoint.getPhysicalEntityId()).thenReturn(null);
        when(logPoint.getLogicalEntityId()).thenReturn("L1");
        when(dataEntityPointRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(phyPoint, logPoint));

        // Effects: direct physical claim (read-write), name-bridge claim
        // (read), and a proc-call effect with no dep point.
        EndpointDataEffectEntity direct = effect("dep_phy_P1", "read-write", null);
        EndpointDataEffectEntity bridged = effect("dep_log_L1", "read", null);
        EndpointDataEffectEntity procCall =
            effect(null, "execute", Map.of("proc_name", "dbo.usp_calc"));
        when(endpointDataEffectRepository.findByModelFileId("mf-1"))
            .thenReturn(List.of(direct, bridged, procCall));

        // Pack translations: claimed proc, orphan proc, trigger, and a view
        // row that merges onto the physical v_orders.
        DbMigrationPackEntity pack = mock(DbMigrationPackEntity.class);
        when(pack.getId()).thenReturn(PACK);
        when(dbMigrationPackRepository.findByProjectIdAndArchitectureId(PROJECT, ARCH))
            .thenReturn(Optional.of(pack));
        // Built BEFORE the when(): the helper stubs each mock, and Mockito
        // forbids nested stubbing inside an unfinished thenReturn.
        List<DbMigrationPackTranslationEntity> translationRows = List.of(
            translation("stored_procedure", "dbo.usp_calc", "translate", "approved"),
            translation("stored_procedure", "usp_orphan", "translate", "unreviewed"),
            translation("trigger", "trg_orders", "translate", "unreviewed"),
            translation("view", "dbo.v_orders", "translate", "approved"));
        when(dbMigrationPackTranslationRepository.findByPackIdOrderByCreatedAtAsc(PACK))
            .thenReturn(translationRows);
    }

    private static PhysicalDataEntityEntity physical(String id, String name, String type) {
        PhysicalDataEntityEntity e = mock(PhysicalDataEntityEntity.class);
        when(e.getId()).thenReturn(id);
        when(e.getName()).thenReturn(name);
        when(e.getPhysicalType()).thenReturn(type);
        return e;
    }

    private static EndpointDataEffectEntity effect(
            String pointId, String accessMode, Map<String, Object> meta) {
        EndpointDataEffectEntity e = mock(EndpointDataEffectEntity.class);
        when(e.getDataEntityPointId()).thenReturn(pointId);
        when(e.getAccessMode()).thenReturn(accessMode);
        when(e.getPathMetadataJson()).thenReturn(meta);
        return e;
    }

    private static DbMigrationPackTranslationEntity translation(
            String kind, String objectRef, String disposition, String reviewStatus) {
        DbMigrationPackTranslationEntity t = mock(DbMigrationPackTranslationEntity.class);
        when(t.getKind()).thenReturn(kind);
        when(t.getObjectRef()).thenReturn(objectRef);
        when(t.getDisposition()).thenReturn(disposition);
        when(t.getReviewStatus()).thenReturn(reviewStatus);
        return t;
    }

    private DbSurfaceObjectDto find(DbSurfaceInventoryDto dto, String objectRef) {
        return dto.objects().stream()
            .filter(o -> objectRef.equals(o.objectRef()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("missing object " + objectRef));
    }

    @Test
    void claimsAccumulateFromDirectAndNameBridgedEffects() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        DbSurfaceObjectDto orders = find(dto, "orders");
        assertThat(orders.effectCount()).isEqualTo(2);
        assertThat(orders.readReferenced()).isTrue();
        assertThat(orders.writeReferenced()).isTrue();
        assertThat(orders.unclaimed()).isFalse();
        assertThat(orders.source()).isEqualTo("model");
    }

    @Test
    void unclaimedObjectsAreEnumeratedNeverHidden() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        assertThat(find(dto, "audit_log").unclaimed()).isTrue();
        assertThat(find(dto, "usp_orphan").unclaimed()).isTrue();
        assertThat(dto.summary().unclaimedTables()).isEqualTo(1);
        assertThat(dto.summary().unclaimedStoredProcedures()).isEqualTo(1);
    }

    @Test
    void procClaimMatchesObjectRefTailAgainstEffectProcName() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        DbSurfaceObjectDto proc = find(dto, "dbo.usp_calc");
        assertThat(proc.procCallReferenced()).isTrue();
        assertThat(proc.unclaimed()).isFalse();
        assertThat(proc.translationDisposition()).isEqualTo("translate");
        assertThat(dto.summary().procCallEffects()).isEqualTo(1);
    }

    @Test
    void triggersCarryNullUnclaimedDimension() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        assertThat(find(dto, "trg_orders").unclaimed()).isNull();
        assertThat(dto.summary().triggers()).isEqualTo(1);
    }

    @Test
    void packViewRowMergesOntoPhysicalViewRow() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        DbSurfaceObjectDto view = find(dto, "v_orders");
        assertThat(view.source()).isEqualTo("model");
        assertThat(view.translationDisposition()).isEqualTo("translate");
        assertThat(view.translationReviewStatus()).isEqualTo("approved");
        // Merged: no standalone "dbo.v_orders" row remains.
        assertThat(dto.objects().stream()
            .filter(o -> "dbo.v_orders".equals(o.objectRef()))).isEmpty();
        assertThat(dto.summary().views()).isEqualTo(1);
    }

    @Test
    void summaryTalliesTheWholeSurface() {
        DbSurfaceInventoryDto dto = service.build(PROJECT, ARCH);
        assertThat(dto.summary().tables()).isEqualTo(2);
        assertThat(dto.summary().views()).isEqualTo(1);
        assertThat(dto.summary().storedProcedures()).isEqualTo(2);
        assertThat(dto.summary().triggers()).isEqualTo(1);
        assertThat(dto.summary().effectsTotal()).isEqualTo(3);
        assertThat(dto.objects()).hasSize(6);
    }

    @Test
    void normalizeNameStripsSchemaBracketsAndCase() {
        assertThat(DbSurfaceInventoryService.normalizeName("dbo.[Usp_Calc]"))
            .isEqualTo("usp_calc");
        assertThat(DbSurfaceInventoryService.normalizeName("\"Orders\""))
            .isEqualTo("orders");
        assertThat(DbSurfaceInventoryService.normalizeName("plain"))
            .isEqualTo("plain");
    }
}
