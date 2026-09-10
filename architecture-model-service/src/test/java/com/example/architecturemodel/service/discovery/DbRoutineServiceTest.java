package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest;
import com.example.architecturemodel.model.dto.UpsertDbRoutinesRequest.RoutineRecordDto;
import com.example.architecturemodel.model.entity.DbMigrationPackTranslationEntity;
import com.example.architecturemodel.model.entity.discovery.DbRoutineEntity;
import com.example.architecturemodel.repository.entity.DbMigrationPackTranslationRepository;
import com.example.architecturemodel.repository.entity.DbRoutineRepository;
import com.example.architecturemodel.service.procbehaviour.ProcBehaviourService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Spec 1 (Stored Proc &amp; Function Behaviour Program, 2026-09-09): the
 * routine-catalog bulk upsert matches by natural key (stable ids across
 * re-scans), inserts new routines, skips malformed records, and never
 * deletes rows that vanished from the live catalog.
 */
@ExtendWith(MockitoExtension.class)
class DbRoutineServiceTest {

    @Mock
    private DbRoutineRepository repository;
    @Mock
    private DbMigrationPackTranslationRepository translationRepository;
    @Mock
    private ObjectProvider<ProcBehaviourService> procBehaviourProvider;
    @Mock
    private ProcBehaviourService procBehaviourService;

    private static RoutineRecordDto record(String name, String kind, String hash) {
        return new RoutineRecordDto(
            "dbo", name, kind, "TSQL", "create proc " + name + " as select 1", hash, "md5",
            List.of(Map.of("name", "id", "ordinal", 1, "source_type", "int", "direction", "in")),
            null, null, List.of(), Map.of("max_result_sets", 1),
            List.of("ledger_line"), List.of("ledger_ctrl"), List.of(),
            List.of("ledger_line"), List.of("ledger_ctrl"), List.of(),
            "live", true, null);
    }

    @Test
    @DisplayName("existing rows are updated in place (id stable), new ones inserted, malformed skipped")
    void upsertMatchesNaturalKeyAndInsertsNew() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID existingId = UUID.randomUUID();
        DbRoutineEntity existing = DbRoutineEntity.builder()
            .id(existingId).projectId(projectId).architectureId(architectureId)
            .schemaName("dbo").routineName("upd_ledger_roll").routineKind("procedure")
            .fullBody("old body").bodyHash("old-hash").build();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(architectureId))
            .thenReturn(List.of(existing));

        DbRoutineService service = new DbRoutineService(repository, translationRepository, procBehaviourProvider);
        UpsertDbRoutinesRequest request = new UpsertDbRoutinesRequest(UUID.randomUUID(), List.of(
            record("UPD_LEDGER_ROLL", "procedure", "new-hash"),
            record("fn_ledger_total", "function", "fn-hash"),
            record("broken", "widget", "x")
        ));

        int upserted = service.bulkUpsert(projectId, architectureId, request);

        assertThat(upserted).isEqualTo(2);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DbRoutineEntity>> captor = ArgumentCaptor.forClass(List.class);
        verify(repository).saveAll(captor.capture());
        List<DbRoutineEntity> saved = captor.getValue();
        assertThat(saved).hasSize(2);
        DbRoutineEntity updated = saved.stream()
            .filter(e -> "upd_ledger_roll".equals(e.getRoutineName())).findFirst().orElseThrow();
        assertThat(updated.getId()).isEqualTo(existingId);
        assertThat(updated.getBodyHash()).isEqualTo("new-hash");
        assertThat(updated.getWritesClosureJson()).containsExactly("ledger_ctrl");
        DbRoutineEntity inserted = saved.stream()
            .filter(e -> "fn_ledger_total".equals(e.getRoutineName())).findFirst().orElseThrow();
        assertThat(inserted.getRoutineKind()).isEqualTo("function");
        assertThat(inserted.getProjectId()).isEqualTo(projectId);
    }

    @Test
    @DisplayName("drift (Spec 5): a changed body marks pinned-baseline items and linked translations stale; unchanged bodies touch nothing")
    void changedBodyMarksBaselineItemsAndTranslationsStale() {
        UUID projectId = UUID.randomUUID();
        UUID architectureId = UUID.randomUUID();
        UUID changedId = UUID.randomUUID();
        UUID unchangedId = UUID.randomUUID();
        DbRoutineEntity changed = DbRoutineEntity.builder()
            .id(changedId).projectId(projectId).architectureId(architectureId)
            .schemaName("dbo").routineName("upd_ledger_roll").routineKind("procedure")
            .fullBody("old body").bodyHash("old-hash").build();
        DbRoutineEntity unchanged = DbRoutineEntity.builder()
            .id(unchangedId).projectId(projectId).architectureId(architectureId)
            .schemaName("dbo").routineName("fn_ledger_total").routineKind("function")
            .fullBody("same").bodyHash("fn-hash").build();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(architectureId))
            .thenReturn(List.of(changed, unchanged));
        when(procBehaviourProvider.getIfAvailable()).thenReturn(procBehaviourService);
        when(procBehaviourService.markItemsStaleForArchitecture(eq(architectureId), any())).thenReturn(3);
        DbMigrationPackTranslationEntity live = new DbMigrationPackTranslationEntity();
        live.setRoutineId(changedId);
        live.setLoopStatus(DbMigrationPackTranslationEntity.LOOP_RECONCILED);
        DbMigrationPackTranslationEntity dispositioned = new DbMigrationPackTranslationEntity();
        dispositioned.setRoutineId(changedId);
        dispositioned.setLoopStatus(DbMigrationPackTranslationEntity.LOOP_DISPOSITIONED);
        when(translationRepository.findByRoutineIdIn(Set.of(changedId)))
            .thenReturn(List.of(live, dispositioned));

        DbRoutineService service = new DbRoutineService(repository, translationRepository, procBehaviourProvider);
        service.bulkUpsert(projectId, architectureId, new UpsertDbRoutinesRequest(UUID.randomUUID(), List.of(
            record("upd_ledger_roll", "procedure", "new-hash"),
            record("fn_ledger_total", "function", "fn-hash")
        )));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> hashes = ArgumentCaptor.forClass(Map.class);
        verify(procBehaviourService).markItemsStaleForArchitecture(eq(architectureId), hashes.capture());
        assertThat(hashes.getValue()).containsExactly(Map.entry(changedId.toString(), "new-hash"));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<DbMigrationPackTranslationEntity>> saved = ArgumentCaptor.forClass(List.class);
        verify(translationRepository).saveAll(saved.capture());
        assertThat(saved.getValue()).containsExactly(live);
        assertThat(live.getLoopStatus()).isEqualTo(DbMigrationPackTranslationEntity.LOOP_STALE);
        assertThat(live.getStaleReason()).isEqualTo("body_changed");
        assertThat(dispositioned.getLoopStatus()).isEqualTo(DbMigrationPackTranslationEntity.LOOP_DISPOSITIONED);
    }

    @Test
    @DisplayName("no body change: neither the baseline nor the translations are touched")
    void unchangedBodiesTouchNothing() {
        UUID architectureId = UUID.randomUUID();
        DbRoutineEntity same = DbRoutineEntity.builder()
            .id(UUID.randomUUID()).architectureId(architectureId)
            .schemaName("dbo").routineName("upd_ledger_roll").routineKind("procedure")
            .fullBody("b").bodyHash("h").build();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(architectureId))
            .thenReturn(List.of(same));
        new DbRoutineService(repository, translationRepository, procBehaviourProvider)
            .bulkUpsert(UUID.randomUUID(), architectureId,
                new UpsertDbRoutinesRequest(null, List.of(record("upd_ledger_roll", "procedure", "h"))));
        verify(procBehaviourProvider, never()).getIfAvailable();
        verify(translationRepository, never()).findByRoutineIdIn(any());
    }

    @Test
    @DisplayName("an empty request saves nothing and reports zero")
    void emptyRequestIsNoop() {
        UUID architectureId = UUID.randomUUID();
        when(repository.findByArchitectureIdOrderBySchemaNameAscRoutineNameAsc(any()))
            .thenReturn(List.of());
        DbRoutineService service = new DbRoutineService(repository, translationRepository, procBehaviourProvider);
        int upserted = service.bulkUpsert(UUID.randomUUID(), architectureId,
            new UpsertDbRoutinesRequest(null, List.of()));
        assertThat(upserted).isZero();
        verify(repository).saveAll(List.of());
    }
}
